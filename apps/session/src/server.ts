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

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
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
import { applyMembershipChange, parseMembershipChangedBody } from "./internal";
import { Mailbox } from "./mailbox";
import { ActorRegistry } from "./registry";
import { loadMembers } from "./repo";

const GAME_PATH = /^\/games\/([^/]+)\/ws$/;
const INTERNAL_PATH = /^\/internal\/games\/([^/]+)\/membership-changed$/;

/** Cap on the internal request body; a membership-changed hint is a handful of bytes. */
const MAX_INTERNAL_BODY_BYTES = 4096;

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
  /**
   * The static internal bearer secret (DESIGN.md §6). When set, `POST /internal/games/{id}/
   * membership-changed` requires `Authorization: Bearer <this>`; when omitted the endpoint is
   * disabled (503), so a deploy that forgets to inject it fails loudly rather than serving the
   * endpoint unauthenticated. Injected from config (INTERNAL_BEARER_TOKEN), never hardcoded.
   */
  readonly internalBearer?: string;
  /**
   * When set, `/internal` is served ONLY on this second port and the public `port` returns
   * 404 for it. On Railway only `port` gets a public domain, so this keeps the internal
   * endpoint reachable over the private network (`session.railway.internal:<internalPort>`)
   * yet unreachable from the edge (DESIGN.md §6, §15). Injected from config (INTERNAL_PORT).
   * When omitted (local, dev-stack, tests), `/internal` is served on `port` as before.
   */
  readonly internalPort?: number;
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

  // The internal endpoint is served on the public `port` only when no separate
  // `internalPort` is configured. In a Railway deploy `internalPort` is set, so the public
  // WS domain returns 404 for `/internal` and only the private port answers it.
  const publicServesInternal = config.internalPort === undefined;

  const makeHttpHandler =
    (serveInternal: boolean) =>
    (req: IncomingMessage, res: ServerResponse): void => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      const internalMatch =
        req.method === "POST" ? INTERNAL_PATH.exec(path) : null;
      if (internalMatch !== null) {
        if (!serveInternal) {
          // /internal lives on the private INTERNAL_PORT listener, not this public one.
          sendJson(res, 404, { error: "NOT_FOUND" });
          return;
        }
        void handleInternalRequest(req, res, internalMatch[1]!, {
          registry,
          pool: config.pool,
          internalBearer: config.internalBearer,
        }).catch(() => sendJson(res, 500, { error: "INTERNAL" }));
        return;
      }
      // Everything else is the health probe (DESIGN.md §6; dev-stack waits on `/`).
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    };

  const httpServer = createServer(makeHttpHandler(publicServesInternal));
  // A second listener for /internal, private-network only (no WS upgrade). Null unless
  // INTERNAL_PORT is set, so the local/test single-port shape is untouched.
  const internalHttpServer =
    config.internalPort !== undefined
      ? createServer(makeHttpHandler(true))
      : null;

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
    // Stop the listeners from accepting new sockets; existing ones stay up for the flush.
    httpServer.close();
    internalHttpServer?.close();
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

  // Bind the private internal listener (if any) before resolving, so a caller that reads
  // back the server can immediately reach both ports.
  const listenInternal = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (internalHttpServer === null) {
        resolve();
        return;
      }
      internalHttpServer.listen(config.internalPort!, host, () => resolve());
    });

  return new Promise<SessionServer>((resolve) => {
    httpServer.listen(config.port ?? 0, host, () => {
      const port = (httpServer.address() as AddressInfo).port;
      void listenInternal().then(() => {
        resolve({
          port,
          url: `ws://${host}:${port}`,
          drain,
          close: () => closeServer(httpServer, wss, internalHttpServer),
        });
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
    const conn: Connection = {
      userId: result.userId,
      role: result.role,
      send,
      close: (code, reason) => ws.close(code, reason),
    };
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

interface InternalRequestDeps {
  readonly registry: ActorRegistry;
  readonly pool: Pool;
  /** Explicitly nullable (not optional) so the composition root may pass an unset value. */
  readonly internalBearer: string | undefined;
}

/** Write a small JSON body with a status; the internal endpoint's only response shape. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Constant-time bearer check (DESIGN.md §6). The secret arrives via injected config, never
 * hardcoded. A length-guarded `timingSafeEqual` avoids leaking the secret length through timing
 * and never throws on a mismatched length.
 */
function bearerOk(header: string | undefined, secret: string): boolean {
  if (header === undefined) return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (match === null) return false;
  const provided = Buffer.from(match[1]!);
  const expected = Buffer.from(secret);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

/** Read the request body to a string, rejecting once it exceeds the internal-body cap. */
function readInternalBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INTERNAL_BODY_BYTES) {
        reject(new Error("internal request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Serve `POST /internal/games/{id}/membership-changed` (DESIGN.md §6). Bearer-authenticated;
 * the body is a hint the actor never trusts for authority (INV-8). The endpoint is disabled
 * (503) when no bearer is configured, so a misconfigured deploy fails closed rather than
 * serving it open.
 */
async function handleInternalRequest(
  req: IncomingMessage,
  res: ServerResponse,
  gameId: string,
  deps: InternalRequestDeps,
): Promise<void> {
  if (deps.internalBearer === undefined || deps.internalBearer === "") {
    sendJson(res, 503, { error: "INTERNAL_ENDPOINT_DISABLED" });
    return;
  }
  const header = req.headers["authorization"];
  if (header === undefined) {
    sendJson(res, 401, { error: "UNAUTHORIZED" });
    return;
  }
  if (!bearerOk(header, deps.internalBearer)) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readInternalBody(req));
  } catch {
    sendJson(res, 400, { error: "VALIDATION" });
    return;
  }
  const body = parseMembershipChangedBody(parsed);
  if (body === null) {
    sendJson(res, 400, { error: "VALIDATION" });
    return;
  }

  await applyMembershipChange(
    { registry: deps.registry, pool: deps.pool },
    gameId,
    body,
  );
  sendJson(res, 200, { ok: true });
}

function closeServer(
  server: Server,
  wss: WebSocketServer,
  internalServer: Server | null,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    for (const client of wss.clients) client.terminate();
    internalServer?.close();
    wss.close(() => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
}
