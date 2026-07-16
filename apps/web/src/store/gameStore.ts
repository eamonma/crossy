// The client store: sequenced state plus an optimistic overlay, reconciled to the
// server's order (DESIGN.md section 10, INV-10; PROTOCOL.md sections 7 and 8). The
// client-store vectors (vectors/v1/client-store) are the specification; the suite in
// client-store.vectors.test.ts executes every case against this class. The store
// speaks wire types from packages/protocol and sends through an injected transport,
// so tests need no socket.
import type {
  Board,
  Cell,
  Cursor,
  Direction,
  GameStatus,
  Participant,
  ReactionNotice,
  ServerMessage,
  Stats,
} from "@crossy/protocol";
import type { GameTransport } from "./transport";

/**
 * The store's connection state. Three of these are the PROTOCOL.md section 7 wire
 * lifecycle (token set normative in vectors/README.md): `live` applies events in order;
 * `resyncing` has seen a gap, sent `requestSync`, and ignores sequenced events until the
 * next snapshot; `reconnecting` lost the socket after a drop or fatal error and waits for
 * the reconnect `welcome` to reconcile.
 *
 * `connecting` is the honest initial state before the first `welcome` ever lands: no
 * board exists yet. It is deliberately distinct from `reconnecting` (a post-drop state)
 * so the UI does not claim "Reconnecting..." on a healthy first connect, and so local
 * mutations are refused until there is authoritative state to build on. It is client-
 * local and pre-handshake: no vector encodes it (every client-store case supplies an
 * explicit `given.sync` and only transitions produce live/resyncing/reconnecting), and
 * no wire message carries it.
 */
export type SyncState = "connecting" | "live" | "resyncing" | "reconnecting";

/**
 * A sent-but-unconfirmed mutation (PROTOCOL.md section 8). `value` is null for a
 * pending clearCell. `agedOut` marks an entry past the recent-command window K, so
 * reconciliation drops it instead of re-sending; how a client measures age against K
 * is deliberately unsettled (PROTOCOL.md section 8, "Age against K"), so nothing in
 * this store derives the flag. The vectors supply it as case input.
 */
export interface PendingCommand {
  readonly commandId: string;
  readonly cell: number;
  readonly value: string | null;
  readonly agedOut?: boolean;
}

/** A conflict-flash trigger (PROTOCOL.md section 8): the view animates, the store detects. */
export interface ConflictFlash {
  readonly cell: number;
  readonly by: string;
}

export interface GameStoreInit {
  transport: GameTransport;
  /** Command id source; defaults to crypto.randomUUID (PROTOCOL.md section 3). */
  newCommandId?: () => string;
  /** Starting state, used by the vector suite to seed `given`. */
  initial?: {
    seq: number;
    sync: SyncState;
    cells?: ReadonlyMap<number, Cell>;
    overlay?: readonly PendingCommand[];
    status?: GameStatus;
  };
}

/** ASCII-only uppercase (INV-1): map a-z to A-Z, leave every other code point alone. */
function asciiUpper(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : ch;
  }
  return out;
}

export class GameStore {
  private readonly transport: GameTransport;
  private readonly newCommandId: () => string;

  private seqValue: number;
  private syncValue: SyncState;
  private statusValue: GameStatus;
  private cellsValue: Map<number, Cell>;
  private overlayValue: PendingCommand[];
  private participantsValue: Participant[] = [];
  private cursorsValue = new Map<string, Cursor>();
  private firstFillAtValue: string | null = null;
  private completedAtValue: string | null = null;
  private abandonedAtValue: string | null = null;
  private statsValue: Stats | null = null;
  private selfUserIdValue: string | null = null;
  // Room-check state (PROTOCOL.md §4, §10; D27): the standing marks and the permanent
  // count, reconciled like any sequenced state. Rendering them (the check style, the
  // confirm-and-send control) lands in the consolidated gameplay-control wave; the store
  // tracks them now so a `puzzleChecked` is an ordinary event, never a forced resync.
  private checkedWrongValue = new Set<number>();
  private checkCountValue = 0;

  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly flashListeners = new Set<(flash: ConflictFlash) => void>();
  private readonly reactionListeners = new Set<(r: ReactionNotice) => void>();

