// The WebSocket server (PROTOCOL.md §2, §7; DESIGN.md §3, §4, §6). `ws` was the settled
// library choice (SP4). One `ws` server attaches to a Node http.Server so health and
// future /internal endpoints can share the listener. Endpoint: /games/{gameId}/ws.
//
// Per connection: the first frame is the handshake; on success the socket goes live and
// routes mutations to the game's actor. Frames from one socket are handled through a
// small serial queue so the handshake completes before any command is processed, and so
// two frames never interleave. The actor's own mailbox is what serializes across sockets
// (INV-2); this queue only orders a single socket's frames.
//
// Reconnect resync (PROTOCOL.md §7, §8): `requestSync` replies with a full `sync`
// snapshot, and the reconnect `welcome` carries the same board with real
// `recentCommandIds`. Per SP4, `permessage-deflate` is negotiated but only the snapshot
// frames (`welcome`, `sync`) are actually compressed; the tiny keystroke stream is sent
// uncompressed, and `serverNoContextTakeover` keeps no standing per-connection zlib
// context (SP4's ~220 KB/conn concern).
//
// Drain (DESIGN.md §6, INV-5): SIGTERM stops accepting connections, flushes every live
// actor, then closes all sockets with 1001 (clients reconnect on 1001, PROTOCOL.md §2).
//
// Out of this slice (reported as deferrals): presence/heartbeat/cursors are accepted and
// ignored (PROTOCOL.md §9); checkRequest is Phase 3.

import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { AuthPort } from "@crossy/auth";
import {
  PROTOCOL_VERSION,
  decodeClientMessage,
  encode,
} from "@crossy/protocol";
import type {
  Board,
  ClientMessage,
  Decoded,
  Participant,
  ServerMessage,
  WelcomeMessage,
} from "@crossy/protocol";
import type { Pool } from "pg";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type { ActorOptions, Connection, GameActor } from "./actor";
import { colorForUser } from "./color";
import { errorFrame } from "./frames";
import { performHandshake } from "./handshake";
import { Mailbox } from "./mailbox";
import { ActorRegistry } from "./registry";
import { loadMembers } from "./repo";

const GAME_PATH = /^\/games\/([^/]+)\/ws$/;

/** A tombstoned user has a null display name; render it per DESIGN.md §8. */
const FORMER_PARTICIPANT = "former participant";

/** Snapshot frames are the only ones worth compressing (SP4). */
function isSnapshotFrame(frame: ServerMessage): boolean {
  return frame.type === "welcome" || frame.type === "sync";
}

export interface SessionServerConfig {
  readonly authPort: AuthPort;
  readonly pool: Pool;
  /** Injected clock (INV-9 keeps the engine clock-free; the actor owns the clock here). */
  readonly now?: () => Date;
  /** Listen port; 0 (default) picks an ephemeral port, which tests read back. */
  readonly port?: number;
  readonly host?: string;
  /** Write-behind flush tuning, passed to every actor (DESIGN.md §15). */
  readonly actorOptions?: ActorOptions;
}

export interface SessionServer {
  readonly port: number;
  /** Base ws URL, e.g. ws://127.0.0.1:PORT . Append /games/{id}/ws to connect. */
  readonly url: string;
  /**
   * Graceful shutdown (SIGTERM, INV-5): stop accepting connections, flush every live
   * actor, then close all sockets with 1001. Resolves once everything is durable.
   */
  drain(): Promise<void>;
  /** Hard teardown for tests: terminate sockets without a drain. */
  close(): Promise<void>;
}

/** Start the session WebSocket server and resolve once it is listening. */
export function createSessionServer(
  config: SessionServerConfig,
): Promise<SessionServer> {
  const now = config.now ?? (() => new Date());
  const host = config.host ?? "127.0.0.1";
  const registry = new ActorRegistry(config.pool, now, config.actorOptions);
  let draining = false;

  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });

  // permessage-deflate negotiated, but only snapshot frames pass `compress: true`
  // (see `send` below). No standing per-connection zlib context (SP4).
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: {
      threshold: 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      zlibDeflateOptions: { level: 6 },
    },
  });

  httpServer.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (draining) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }
      const gameId = parseGameId(request.url);
      if (gameId === null) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleConnection(ws, gameId, {
          authPort: config.authPort,
          pool: config.pool,
          registry,
        });
      });
    },
  );

  async function drain(): Promise<void> {
    draining = true;
    // Stop the listener from accepting new sockets; existing ones stay up for the flush.
    httpServer.close();
    const actors = await registry.liveActors();
    for (const actor of actors) {
      try {
        await actor.drain();
      } catch {
        // One actor's flush fault must not abort draining the rest.
      }
    }
    for (const client of wss.clients) client.close(1001, "server shutdown");
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  return new Promise<SessionServer>((resolve) => {
    httpServer.listen(config.port ?? 0, host, () => {
      const port = (httpServer.address() as AddressInfo).port;
      resolve({
        port,
        url: `ws://${host}:${port}`,
        drain,
        close: () => closeServer(httpServer, wss),
      });
    });
  });
}

