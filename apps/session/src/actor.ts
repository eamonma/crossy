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
  applyWithVote,
  SITTING_GAP_MS,
  type BoardState,
  type CellSet,
  type CheckVoteCast,
  type CheckVoteClosed,
  type CheckVoteOpened,
  type RejectionCode,
  type VoteCommand,
  type VoteEvent,
  type VoteRejectionCode,
} from "@crossy/engine";
import type {
  CastCheckVoteMessage,
  CheckPuzzleMessage,
  CheckVoteView,
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
  checkedWrongAscending,
  checkVoteCastToWire,
  checkVoteClosedToWire,
  checkVoteOpenedToWire,
  checkVoteToWire,
  puzzleCheckedToWire,
  toEngineCommand,
} from "./adapt";
import { createNoopAnalytics } from "./analytics/analytics";
import type { Analytics } from "./analytics/analytics";
import { errorFrame } from "./frames";
import type { EngineSolution, HydratedGame } from "./hydrate";
import { Mailbox } from "./mailbox";
import type { ActivityPushEmitter, BoardFacts } from "./push/emitter";
import { createInertEmitter } from "./push/emitter";
import type {
  CheckEventRow,
  GamePersistence,
  PersistedCheckVote,
  StateSnapshot,
  VoteEventRow,
} from "./writer";

/** The last K applied commandIds kept for idempotency and the board payload (DESIGN.md §6). */
const RECENT_COMMAND_LIMIT = 64;

/**
 * The check-vote timebox (PROTOCOL.md §10; D32; DESIGN.md §15, adopted-by-default). When a vote
 * opens the session stamps `expiresAt` = now + this onto the broadcast and the snapshot, arms a
 * timer, and feeds the engine an `expireCheckVote` input when it fires. The session owns the wall
 * clock; the engine models no timeout (INV-9).
 */
export const CHECK_VOTE_TTL_MS = 30_000;

/**
 * Write-behind thresholds (DESIGN.md §15, D14; adopted-by-default, tune with measurement).
 * A flush fires when EITHER bound is hit, whichever comes first.
 */
export const FLUSH_EVENT_THRESHOLD = 25;
export const FLUSH_INTERVAL_MS = 5_000;

/** Human-readable text for each engine rejection, including the vote gates (PROTOCOL.md §11; D32). */
const REJECTION_MESSAGE: Record<RejectionCode | VoteRejectionCode, string> = {
  GAME_NOT_ONGOING: "the game is no longer ongoing",
  INVALID_CELL: "cell is out of range or a black square",
  INVALID_VALUE: "value must match ^[A-Z0-9]{1,10}$ after normalization",
  GRID_NOT_FULL: "the grid must be full before a check",
  VOTE_PENDING: "a check vote is already open",
  NO_VOTE_OPEN: "no matching open check vote",
  NOT_ELECTOR: "you are not an elector on this vote",
  ALREADY_VOTED: "you have already voted on this check",
};

/** The check_vote_events row for an `opened` event (D32): user_id = proposer, electorate frozen. */
function openedVoteRow(event: CheckVoteOpened, at: string): VoteEventRow {
  return {
    seq: event.seq,
    kind: "opened",
    userId: event.by,
    approve: null,
    voteSeq: event.seq,
    electorate: [...event.electorate],
    outcome: null,
    reason: null,
    at,
  };
}

/** The check_vote_events row for a `cast` ballot (D32): user_id = voter, approve = the ballot. */
function castVoteRow(event: CheckVoteCast, at: string): VoteEventRow {
  return {
    seq: event.seq,
    kind: "cast",
    userId: event.by,
    approve: event.approve,
    voteSeq: event.voteSeq,
    electorate: null,
    outcome: null,
    reason: null,
    at,
  };
}

