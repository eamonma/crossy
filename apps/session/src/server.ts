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
// Presence (PROTOCOL.md §6, §9): a socket going live broadcasts `playerConnected` to the
// others when it is the user's first live socket; its close broadcasts `playerDisconnected`
// when it was the user's last. `moveCursor` relays as a `cursor` notice, rate-capped at 10/s
// per socket; the actor records each user's cursor so the next snapshot carries the current
// view (PROTOCOL.md §4, §9), and an out-of-range or black-square cursor is dropped silently.
// Liveness: 45 s with no inbound frame of any type terminates the socket, so the close path
// broadcasts the disconnect; any received frame (heartbeat included) resets the timer. The
// liveness timer lives on the socket, not the actor, so it cannot leak across actor passivation:
// a close always clears it, and a passivated actor has no sockets.

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { AuthPort } from "@crossy/auth";
import {
  PROTOCOL_VERSION,
  assignRoomColors,
  colorForUser,
  decodeClientMessage,
  encode,
} from "@crossy/protocol";
import type {
  Board,
  ClientMessage,
  Decoded,
  Participant,
  PlayerConnectedMessage,
  ServerMessage,
  WelcomeMessage,
} from "@crossy/protocol";
import type { Pool } from "pg";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type { ActorOptions, Connection, GameActor } from "./actor";
import type { Analytics } from "./analytics/analytics";
import { errorFrame } from "./frames";
import { performHandshake } from "./handshake";
import { applyMembershipChange, parseMembershipChangedBody } from "./internal";
import { Mailbox } from "./mailbox";
import type { ActivityPushEmitter } from "./push/emitter";
import { ActorRegistry } from "./registry";
import { loadMembers } from "./repo";

const GAME_PATH = /^\/games\/([^/]+)\/ws$/;
const INTERNAL_PATH = /^\/internal\/games\/([^/]+)\/membership-changed$/;
/**
 * The Live Activity welcome notice (PROTOCOL.md 12a): the API POSTs here after a token registers,
 * so the emitter hands the fresh island the current authoritative frame at once. Same internal
 * listener, same bearer, same private-port routing as membership-changed.
 */
const INTERNAL_LA_REGISTERED_PATH =
  /^\/internal\/games\/([^/]+)\/live-activity-registered$/;

/** Cap on the internal request body; a membership-changed hint is a handful of bytes. */
const MAX_INTERNAL_BODY_BYTES = 4096;

/** A tombstoned user has a null display name; render it per DESIGN.md §8. */
const FORMER_PARTICIPANT = "former participant";

/**
 * Liveness window (PROTOCOL.md §9): 45 s with no inbound frame of any type marks a connection
 * dead. Any received frame (heartbeat every 15 s, or a command) resets the timer, so an active
 * client never flaps. Tunable per server for tests, which set a small value rather than sleeping
 * 45 s in CI.
 */
const LIVENESS_TIMEOUT_MS = 45_000;

/**
 * Passivation sweep cadence (DESIGN.md §6): how often the registry looks for idle actors.
 * Cheap (a map scan; drains only fire for eviction candidates), so a minute keeps the
 * eviction lag small next to the 30-minute idle window. Tunable per server for tests.
 */
const PASSIVATE_SWEEP_INTERVAL_MS = 60_000;

/** At most 10 `moveCursor` relays per second per socket (PROTOCOL.md §9); excess is dropped. */
const CURSOR_MAX_PER_SECOND = 10;
const CURSOR_WINDOW_MS = 1000;

/** At most 5 `react` relays per second per socket (PROTOCOL.md §9); excess is dropped. */
const REACTION_MAX_PER_SECOND = 5;

