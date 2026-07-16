// The simulation core: it drives the real server pipeline and the real client store
// against a scripted, deterministic network. Nothing here is a re-implementation of
// gameplay. The server side is the real GameActor (apps/session), the client side is the
// real GameStore (apps/web); this module only stands in for the wire between them, the
// piece a WebSocket normally provides, so that a fast-check program can inject the faults
// the protocol is built to survive (delay, single-frame loss, disconnect, reconnect).
//
// Why a shim instead of real sockets: a property loop runs thousands of programs, and a
// socket round trip per event would make that untenable. server.ts's live-frame routing
// is thin (placeLetter/clearCell -> actor.submit, requestSync -> a sync board built from
// actor.snapshotBoard, a reconnect welcome built the same way), so the shim reproduces
// exactly that routing and drives the same actor and store objects the service and the
// client construct in production. The DB-backed properties (crash.property.test.ts) use
// the real Postgres persistence; everything else uses an in-memory recorder.
//
// Determinism (the whole point, DESIGN.md section 11): no wall clock, no Math.random, no
// real timers on the logic path. The actor's clock is an injected counter, command ids
// come from an injected counter, and submissions are drained one at a time in FIFO order,
// so a program is a pure function of the values fast-check supplies and a failure replays
// from its seed.

import type {
  Board,
  ClientMessage,
  Participant,
  Role,
  ServerMessage,
} from "@crossy/protocol";
import type { CellSet } from "@crossy/engine";
import { matches } from "@crossy/engine";
import { GameActor } from "../../apps/session/src/actor";
import type { ActorOptions, Connection } from "../../apps/session/src/actor";
import { hydrateGame } from "../../apps/session/src/hydrate";
import type {
  GameStateRow,
  HydratedGame,
  PuzzleSnapshot,
} from "../../apps/session/src/hydrate";
import type {
  CheckEventRow,
  GamePersistence,
  StateSnapshot,
} from "../../apps/session/src/writer";
import { GameStore } from "../../apps/web/src/store/gameStore";

/** A tiny puzzle for the harness: geometry plus the server-only per-cell solution. */
export interface SimPuzzle {
  readonly rows: number;
  readonly cols: number;
  readonly blocks: readonly number[];
  /** Per-cell full solution; null at a block. Length rows*cols. Server-only (INV-6). */
  readonly solution: readonly (string | null)[];
}

/** One record of a write-behind flush, for the DESIGN.md section 15 measurement. */
export interface FlushRecord {
  readonly batch: number;
  readonly lastSeq: number;
  readonly kind: "threshold-or-inline" | "terminal";
}

/**
 * In-memory stand-in for the Postgres write path. It mirrors what the real flush does to
 * the two session-owned tables (append events to the log, upsert the snapshot) so the
 * actor's participantCount read and the flush cadence are exercised without Docker, and
 * it records every batch size for the flush measurement.
 */
export class RecordingPersistence implements GamePersistence {
  readonly log: CellSet[] = [];
  readonly checkLog: CheckEventRow[] = [];
  readonly flushes: FlushRecord[] = [];
  snapshot: StateSnapshot | null = null;

  async flush(
    _gameId: string,
    events: readonly CellSet[],
    checks: readonly CheckEventRow[],
    snap: StateSnapshot,
  ): Promise<void> {
    this.append(events);
    this.appendChecks(checks);
    this.snapshot = snap;
    this.flushes.push({
      batch: events.length,
      lastSeq: snap.lastSeq,
      kind: "threshold-or-inline",
    });
  }

  async flushTerminal(
    _gameId: string,
    events: readonly CellSet[],
    checks: readonly CheckEventRow[],
    buildSnapshot: (participantCount: number) => {
      snap: StateSnapshot;
      stats: import("@crossy/protocol").Stats;
    },
  ): Promise<import("@crossy/protocol").Stats> {
    this.append(events);
    this.appendChecks(checks);
    const participantCount = new Set(this.log.map((e) => e.by)).size;
    const { snap, stats } = buildSnapshot(participantCount);
    this.snapshot = snap;
    this.flushes.push({
      batch: events.length,
      lastSeq: snap.lastSeq,
      kind: "terminal",
    });
    return stats;
  }

