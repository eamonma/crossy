// Domain vocabulary for the crossword client (DESIGN.md section 2): cell, word,
// clue, block, across/down. No x/y/tile. Cells are a flat, row-major array; index i
// maps to row = floor(i / cols), col = i mod cols. Geometry and navigation types
// live in @crossy/engine now; these are the view-side types.
import type { Direction } from "@crossy/engine";

/** One numbered word: its clue number, axis, and the cells it spans, in order. `text` is the
 * clue prose, present on the live board (it arrives on the ClientPuzzle) and absent on the demo
 * boards, which carry geometry only. */
export interface Clue {
  number: number;
  direction: Direction;
  cells: readonly number[];
  text?: string;
}

/** A fixture teammate: seeds the fake session's participants and cursors. */
export interface Teammate {
  id: string;
  initial: string;
  cell: number;
  direction: Direction;
}

/**
 * A puzzle template plus the derived numbering and clue lists. This is fake, local
 * data for the demo boards; the real thing arrives as a solution-stripped
 * `ClientPuzzle` over REST (DESIGN.md section 10, INV-6).
 */
export interface Puzzle {
  cols: number;
  rows: number;
  blocks: ReadonlySet<number>;
  numbers: ReadonlyMap<number, number>;
  circles: ReadonlySet<number>;
  /** Cells a check has flagged wrong, to exercise the red background role. */
  wrong: ReadonlySet<number>;
  acrossClues: readonly Clue[];
  downClues: readonly Clue[];
}