/**
 * The reaction send gate (PROTOCOL.md §9; DESIGN.md D25). The v1 five-grapheme allowlist is
 * retired: a `react` is sendable iff its `emoji` is exactly one RGI emoji grapheme, so any one
 * well-formed emoji is accepted and the personal reaction set stays a pure client preference the
 * session never learns (D24, D25). The codec already shape-guards the field (non-empty, at most
 * 32 UTF-8 bytes); this is the one rule the session layers on top. `\p{RGI_Emoji}` is the canonical
 * Unicode property, matched anchored so the whole string must be exactly one emoji: "A", a digit,
 * "🔥🔥" (two graphemes), and a bare text-presentation character like ♥ (U+2665, lacking the emoji
 * variation selector U+FE0F) all fail; a flag, a skin-tone modifier, or a ZWJ sequence that is one
 * RGI grapheme within the byte bound passes. No hand-rolled emoji ranges.
 *
 * RGI_Emoji is a Unicode *property of strings*, so it requires the regex `v` flag (under `u` it is a
 * runtime SyntaxError, "Invalid property name"); a `u`-flag fallback is therefore not possible. Node
 * >=24 (the repo's `engines`) supports `v` at runtime, but the TS toolchain targets ES2023 (< es2024)
 * and rejects a `/…/v` literal (TS1501). The RegExp constructor keeps the required `v` flag and the
 * ES2023 target with no config change, since its string flag is not target-checked. `.test` is
 * stateless without the `g` flag, so this one shared instance is reused safely.
 */
const RGI_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");
function isSendableReaction(emoji: string): boolean {
  return RGI_EMOJI.test(emoji);
}

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
  /**
   * Liveness window in ms (PROTOCOL.md §9); defaults to 45 s. A connection with no inbound
   * frame for this long is terminated so the close path broadcasts `playerDisconnected`. Tests
   * inject a small value to exercise the reap without a real 45 s sleep.
   */
  readonly livenessTimeoutMs?: number;
  /**
   * Passivation window (DESIGN.md §6, §15): an actor with zero live sockets for this long is
   * drained and evicted by the sweep. Defaults to 30 minutes (the §15 guess, tunable via
   * PASSIVATE_AFTER_MS); tests inject a small value to exercise eviction without the wait.
   */
  readonly passivateAfterMs?: number;
  /** Sweep cadence for passivation; defaults to 60 s. Tests inject a small value. */
  readonly passivateSweepIntervalMs?: number;
  /**
   * The Live Activity push emitter (PROTOCOL.md "Live Activity push"). When present it is passed to
   * every actor and fed at the presence sites; when omitted the whole channel is inert and the
   * session behaves exactly as before (the composition root supplies it only when the APNs env is
   * complete). Fire-and-forget throughout: no server path ever awaits it.
   */
  readonly pushEmitter?: ActivityPushEmitter;
  /**
   * The product analytics port (src/analytics). When present it is passed to every actor
   * (terminal transitions) and fed at the join seam here; when omitted nothing captures and
   * the session behaves exactly as before (the composition root supplies it; unset
   * POSTHOG_TOKEN yields the noop). Fire-and-forget throughout: no path ever awaits it.
   */
  readonly analytics?: Analytics;
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
  /** Cached actor entries (DESIGN.md §6): tests assert passivation through this. */
  liveActorCount(): number;
}

