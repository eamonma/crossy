// The WebSocket server (PROTOCOL.md §2; DESIGN.md §3, §4, §6). `ws` was the settled
// library choice (SP4). One `ws` server attaches to a Node http.Server so health and
// future /internal endpoints can share the listener. Endpoint: /games/{gameId}/ws.
//
// Per connection: the first frame is the handshake; on success the socket goes live and
// routes mutations to the game's actor. Frames from one socket are handled through a
// small serial queue so the handshake completes before any command is processed, and so
// two frames never interleave. The actor's own mailbox is what serializes across sockets
// (INV-2); this queue only orders a single socket's frames.
//
// Out of this slice (reported as deferrals): presence/heartbeat/cursors are accepted and
// ignored (PROTOCOL.md §9); requestSync and checkRequest are not answered yet (reconnect
// resync is Wave 2.2, check is Phase 3). Persistence writes are Wave 2.2; state is
// in-memory here.

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
  ClientMessage,
  Decoded,
  Participant,
  ServerMessage,
  WelcomeMessage,
} from "@crossy/protocol";
import type { Pool } from "pg";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type { Connection, GameActor } from "./actor";
import { colorForUser } from "./color";
import { errorFrame } from "./frames";
import { performHandshake } from "./handshake";
import { Mailbox } from "./mailbox";
import { ActorRegistry } from "./registry";
import { loadMembers } from "./repo";

const GAME_PATH = /^\/games\/([^/]+)\/ws$/;

/** A tombstoned user has a null display name; render it per DESIGN.md §8. */
const FORMER_PARTICIPANT = "former participant";

export interface SessionServerConfig {
  readonly authPort: AuthPort;
  readonly pool: Pool;
  /** Injected clock (INV-9 keeps the engine clock-free; the actor owns the clock here). */
  readonly now?: () => Date;
  /** Listen port; 0 (default) picks an ephemeral port, which tests read back. */
  readonly port?: number;
  readonly host?: string;
}

export interface SessionServer {
  readonly port: number;
  /** Base ws URL, e.g. ws://127.0.0.1:PORT . Append /games/{id}/ws to connect. */
  readonly url: string;
  close(): Promise<void>;
}

/** Start the session WebSocket server and resolve once it is listening. */
export function createSessionServer(
  config: SessionServerConfig,
): Promise<SessionServer> {
  const now = config.now ?? (() => new Date());
  const host = config.host ?? "127.0.0.1";
  const registry = new ActorRegistry(config.pool, now);

  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
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

  return new Promise<SessionServer>((resolve) => {
    httpServer.listen(config.port ?? 0, host, () => {
      const port = (httpServer.address() as AddressInfo).port;
      resolve({
        port,
        url: `ws://${host}:${port}`,
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
    if (ws.readyState === ws.OPEN) ws.send(encode(frame));
  };

  ws.on("message", (data: RawData) => {
    void frames
      .post(async () => {
        const decoded = parseFrame(data);
        if (!live) {
          await runHandshake(decoded);
        } else {
          handleLiveFrame(decoded);
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

  function handleLiveFrame(decoded: Decoded<ClientMessage>): void {
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
      case "moveCursor":
      case "heartbeat":
        return; // accepted and ignored (PROTOCOL.md §9, out of this slice)
      case "requestSync":
      case "checkRequest":
        return; // deferred: resync is Wave 2.2, check is Phase 3 (see the report)
      case "hello":
        return; // a second hello after handshake is unexpected; ignore
    }
  }
}

/** Build the `welcome` frame with a full board snapshot (PROTOCOL.md §2, §4). */
async function buildWelcome(
  pool: Pool,
  gameId: string,
  actor: GameActor,
  self: Connection,
): Promise<WelcomeMessage> {
  const members = await loadMembers(pool, gameId);
  const connected = actor.connectedUserIds();
  const participants: Participant[] = members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName ?? FORMER_PARTICIPANT,
    color: colorForUser(member.userId),
    role: member.role,
    connected: connected.has(member.userId),
  }));
  return {
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    self: { userId: self.userId, role: self.role },
    board: actor.snapshotBoard(participants),
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