  constructor(init: GameStoreInit) {
    this.transport = init.transport;
    this.newCommandId = init.newCommandId ?? (() => crypto.randomUUID());
    this.seqValue = init.initial?.seq ?? 0;
    // Honest default: a freshly opened game is `connecting`, not `reconnecting`. The vector
    // suite always seeds `sync` explicitly, so this default is exercised only by the real
    // connect path (net/connect.ts); the first `welcome` flips it to `live`.
    this.syncValue = init.initial?.sync ?? "connecting";
    this.statusValue = init.initial?.status ?? "ongoing";
    this.cellsValue = new Map(init.initial?.cells ?? []);
    this.overlayValue = [...(init.initial?.overlay ?? [])];
  }

  // --- Read surface (views subscribe, then read getters) ---

  get seq(): number {
    return this.seqValue;
  }
  get sync(): SyncState {
    return this.syncValue;
  }
  get status(): GameStatus {
    return this.statusValue;
  }
  get overlay(): readonly PendingCommand[] {
    return this.overlayValue;
  }
  get participants(): readonly Participant[] {
    return this.participantsValue;
  }
  get cursors(): ReadonlyMap<string, Cursor> {
    return this.cursorsValue;
  }
  get firstFillAt(): string | null {
    return this.firstFillAtValue;
  }
  get completedAt(): string | null {
    return this.completedAtValue;
  }
  get abandonedAt(): string | null {
    return this.abandonedAtValue;
  }
  get stats(): Stats | null {
    return this.statsValue;
  }
  get selfUserId(): string | null {
    return this.selfUserIdValue;
  }
  /** The standing room-check marks (PROTOCOL.md §4, §10). Indices only (INV-6). */
  get checkedWrongCells(): ReadonlySet<number> {
    return this.checkedWrongValue;
  }
  /** The game's total accepted checks; permanent, never reset (PROTOCOL.md §10). */
  get checkCount(): number {
    return this.checkCountValue;
  }

  /**
   * The composite the user sees for one cell (INV-10): sequenced state painted with
   * the overlay, the most recently sent pending entry winning per cell (PROTOCOL.md
   * section 8). Pending values render through the same path as confirmed ones, so
   * the view cannot tell them apart (Decision 2.1d-4).
   */
  renderValue(cell: number): string | null {
    for (let i = this.overlayValue.length - 1; i >= 0; i -= 1) {
      const entry = this.overlayValue[i];
      if (entry !== undefined && entry.cell === cell) return entry.value;
    }
    return this.cellsValue.get(cell)?.v ?? null;
  }

  /**
   * The cell's SEQUENCED value only, never the optimistic overlay. The grid-full derivation
   * reads exactly this (R9, docs/design/room-actions-control.md): the client gates the check
   * row on the same state the server gates `checkPuzzle` on (PROTOCOL.md §5, §10), so a
   * just-typed optimistic last letter leaves the row disabled for a beat instead of letting
   * the platforms diverge.
   */
  sequencedValue(cell: number): string | null {
    return this.cellsValue.get(cell)?.v ?? null;
  }

