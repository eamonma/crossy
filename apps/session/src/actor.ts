// The game actor (DESIGN.md §3, §6): one per live game, the single writer for its state.
// Every mutation runs through the mailbox, so a game's state changes are serialized into
// one total order (INV-2) no matter how many sockets send concurrently. The actor owns
// the context gates it alone can enforce (role, terminal state via the reducer) and the
// completion driver, so completion is exactly-once and level-triggered (INV-3, INV-4).
// It holds the solution for the comparator; the solution never reaches an outbound frame
// (INV-6).
//
// Write-behind (DESIGN.md §6, D14): accepted events buffer in memory and flush with the
// board snapshot in ONE transaction every ~25 events or ~5 seconds, and on drain. A hard
// crash loses at most the unflushed tail; the snapshot-plus-log pair is always internally
// consistent (INV-5). The completion event flushes SYNCHRONOUSLY before it is broadcast
// (INV-3), and participantCount is read authoritatively over cell_events in that same
// transaction (PROTOCOL.md §4). Every flush and every mutation runs inside the mailbox, so
// none of them can race the others.

import {
  applyWithCompletion,
  reduce,
  type BoardState,
  type CellSet,
  type Command,
  type RejectionCode,
} from "@crossy/engine";
import type {
  ClearCellMessage,
  Cursor,
  Direction,
  PlaceLetterMessage,
  Role,
  ServerMessage,
  Stats,
} from "@crossy/protocol";
import {
  boardCells,
  buildBoard,
  cellSetToWire,
  toEngineCommand,
} from "./adapt";
import { createNoopAnalytics } from "./analytics/analytics";
import type { Analytics } from "./analytics/analytics";
import { errorFrame } from "./frames";
import type { EngineSolution, HydratedGame } from "./hydrate";
import { Mailbox } from "./mailbox";
import type { ActivityPushEmitter, BoardFacts } from "./push/emitter";
import { createInertEmitter } from "./push/emitter";
import type { GamePersistence, StateSnapshot } from "./writer";

/** The last K applied commandIds kept for idempotency and the board payload (DESIGN.md §6). */
const RECENT_COMMAND_LIMIT = 64;

/**
 * Write-behind thresholds (DESIGN.md §15, D14; adopted-by-default, tune with measurement).
 * A flush fires when EITHER bound is hit, whichever comes first.
 */
export const FLUSH_EVENT_THRESHOLD = 25;
export const FLUSH_INTERVAL_MS = 5_000;

/** Human-readable text for each reducer rejection (PROTOCOL.md §11). */
const REJECTION_MESSAGE: Record<RejectionCode, string> = {
  GAME_NOT_ONGOING: "the game is no longer ongoing",
  INVALID_CELL: "cell is out of range or a black square",
  INVALID_VALUE: "value must match ^[A-Z0-9]{1,10}$ after normalization",
};

/** A live socket the actor can address. The concrete socket wrapper lives in server.ts. */
export interface Connection {
  readonly userId: string;
  /** Cached at handshake; updated in place on a re-verified role change (INV-8). */
  role: Role;
  send(frame: ServerMessage): void;
  /**
   * Close the socket with a code and reason, e.g. 1008 after a `kicked` notice (PROTOCOL.md §6).
   * Optional so a non-socket consumer of the actor (the simulation harness, which taps
   * broadcasts through a `send`-only connection) stays compatible; the real server always
   * supplies it, and `disconnectUser` invokes it only when present.
   */
  close?(code: number, reason: string): void;
}

/** Tunable write-behind bounds; both default to the DESIGN.md §15 constants above. */
export interface ActorOptions {
  readonly flushEventThreshold?: number;
  readonly flushIntervalMs?: number;
}