/** The check_vote_events row for a `closed` event (D32): user_id null, outcome/reason set. */
function closedVoteRow(event: CheckVoteClosed, at: string): VoteEventRow {
  return {
    seq: event.seq,
    kind: "closed",
    userId: null,
    approve: null,
    voteSeq: event.voteSeq,
    electorate: null,
    outcome: event.outcome,
    reason: event.reason ?? null,
    at,
  };
}

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
  /**
   * The check-vote timebox in ms (PROTOCOL.md §10; D32); defaults to CHECK_VOTE_TTL_MS (30 s). Tests
   * inject a small value to exercise expiry without a real 30 s wait, the same affordance
   * livenessTimeoutMs and passivateAfterMs give their timers.
   */
  readonly checkVoteTtlMs?: number;
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
  /**
   * Accepted-but-unflushed room checks, appended to check_events on the next flush in the
   * same transaction as the snapshot carrying their marks (DESIGN.md §6, §9; D27). Each row
   * retains the acting user the way pending cellSets carry `by` — server-side only, since
   * the wire event is neutral by construction (PROTOCOL.md §6).
   */
  private pendingChecks: CheckEventRow[] = [];
  /**
   * Accepted-but-unflushed vote lifecycle events, appended to check_vote_events on the next flush in
   * the same transaction as the snapshot carrying the vote state (DESIGN.md §6, §9; D32). Buffered
   * exactly like `pendingChecks`, so every consumed vote seq stays accounted for (INV-5).
   */
  private pendingVoteEvents: VoteEventRow[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushEventThreshold: number;
  private readonly flushIntervalMs: number;
  private readonly checkVoteTtlMs: number;

  /**
   * The open vote's absolute timeout (PROTOCOL.md §10; D32), null when no vote is open. The session
   * owns the wall clock: it stamps this at open, rides it on the broadcast and every snapshot, and
   * fires `voteTimer` at it. The engine `checkVote` models no clock (INV-9), so this is its companion.
   */
  private voteExpiresAt: string | null;
  /** The armed expiry timer for the open vote (D32); null when no vote is open. */
  private voteTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * When the actor last lost its final socket (or hydration time, for an actor that has
   * never held one); null while any socket is attached. The passivation sweep (DESIGN.md
   * §6) reads this through `idleMillis` to find eviction candidates.
   */
  private idleSince: Date | null;

  /**
   * Set by the registry at the moment it drops this actor (DESIGN.md §6). An evicted
   * actor refuses new attachments, so a handshake that resolved it just before eviction
   * re-resolves and hydrates a fresh actor from the flushed row instead of writing
   * through a ghost the registry no longer knows (INV-7 single writer).
   */
  private evicted = false;

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
    this.stats = hydrated.stats;
    this.voteExpiresAt = hydrated.checkVoteExpiresAt;
    this.idleSince = now();
    this.flushEventThreshold =
      options.flushEventThreshold ?? FLUSH_EVENT_THRESHOLD;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.checkVoteTtlMs = options.checkVoteTtlMs ?? CHECK_VOTE_TTL_MS;
    this.pushEmitter = pushEmitter ?? createInertEmitter();
    this.analytics = analytics ?? createNoopAnalytics();
    this.reconcileHydratedVote();
  }

  /**
   * Reconcile a hydrated open vote with the wall clock on crash rehydrate (PROTOCOL.md §10; D32).
   * A vote whose deadline already passed closes `failed` `EXPIRED`, consuming a seq and persisting
   * a check_vote_events row (no broadcast: no socket is attached yet, so the welcome snapshot heals
   * it); a vote still in the future re-arms the timer for the remaining time. With no open vote this
   * is a no-op. The engine expiry input drives the close (INV-9); the session owns the clock.
   */
  private reconcileHydratedVote(): void {
    const vote = this.state.checkVote;
    if (vote === undefined || vote === null) return;
    const expiresAt = this.voteExpiresAt;
    const expiredAtRest =
      expiresAt === null || Date.parse(expiresAt) <= this.now().getTime();
    if (!expiredAtRest) {
      this.armVoteTimer(expiresAt);
      return;
    }
    const at = this.now().toISOString();
    const result = applyWithVote(
      this.state,
      { type: "expireCheckVote" },
      this.solution,
    );
    if (result.events.length === 0) return; // defensive: no vote to close
    this.state = result.state;
    for (const event of result.events) {
      if (event.type === "checkVoteClosed") {
        this.pendingVoteEvents.push(closedVoteRow(event, at));
      }
    }
    this.voteExpiresAt = null;
    // Persist the close promptly and deterministically, behind the constructor, through the mailbox
    // (single writer). The state is already correct for a synchronous welcome; this only durably
    // records the consumed seq (INV-5).
    void this.mailbox
      .post(() => this.doFlush())
      .catch((error: unknown) => {
        console.error(
          `hydrate-expiry flush fault for game ${this.gameId}:`,
          error,
        );
      });
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
      firstFillAt: this.state.firstFillAt,
    };
  }

  /**
   * Register a live socket. `attached: false` means the registry evicted this actor between
   * the handshake resolving it and the attach: the caller must re-resolve through the
   * registry, which hydrates a fresh actor from the flushed row (DESIGN.md §6, INV-7).
   * `firstForUser` is `true` when this is the user's FIRST live socket on the game, so the
   * caller broadcasts `playerConnected` to the others (PROTOCOL.md §6, §9). A second socket
   * for the same user gets `false`: no connect notice (presence keys on the first/last
   * socket per user, not per socket).
   */
  addConnection(
    connection: Connection,
  ): { attached: false } | { attached: true; firstForUser: boolean } {
    if (this.evicted) return { attached: false };
    const first = !this.hasUserConnection(connection.userId);
    this.connections.add(connection);
    this.idleSince = null;
    return { attached: true, firstForUser: first };
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
    if (this.connections.size === 0) this.idleSince = this.now();
    const last = !this.hasUserConnection(connection.userId);
    // The user's cursor is presence, tied to their liveness: drop it on the last socket so the
    // next snapshot and the `playerDisconnected` agree the departed user has no cursor (§9).
    if (last) this.cursors.delete(connection.userId);
    return last;
  }

  /**
   * Milliseconds since the actor lost its final socket (or since hydration, for one that
   * never held a socket); `null` while any socket is attached. The passivation sweep
   * compares this against its idle window (DESIGN.md §6).
   */
  idleMillis(now: Date): number | null {
    if (this.idleSince === null) return null;
    return now.getTime() - this.idleSince.getTime();
  }

  /** Live socket count, for the registry's post-drain eviction recheck (DESIGN.md §6). */
  get connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Mark this actor dropped by the registry (DESIGN.md §6). Called synchronously with the
   * registry map delete, after a successful drain, so no await separates the mark from the
   * moment the registry stops handing this actor out. From here every attach is refused.
   */
  markEvicted(): void {
    this.evicted = true;
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
    if (held && this.connections.size === 0) this.idleSince = this.now();
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
    return (
      this.pending.length +
      this.pendingChecks.length +
      this.pendingVoteEvents.length
    );
  }

  /**
   * Enqueue a mutation on the mailbox. Every mutation for this game runs through this one
   * queue, so however many sockets send concurrently, the commands take one total order
   * and seq stays contiguous (INV-2). The returned promise settles when the command has
   * been applied, flushed if the completion path fired, and broadcast. `checkPuzzle` and
   * `castCheckVote` ride the same queue: a proposal and a ballot are sequenced mutations of the
   * vote state (PROTOCOL.md §10; D32), fed to the engine's vote driver like any other command.
   */
  submit(
    connection: Connection,
    message:
      | PlaceLetterMessage
      | ClearCellMessage
      | CheckPuzzleMessage
      | CastCheckVoteMessage,
  ): Promise<void> {
    return this.mailbox.post(() => this.handleMutation(connection, message));
  }

  /**
   * Apply one command through the engine's vote driver (PROTOCOL.md §10; D32). Runs inside the
   * mailbox (see `submit`), so it is the single writer of this game's state. A cell mutation runs
   * two-phase completion and cancels an open vote when it completes or breaks the grid; a
   * `checkPuzzle` opens a vote (freezing the electorate assembled here from live presence); a
   * `castCheckVote` records a ballot and may resolve the vote. Each accepted command broadcasts its
   * sequenced events (adapter-stamped) and buffers them for the write-behind flush; a completing
   * move flushes synchronously then broadcasts `gameCompleted` (INV-3). A rejection unicasts a §11
   * error carrying the offending `commandId`, exactly like the cell mutations.
   */
  private async handleMutation(
    connection: Connection,
    message:
      | PlaceLetterMessage
      | ClearCellMessage
      | CheckPuzzleMessage
      | CastCheckVoteMessage,
  ): Promise<void> {
    // Role gate (DESIGN.md §3 step 2): spectators send nothing that mutates the board, the vote
    // proposal and ballot included (PROTOCOL.md §5: checkPuzzle and castCheckVote are host/solver).
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

    const nowDate = this.now();
    const at = nowDate.toISOString();

    // Translate the wire command into the engine's vote command. A proposal carries the electorate
    // frozen from live presence (INV-9: the engine gets it as data) and the session stamps the
    // vote's absolute `expiresAt` = now + TTL, attached to the broadcast checkVoteOpened.
    let command: VoteCommand;
    let openedExpiresAt: string | undefined;
    if (message.type === "checkPuzzle") {
      command = {
        type: "checkPuzzle",
        commandId: message.commandId,
        by: connection.userId,
        electorate: this.assembleElectorate(connection.userId),
      };
      openedExpiresAt = new Date(
        nowDate.getTime() + this.checkVoteTtlMs,
      ).toISOString();
    } else if (message.type === "castCheckVote") {
      command = {
        type: "castCheckVote",
        commandId: message.commandId,
        by: connection.userId,
        voteSeq: message.voteSeq,
        approve: message.approve,
      };
    } else {
      command = toEngineCommand(message, connection.userId, at);
    }

    // Capture whether firstFillAt was already set before applying: the reducer sets it once, on the
    // first placeLetter (PROTOCOL.md §4). A null-to-value transition means this cellSet is that fill.
    const hadFirstFillBefore = this.state.firstFillAt !== null;
    const result = applyWithVote(this.state, command, this.solution);

    if (result.error !== undefined) {
      connection.send(
        errorFrame(result.error, REJECTION_MESSAGE[result.error], {
          commandId: message.commandId,
        }),
      );
      return;
    }

    this.state = result.state;
    this.recordCommandId(message.commandId);

    // The first fill's cellSet carries firstFillAt so already-connected clients start the shared
    // timer on the delta, not only at their next snapshot (PROTOCOL.md §6). Rides exactly that one
    // event; every later cellSet omits it.
    const firstFillDelta =
      !hadFirstFillBefore && this.state.firstFillAt !== null
        ? this.state.firstFillAt
        : undefined;

    const completion = this.emitVoteEvents(
      result.events,
      at,
      openedExpiresAt,
      firstFillDelta,
    );

    // Reconcile the timer with the post-command vote state: a newly opened vote arms it, any close
    // (pass, reject, expiry, cancellation) cancels it (PROTOCOL.md §10; D32).
    this.reconcileVoteTimer(result.events, openedExpiresAt);

    if (completion !== null) {
      await this.completeGame(completion, at, connection.userId);
      return;
    }
    // A non-terminal cell fill changed the counts: feed the debounced fill push (fire-and-forget).
    // The vote commands set no cell, so they never touch the fill push. Emitted after the broadcast
    // so the WS path is never delayed.
    if (message.type === "placeLetter" || message.type === "clearCell") {
      this.pushEmitter.onFill(this.gameId, this.boardFacts());
    }
    await this.afterMutationFlush();
  }

  /**
   * Broadcast and buffer each event the vote driver produced (PROTOCOL.md §6, §10; D32), in engine
   * order. cellSets append to cell_events and broadcast; a `puzzleChecked` appends to check_events
   * (user_id = the proposer the engine names on `by`) and broadcasts with `by`; the three vote
   * events append to check_vote_events and broadcast adapter-stamped (`expiresAt` on the open). A
   * `gameCompleted` is not broadcast here: its seq is returned so `completeGame` flushes
   * synchronously first (INV-3). Since the terminal event stays last, everything before it is
   * broadcast in order.
   */
  private emitVoteEvents(
    events: readonly VoteEvent[],
    at: string,
    openedExpiresAt: string | undefined,
    firstFillDelta: string | undefined,
  ): number | null {
    let completion: number | null = null;
    for (const event of events) {
      switch (event.type) {
        case "cellSet":
          this.pending.push(event);
          this.broadcast(cellSetToWire(event, firstFillDelta));
          break;
        case "puzzleChecked":
          // user_id is the proposer whose vote passed (DESIGN.md §9); the vote path always sets `by`.
          this.pendingChecks.push({ seq: event.seq, userId: event.by!, at });
          this.broadcast(puzzleCheckedToWire(event, at));
          break;
        case "checkVoteOpened":
          this.pendingVoteEvents.push(openedVoteRow(event, at));
          this.broadcast(checkVoteOpenedToWire(event, at, openedExpiresAt!));
          break;
        case "checkVoteCast":
          this.pendingVoteEvents.push(castVoteRow(event, at));
          this.broadcast(checkVoteCastToWire(event, at));
          break;
        case "checkVoteClosed":
          this.pendingVoteEvents.push(closedVoteRow(event, at));
          this.broadcast(checkVoteClosedToWire(event, at));
          break;
        case "gameCompleted":
          completion = event.seq;
          break;
      }
    }
    return completion;
  }

  /**
   * The electorate frozen at proposal accept time (PROTOCOL.md §10; D32): the host and solver
   * members with a live socket on this actor, always including the proposer, ascending ASCII
   * (INV-1). Spectators never vote. Assembled from the cached connection roles (verified at
   * handshake, refreshed on a role change, INV-8), so it needs no Postgres read on the hot path.
   */
  private assembleElectorate(proposerId: string): string[] {
    const electors = new Set<string>([proposerId]);
    for (const conn of this.connections) {
      if (conn.role === "host" || conn.role === "solver") {
        electors.add(conn.userId);
      }
    }
    return [...electors].sort();
  }

  /**
   * Reconcile the expiry timer with the post-command vote state (PROTOCOL.md §10; D32). A vote that
   * just opened (and did not auto-pass) arms the timer at the stamped `expiresAt`; a closed vote (or
   * a solo auto-pass) cancels it. A ballot that leaves the vote open leaves the timer running at its
   * original deadline: the timebox never resets on a ballot.
   */
  private reconcileVoteTimer(
    events: readonly VoteEvent[],
    openedExpiresAt: string | undefined,
  ): void {
    if (this.state.checkVote === undefined || this.state.checkVote === null) {
      this.cancelVoteTimer();
      return;
    }
    const opened = events.some((e) => e.type === "checkVoteOpened");
    if (opened && openedExpiresAt !== undefined) {
      this.armVoteTimer(openedExpiresAt);
    }
  }

  /** Arm the expiry timer at `expiresAt` (PROTOCOL.md §10; D32), replacing any prior one. */
  private armVoteTimer(expiresAt: string): void {
    this.cancelVoteTimer();
    this.voteExpiresAt = expiresAt;
    const delay = Math.max(0, Date.parse(expiresAt) - this.now().getTime());
    this.voteTimer = setTimeout(() => {
      this.voteTimer = null;
      // Feed the expiry through the mailbox so it is serialized with commands (single writer, one
      // total order). An expiry racing a close is a silent no-op by contract.
      void this.mailbox
        .post(() => this.handleExpiry())
        .catch((error: unknown) => {
          console.error(`vote-expiry fault for game ${this.gameId}:`, error);
        });
    }, delay);
    this.voteTimer.unref?.();
  }

  /** Cancel the expiry timer and clear the session-owned `expiresAt` (the vote is closing). */
  private cancelVoteTimer(): void {
    if (this.voteTimer !== null) {
      clearTimeout(this.voteTimer);
      this.voteTimer = null;
    }
    this.voteExpiresAt = null;
  }

  /**
   * Close the open vote on the timer firing (PROTOCOL.md §10; D32): feed the engine an
   * `expireCheckVote` input, which closes it `failed` `EXPIRED`. With no vote open (the timer raced
   * a close) it is a silent no-op. Runs inside the mailbox (posted by the timer), so it never races
   * a command.
   */
  private async handleExpiry(): Promise<void> {
    const at = this.now().toISOString();
    const result = applyWithVote(
      this.state,
      { type: "expireCheckVote" },
      this.solution,
    );
    if (result.events.length === 0) {
      // No vote open: the timer raced a close. Ensure the timer state is clear and stop.
      this.cancelVoteTimer();
      return;
    }
    this.state = result.state;
    this.emitVoteEvents(result.events, at, undefined, undefined);
    this.cancelVoteTimer();
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
    const checks = this.pendingChecks;
    const voteEvents = this.pendingVoteEvents;
    const stats = await this.persistence.flushTerminal(
      this.gameId,
      events,
      checks,
      voteEvents,
      (participantCount, eventAtMs) => {
        const s = this.computeStats(
          terminalSeq,
          at,
          participantCount,
          eventAtMs,
        );
        return { snap: this.snapshotForFlush(s), stats: s };
      },
    );
    this.stats = stats;
    this.pending = [];
    this.pendingChecks = [];
    this.pendingVoteEvents = [];
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
   * Terminal abandon (INV-4). Closes an open vote `cancelled` `TERMINAL` first (BEFORE
   * `gameAbandoned`, mirroring the engine's completion ordering; the engine models no abandon, so
   * the actor composes it, PROTOCOL.md §10; D32), then takes the next seq, marks the state
   * abandoned, flushes the buffered events plus the abandoned snapshot SYNCHRONOUSLY in one
   * transaction, and broadcasts `gameAbandoned` (persisted before broadcast, like completion). The
   * terminal event consumes a seq but is never appended to cell_events (DESIGN.md §9); the vote
   * close consumes its own seq and lands in check_vote_events like any close.
   */
  private async doAbandon(by: string): Promise<void> {
    if (this.state.status !== "ongoing") return; // INV-4: a terminal state is final
    const at = this.now().toISOString();
    // Close an open vote first, so the ordering is checkVoteClosed(TERMINAL), then gameAbandoned.
    const vote = this.state.checkVote;
    if (vote !== undefined && vote !== null) {
      const closeSeq = this.state.seq + 1;
      const closed: CheckVoteClosed = {
        type: "checkVoteClosed",
        seq: closeSeq,
        voteSeq: vote.openedSeq,
        outcome: "cancelled",
        reason: "TERMINAL",
      };
      this.state = { ...this.state, seq: closeSeq, checkVote: null };
      this.pendingVoteEvents.push(closedVoteRow(closed, at));
      this.broadcast(checkVoteClosedToWire(closed, at));
      this.cancelVoteTimer();
    }
    const seq = this.state.seq + 1;
    this.state = { ...this.state, status: "abandoned", seq };
    this.abandonedAt = at;
    const events = this.pending;
    await this.persistence.flush(
      this.gameId,
      events,
      this.pendingChecks,
      this.pendingVoteEvents,
      this.snapshotForFlush(),
    );
    this.pending = [];
    this.pendingChecks = [];
    this.pendingVoteEvents = [];
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
    if (this.pendingFlushCount >= this.flushEventThreshold) {
      await this.doFlush();
      return;
    }
    if (this.pendingFlushCount > 0 && this.flushTimer === null) {
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
    if (this.pendingFlushCount === 0) return;
    const events = this.pending;
    const checks = this.pendingChecks;
    const voteEvents = this.pendingVoteEvents;
    await this.persistence.flush(
      this.gameId,
      events,
      checks,
      voteEvents,
      this.snapshotForFlush(),
    );
    this.pending = [];
    this.pendingChecks = [];
    this.pendingVoteEvents = [];
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
      // The marks, count, and open vote persist with the board they describe, in one jsonb, so a
      // rehydrated actor serves exactly the snapshot it flushed (INV-5; D27, D32).
      board: {
        cells: boardCells(this.state),
        checkedWrongCells: checkedWrongAscending(this.state),
        checkCount: this.state.checkCount,
        checkVote: this.persistedCheckVote(),
      },
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
      checkVote: this.wireCheckVote(),
    });
  }

  /**
   * The open vote as the persisted snapshot shape (DESIGN.md §9; D32), or null when none. Carries
   * the engine fields plus the session-owned `expiresAt` so a rehydrated actor resumes or expires
   * the vote (writer.ts PersistedCheckVote). Defensive null when `expiresAt` is unset, which cannot
   * happen while a vote is open.
   */
  private persistedCheckVote(): PersistedCheckVote | null {
    const vote = this.state.checkVote;
    if (vote === undefined || vote === null || this.voteExpiresAt === null) {
      return null;
    }
    return {
      openedSeq: vote.openedSeq,
      by: vote.by,
      commandId: vote.commandId,
      electorate: [...vote.electorate],
      approvals: [...vote.approvals],
      rejections: [...vote.rejections],
      expiresAt: this.voteExpiresAt,
    };
  }

  /** The open vote as the §4 wire object (PROTOCOL.md §4; D32), or null when none is open. */
  private wireCheckVote(): CheckVoteView | null {
    const vote = this.state.checkVote;
    if (vote === undefined || vote === null || this.voteExpiresAt === null) {
      return null;
    }
    return checkVoteToWire(vote, this.voteExpiresAt);
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
   * `eventAtMs` is the whole log's timestamps from that same transaction (seq order,
   * epoch ms), the sittings inputs (D29) — same provenance rationale as participantCount.
   */
  private computeStats(
    terminalSeq: number,
    completedAt: string,
    participantCount: number,
    eventAtMs: readonly number[],
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
    // The sittings partition over the log (PROTOCOL.md §4, D29): one walk in seq order; a
    // gap of SITTING_GAP_MS or more collapses in full and closes a sitting (`>=` at the
    // boundary, a negative skew gap never splits) — the engine's `collapseIdle` rule under
    // the engine's constant, so the two readings cannot disagree on the threshold.
    let collapsedMs = 0;
    let sittingCount = eventAtMs.length === 0 ? 0 : 1;
    for (let i = 1; i < eventAtMs.length; i++) {
      const gap = eventAtMs[i]! - eventAtMs[i - 1]!;
      if (gap >= SITTING_GAP_MS) {
        collapsedMs += gap;
        sittingCount += 1;
      }
    }
    // activeSolveSeconds: solveTimeSeconds with idle collapsed — same endpoints, same
    // rounding, minus the collapsed milliseconds, clamped at 0 (PROTOCOL.md §4). A gapless
    // game yields activeSolveSeconds === solveTimeSeconds exactly.
    const activeSolveSeconds =
      firstFill === null
        ? 0
        : Math.max(
            0,
            Math.round(
              (Date.parse(completedAt) - Date.parse(firstFill) - collapsedMs) /
                1000,
            ),
          );
    return {
      solveTimeSeconds,
      totalEvents: terminalSeq - 1,
      participantCount,
      // The permanent count freezes into the stats at completion (PROTOCOL.md §4, §10).
      checkCount: this.state.checkCount,
      activeSolveSeconds,
      sittingCount,
    };
  }

  private broadcast(frame: ServerMessage): void {
    for (const connection of this.connections) connection.send(frame);
  }
}