  /**
   * The last writer of a cell's sequenced value: the `by` already on the wire (PROTOCOL.md
   * section 8, the same field the conflict flash reads). Null for an empty or never-written
   * cell. Read-only over confirmed state (the optimistic overlay carries no attribution), so
   * it introduces no new data path; the post-game mosaic reads it to paint each square its
   * owner's color. A later read model (first-correct, DESIGN.md D16) supersedes this source
   * without touching the caller's shape.
   */
  writerOf(cell: number): string | null {
    return this.cellsValue.get(cell)?.by ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** The view animates the ~300 ms conflict flash; the store only detects the trigger. */
  subscribeFlash(listener: (flash: ConflictFlash) => void): () => void {
    this.flashListeners.add(listener);
    return () => this.flashListeners.delete(listener);
  }

  /**
   * Relay an incoming reaction notice to the view (PROTOCOL.md §6, §9). Like subscribeFlash, the
   * store DETECTS and forwards but holds NOTHING: a reaction is ephemeral and never sequenced, so
   * it must never enter reconciled state (Wave 7.3). Because no reaction is stored, a snapshot
   * (welcome/sync/crash-rollback) can neither resurrect nor clear a live sticker. The transient
   * sprite state lives entirely in the view's ReactionModel.
   */
  subscribeReaction(listener: (r: ReactionNotice) => void): () => void {
    this.reactionListeners.add(listener);
    return () => this.reactionListeners.delete(listener);
  }

  // --- Local commands (PROTOCOL.md section 8: overlay entry plus send) ---

  placeLetter(cell: number, value: string, commandId?: string): void {
    this.sendMutation(cell, asciiUpper(value), commandId);
  }

  clearCell(cell: number, commandId?: string): void {
    this.sendMutation(cell, null, commandId);
  }

  /**
   * Relay the local cursor to the room (PROTOCOL.md sections 5 and 9). Ephemeral: no overlay,
   * no seq, best-effort. Refused before the first snapshot (`connecting`), since there is no
   * authoritative game to move a cursor over yet; the 10/s throttle is the caller's job (LiveApp
   * caps it, PROTOCOL.md section 9). Nothing here mutates store state, so views do not re-render.
   */
  moveCursor(cell: number, direction: Direction): void {
    if (this.syncValue === "connecting") return;
    this.transport.send({ type: "moveCursor", cell, direction });
  }

  /**
   * Fan a local reaction out to the room (PROTOCOL.md §5, §9). Ephemeral like moveCursor: no
   * overlay, no seq, and nothing stored, so views never re-render off this and a reaction can never
   * enter reconciled state (Wave 7.3). Refused before the first snapshot (`connecting`): there is
   * no authoritative board to anchor a cell against yet. The 5/s cap and the local echo are the
   * caller's job (ReactionModel), the same split as the cursor throttle. A reaction is legal in any
   * status, completed and abandoned included (§9), so there is deliberately no terminal-state gate.
   */
  react(emoji: string, cell: number): void {
    if (this.syncValue === "connecting") return;
    this.transport.send({ type: "react", emoji, cell });
  }

  /**
   * The room-wide check (PROTOCOL.md §5, §10; D27): a commandId-minted intent like any
   * mutation, but with no overlay entry, because a check owns no cell and paints nothing
   * optimistically. That absence is load-bearing for the rejection path (R2): a non-fatal
   * `GRID_NOT_FULL`/`GAME_NOT_ONGOING` echo finds no overlay entry to clear and falls through
   * as a silent no-op, which is the designed posture — the room's own state shows why.
   * The confirmation dialog is the caller's job; this command IS the confirmed intent (§10).
   */
  checkPuzzle(commandId?: string): void {
    // The same gates as sendMutation: no authoritative board yet, or a terminal board the
    // server would answer with GAME_NOT_ONGOING anyway (INV-4 scope).
    if (this.syncValue === "connecting") return;
    if (this.statusValue !== "ongoing") return;
    this.transport.send({
      type: "checkPuzzle",
      commandId: commandId ?? this.newCommandId(),
    });
  }

  private sendMutation(
    cell: number,
    value: string | null,
    commandId?: string,
  ): void {
    // Before the first welcome there is no authoritative board yet: refuse local
    // mutations so a keystroke cannot mint an overlay entry against an empty grid
    // (item 3; the UI de-emphasizes and locks input in this state too). This is an
    // explicit gate, not an accident of the old `reconnecting` default; the first
    // welcome flips sync to `live` and unlocks input. A later drop goes `reconnecting`,
    // where optimistic mutations are still allowed and reconciled (PROTOCOL.md section 8).
    if (this.syncValue === "connecting") return;
    // Terminal states freeze mutation locally: refused here, never reaching the
    // wire (ROADMAP Wave 2.1d terminal-state rule; INV-4 governs the board, the
    // server would reject with GAME_NOT_ONGOING anyway).
    if (this.statusValue !== "ongoing") return;
    const id = commandId ?? this.newCommandId();
    this.overlayValue.push({ commandId: id, cell, value });
    this.transport.send(
      value === null
        ? { type: "clearCell", commandId: id, cell }
        : { type: "placeLetter", commandId: id, cell, value },
    );
    this.bump();
  }

  // --- Inbound frames (decoded by packages/protocol before they reach here) ---

  /** The transport lost the socket: back off and reconnect (PROTOCOL.md section 7).
   * The overlay is preserved so the reconnect welcome can re-send it (section 8). */
  connectionLost(): void {
    this.syncValue = "reconnecting";
    this.bump();
  }

  receive(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.selfUserIdValue = message.self.userId;
        this.applySnapshot(message.board);
        return;
      case "sync":
        this.applySnapshot(message.board);
        return;
      case "cellSet":
        this.applySequenced(message.seq, () => this.applyCellSet(message));
        return;
      case "gameCompleted":
        this.applySequenced(message.seq, () => {
          this.statusValue = "completed";
          this.completedAtValue = message.at;
          this.statsValue = message.stats;
        });
        return;
      case "gameAbandoned":
        this.applySequenced(message.seq, () => {
          this.statusValue = "abandoned";
          this.abandonedAtValue = message.at;
        });
        return;
      case "error":
        if (message.fatal) {
          // The connection is about to close (1008). Clear nothing by commandId:
          // the overlay must survive for the post-reconnect re-send (PROTOCOL.md
          // sections 7 and 8; the fatal-error vector pins exactly this).
          this.syncValue = "reconnecting";
          this.bump();
          return;
        }
        // A non-fatal error for a pending command clears its overlay entry so the
        // cell's true value is never masked (the immortal-overlay case, INV-10).
        if (message.commandId !== undefined) {
          this.removeOverlayEntry(message.commandId);
        }
        return;
      case "playerConnected": {
        const joined: Participant = {
          userId: message.userId,
          displayName: message.displayName,
          avatarUrl: message.avatarUrl,
          color: message.color,
          role: message.role,
          connected: true,
        };
        const index = this.participantsValue.findIndex(
          (p) => p.userId === message.userId,
        );
        if (index === -1) this.participantsValue.push(joined);
        else this.participantsValue[index] = joined;
        this.bump();
        return;
      }
      case "playerDisconnected": {
        const index = this.participantsValue.findIndex(
          (p) => p.userId === message.userId,
        );
        const present =
          index === -1 ? undefined : this.participantsValue[index];
        if (present !== undefined) {
          this.participantsValue[index] = { ...present, connected: false };
          this.cursorsValue.delete(message.userId);
          this.bump();
        }
        return;
      }
      case "cursor":
        this.cursorsValue.set(message.userId, {
          userId: message.userId,
          cell: message.cell,
          direction: message.direction as Direction,
        });
        this.bump();
        return;
      case "reaction":
        // Pure fan-out, then gone (PROTOCOL.md §6): forward to the view's ReactionModel and store
        // nothing. No bump, since no reconciled state changed; a sticker is not board state.
        for (const listener of this.reactionListeners) listener(message);
        return;
      case "puzzleChecked":
        // An ordinary sequenced event (PROTOCOL.md §6, §7): applied under the seq gate so
        // the stream never forces a resync. The marks replace any standing set wholesale
        // and the count is permanent (§10). UI (mark styling, the confirm-and-send
        // control) lands in the consolidated gameplay-control wave.
        this.applySequenced(message.seq, () => {
          this.checkedWrongValue = new Set(message.wrongCells);
          this.checkCountValue = message.checkCount;
        });
        return;
      case "kicked":
        // Followed by close 1008; the transport surfaces the closure. Nothing to
        // reconcile here in the skeleton.
        return;
    }
  }