/** Start the session WebSocket server and resolve once it is listening. */
export function createSessionServer(
  config: SessionServerConfig,
): Promise<SessionServer> {
  const now = config.now ?? (() => new Date());
  const host = config.host ?? "127.0.0.1";
  const registry = new ActorRegistry(
    config.pool,
    now,
    config.actorOptions,
    config.pushEmitter,
    config.analytics,
    config.passivateAfterMs,
  );
  let draining = false;

  // Passivation sweep (DESIGN.md §6): a fixed-cadence tick; the registry serializes
  // overlapping ticks itself and each eviction drains before it drops (INV-5, INV-7).
  const sweepTimer = setInterval(() => {
    void registry
      .sweep()
      .then((evicted) => {
        if (evicted > 0) console.log(`passivated ${evicted} idle actor(s)`);
      })
      .catch((error: unknown) => {
        console.error("passivation sweep fault:", error);
      });
  }, config.passivateSweepIntervalMs ?? PASSIVATE_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

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
      const registeredMatch =
        req.method === "POST" ? INTERNAL_LA_REGISTERED_PATH.exec(path) : null;
      if (registeredMatch !== null) {
        if (!serveInternal) {
          sendJson(res, 404, { error: "NOT_FOUND" });
          return;
        }
        void handleLiveActivityRegistered(req, res, registeredMatch[1]!, {
          registry,
          internalBearer: config.internalBearer,
          pushEmitter: config.pushEmitter,
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
          livenessTimeoutMs: config.livenessTimeoutMs ?? LIVENESS_TIMEOUT_MS,
          ...(config.pushEmitter !== undefined
            ? { pushEmitter: config.pushEmitter }
            : {}),
          ...(config.analytics !== undefined
            ? { analytics: config.analytics }
            : {}),
        });
      });
    },
  );

  async function drain(): Promise<void> {
    draining = true;
    clearInterval(sweepTimer);
    // Stop the listeners from accepting new sockets; existing ones stay up for the flush.
    httpServer.close();
    internalHttpServer?.close();
    const actors = await registry.liveActors();
    for (const actor of actors) {
      try {
        await actor.drain();
      } catch (error) {
        // One actor's flush fault must not abort draining the rest. Logged because the
        // drain window is where a second writer (deploy overlap) surfaces as a
        // SnapshotRegressionError; a silent catch here would hide the tripwire.
        console.error(`drain flush fault for game ${actor.gameId}:`, error);
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
          close: () => {
            clearInterval(sweepTimer);
            return closeServer(httpServer, wss, internalHttpServer);
          },
          liveActorCount: () => registry.liveActorCount(),
        });
      });
    });
  });
}

interface ConnectionDeps {
  readonly authPort: AuthPort;
  readonly pool: Pool;
  readonly registry: ActorRegistry;
  readonly livenessTimeoutMs: number;
  /** Fed at the presence sites (connect/disconnect) when configured; absent means inert. */
  readonly pushEmitter?: ActivityPushEmitter;
  /** Fed at the join seam (first live socket) when configured; absent means no capture. */
  readonly analytics?: Analytics;
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

  // Liveness (PROTOCOL.md §9): the timer lives on the socket, so it cannot leak across actor
  // passivation. Armed now (a socket that never sends `hello` is reaped too), reset on every
  // inbound frame, cleared on close. On expiry the socket is terminated, and its `close` runs
  // the disconnect broadcast, exactly as a real drop would.
  let livenessTimer: ReturnType<typeof setTimeout> | null = null;
  const clearLiveness = (): void => {
    if (livenessTimer !== null) {
      clearTimeout(livenessTimer);
      livenessTimer = null;
    }
  };
  const resetLiveness = (): void => {
    clearLiveness();
    livenessTimer = setTimeout(() => ws.terminate(), deps.livenessTimeoutMs);
    livenessTimer.unref?.();
  };
  resetLiveness();

  // Per-socket cursor rate limit (PROTOCOL.md §9): a sliding 1 s window capped at 10 relays.
  const cursorSentAt: number[] = [];
  const allowCursor = (nowMs: number): boolean => {
    while (
      cursorSentAt.length > 0 &&
      nowMs - cursorSentAt[0]! >= CURSOR_WINDOW_MS
    ) {
      cursorSentAt.shift();
    }
    if (cursorSentAt.length >= CURSOR_MAX_PER_SECOND) return false;
    cursorSentAt.push(nowMs);
    return true;
  };

  // Per-socket reaction rate limit (PROTOCOL.md §9): the same sliding 1 s window as the cursor
  // limit, capped at 5 relays, but a separate budget, so one presence family never consumes the
  // other's.
  const reactionSentAt: number[] = [];
  const allowReaction = (nowMs: number): boolean => {
    while (
      reactionSentAt.length > 0 &&
      nowMs - reactionSentAt[0]! >= CURSOR_WINDOW_MS
    ) {
      reactionSentAt.shift();
    }
    if (reactionSentAt.length >= REACTION_MAX_PER_SECOND) return false;
    reactionSentAt.push(nowMs);
    return true;
  };