interface ConnectionDeps {
  readonly authPort: AuthPort;
  readonly pool: Pool;
  readonly registry: ActorRegistry;
}

function handleConnection(
  ws: WebSocket,
  gameId: string,
  deps: ConnectionDeps,
): void {
  // One serial queue per socket: the handshake settles before any later frame is handled.
  const frames = new Mailbox();
  let live = false;
  let actor: GameActor | null = null;
  let connection: Connection | null = null;

  const send = (frame: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) {
      // Compress snapshot frames only (SP4); the keystroke stream stays uncompressed.
      ws.send(encode(frame), { compress: isSnapshotFrame(frame) });
    }
  };

  ws.on("message", (data: RawData) => {
    void frames
      .post(async () => {
        const decoded = parseFrame(data);
        if (!live) {
          await runHandshake(decoded);
        } else {
          await handleLiveFrame(decoded);
        }
      })
      .catch(() => {
        // A handler fault must not take down the socket; drop and keep serving.
      });
  });

  ws.on("close", () => {
    if (actor !== null && connection !== null) {
      actor.removeConnection(connection);
    }
  });
  ws.on("error", () => {
    // Transport errors surface as a close; nothing else to do in this slice.
  });

  async function runHandshake(decoded: Decoded<ClientMessage>): Promise<void> {
    const result = await performHandshake(deps, gameId, decoded);
    if (!result.ok) {
      send(result.error);
      ws.close(1008, result.error.code);
      return;
    }
    const conn: Connection = { userId: result.userId, role: result.role, send };
    result.actor.addConnection(conn);
    actor = result.actor;
    connection = conn;
    live = true;
    send(await buildWelcome(deps.pool, gameId, result.actor, conn));
  }

  async function handleLiveFrame(
    decoded: Decoded<ClientMessage>,
  ): Promise<void> {
    if (!decoded.ok) {
      if (decoded.error.kind === "unknown_type") {
        // Unknown command type (PROTOCOL.md §5): non-fatal UNKNOWN_TYPE, no commandId.
        send(errorFrame("UNKNOWN_TYPE", decoded.error.detail));
      }
      // A malformed frame carries no type and no code in §11; drop it (see the report).
      return;
    }
    const message = decoded.value;
    switch (message.type) {
      case "placeLetter":
      case "clearCell":
        if (actor !== null && connection !== null) {
          void actor.submit(connection, message);
        }
        return;
      case "requestSync":
        // Full-snapshot resync (PROTOCOL.md §7): reply `sync` with the current board.
        if (actor !== null) {
          const board = await buildBoardPayload(deps.pool, gameId, actor);
          send({ type: "sync", board });
        }
        return;
      case "moveCursor":
      case "heartbeat":
        return; // accepted and ignored (PROTOCOL.md §9, out of this slice)
      case "checkRequest":
        return; // deferred: check is Phase 3 (see the report)
      case "hello":
        return; // a second hello after handshake is unexpected; ignore
    }
  }
}

/** Build the §4 board payload with live participants, shared by `welcome` and `sync`. */
async function buildBoardPayload(
  pool: Pool,
  gameId: string,
  actor: GameActor,
): Promise<Board> {
  const members = await loadMembers(pool, gameId);
  const connected = actor.connectedUserIds();
  const participants: Participant[] = members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName ?? FORMER_PARTICIPANT,
    color: colorForUser(member.userId),
    role: member.role,
    connected: connected.has(member.userId),
  }));
  return actor.snapshotBoard(participants);
}

/** Build the `welcome` frame with a full board snapshot (PROTOCOL.md §2, §4). */
async function buildWelcome(
  pool: Pool,
  gameId: string,
  actor: GameActor,
  self: Connection,
): Promise<WelcomeMessage> {
  return {
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    self: { userId: self.userId, role: self.role },
    board: await buildBoardPayload(pool, gameId, actor),
  };
}

function parseGameId(url: string | undefined): string | null {
  if (url === undefined) return null;
  const path = url.split("?")[0] ?? "";
  const match = GAME_PATH.exec(path);
  return match?.[1] ?? null;
}

function parseFrame(data: RawData): Decoded<ClientMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    return {
      ok: false,
      error: { kind: "malformed", detail: "frame is not valid JSON" },
    };
  }
  return decodeClientMessage(parsed);
}

function closeServer(server: Server, wss: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
}