  /**
   * The section 7 ordering rules for sequenced events: apply iff seq is exactly
   * lastApplied + 1; a gap sends requestSync and goes resyncing (events are ignored
   * until the snapshot lands); a stale event is discarded.
   */
  private applySequenced(seq: number, apply: () => void): void {
    if (this.syncValue !== "live") return; // awaiting a snapshot; ignore events
    if (seq === this.seqValue + 1) {
      apply();
      this.seqValue = seq;
      this.bump();
      return;
    }
    if (seq > this.seqValue + 1) {
      this.syncValue = "resyncing";
      this.transport.send({ type: "requestSync" });
      this.bump();
    }
    // seq <= lastApplied: stale, discard (PROTOCOL.md section 7).
  }

  private applyCellSet(message: {
    cell: number;
    value: string | null;
    by: string;
    commandId: string;
    firstFillAt?: string;
  }): void {
    const renderedBefore = this.renderValue(message.cell);
    // Mark clearing on value change ONLY (PROTOCOL.md §10, the reducer's rule): a
    // different letter or a clear removes a standing check mark; a same-value no-op
    // keeps it, because the mark is still true.
    const sequencedBefore = this.cellsValue.get(message.cell)?.v ?? null;
    if (
      message.value !== sequencedBefore &&
      this.checkedWrongValue.has(message.cell)
    ) {
      this.checkedWrongValue.delete(message.cell);
    }
    this.cellsValue.set(message.cell, { v: message.value, by: message.by });
    // The first fill's cellSet carries firstFillAt, so the shared timer (gameTime.ts)
    // starts on the delta instead of waiting for the next snapshot (PROTOCOL.md section 6).
    // Set-once, mirroring the reducer's rule: only the first fill's frame carries it, and a
    // stale or redelivered frame never reaches here (the section 7 seq gate in
    // applySequenced), so the origin is set exactly once and never moves.
    if (message.firstFillAt !== undefined && this.firstFillAtValue === null) {
      this.firstFillAtValue = message.firstFillAt;
    }
    // Your own echo clears its overlay entry (INV-10).
    this.removeOverlayEntry(message.commandId);
    // Conflict flash (PROTOCOL.md section 8): another user's event changed the
    // value you were rendering as non-null. Comparing the rendered composite
    // before and after means an event masked by a still-pending overlay entry
    // never flashes, and an erase of your letter always does.
    const renderedAfter = this.renderValue(message.cell);
    if (
      message.by !== this.selfUserIdValue &&
      renderedBefore !== null &&
      renderedAfter !== renderedBefore
    ) {
      for (const listener of this.flashListeners) {
        listener({ cell: message.cell, by: message.by });
      }
    }
  }

