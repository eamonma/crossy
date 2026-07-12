// Domain vocabulary for the crossword client (DESIGN.md section 2): cell, word,
// clue, block, across/down. No x/y/tile. Cells are a flat, row-major array; index i
// maps to row = floor(i / cols), col = i mod cols. Geometry and navigation types
// live in @crossy/engine now; these are the view-side types.
import type { Direction } from "@crossy/engine";

/** An inline style a clue run wears. The wire vocabulary (PROTOCOL puzzle model): italic, bold,
 * subscript, superscript. Unknown strings are tolerated (ignored) for forward compatibility. */
export type ClueStyle = "i" | "b" | "sub" | "sup";

/** A canonical run of clue prose: a slice of text with an optional set of inline styles. The
 * server guarantees the concatenation of every run's `t` equals the clue's plain `text`, runs are
 * pre-merged (no empties, no adjacent equal-style pairs), and `s` is in the fixed order
 * "b","i","sub","sup". `runs` is absent for unstyled clues and every pre-feature puzzle, so plain
 * `text` is the permanent fallback (never render raw markup; ClueText renders runs as elements). */
export interface ClueRun {
  t: string;
  s?: readonly ClueStyle[];
}

/** One numbered word: its clue number, axis, and the cells it spans, in order. `text` is the
 * clue prose, present on the live board (it arrives on the ClientPuzzle) and absent on the demo
 * boards, which carry geometry only. `runs` is the optional structured form of that same prose
 * (styled spans); when absent the plain `text` renders exactly as before. */
export interface Clue {
  number: number;
  direction: Direction;
  cells: readonly number[];
  text?: string;
  runs?: readonly ClueRun[];
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
