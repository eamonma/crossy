// Domain vocabulary for the crossword client (DESIGN.md §2): cell, word, clue, block,
// across/down. No x/y/tile. Cells are a flat, row-major array; index i maps to
// row = floor(i / cols), col = i mod cols.

export type Direction = "across" | "down";
export type Toward = "forward" | "backward";

/**
 * The geometry the navigation core reasons over. `blocks` are the black-square cell
 * indices. `fills` is optional: present only for the forward filled-skip during typing
 * (DESIGN.md §5). A missing `fills` means every playable cell is treated as empty,
 * which is exactly what the 12 seed navigation vectors assume.
 */
export interface Grid {
  cols: number;
  rows: number;
  blocks: ReadonlySet<number>;
  fills?: ReadonlyMap<number, string>;
}

/** The focused cell and the axis being solved along. */
export interface Selection {
  cell: number;
  direction: Direction;
}

/** One numbered word: its clue number, axis, and the cells it spans, in order. */
export interface Clue {
  number: number;
  direction: Direction;
  cells: readonly number[];
}

/** A teammate's live cursor: where they are and which way they are solving. */
export interface Teammate {
  id: string;
  initial: string;
  cell: number;
  direction: Direction;
}

/**
 * A puzzle template plus the derived numbering and clue lists. This is fake, local
 * data for the playground; the real thing arrives as a solution-stripped `ClientPuzzle`
 * over the wire in Wave 2.1d (DESIGN.md §10, INV-6).
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

/**
 * Open decision A (SP6 divergence 2): where Shift+Tab lands.
 * - `v2-asymmetric`: previous clue's start if empty, else its end. Never a mid-word
 *   empty. This is v2's shipped behavior and the default.
 * - `symmetric-first-empty`: previous clue's first empty cell, else its start. Mirrors
 *   the forward Tab rule.
 */
export type ShiftTabMode = "v2-asymmetric" | "symmetric-first-empty";

/**
 * Open decision B (SP6 divergence 3): backspace on an already-empty cell.
 * - `v2-cross-block`: step back across the block into the previous word and clear it.
 *   This is v2's shipped behavior and the default.
 * - `clamp-to-word`: step back only within the current word; hold at the word's start.
 */
export type BackspaceMode = "v2-cross-block" | "clamp-to-word";
