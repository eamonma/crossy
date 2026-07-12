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

/**
 * A clue style token (PROTOCOL.md §12). Vendor markup maps into this closed set: `<i>`/`<em>` to
 * `"i"`, `<b>`/`<strong>` to `"b"`, `<sub>` to `"sub"`, `<sup>` to `"sup"`. Nesting flattens to a
 * set, ordered `b`, `i`, `sub`, `sup` in a run's `s`.
 */
export type ClueStyle = "i" | "b" | "sub" | "sup";

/**
 * One styled span of a clue (PROTOCOL.md §12). `t` is a non-empty slice of the plain text; `s` is
 * its style set, omitted when the run is plain. The concatenation of every run's `t` equals the
 * clue's `text` exactly (the plain projection).
 */
export interface ClueRun {
  readonly t: string;
  readonly s?: readonly ClueStyle[];
}

/**
 * A clue, structured at ingestion (DESIGN.md §7). No answer field, on either side of the split.
 * `text` is the canonical plain projection; `runs` is the optional additive render form
 * (PROTOCOL.md §12), present only when the clue carries styling, omitted when it is wholly plain.
 */
export interface Clue {
  readonly number: number;
  readonly text: string;
  readonly cellIndices: readonly number[];
  /** Structured markup runs (PROTOCOL.md §12). Absent when the clue is unstyled; renders `text`. */
  readonly runs?: readonly ClueRun[];
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

/**
 * Lift the per-cell solution array into a `cell -> value` map: the comparator's input shape
 * (`ReadonlyMap<number, string>`, the engine's `Solution`). The array is row-major and cell-
 * indexed exactly like the board (index `i` is cell `i`), and a `null` entry (a black square or
 * an absent cell) is skipped, so a cell with no solution never appears in the map. This is the
 * single translation of the stored snapshot into a solution map: the session hydrates the live
 * comparator through it, and the API's Archive read model joins `cell_events` against it, so both
 * read one cell index space and first-correct attribution can never drift from the live game.
 *
 * The return type is a plain `ReadonlyMap<number, string>`, deliberately not branded and not the
 * engine's `Solution` name (protocol imports no workspace code; the engine's type is structurally
 * this map). It is server-only by usage: the caller must never place it on a `ClientPuzzle` or any
 * outbound payload, because a `value` is solution content (INV-6). Accepting the structural
 * `{ solution }` shape lets a `ServerPuzzle` and any snapshot carrying the same array both call in.
 */
export function serverPuzzleToSolution(puzzle: {
  readonly solution: readonly (string | null)[];
}): ReadonlyMap<number, string> {
  const solution = new Map<number, string>();
  puzzle.solution.forEach((value, cell) => {
    if (value !== null) solution.set(cell, value);
  });
  return solution;
}

/**
 * A puzzle's black-square silhouette, the pattern only (PROTOCOL.md §12). An array of `rows`
 * strings, each exactly `cols` characters, where `#` is a black square and `.` is a playable
 * cell, indexed row-major like the board (row `r`, column `c` is character `c` of string `r`,
 * cell index `r * cols + c`). This is a plain `string[]`, deliberately not branded: it carries
 * the same public geometry as the block indices already on `ClientPuzzle`, no letters and no
 * numbering, so it is INV-6-safe by content, not by type.
 */
export type Mask = readonly string[];

/** The two glyphs a mask row is built from: block and playable. */
const MASK_BLOCK = "#";
const MASK_CELL = ".";

/**
 * Derive the black-square silhouette from a puzzle's geometry (PROTOCOL.md §12). The inputs are
 * the pattern-only facts every stored puzzle carries (`rows`, `cols`, and the block cell indices,
 * DESIGN.md §7); the solution is neither read nor reachable here, so INV-6 holds by construction:
 * this cannot emit a letter it never received. The block set makes the scan O(rows*cols) with
 * O(1) membership, cheap enough for a list endpoint at the 25x25 cap (625 cells). An index outside
 * the grid is ignored, so a malformed stored `blocks` never throws on a read path.
 */
export function deriveMask(geometry: {
  readonly rows: number;
  readonly cols: number;
  readonly blocks: readonly number[];
}): Mask {
  const { rows, cols, blocks } = geometry;
  const blocked = new Set(blocks);
  const mask: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    let row = "";
    for (let c = 0; c < cols; c += 1) {
      row += blocked.has(r * cols + c) ? MASK_BLOCK : MASK_CELL;
    }
    mask.push(row);
  }
  return mask;
}