  private append(events: readonly CellSet[]): void {
    for (const event of events) {
      // Mirror the real ON CONFLICT (game_id, seq) DO NOTHING: never double-append a seq.
      if (this.log.some((e) => e.seq === event.seq)) continue;
      this.log.push(event);
    }
  }

  private appendChecks(checks: readonly CheckEventRow[]): void {
    for (const check of checks) {
      if (this.checkLog.some((c) => c.seq === check.seq)) continue;
      this.checkLog.push(check);
    }
  }
}

/** The state of one simulated client and its socket. */
interface SimClient {
  readonly index: number;
  readonly userId: string;
  readonly role: Role;
  readonly store: GameStore;
  readonly connection: Connection;
  /** Frames the actor has emitted toward this client, awaiting network delivery. */
  inbox: ServerMessage[];
  connected: boolean;
}

export interface SimClientSpec {
  readonly role: Role;
}

/** One generated step. `value`/`cell`/`count` are read only by the kinds that use them. */
export interface RawAction {
  readonly kind:
    "place" | "clear" | "deliver" | "dropFrame" | "disconnect" | "reconnect";
  readonly client: number;
  readonly cell: number;
  readonly value: string;
  readonly count: number;
}

export interface SimOptions {
  readonly puzzle: SimPuzzle;
  readonly clients: readonly SimClientSpec[];
  readonly actorOptions?: ActorOptions;
  /** A seeded starting board (near-complete grids for the completion properties). */
  readonly seedState?: GameStateRow;
  /** The persistence port; defaults to a fresh in-memory recorder. */
  readonly persistence?: GamePersistence;
  /** The game id the actor passes to persistence; must match the seeded DB row (crash test). */
  readonly gameId?: string;
}

