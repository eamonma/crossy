// Hydration (DESIGN.md §6): the first connection for a game loads `games` (the puzzle
// snapshot) plus `game_state` (the board snapshot and last_seq) and constructs the
// actor's starting state. `cell_events` is not read here (DESIGN.md §6). This is the
// adapter seam the engine README describes: the wire/db world is translated into the
// engine's own domain types (BoardState, a solution map), and the solution stays
// server-side for the comparator, never on any outbound frame (INV-6).

import type { BoardState, Cell, Grid } from "@crossy/engine";

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

/** The `game_state` row (DESIGN.md §9). Absent for a game no one has played yet. */
export interface GameStateRow {
  readonly status: "ongoing" | "completed" | "abandoned";
  readonly board: readonly RawCell[];
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
  const solution = new Map<number, string>();
  snapshot.solution.forEach((value, cell) => {
    if (value !== null) solution.set(cell, value);
  });
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

  const cells = new Map<number, Cell>();
  let filledCount = 0;
  if (state !== null) {
    state.board.forEach((raw, cell) => {
      if (raw.by === null) return; // black square or never-written
      cells.set(cell, { v: raw.v, by: raw.by });
      if (raw.v !== null) filledCount += 1;
    });
  }

  const boardState: BoardState = {
    grid,
    status: state?.status ?? "ongoing",
    seq: state?.lastSeq ?? 0,
    firstFillAt: state?.firstFillAt ?? null,
    cells,
    filledCount,
  };

  return {
    boardState,
    solution,
    completedAt: state?.completedAt ?? null,
    abandonedAt: state?.abandonedAt ?? null,
    recentCommandIds: state?.recentCommandIds ?? [],
    roomName,
  };
}
