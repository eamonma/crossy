// Hydration (DESIGN.md §6): the first connection for a game loads `games` (the puzzle
// snapshot) plus `game_state` (the board snapshot and last_seq) and constructs the
// actor's starting state. `cell_events` is not read here (DESIGN.md §6). This is the
// adapter seam the engine README describes: the wire/db world is translated into the
// engine's own domain types (BoardState, a solution map), and the solution stays
// server-side for the comparator, never on any outbound frame (INV-6).

import type { BoardState, Cell, Grid } from "@crossy/engine";
import type { Stats } from "@crossy/protocol";
import { serverPuzzleToSolution } from "@crossy/protocol";

/** The engine's comparator input: cell index to its full solution string. */
export type EngineSolution = ReadonlyMap<number, string>;

/** One cell as stored in `game_state.board` (PROTOCOL.md §4 shape). */
export interface RawCell {
  readonly v: string | null;
  readonly by: string | null;
}

/** The server-only puzzle model denormalized into `games.puzzle_snapshot` (DESIGN.md §9). */
export interface PuzzleSnapshot {
  readonly rows: number;
  readonly cols: number;
  readonly blocks: readonly number[];
  /** Per-cell full solution; `null` at a black square or unsolved cell. Server-only (INV-6). */
  readonly solution: readonly (string | null)[];
}

/**
 * The stored board jsonb, in either of its two generations: the current object shape
 * (writer.ts BoardSnapshot: cells plus the room-check marks and count, D27) or the
 * pre-check bare cell array a legacy row still holds. The reader accepts both
 * (expand/contract, DESIGN.md §9): a legacy board hydrates with no standing marks and
 * a zero count, which is exactly the state it was flushed in.
 */
export type StoredBoard =
  | readonly RawCell[]
  | {
      readonly cells: readonly RawCell[];
      readonly checkedWrongCells?: readonly number[];
      readonly checkCount?: number;
    };

/** The `game_state` row (DESIGN.md §9). Absent for a game no one has played yet. */
export interface GameStateRow {
  readonly status: "ongoing" | "completed" | "abandoned";
  readonly board: StoredBoard;
  readonly lastSeq: number;
  readonly firstFillAt: string | null;
  readonly completedAt: string | null;
  readonly abandonedAt: string | null;
  readonly stats: Record<string, unknown> | null;
  readonly recentCommandIds: readonly string[];
}

/** Everything the actor needs to start serving a game. */
export interface HydratedGame {
  readonly boardState: BoardState;
  readonly solution: EngineSolution;
  readonly completedAt: string | null;
  readonly abandonedAt: string | null;
  readonly recentCommandIds: readonly string[];
  /**
   * The room's display name (`games.name`, nullable). Carried so the completion Live Activity alert
   * body can name the room without a second read on the hot path (PROTOCOL.md 12a). Display content
   * only, never solution-bearing (INV-6).
   */
  readonly roomName: string | null;
  /**
   * The persisted completion stats, non-null only for a completed game (PROTOCOL.md §4).
   * Carried through so a rehydrated terminal actor serves the same snapshot it flushed
   * (INV-5): the stats were computed once, inside the terminal flush transaction, and
   * must survive passivation like every other snapshot fact.
   */
  readonly stats: Stats | null;
}

/** Narrow a stored board to its legacy bare-array generation (pre-check rows, D27). */
function isLegacyBoard(board: StoredBoard): board is readonly RawCell[] {
  return Array.isArray(board);
}

/** Parse the puzzle snapshot into the engine grid and the comparator's solution map. */
function readPuzzle(snapshot: PuzzleSnapshot): {
  grid: Grid;
  solution: EngineSolution;
} {
  const grid: Grid = {
    cols: snapshot.cols,
    rows: snapshot.rows,
    blocks: new Set(snapshot.blocks),
  };
  // One extraction of the snapshot into a cell -> value map, shared with the API's Archive
  // read model (packages/protocol), so the live comparator and first-correct attribution
  // read one cell index space and cannot drift (INV-6-safe: server-side only, never outbound).
  const solution = serverPuzzleToSolution(snapshot);
  return { grid, solution };
}

/**
 * Build the actor's starting state from the puzzle snapshot and the optional game_state
 * row. With no game_state row the board is empty at seq 0 (a game no one has played).
 * A cell counts as written when it carries a writer (`by`), so a cleared cell
 * (`{v:null, by:"u"}`) is preserved distinct from a black or never-written cell
 * (`{v:null, by:null}`), per PROTOCOL.md §4.
 */
export function hydrateGame(
  snapshot: PuzzleSnapshot,
  state: GameStateRow | null,
  roomName: string | null = null,
): HydratedGame {
  const { grid, solution } = readPuzzle(snapshot);

  // Split the stored board into its facts, tolerating the legacy bare-array shape
  // (StoredBoard): a legacy row carries no check state, which reads as none standing.
  const stored: StoredBoard = state?.board ?? [];
  const legacy = isLegacyBoard(stored);
  const storedCells = legacy ? stored : stored.cells;
  const storedChecked = legacy ? [] : (stored.checkedWrongCells ?? []);
  const storedCheckCount = legacy ? 0 : (stored.checkCount ?? 0);

  const cells = new Map<number, Cell>();
  let filledCount = 0;
  storedCells.forEach((raw, cell) => {
    if (raw.by === null) return; // black square or never-written
    cells.set(cell, { v: raw.v, by: raw.by });
    if (raw.v !== null) filledCount += 1;
  });

  const boardState: BoardState = {
    grid,
    status: state?.status ?? "ongoing",
    seq: state?.lastSeq ?? 0,
    firstFillAt: state?.firstFillAt ?? null,
    cells,
    filledCount,
    // The standing marks and the permanent count survive passivation with the board
    // they describe (PROTOCOL.md §4, §10; D27).
    checkedWrong: new Set(storedChecked),
    checkCount: storedCheckCount,
  };

  // The single writer serialized this from a Stats at the terminal flush (INV-7), so the
  // cast mirrors the one on the write side (actor snapshotForFlush). The repo maps an
  // empty `{}` (an ongoing game's row) to null before it reaches here. A row flushed
  // before the room check landed (D27) predates stats.checkCount; backfill the zero it
  // means, so every served snapshot carries the full PROTOCOL.md §4 stats shape.
  const rawStats =
    (state?.stats as
      | (Omit<Stats, "checkCount"> & { checkCount?: number })
      | null) ?? null;
  const stats: Stats | null =
    rawStats === null
      ? null
      : { ...rawStats, checkCount: rawStats.checkCount ?? 0 };

  return {
    boardState,
    solution,
    completedAt: state?.completedAt ?? null,
    abandonedAt: state?.abandonedAt ?? null,
    recentCommandIds: state?.recentCommandIds ?? [],
    roomName,
    stats,
  };
}