/** A stable, deterministic userId for client `i` (a valid-looking uuid for the DB path). */
export function simUserId(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

const SENTINEL_CLOCK_START = Date.UTC(2026, 6, 8, 0, 0, 0);

/** A GameStateRow for a solved board, to seed the actor terminal for the INV-4 property. */
export function completedSeedState(puzzle: SimPuzzle): GameStateRow {
  const blocks = new Set(puzzle.blocks);
  const writer = simUserId(0);
  let filled = 0;
  const board = puzzle.solution.map((solution, cell) => {
    if (blocks.has(cell) || solution === null) {
      return { v: null, by: null };
    }
    filled += 1;
    return { v: solution, by: writer };
  });
  return {
    status: "completed",
    board,
    lastSeq: filled + 1, // the completing events plus the terminal seq
    firstFillAt: new Date(SENTINEL_CLOCK_START).toISOString(),
    completedAt: new Date(SENTINEL_CLOCK_START + 60_000).toISOString(),
    abandonedAt: null,
    stats: {
      solveTimeSeconds: 60,
      totalEvents: filled,
      participantCount: 1,
      checkCount: 0,
    },
    recentCommandIds: [],
  };
}

function puzzleSnapshot(puzzle: SimPuzzle): PuzzleSnapshot {
  return {
    rows: puzzle.rows,
    cols: puzzle.cols,
    blocks: puzzle.blocks,
    solution: puzzle.solution,
  };
}

/**
 * One simulated game: the real actor on the server side, one real store per client, and
 * the scripted network between them. Build it, `init()`, apply actions, `settle()`, then
 * read the assertions helpers.
 */
export class Sim {
  /** The live server actor. Replaced by `rehydrate` when the crash property restarts it. */
  actor: GameActor;
  readonly persistence: GamePersistence;
  readonly clients: SimClient[] = [];
  /** Everything the actor broadcast, in order: the authoritative sequenced stream. */
  readonly serverLog: ServerMessage[] = [];

  private readonly puzzle: SimPuzzle;
  private readonly gameId: string;
  private readonly actorOptions: ActorOptions;
  private readonly observer: Connection;
  private readonly submissions: {
    client: SimClient;
    message: ClientMessage;
  }[] = [];
  private clockTick = 0;
  private idCounter = 0;

  constructor(options: SimOptions) {
    this.puzzle = options.puzzle;
    this.gameId = options.gameId ?? "sim-game";
    this.actorOptions = options.actorOptions ?? { flushEventThreshold: 1 };
    this.persistence = options.persistence ?? new RecordingPersistence();
    const hydrated = hydrateGame(
      puzzleSnapshot(options.puzzle),
      options.seedState ?? null,
    );
    this.actor = new GameActor(
      this.gameId,
      hydrated,
      this.persistence,
      () => this.now(),
      this.actorOptions,
    );

    // An always-connected observer taps every broadcast frame into serverLog. It never
    // submits, so it needs no store and never leaves the actor's connection set.
    this.observer = {
      userId: "sim-observer",
      role: "spectator",
      send: (frame) => this.serverLog.push(frame),
    };
    this.actor.addConnection(this.observer);

    options.clients.forEach((spec, index) => {
      const userId = simUserId(index);
      const client: SimClient = {
        index,
        userId,
        role: spec.role,
        connected: false,
        inbox: [],
        store: new GameStore({
          transport: {
            send: (message) => this.onClientSend(client, message),
          },
          newCommandId: () => `c${index}-${this.idCounter++}`,
        }),
        connection: {
          userId,
          role: spec.role,
          send: (frame) => {
            if (client.connected) client.inbox.push(frame);
          },
        },
      };
      this.clients.push(client);
    });
  }

  private now(): Date {
    return new Date(SENTINEL_CLOCK_START + this.clockTick++ * 1000);
  }

  private currentParticipants(): Participant[] {
    return this.clients.map((c) => ({
      userId: c.userId,
      displayName: `P${c.index}`,
      // Simulated participants carry no avatar; convergence is over board state, not presence chrome.
      avatarUrl: null,
      color: "#000000",
      role: c.role,
      connected: c.connected,
    }));
  }

  /** The server's current sequenced board (what every client must converge to). */
  serverBoard(): Board {
    return this.actor.snapshotBoard(this.currentParticipants());
  }

  /** Connect every client and deliver the opening welcome so each store starts live. */
  async init(): Promise<void> {
    for (const client of this.clients) {
      this.actor.addConnection(client.connection);
      client.connected = true;
      client.inbox.push(this.welcomeFor(client));
    }
    for (const client of this.clients) this.deliverAll(client);
    await this.drainSubmissions();
  }

  /**
   * Model a hard crash and restart (INV-5, PROTOCOL.md section 7): drop the running actor,
   * stand up a fresh one from `hydrated` (the last flushed snapshot plus its log, read back
   * from persistence), and drop every client's socket. `settle` then reconnects each client,
   * which receives a welcome whose seq may be LOWER than what it already applied and MUST
   * roll back, re-sending pending commands still inside the window.
   */
  rehydrate(hydrated: HydratedGame): void {
    this.actor = new GameActor(
      this.gameId,
      hydrated,
      this.persistence,
      () => this.now(),
      this.actorOptions,
    );
    this.actor.addConnection(this.observer);
    for (const client of this.clients) {
      client.connected = false;
      client.inbox = [];
      client.store.connectionLost();
    }
  }

  private welcomeFor(client: SimClient): ServerMessage {
    return {
      type: "welcome",
      protocolVersion: 1,
      self: { userId: client.userId, role: client.role },
      board: this.serverBoard(),
    };
  }

  private onClientSend(client: SimClient, message: ClientMessage): void {
    // A disconnected socket drops the frame; the overlay keeps it and reconnection
    // re-sends (PROTOCOL.md section 8, best-effort transport).
    if (!client.connected) return;
    this.submissions.push({ client, message });
  }

  /**
   * Route every queued client frame to the server, one at a time in FIFO order, awaiting
   * each so the actor's mailbox assigns a deterministic total order. placeLetter and
   * clearCell reach the real actor; requestSync gets a fresh sync board; the rest are the
   * ephemeral frames the service ignores (PROTOCOL.md section 9).
   */
  private async drainSubmissions(): Promise<void> {
    while (this.submissions.length > 0) {
      const next = this.submissions.shift();
      if (next === undefined) break;
      const { client, message } = next;
      if (message.type === "placeLetter" || message.type === "clearCell") {
        await this.actor.submit(client.connection, message);
      } else if (message.type === "requestSync") {
        if (client.connected) {
          client.inbox.push({ type: "sync", board: this.serverBoard() });
        }
      }
      // moveCursor / heartbeat: accepted and ignored, exactly as the service does.
    }
  }

  /** Await any queued client frames (call after an imperative action to let the server run). */
  async pump(): Promise<void> {
    await this.drainSubmissions();
  }

  /** Apply one generated step, then let the server process what it produced. */
  async step(action: RawAction): Promise<void> {
    switch (action.kind) {
      case "place":
        this.place(action.client, action.cell, action.value);
        break;
      case "clear":
        this.clear(action.client, action.cell);
        break;
      case "deliver":
        this.deliver(action.client, action.count);
        break;
      case "dropFrame":
        this.dropFrame(action.client);
        break;
      case "disconnect":
        this.disconnect(action.client);
        break;
      case "reconnect":
        this.reconnect(action.client);
        break;
    }
    await this.drainSubmissions();
  }

  /**
   * Submit a mutation straight through the actor, bypassing the store's local terminal
   * freeze, so the INV-4 property can prove the SERVER rejects post-terminal mutations
   * (the store guard is a separate, client-side belt-and-braces). Returns the error codes
   * the actor sent back for this command.
   */
  async forceMutate(
    clientIndex: number,
    cell: number,
    value: string | null,
  ): Promise<string[]> {
    const client = this.client(clientIndex);
    const commandId = `f${clientIndex}-${this.idCounter++}`;
    const before = client.inbox.length;
    const message: ClientMessage =
      value === null
        ? { type: "clearCell", commandId, cell }
        : { type: "placeLetter", commandId, cell, value };
    await this.actor.submit(client.connection, message);
    const codes: string[] = [];
    for (let i = before; i < client.inbox.length; i++) {
      const frame = client.inbox[i];
      if (frame !== undefined && frame.type === "error") codes.push(frame.code);
    }
    return codes;
  }

  // --- Actions the generator drives (each is deterministic given its inputs) ---

  place(clientIndex: number, cell: number, value: string): void {
    const client = this.client(clientIndex);
    client.store.placeLetter(cell, value);
  }

  clear(clientIndex: number, cell: number): void {
    const client = this.client(clientIndex);
    client.store.clearCell(cell);
  }

  /** Deliver up to `count` inbox frames to the store, in order (never reordered). */
  deliver(clientIndex: number, count: number): void {
    const client = this.client(clientIndex);
    if (!client.connected) return;
    for (let i = 0; i < count && client.inbox.length > 0; i++) {
      const frame = client.inbox.shift();
      if (frame !== undefined) client.store.receive(frame);
    }
  }

  private deliverAll(client: SimClient): void {
    while (client.inbox.length > 0) {
      const frame = client.inbox.shift();
      if (frame !== undefined) client.store.receive(frame);
    }
  }

  /**
   * Drop the next sequenced frame in this client's inbox. A later frame then arrives with
   * a seq gap, which the store must answer with requestSync (PROTOCOL.md section 7). This
   * models a single lost frame on a live connection, the exact fault the resync path
   * exists for; it never reorders, honoring the per-connection ascending-seq contract.
   */
  dropFrame(clientIndex: number): void {
    const client = this.client(clientIndex);
    const idx = client.inbox.findIndex(
      (f) =>
        f.type === "cellSet" ||
        f.type === "gameCompleted" ||
        f.type === "gameAbandoned",
    );
    if (idx !== -1) client.inbox.splice(idx, 1);
  }

  /** A transport drop: the socket closes, in-flight frames are lost, the store backs off. */
  disconnect(clientIndex: number): void {
    const client = this.client(clientIndex);
    if (!client.connected) return;
    this.actor.removeConnection(client.connection);
    client.connected = false;
    client.inbox = [];
    client.store.connectionLost();
  }

  /** Reconnect: a fresh welcome snapshot the store reconciles against (PROTOCOL.md section 7). */
  reconnect(clientIndex: number): void {
    const client = this.client(clientIndex);
    if (client.connected) return;
    this.actor.addConnection(client.connection);
    client.connected = true;
    client.inbox = [this.welcomeFor(client)];
  }

  private client(index: number): SimClient {
    const client = this.clients[index];
    if (client === undefined) throw new Error(`no client ${index}`);
    return client;
  }

  /**
   * Drive the world to a fixpoint: reconnect everyone, deliver every buffered frame,
   * answer every resync, and route every re-send, until nothing is pending. This is where
   * gaps and reconnects "fully settle" (the convergence property's precondition). It is
   * bounded; overrunning the bound is itself a liveness bug and throws with context so the
   * seed reproduces it.
   */
  async settle(): Promise<void> {
    const MAX_ROUNDS = 200;
    await this.drainSubmissions();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let progressed = false;

      for (const client of this.clients) {
        if (!client.connected) {
          this.reconnect(client.index);
          progressed = true;
        }
      }
      await this.drainSubmissions();

      for (const client of this.clients) {
        if (client.connected && client.inbox.length > 0) {
          this.deliverAll(client);
          progressed = true;
        }
      }
      await this.drainSubmissions();

      const serverSeq = this.serverBoard().seq;
      for (const client of this.clients) {
        if (!client.connected || client.inbox.length > 0) continue;
        // Resync a client that is mid-gap, or one silently behind the server seq. The
        // latter is a lost frame whose gap no later event revealed: in a real session the
        // next sequenced event or a reconnect heals it, and the recentCommandIds in the
        // snapshot confirm and drop the echo the client never saw (PROTOCOL.md section 8).
        if (client.store.sync !== "live" || client.store.seq < serverSeq) {
          client.inbox.push({ type: "sync", board: this.serverBoard() });
          progressed = true;
        }
      }
      await this.drainSubmissions();

      if (!progressed && this.quiescent()) return;
    }
    throw new Error(
      "settle did not converge within the round bound (possible liveness bug)",
    );
  }

  private quiescent(): boolean {
    if (this.submissions.length > 0) return false;
    const serverSeq = this.serverBoard().seq;
    return this.clients.every(
      (c) =>
        c.connected &&
        c.inbox.length === 0 &&
        c.store.sync === "live" &&
        c.store.seq === serverSeq,
    );
  }

  // --- Assertion helpers (the properties read these; they assert, not this module) ---

  /** The sequenced events the server broadcast, in order (cellSet/gameCompleted/etc.). */
  sequencedServerEvents(): { seq: number; type: string; commandId?: string }[] {
    const out: { seq: number; type: string; commandId?: string }[] = [];
    for (const frame of this.serverLog) {
      if (frame.type === "cellSet") {
        out.push({
          seq: frame.seq,
          type: frame.type,
          commandId: frame.commandId,
        });
      } else if (
        frame.type === "gameCompleted" ||
        frame.type === "gameAbandoned"
      ) {
        out.push({ seq: frame.seq, type: frame.type });
      }
    }
    return out;
  }

  completionCount(): number {
    return this.serverLog.filter((f) => f.type === "gameCompleted").length;
  }

  /** How many times the server broadcast a cellSet for each commandId (dedup check). */
  cellSetCountByCommandId(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const frame of this.serverLog) {
      if (frame.type === "cellSet") {
        counts.set(frame.commandId, (counts.get(frame.commandId) ?? 0) + 1);
      }
    }
    return counts;
  }

  /** Is the server board full and correct under the comparator (a completion is due)? */
  boardIsCorrectAndFull(): boolean {
    const board = this.serverBoard();
    for (const cell of this.playableCells()) {
      const value = board.cells[cell]?.v ?? null;
      const solution = this.puzzle.solution[cell];
      if (value === null || solution === null || solution === undefined) {
        return false;
      }
      if (!matches(solution, value)) return false;
    }
    return true;
  }

  /** Playable-cell indices (not blocks), in order. */
  playableCells(): number[] {
    const blocks = new Set(this.puzzle.blocks);
    const cells: number[] = [];
    for (let i = 0; i < this.puzzle.rows * this.puzzle.cols; i++) {
      if (!blocks.has(i)) cells.push(i);
    }
    return cells;
  }
}