  private removeOverlayEntry(commandId: string): void {
    const index = this.overlayValue.findIndex(
      (entry) => entry.commandId === commandId,
    );
    if (index === -1) return;
    this.overlayValue.splice(index, 1);
    this.bump();
  }

  /**
   * Snapshot reconciliation, identical for welcome, sync, and a crash-rollback
   * snapshot (PROTOCOL.md sections 7 and 8): replace all sequenced state (a lower
   * seq is accepted and rolled back to, INV-5), then per still-pending command:
   * confirmed by recentCommandIds drops; aged out drops without re-send; otherwise
   * re-add and re-send (MUST, not MAY). Duplicates drop by commandId.
   */
  private applySnapshot(board: Board): void {
    this.seqValue = board.seq;
    this.statusValue = board.status;
    this.firstFillAtValue = board.firstFillAt;
    this.completedAtValue = board.completedAt;
    this.abandonedAtValue = board.abandonedAt;
    this.statsValue = board.stats;
    // The marks and count ride every snapshot (PROTOCOL.md §4), so reconnect and resync
    // heal the check state with no delta replay.
    this.checkedWrongValue = new Set(board.checkedWrongCells);
    this.checkCountValue = board.checkCount;
    this.participantsValue = [...board.participants];
    this.cursorsValue = new Map(
      board.cursors.map((cursor) => [cursor.userId, cursor]),
    );
    this.cellsValue = new Map();
    board.cells.forEach((cell, index) => {
      if (cell.v !== null || cell.by !== null) {
        this.cellsValue.set(index, cell);
      }
    });

    const recent = new Set(board.recentCommandIds);
    const pending = this.overlayValue;
    this.overlayValue = [];
    const seen = new Set<string>();
    for (const entry of pending) {
      if (seen.has(entry.commandId)) continue;
      seen.add(entry.commandId);
      if (recent.has(entry.commandId)) continue; // confirmed inside the gap
      if (entry.agedOut === true) continue; // past the window K: drop, never re-send
      this.overlayValue.push({
        commandId: entry.commandId,
        cell: entry.cell,
        value: entry.value,
      });
      this.transport.send(
        entry.value === null
          ? { type: "clearCell", commandId: entry.commandId, cell: entry.cell }
          : {
              type: "placeLetter",
              commandId: entry.commandId,
              cell: entry.cell,
              value: entry.value,
            },
      );
    }
    this.syncValue = "live";
    this.bump();
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