export class GameActor {
  private state: BoardState;
  private readonly solution: EngineSolution;
  private completedAt: string | null;
  private abandonedAt: string | null;
  /** The room's display name (`games.name`), for the completion Live Activity alert body. */
  private readonly roomName: string | null;
  private stats: Stats | null;
  private recentCommandIds: string[];
  private readonly connections = new Set<Connection>();
  /**
   * Each connected user's current cursor (PROTOCOL.md §9). Best-effort presence: never
   * sequenced, never persisted. Keyed by userId, so a user's several tabs share one cursor.
   * An entry lives only while the user holds a socket; it is dropped on their last close
   * (removeConnection) or a kick (disconnectUser), so a departed user carries no cursor.
   */
  private readonly cursors = new Map<string, Cursor>();
  private readonly mailbox = new Mailbox();

  /** Accepted-but-unflushed cellSets, appended to cell_events on the next flush (§6). */
  private pending: CellSet[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushEventThreshold: number;
  private readonly flushIntervalMs: number;

  /**
   * The Live Activity push emitter (PROTOCOL.md "Live Activity push"). Fire-and-forget: the actor
   * calls it after a broadcast and never awaits it, so a slow or down APNs cannot back-pressure the
   * hot path. Defaults to the inert no-op emitter, so an actor built without one (every existing
   * test) behaves exactly as before.
   */
  private readonly pushEmitter: ActivityPushEmitter;

  /**
   * The product analytics port (src/analytics). Same posture as the push emitter: fire-and-
   * forget beside the terminal seams, never awaited, never on the keystroke path. Defaults
   * to the noop, so an actor built without one (every existing test) behaves as before.
   */
  private readonly analytics: Analytics;

  constructor(
    readonly gameId: string,
    hydrated: HydratedGame,
    private readonly persistence: GamePersistence,
    private readonly now: () => Date,
    options: ActorOptions = {},
    pushEmitter?: ActivityPushEmitter,
    analytics?: Analytics,
  ) {
    this.state = hydrated.boardState;
    this.solution = hydrated.solution;
    this.completedAt = hydrated.completedAt;
    this.abandonedAt = hydrated.abandonedAt;
    this.roomName = hydrated.roomName;
    this.recentCommandIds = [...hydrated.recentCommandIds];
    this.stats = null;
    this.flushEventThreshold =
      options.flushEventThreshold ?? FLUSH_EVENT_THRESHOLD;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.pushEmitter = pushEmitter ?? createInertEmitter();
    this.analytics = analytics ?? createNoopAnalytics();
  }

  /**
   * The board facts a Live Activity push carries (PROTOCOL.md "Live Activity push"): filled is the
   * count of filled playable cells, total the fillable-cell count, plus the lifecycle status,
   * completedAt, and the live-socket set that drives puck away-dimming. COUNTS ONLY (INV-6): no
   * letters, no coordinates. Cheap and synchronous, so the hot path never awaits to produce it.
   */
  boardFacts(): BoardFacts {
    const total =
      this.state.grid.cols * this.state.grid.rows - this.state.grid.blocks.size;
    return {
      filled: this.state.filledCount,
      total,
      status: this.state.status,
      completedAt: this.completedAt,
      connectedUserIds: this.connectedUserIds(),
      roomName: this.roomName,
    };
  }

  /**
   * Register a live socket. Returns `true` when this is the user's FIRST live socket on the
   * game, so the caller broadcasts `playerConnected` to the others (PROTOCOL.md §6, §9). A
   * second socket for the same user returns `false`: no connect notice (presence keys on the
   * first/last socket per user, not per socket).
   */
  addConnection(connection: Connection): boolean {
    const first = !this.hasUserConnection(connection.userId);
    this.connections.add(connection);
    return first;
  }

  /**
   * Drop a live socket. Returns `true` when the socket was present AND it was the user's LAST
   * live socket, so the caller broadcasts `playerDisconnected` to the rest (PROTOCOL.md §6, §9).
   * A socket already removed (e.g. a kicked socket dropped in `disconnectUser` before its close
   * fires) returns `false`, so the close path never double-broadcasts.
   */
  removeConnection(connection: Connection): boolean {
    const existed = this.connections.delete(connection);
    if (!existed) return false;
    const last = !this.hasUserConnection(connection.userId);
    // The user's cursor is presence, tied to their liveness: drop it on the last socket so the
    // next snapshot and the `playerDisconnected` agree the departed user has no cursor (§9).
    if (last) this.cursors.delete(connection.userId);
    return last;
  }

  /** Whether the user still holds any live socket (the first/last-socket presence pivot). */
  private hasUserConnection(userId: string): boolean {
    for (const conn of this.connections) {
      if (conn.userId === userId) return true;
    }
    return false;
  }

  /**
   * Send an ephemeral notice to every live connection except `origin` (PROTOCOL.md §6, §9):
   * `playerConnected` and `cursor` skip the originating socket, and `playerDisconnected` passes
   * the already-removed socket so it reaches everyone still connected. Best-effort, no `seq`, no
   * mailbox: presence never enters the total order (D20).
   */
  broadcastExcept(origin: Connection, frame: ServerMessage): void {
    for (const connection of this.connections) {
      if (connection !== origin) connection.send(frame);
    }
  }

  /**
   * Disconnect a user whose membership was revoked (INV-8, DESIGN.md §6). The caller has read
   * authoritative state from Postgres and determined this user is no longer allowed (denylisted
   * or no membership). The actor only enforces that verdict on its live sockets: it sends the
   * terminal `kicked` notice and closes 1008 on every socket the user holds, then drops them.
   * It never mutates membership; that is the API's job (INV-7).
   */
  disconnectUser(userId: string, reason: string): void {
    let held = false;
    for (const conn of [...this.connections]) {
      if (conn.userId !== userId) continue;
      held = true;
      conn.send({ type: "kicked", reason });
      conn.close?.(1008, "kicked");
      this.connections.delete(conn);
    }
    // A kicked user leaves no presence behind (§9): drop their cursor so no snapshot carries it.
    this.cursors.delete(userId);
    // Live Activity (PROTOCOL.md "Live Activity push"): the kicked member's own tokens get an
    // `end` (their island must not keep ticking a room they were removed from), everyone else a
    // presence update. Fire-and-forget. Emitted once, only when the user actually held a socket
    // here, so a no-op disconnect (already gone) does not push. The facts already exclude them,
    // since their sockets are removed above.
    if (held) this.pushEmitter.onKick(this.gameId, userId, this.boardFacts());
  }

  /** Update the cached role for a user's live sockets after a re-verified role change (INV-8). */
  setUserRole(userId: string, role: Role): void {
    for (const conn of this.connections) {
      if (conn.userId === userId) conn.role = role;
    }
  }

  /**
   * Abandon the game (DESIGN.md §6, §7; PROTOCOL.md §6). Runs through the mailbox so it cannot
   * race a mutation or a flush. Abandon on an already-terminal game is a no-op (INV-4).
   */
  abandon(by: string): Promise<void> {
    return this.mailbox.post(() => this.doAbandon(by));
  }

  /** The userIds with a live connection, for the `connected` flag on participants. */
  connectedUserIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const c of this.connections) ids.add(c.userId);
    return ids;
  }

  /**
   * Whether a cell is a valid cursor target: an integer in range that is not a black square,
   * the same rule the reducer maps to INVALID_CELL for a mutation (PROTOCOL.md §5). A
   * `moveCursor` naming any other cell is dropped silently by the caller, since presence is
   * best-effort and PROTOCOL.md §9 defines no cursor error.
   */
  isCursorTarget(cell: number): boolean {
    const total = this.state.grid.cols * this.state.grid.rows;
    return (
      Number.isInteger(cell) &&
      cell >= 0 &&
      cell < total &&
      !this.state.grid.blocks.has(cell)
    );
  }

  /**
   * Record a connected user's current cursor (PROTOCOL.md §9), so the next snapshot carries it
   * (PROTOCOL.md §4, "the board payload carries the current view at snapshot time"). Ephemeral:
   * the caller has already validated the cell (isCursorTarget) and rate-capped the frame; this
   * only updates in-memory presence and never touches sequenced state.
   */
  setCursor(userId: string, cell: number, direction: Direction): void {
    this.cursors.set(userId, { userId, cell, direction });
  }

  /** How many events are buffered but not yet flushed (drain and tests read this). */
  get pendingFlushCount(): number {
    return this.pending.length;
  }

  /**
   * Enqueue a mutation on the mailbox. Every mutation for this game runs through this one
   * queue, so however many sockets send concurrently, the commands take one total order
   * and seq stays contiguous (INV-2). The returned promise settles when the command has
   * been applied, flushed if the completion path fired, and broadcast.
   */
  submit(
    connection: Connection,
    message: PlaceLetterMessage | ClearCellMessage,
  ): Promise<void> {
    return this.mailbox.post(() => this.handleMutation(connection, message));
  }

  /**
   * Apply one mutation. Runs inside the mailbox (see `submit`), so it is the single
   * writer of this game's state. Broadcasts one `cellSet` per accepted command, buffers
   * it for the write-behind flush, and on the completing move flushes synchronously then
   * broadcasts `gameCompleted` (INV-3). A rejection unicasts a §11 error.
   */
  private async handleMutation(
    connection: Connection,
    message: PlaceLetterMessage | ClearCellMessage,
  ): Promise<void> {
    // Role gate (DESIGN.md §3 step 2): spectators send nothing that mutates the board.
    if (connection.role === "spectator") {
      connection.send(
        errorFrame("ROLE_FORBIDDEN", "spectators cannot mutate the board", {
          commandId: message.commandId,
        }),
      );
      return;
    }

    // Idempotent commands (PROTOCOL.md §5, §6): a duplicate commandId is dropped
    // silently, no event and no error.
    if (this.recentCommandIds.includes(message.commandId)) return;

    const at = this.now().toISOString();
    const command = toEngineCommand(message, connection.userId, at);

    const result = applyWithCompletion(this.state, command, this.solution);

    // An accepted command always emits at least one cellSet, even a no-op (PROTOCOL.md
    // §6). Empty events therefore means a rejection; recover its code from the reducer.
    if (result.events.length === 0) {
      this.rejectCommand(connection, command, message.commandId);
      return;
    }

    // Capture whether firstFillAt was already set before applying: the reducer sets it
    // once, on the first placeLetter (PROTOCOL.md §4). A null-to-value transition here
    // means this command's cellSet is the first fill.
    const hadFirstFillBefore = this.state.firstFillAt !== null;
    this.state = result.state;
    this.recordCommandId(message.commandId);

    // The first fill's cellSet carries firstFillAt so already-connected clients start the
    // shared timer on the delta, not only at their next snapshot (PROTOCOL.md §6). It rides
    // exactly this one event; every later cellSet omits it.
    const firstFillDelta =
      !hadFirstFillBefore && this.state.firstFillAt !== null
        ? this.state.firstFillAt
        : undefined;

    let completion: number | null = null;
    for (const event of result.events) {
      if (event.type === "cellSet") {
        // Buffer for the write-behind flush, then broadcast immediately (DESIGN.md §3
        // steps 4 and 5): Postgres is never on the keystroke path.
        this.pending.push(event);
        this.broadcast(cellSetToWire(event, firstFillDelta));
        continue;
      }
      // gameCompleted: the engine emits {type, seq}; the actor drives the terminal flush.
      completion = event.seq;
    }

    if (completion !== null) {
      await this.completeGame(completion, at, connection.userId);
      return;
    }
    // A non-terminal fill changed the counts: feed the debounced fill push (fire-and-forget). The
    // policy dedupes a no-op fill (same counts) and holds intermediate states, so calling per
    // accepted mutation is safe. Emitted after the broadcast so the WS path is never delayed.
    this.pushEmitter.onFill(this.gameId, this.boardFacts());
    await this.afterMutationFlush();
  }

  /**
   * Terminal completion (INV-3): flush the buffered events plus the completed snapshot
   * SYNCHRONOUSLY, deriving the authoritative participantCount (DISTINCT user_id over
   * cell_events) inside that same transaction, then broadcast `gameCompleted`. Persisted
   * before broadcast, exactly once. `by` is the member whose move completed the game.
   */
  private async completeGame(
    terminalSeq: number,
    at: string,
    by: string,
  ): Promise<void> {
    this.completedAt = at;
    const events = this.pending;
    const stats = await this.persistence.flushTerminal(
      this.gameId,
      events,
      (participantCount) => {
        const s = this.computeStats(terminalSeq, at, participantCount);
        return { snap: this.snapshotForFlush(s), stats: s };
      },
    );
    this.stats = stats;
    this.pending = [];
    this.cancelFlushTimer();
    this.broadcast({
      type: "gameCompleted",
      seq: terminalSeq,
      at,
      stats,
    });
    // Terminal moment (PROTOCOL.md "Live Activity push"): end the island with the final
    // content-state and a dismissal date. Fire-and-forget, after the WS broadcast.
    const facts = this.boardFacts();
    this.pushEmitter.onTerminal(this.gameId, facts);
    // solve_completed, beside the same terminal seam the push reacts to: the transition was
    // decided and persisted exactly once above (INV-3), so the event fires exactly once per
    // game. Counts and ids only, never a cell or letter (INV-6).
    this.analytics.capture({
      distinctId: by,
      event: "solve_completed",
      properties: {
        roomId: this.gameId,
        filled: facts.filled,
        total: facts.total,
        participantCount: stats.participantCount,
      },
    });
  }

  /**
   * Terminal abandon (INV-4). Takes the next seq, marks the state abandoned, flushes the
   * buffered events plus the abandoned snapshot SYNCHRONOUSLY in one transaction, then
   * broadcasts `gameAbandoned` (persisted before broadcast, like completion). The terminal
   * event consumes a seq but is never appended to cell_events (DESIGN.md §9), so only the
   * pending cellSets go to the log; the snapshot carries the terminal seq and status.
   */
  private async doAbandon(by: string): Promise<void> {
    if (this.state.status !== "ongoing") return; // INV-4: a terminal state is final
    const at = this.now().toISOString();
    const seq = this.state.seq + 1;
    this.state = { ...this.state, status: "abandoned", seq };
    this.abandonedAt = at;
    const events = this.pending;
    await this.persistence.flush(this.gameId, events, this.snapshotForFlush());
    this.pending = [];
    this.cancelFlushTimer();
    this.broadcast({ type: "gameAbandoned", seq, at, by });
    // Terminal moment (PROTOCOL.md "Live Activity push"): end the island with the frozen partial
    // fill and a dismissal date. Fire-and-forget, after the WS broadcast.
    const facts = this.boardFacts();
    this.pushEmitter.onTerminal(this.gameId, facts);
    // room_abandoned, beside the same terminal seam: `by` is the host the API authorized
    // (DESIGN.md §7), so the room-level transition still has a single acting member. The
    // INV-4 guard above makes it at-most-once. Counts and ids only (INV-6).
    this.analytics.capture({
      distinctId: by,
      event: "room_abandoned",
      properties: {
        roomId: this.gameId,
        filled: facts.filled,
        total: facts.total,
      },
    });
  }

  /**
   * Write-behind scheduling (DESIGN.md §6): flush now once the event buffer reaches the
   * count threshold, otherwise arm the interval timer so a slow trickle still flushes
   * within ~5 s. Both bounds are tunable (ActorOptions). The threshold flush is awaited
   * inside the mutation's mailbox task, so no other mutation can interleave with its
   * transaction and the persisted snapshot always matches the appended events (INV-5).
   */
  private async afterMutationFlush(): Promise<void> {
    if (this.pending.length >= this.flushEventThreshold) {
      await this.doFlush();
      return;
    }
    if (this.pending.length > 0 && this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        // Post through the mailbox so the timed flush is serialized with mutations too.
        void this.mailbox
          .post(() => this.doFlush())
          .catch((error: unknown) => {
            // A flush fault keeps the buffer for the next trigger; never crash the actor.
            // Log it so a SnapshotRegressionError (a second writer clobbering our row) is
            // loud rather than silent; the buffer is retained, the actor stays up.
            console.error(`flush fault for game ${this.gameId}:`, error);
          });
      }, this.flushIntervalMs);
      this.flushTimer.unref?.();
    }
  }

  /**
   * Flush the buffered events and the current snapshot in one transaction. Runs inside the
   * mailbox (called inline from a mutation, or posted by the timer or drain), so it never
   * races a mutation. On success the buffer clears; on failure it is retained so the next
   * trigger retries (bounded loss, never divergence; INV-5).
   */
  private async doFlush(): Promise<void> {
    this.cancelFlushTimer();
    if (this.pending.length === 0) return;
    const events = this.pending;
    await this.persistence.flush(this.gameId, events, this.snapshotForFlush());
    this.pending = [];
  }

  /**
   * Drain to durability (DESIGN.md §6, INV-5): used on SIGTERM and passivation. Posts a
   * final flush behind any in-flight mutation on the mailbox, so nothing accepted is lost.
   */
  async drain(): Promise<void> {
    this.cancelFlushTimer();
    await this.mailbox.post(() => this.doFlush());
  }

  /** Build the game_state snapshot to persist, with optional terminal stats. */
  private snapshotForFlush(stats: Stats | null = this.stats): StateSnapshot {
    return {
      status: this.state.status,
      board: boardCells(this.state),
      lastSeq: this.state.seq,
      firstFillAt: this.state.firstFillAt,
      completedAt: this.completedAt,
      abandonedAt: this.abandonedAt,
      stats: stats as Record<string, unknown> | null,
      recentCommandIds: this.recentCommandIds,
    };
  }

  private cancelFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Build the current board snapshot for `welcome`/`sync` (PROTOCOL.md §4). */
  snapshotBoard(
    participants: Parameters<typeof buildBoard>[1]["participants"],
  ): ReturnType<typeof buildBoard> {
    return buildBoard(this.state, {
      participants,
      cursors: [...this.cursors.values()],
      completedAt: this.completedAt,
      abandonedAt: this.abandonedAt,
      stats: this.stats,
      recentCommandIds: this.recentCommandIds,
    });
  }

  private rejectCommand(
    connection: Connection,
    command: Command,
    commandId: string,
  ): void {
    const { error } = reduce(this.state, command);
    if (error === undefined) return; // unreachable: no events implies a rejection
    connection.send(errorFrame(error, REJECTION_MESSAGE[error], { commandId }));
  }

  private recordCommandId(commandId: string): void {
    this.recentCommandIds.push(commandId);
    if (this.recentCommandIds.length > RECENT_COMMAND_LIMIT) {
      this.recentCommandIds =
        this.recentCommandIds.slice(-RECENT_COMMAND_LIMIT);
    }
  }

  /**
   * Completion stats (PROTOCOL.md §4). solveTimeSeconds and totalEvents are exact.
   * participantCount is the authoritative DISTINCT user_id over cell_events, passed in
   * from inside the terminal flush transaction (not derived from the board's last-writer
   * map, which would undercount, nor from actor memory, which is lost on passivation).
   */
  private computeStats(
    terminalSeq: number,
    completedAt: string,
    participantCount: number,
  ): Stats {
    const firstFill = this.state.firstFillAt;
    const solveTimeSeconds =
      firstFill === null
        ? 0
        : Math.max(
            0,
            Math.round(
              (Date.parse(completedAt) - Date.parse(firstFill)) / 1000,
            ),
          );
    return {
      solveTimeSeconds,
      totalEvents: terminalSeq - 1,
      participantCount,
    };
  }

  private broadcast(frame: ServerMessage): void {
    for (const connection of this.connections) connection.send(frame);
  }
}