  ws.on("message", (data: RawData) => {
    // Any inbound frame resets liveness (PROTOCOL.md §9), heartbeat included, before routing.
    resetLiveness();
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
    clearLiveness();
    if (actor !== null && connection !== null) {
      // If this was the user's last live socket, tell the rest they went away (PROTOCOL.md §9).
      const wasLast = actor.removeConnection(connection);
      if (wasLast) {
        actor.broadcastExcept(connection, {
          type: "playerDisconnected",
          userId: connection.userId,
        });
        // A cluster member went away: refresh the island's away-dimming (PROTOCOL.md "Live
        // Activity push"). Fire-and-forget, after the WS broadcast; the policy dedupes a
        // non-cluster (spectator) change, so this is safe on every last-socket transition.
        deps.pushEmitter?.onPresence(gameId, actor.boardFacts());
      }
    }
  });
  ws.on("error", () => {
    // Transport errors surface as a close; nothing else to do in this slice.
  });

  async function runHandshake(decoded: Decoded<ClientMessage>): Promise<void> {
    // The attach can race a passivation eviction (DESIGN.md §6): a handshake that resolved
    // its actor just before the registry dropped it is refused by the evicted mark and must
    // re-resolve, which hydrates a fresh actor from the flushed row. One retry is the
    // expected worst case; the bound is paranoia, never hit in practice.
    let conn: Connection | null = null;
    let attachedActor: GameActor | null = null;
    let firstForUser = false;
    for (let attempt = 0; attempt < 3 && attachedActor === null; attempt++) {
      const result = await performHandshake(deps, gameId, decoded);
      if (!result.ok) {
        send(result.error);
        ws.close(1008, result.error.code);
        return;
      }
      conn = {
        userId: result.userId,
        role: result.role,
        send,
        close: (code, reason) => ws.close(code, reason),
      };
      const attach = result.actor.addConnection(conn);
      if (attach.attached) {
        attachedActor = result.actor;
        firstForUser = attach.firstForUser;
      }
    }
    if (attachedActor === null || conn === null) {
      // Three evictions in one handshake: give up transiently; the client reconnects.
      ws.close(1013, "TRY_AGAIN_LATER");
      return;
    }
    actor = attachedActor;
    connection = conn;
    live = true;
    // The connecting socket gets the full participant list in its own welcome, so it is excluded
    // from the connect notice. Only the user's FIRST live socket announces (PROTOCOL.md §6, §9).
    send(await buildWelcome(deps.pool, gameId, attachedActor, conn));
    if (firstForUser) {
      const notice = await buildPlayerConnected(deps.pool, gameId, conn);
      attachedActor.broadcastExcept(conn, notice);
      const facts = attachedActor.boardFacts();
      // A cluster member arrived: refresh the island (a member who joined after the activity
      // started still appears; PROTOCOL.md "Live Activity push"). Fire-and-forget, after the WS
      // broadcast. The policy dedupes a spectator (non-cluster) connect.
      deps.pushEmitter?.onPresence(gameId, facts);
      // room_joined, beside the same presence seam: the member's first live socket, after the
      // handshake verified membership against Postgres (INV-8), is the session's authoritative
      // "member entered the room" moment (the membership INSERT itself is API-owned, INV-7).
      // A reconnect after a full disconnect fires again, same as the playerConnected notice.
      // Counts and ids only (INV-6).
      deps.analytics?.capture({
        distinctId: conn.userId,
        event: "room_joined",
        properties: {
          roomId: gameId,
          filled: facts.filled,
          total: facts.total,
        },
      });
    }
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
      // The vote proposal (checkPuzzle) and ballot (castCheckVote) ride the same mutation path as
      // the cell commands (PROTOCOL.md §5, §10; D32): the actor's mailbox serializes them, its role
      // gate rejects spectators (ROLE_FORBIDDEN), and the engine's vote driver maps a bad moment to
      // the §11 codes (GAME_NOT_ONGOING, GRID_NOT_FULL, VOTE_PENDING, NO_VOTE_OPEN, NOT_ELECTOR,
      // ALREADY_VOTED), each a non-fatal error carrying the offending commandId.
      case "placeLetter":
      case "clearCell":
      case "checkPuzzle":
      case "castCheckVote":
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
        // Relay the cursor to the other connections, rate-capped at 10/s, and record it so the
        // next snapshot carries the current view (PROTOCOL.md §4, §9). A cursor whose cell is out
        // of range or a black square is dropped silently (best-effort; PROTOCOL.md §9 defines no
        // cursor error), mirroring the reducer's INVALID_CELL rule for a mutation. Role is not
        // gated here: any participant may send moveCursor (PROTOCOL.md §5), and spectator cursors
        // are suppressed client-side by default, not by the server (DESIGN.md §8).
        if (
          actor !== null &&
          connection !== null &&
          actor.isCursorTarget(message.cell) &&
          allowCursor(Date.now())
        ) {
          actor.setCursor(connection.userId, message.cell, message.direction);
          actor.broadcastExcept(connection, {
            type: "cursor",
            userId: connection.userId,
            cell: message.cell,
            direction: message.direction,
          });
        }
        return;
      case "react":
        // Relay the reaction to the other connections, rate-capped at 5/s, and record NOTHING: a
        // reaction never enters a snapshot (there is no board.reactions), so this is pure fan-out,
        // lighter than moveCursor which records the cursor for §4. The send gate (isSendableReaction,
        // D25): `emoji` must be exactly one RGI emoji grapheme, and `cell` a valid target (in range,
        // not a black square, the same isCursorTarget rule); any violation, a non-emoji `emoji`, a bad
        // cell, or over-rate, is dropped silently, the same best-effort posture as moveCursor
        // (PROTOCOL.md §9 defines no reaction error). Role is not gated: any participant, spectators
        // included, may react (PROTOCOL.md §5), and it is legal in any game status, so no
        // GAME_NOT_ONGOING gate touches it (§9). The emoji and cell checks precede allowReaction, so
        // only a valid react spends the rate budget, exactly as the cursor relay guards allowCursor.
        if (
          actor !== null &&
          connection !== null &&
          isSendableReaction(message.emoji) &&
          actor.isCursorTarget(message.cell) &&
          allowReaction(Date.now())
        ) {
          actor.broadcastExcept(connection, {
            type: "reaction",
            userId: connection.userId,
            emoji: message.emoji,
            cell: message.cell,
          });
        }
        return;
      case "heartbeat":
        // Liveness already reset for every inbound frame (above); heartbeat carries no other
        // action. It is no longer ignored: it is precisely what keeps an idle client alive (§9).
        return;
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
  // Room-aware colors (D28): assigned over the full member list, deterministically, so every
  // snapshot of this room agrees. The fallback is unreachable (the map is built from `members`)
  // but keeps the expression total.
  const colors = assignRoomColors(members);
  const participants: Participant[] = members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName ?? FORMER_PARTICIPANT,
    // Opaque, nullable, resolved API-side (PROTOCOL.md §4); the session only relays it.
    avatarUrl: member.avatarUrl,
    color: colors.get(member.userId) ?? colorForUser(member.userId),
    role: member.role,
    connected: connected.has(member.userId),
  }));
  return actor.snapshotBoard(participants);
}

