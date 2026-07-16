// The board payload (PROTOCOL.md §4), carried inside `welcome` and `sync`. It holds only mutable
// game state; the puzzle (geometry, clues) comes from REST and is immutable per game.

/** A participant's role in a game (DESIGN.md §8). */
export type Role = "host" | "solver" | "spectator";

/** Cursor / word orientation (PROTOCOL.md §5). */
export type Direction = "across" | "down";

/** Game lifecycle status (PROTOCOL.md §4). */
export type GameStatus = "ongoing" | "completed" | "abandoned";

/**
 * One grid cell's mutable state. `{v:null,by:null}` is a black square or a never-written cell; a
 * cleared cell keeps its clearer as `by` with `v:null` (PROTOCOL.md §4, §6). A filled cell has
 * both. `v` may be a multi-character rebus string.
 */
export interface Cell {
  readonly v: string | null;
  readonly by: string | null;
}

/** A participant view at snapshot time (PROTOCOL.md §4). */
export interface Participant {
  readonly userId: string;
  readonly displayName: string;
  /**
   * An opaque, nullable avatar URL, resolved server-side once where the display name is
   * (DESIGN.md §8): a provider metadata avatar, else a Gravatar URL from the account email, else
   * null. `null` is a first-class value; a client renders the image when present and falls back to
   * its initial avatar while loading, on a load error, or when null (PROTOCOL.md §4). The value is
   * opaque: no client learns which provider produced it, and no email or hash input ever crosses
   * the wire (INV-6 spirit).
   */
  readonly avatarUrl: string | null;
  readonly color: string;
  readonly role: Role;
  readonly connected: boolean;
}

/** A cursor position at snapshot time (PROTOCOL.md §4). Best-effort, never sequenced (§9). */
export interface Cursor {
  readonly userId: string;
  readonly cell: number;
  readonly direction: Direction;
}

/** Completion stats, non-null only when the game is completed (PROTOCOL.md §4). */
export interface Stats {
  readonly solveTimeSeconds: number;
  readonly totalEvents: number;
  readonly participantCount: number;
  /** The game's total accepted checks, frozen at completion (PROTOCOL.md §4, §10; D27). */
  readonly checkCount: number;
}

/**
 * The full board snapshot (PROTOCOL.md §4). `cells` has length `rows * cols`. `recentCommandIds`
 * is the last K applied `commandId`s for snapshot reconciliation (§8). Reconnect always transfers
 * the whole board; there are no deltas (§1).
 */
export interface Board {
  readonly seq: number;
  readonly status: GameStatus;
  readonly firstFillAt: string | null;
  readonly completedAt: string | null;
  readonly abandonedAt: string | null;
  readonly cells: readonly Cell[];
  /**
   * The standing room-check marks (PROTOCOL.md §4, §10): the playable cells whose value
   * failed the comparator at the most recent checkPuzzle and has not changed since,
   * ascending, `[]` when none stand. Indices only, never values or answers (INV-6).
   */
  readonly checkedWrongCells: readonly number[];
  /** The game's total accepted checks, `0` before the first; permanent, never reset (§10). */
  readonly checkCount: number;
  readonly participants: readonly Participant[];
  readonly cursors: readonly Cursor[];
  readonly recentCommandIds: readonly string[];
  readonly stats: Stats | null;
}
