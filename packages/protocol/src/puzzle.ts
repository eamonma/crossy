// The ServerPuzzle / ClientPuzzle split (INV-6, DESIGN.md §4, §7). Solutions never leave the
// server. The split is structural, not a runtime strip: `ClientPuzzle` has no solution-typed
// field anywhere, so a leak is a compile error. `Solution` is branded, and the golden in
// inv6-no-solution-leak.test.ts asserts no client-facing payload transitively contains one.
//
// PROTOCOL.md gives literal examples for every wire message but not for the puzzle, which is a
// REST payload (§12) owned by ingestion (DESIGN.md §7). This is the faithful minimal model the
// wire contract needs: geometry, circles, and clues as `{number, text, cellIndices}` (DESIGN.md
// §7). The load-bearing normative fact here is the solution split; the exhaustive puzzle schema
// (image clues, cross-references, per-cell numbering) is ingestion's to pin when it lands.

/**
 * A branded per-cell solution string. The brand carries no runtime data; it exists only so the
 * type system can tell a solution apart from any other string and forbid it from client types.
 */
export type Solution = string & { readonly __solutionBrand: unique symbol };

/** A clue, structured at ingestion (DESIGN.md §7). No answer field, on either side of the split. */
export interface Clue {
  readonly number: number;
  readonly text: string;
  readonly cellIndices: readonly number[];
}

/** Across and down clue lists. */
export interface Clues {
  readonly across: readonly Clue[];
  readonly down: readonly Clue[];
}

/** Puzzle facts safe for any client: geometry, circles, clues. Immutable per game (§4). */
export interface PuzzleBase {
  readonly rows: number;
  readonly cols: number;
  /** Black-square cell indices: unplayable and immutable (PROTOCOL.md §4). */
  readonly blocks: readonly number[];
  /** Circled cell indices, a visual overlay (DESIGN.md §2). */
  readonly circles: readonly number[];
  /** Shaded-circle cells, a render variant of circles (DESIGN.md §7). */
  readonly shadedCircles?: readonly number[];
  readonly clues: Clues;
}

/**
 * The only puzzle type on any client-facing payload (REST §12, link previews §7). No solution
 * field, transitively (INV-6). Enforced structurally by inv6-no-solution-leak.test.ts.
 */
export type ClientPuzzle = PuzzleBase;

/**
 * The server-internal puzzle, carrying the per-cell solution. `null` at a black square. Lives in
 * the `puzzles` table (DESIGN.md §9) and never crosses the wire.
 */
export interface ServerPuzzle extends PuzzleBase {
  readonly solution: readonly (Solution | null)[];
}

/**
 * Project a ServerPuzzle to its client shape by construction (DESIGN.md §7: structural, not a
 * runtime strip). The return type is `ClientPuzzle`, so this cannot carry a solution: the type,
 * not this function, is what INV-6 rests on. Resilient to added `PuzzleBase` fields.
 */
export function toClientPuzzle(puzzle: ServerPuzzle): ClientPuzzle {
  const { solution, ...client } = puzzle;
  void solution;
  return client;
}