/**
 * Build a `playerConnected` notice (PROTOCOL.md §6). Reuses the same `loadMembers` machinery as
 * `buildBoardPayload`, so the display name and avatar (the read grant is display_name and avatar),
 * color, and role match the participant list; the color is assigned over the same full member
 * list (D28), so the notice and the §4 payload agree for one room. The "former participant"
 * fallback applies to a tombstoned user's null display name (DESIGN.md §8). If the member row is
 * somehow absent, fall back to the connection's handshake-verified role, a null avatar, and the
 * bare hash color so the notice is still well-formed.
 */
async function buildPlayerConnected(
  pool: Pool,
  gameId: string,
  conn: Connection,
): Promise<PlayerConnectedMessage> {
  const members = await loadMembers(pool, gameId);
  const member = members.find((m) => m.userId === conn.userId);
  return {
    type: "playerConnected",
    userId: conn.userId,
    displayName: member?.displayName ?? FORMER_PARTICIPANT,
    // Same opaque nullable field the participant carries (PROTOCOL.md §4, §6); null when the member
    // row is absent, which matches the initial-avatar fallback clients already render.
    avatarUrl: member?.avatarUrl ?? null,
    color:
      assignRoomColors(members).get(conn.userId) ?? colorForUser(conn.userId),
    role: member?.role ?? conn.role,
  };
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

interface LiveActivityRegisteredDeps {
  readonly registry: ActorRegistry;
  /** Explicitly nullable (not optional) so the composition root may pass an unset value. */
  readonly internalBearer: string | undefined;
  /** Absent when the push channel is inert (no APNs env); then the welcome is a no-op. */
  readonly pushEmitter: ActivityPushEmitter | undefined;
}

/** Parse the welcome notice body: `{ userId }`, the registering member. Null if malformed. */
function parseLiveActivityRegisteredBody(
  raw: unknown,
): { userId: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const userId = (raw as { userId?: unknown }).userId;
  if (typeof userId !== "string" || userId === "") return null;
  return { userId };
}

/**
 * Serve `POST /internal/games/{id}/live-activity-registered` (PROTOCOL.md 12a). Same bearer,
 * listener, and private-port routing as membership-changed. The API fires this after a successful
 * token upsert; the session hands the fresh island the current authoritative frame via the emitter's
 * onWelcome. Failure posture is log-and-drop from the API side, so this endpoint stays honest but
 * lenient: it acknowledges once authorized, then does the fire-and-forget welcome, so a slow APNs
 * or a since-deleted game never turns into a failed notice the API must retry.
 *
 * No-actor case (member backgrounded, everyone else offline, actor evicted): the registry reads the
 * current facts with a cheap SELECT-only hydration read (boardFactsFor) rather than resurrecting an
 * actor. A game that no longer exists yields null facts and the welcome is dropped. The emitter is
 * fed the same content-state it would send to the whole game, aimed at only this user's tokens.
 */
async function handleLiveActivityRegistered(
  req: IncomingMessage,
  res: ServerResponse,
  gameId: string,
  deps: LiveActivityRegisteredDeps,
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
  const body = parseLiveActivityRegisteredBody(parsed);
  if (body === null) {
    sendJson(res, 400, { error: "VALIDATION" });
    return;
  }

  // Enqueue the welcome, then acknowledge. onWelcome is fire-and-forget by construction (it appends
  // to the emitter's own queue and returns at once), so the endpoint never waits on APNs, yet it
  // resolves the cheap facts read first so the ack honestly reflects that the welcome was handed off.
  // The API treats the whole notice as fire-and-forget anyway (log-and-drop), so a slow facts read
  // never blocks the 204. A since-deleted game yields null facts: drop the welcome, the cheapest
  // honest behavior. The read is guarded so a fault is logged and still acknowledged (the
  // registration stands and the debounce world works without the welcome).
  if (deps.pushEmitter !== undefined) {
    try {
      const facts = await deps.registry.boardFactsFor(gameId);
      if (facts !== null)
        deps.pushEmitter.onWelcome(gameId, body.userId, facts);
    } catch (error) {
      console.error(
        `live-activity welcome fault for game ${gameId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
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
