// Puzzle ingestion: the anti-corruption layer (DESIGN.md section 7, D13; ROADMAP Phase 3
// Track C, G1). One XWord Info JSON document in, either an accepted internal `ServerPuzzle` or
// exactly one named rejection with a stable code. The external format is translated exactly
// once, here at the boundary; nothing downstream ever parses XWord Info again (DESIGN.md 7).
//
// The rejection set and its constants are grounded in SP5 (reports/spikes/sp5-puzzle-corpus.md):
// the 25x25 cap (D13), the rebus length cap of 10 (observed max 4, documented max about 7), the
// `A-Z0-9` charset with first-character acceptance for punctuation rebuses (D12), and the
// Schroedinger / multiple-clues-per-slot ambiguity. Charset normalization is ASCII-only, reusing
// the shared `asciiUppercase` so ingestion and the reducer fold identically (INV-1); a
// locale-aware upcase is forbidden because the ports would diverge (Turkish `i`).
//
// Check order is fixed and documented on `translateXwordInfo` so the same bad puzzle always
// yields the same code (deterministic, total).
import { asciiUppercase } from "@crossy/protocol";
import type { ServerPuzzle, Solution, Clue } from "@crossy/protocol";

/** DESIGN.md section 7 / D13: a grid may be at most 25 cells in either dimension. */
const MAX_DIMENSION = 25;
/** DESIGN.md section 5, SP5: a solution cell holds at most 10 characters. */
const MAX_REBUS_LENGTH = 10;
/** XWord Info marks a black square with a lone `.` in the row-major `grid` array (SP5). */
const BLOCK_TOKEN = ".";
/** First-character acceptance charset, tested after ASCII-uppercasing (INV-1, D12). */
const ENTERABLE_FIRST_CHAR = /[A-Z0-9]/;
/** A clue is `"<number>. <text>"`; the number is derived from the grid, not trusted (SP5). */
const CLUE_PREFIX = /^\s*(\d+)[.:]?\s*/;

/**
 * The stable machine-readable rejection codes ingestion can emit. Every member is also an
 * `ApiErrorCode` (http/errors.ts), so a route passes one straight to `fail` without a mapping
 * table. `VALIDATION` covers a malformed document; the rest are the named domain rejections
 * (DESIGN.md section 7, PROTOCOL.md section 12, SP5).
 */
export type IngestErrorCode =
  | "VALIDATION"
  | "DIAGRAMLESS"
  | "OVERSIZE_GRID"
  | "DEGENERATE_GRID"
  | "REBUS_TOO_LONG"
  | "UNSOLVABLE_CELL"
  | "AMBIGUOUS_SOLUTION";

/** Detected feature flags, stored with the puzzle (DESIGN.md section 7, section 9 `features`). */
export interface PuzzleFeatures {
  /** At least one solution cell holds a multi-character rebus answer. */
  readonly rebus: boolean;
  /** At least one circled cell (structural overlay, no gameplay effect; DESIGN.md 2, 7). */
  readonly circles: boolean;
  /** At least one shaded-circle cell (a render variant of a circle; DESIGN.md 7). */
  readonly shadedCircles: boolean;
}

/**
 * The result of ingesting one document: an accepted puzzle with its detected features, or a
 * single named rejection. Messages never echo solution content (INV-6): a rejection carries a
 * code and a generic reason, never the offending answer text.
 */
export type IngestResult =
  | {
      readonly ok: true;
      readonly puzzle: ServerPuzzle;
      readonly features: PuzzleFeatures;
    }
  | {
      readonly ok: false;
      readonly code: IngestErrorCode;
      readonly message: string;
    };

function reject(code: IngestErrorCode, message: string): IngestResult {
  return { ok: false, code, message };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isPositiveInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x > 0;
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

/** A grid-derived word: its number (assigned by scanning the grid) and its cell run. */
interface WordRun {
  readonly number: number;
  readonly cells: readonly number[];
}

/**
 * Assign standard crossword numbering and word runs from the grid geometry alone, never from the
 * file's numbers (SP5: real puzzles carry odd numberings, so numbering is derived). A cell starts
 * an across word when its left neighbor is a block or edge and its right neighbor is playable
 * (a run of length >= 2); the down rule is the transpose. A length-1 run is not a word, so an
 * unchecked cell (crossed by only one word) is simply absent from the other direction, never a
 * crash (SP5: tolerate unchecked cells).
 */
function deriveWordRuns(
  rows: number,
  cols: number,
  isBlockAt: (index: number) => boolean,
): { across: WordRun[]; down: WordRun[] } {
  const across: WordRun[] = [];
  const down: WordRun[] = [];
  let n = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (isBlockAt(i)) continue;
      const startsAcross =
        (c === 0 || isBlockAt(i - 1)) && c < cols - 1 && !isBlockAt(i + 1);
      const startsDown =
        (r === 0 || isBlockAt(i - cols)) &&
        r < rows - 1 &&
        !isBlockAt(i + cols);
      if (!startsAcross && !startsDown) continue;
      n += 1;
      if (startsAcross) {
        const cells: number[] = [];
        for (let cc = c; cc < cols; cc += 1) {
          const j = r * cols + cc;
          if (isBlockAt(j)) break;
          cells.push(j);
        }
        across.push({ number: n, cells });
      }
      if (startsDown) {
        const cells: number[] = [];
        for (let rr = r; rr < rows; rr += 1) {
          const j = rr * cols + c;
          if (isBlockAt(j)) break;
          cells.push(j);
        }
        down.push({ number: n, cells });
      }
    }
  }
  return { across, down };
}

/** Split `"17. Some clue"` into its number (for ambiguity detection) and its display text. */
function parseClue(raw: string): { number: number | null; text: string } {
  const m = CLUE_PREFIX.exec(raw);
  if (m && m[1] !== undefined) {
    return { number: Number(m[1]), text: raw.slice(m[0].length).trim() };
  }
  return { number: null, text: raw.trim() };
}

/** True if any number appears more than once (the Schroedinger / one-slot-two-clues signal). */
function hasDuplicateNumber(
  parsed: readonly { number: number | null }[],
): boolean {
  const seen = new Set<number>();
  for (const p of parsed) {
    if (p.number === null) continue;
    if (seen.has(p.number)) return true;
    seen.add(p.number);
  }
  return false;
}

/** True when the document declares a diagramless puzzle, which v4 does not support (D13). */
function isDiagramless(body: Record<string, unknown>): boolean {
  const t = body["type"];
  if (typeof t === "string" && asciiUppercase(t) === "DIAGRAMLESS") return true;
  return body["diagramless"] === true;
}

/**
 * Read an optional parallel `circles` array (XWord Info encodes circles as a `0/1` array the
 * length of the grid, SP5): the circled cell indices, `null` when absent, or the sentinel
 * `"malformed"` on a shape error.
 */
function readCircleIndices(
  value: unknown,
  cellCount: number,
): number[] | "malformed" | null {
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    value.length !== cellCount ||
    !value.every((v) => v === 0 || v === 1 || typeof v === "boolean")
  ) {
    return "malformed";
  }
  const indices: number[] = [];
  value.forEach((v, i) => {
    if (v === 1 || v === true) indices.push(i);
  });
  return indices;
}

/**
 * Translate one XWord Info JSON document into an internal `ServerPuzzle`, or reject it with a
 * single named code. The check order is fixed so the same bad puzzle always yields the same code:
 *
 *  1. VALIDATION          body is a JSON object
 *  2. DIAGRAMLESS         the document declares a diagramless puzzle (known-incompatible flag)
 *  3. VALIDATION          `size` is an object with positive-integer `rows` and `cols`
 *  4. OVERSIZE_GRID       `rows` or `cols` exceeds 25 (bounds all later per-cell work)
 *  5. VALIDATION          `grid` is an array of exactly `rows*cols` strings
 *  6. VALIDATION          `clues.across` and `clues.down` are arrays of strings
 *  7. VALIDATION          `circles` has the right shape when present
 *  8. DEGENERATE_GRID     the grid has zero playable cells (completion would be vacuous, 7)
 *  9. REBUS_TOO_LONG      some playable cell's normalized solution exceeds 10 characters
 * 10. UNSOLVABLE_CELL     some playable cell's normalized solution has no A-Z0-9 first character
 * 11. AMBIGUOUS_SOLUTION  a direction lists two clues for one slot (duplicate clue number)
 * 12. VALIDATION          the clue count does not match the grid's word runs; else ACCEPT
 *
 * Structure is checked before semantics; `size` and oversize come first because they are the
 * cheapest global bound and cap the per-cell scans. Within the per-cell rules the length cap is
 * scanned before enterability, and both are scanned over the whole grid before the next code, so
 * the code chosen never depends on where in the grid the offending cell sits.
 */
export function translateXwordInfo(body: unknown): IngestResult {
  // 1.
  if (!isObject(body)) {
    return reject("VALIDATION", "puzzle must be a JSON object");
  }

  // 2.
  if (isDiagramless(body)) {
    return reject("DIAGRAMLESS", "diagramless puzzles are not supported");
  }

  // 3.
  const size = body["size"];
  if (
    !isObject(size) ||
    !isPositiveInt(size["rows"]) ||
    !isPositiveInt(size["cols"])
  ) {
    return reject(
      "VALIDATION",
      "size must carry positive integer rows and cols",
    );
  }
  const rows = size["rows"];
  const cols = size["cols"];

  // 4.
  if (rows > MAX_DIMENSION || cols > MAX_DIMENSION) {
    return reject(
      "OVERSIZE_GRID",
      `grid ${rows}x${cols} exceeds the ${MAX_DIMENSION}x${MAX_DIMENSION} cap in some dimension`,
    );
  }

  // 5.
  const cellCount = rows * cols;
  const grid = body["grid"];
  if (!isStringArray(grid) || grid.length !== cellCount) {
    return reject(
      "VALIDATION",
      `grid must be an array of ${cellCount} strings`,
    );
  }

  // 6.
  const clues = body["clues"];
  if (
    !isObject(clues) ||
    !isStringArray(clues["across"]) ||
    !isStringArray(clues["down"])
  ) {
    return reject(
      "VALIDATION",
      "clues must carry across and down arrays of strings",
    );
  }
  const acrossClues = clues["across"];
  const downClues = clues["down"];

  // 7.
  const circleRead = readCircleIndices(body["circles"], cellCount);
  if (circleRead === "malformed") {
    return reject(
      "VALIDATION",
      "circles must be a 0/1 array the length of the grid",
    );
  }
  const circleIndices = circleRead ?? [];

  // Materialize blocks and the normalized (ASCII-uppercased, INV-1) solution grid.
  const blocks: number[] = [];
  const solution: (Solution | null)[] = [];
  for (const [i, cell] of grid.entries()) {
    if (cell === BLOCK_TOKEN) {
      blocks.push(i);
      solution.push(null);
    } else {
      solution.push(asciiUppercase(cell) as Solution);
    }
  }

  // 8.
  if (blocks.length === cellCount) {
    return reject("DEGENERATE_GRID", "grid has no playable cells");
  }

  // 9. Length cap, scanned over the whole grid before enterability so a too-long cell anywhere
  //    wins over an unsolvable cell anywhere.
  for (const [, s] of solution.entries()) {
    if (s !== null && s.length > MAX_REBUS_LENGTH) {
      return reject(
        "REBUS_TOO_LONG",
        `a solution cell exceeds the ${MAX_REBUS_LENGTH}-character cap`,
      );
    }
  }

  // 10. Enterability: first-char acceptance (D12). A whole-symbol cell like `/` has no legal
  //     input; `A/B` is fine because typing `A` completes it (SP5).
  for (const [, s] of solution.entries()) {
    if (
      s !== null &&
      !(s.length >= 1 && ENTERABLE_FIRST_CHAR.test(s.charAt(0)))
    ) {
      return reject(
        "UNSOLVABLE_CELL",
        "a solution cell has no enterable value under the A-Z0-9 first-character rule",
      );
    }
  }

  // 11 & 12. Structure the clues against grid-derived word runs.
  const runs = deriveWordRuns(rows, cols, (i) => solution[i] === null);
  const acrossParsed = acrossClues.map(parseClue);
  const downParsed = downClues.map(parseClue);
  if (hasDuplicateNumber(acrossParsed) || hasDuplicateNumber(downParsed)) {
    return reject(
      "AMBIGUOUS_SOLUTION",
      "a direction lists more than one clue for a single slot",
    );
  }
  if (
    acrossParsed.length !== runs.across.length ||
    downParsed.length !== runs.down.length
  ) {
    return reject(
      "VALIDATION",
      "the clue count does not match the grid's word runs",
    );
  }
  const buildClues = (
    parsed: readonly { text: string }[],
    wordRuns: readonly WordRun[],
  ): Clue[] =>
    wordRuns.map((run, idx) => ({
      number: run.number,
      text: parsed[idx]!.text,
      cellIndices: run.cells,
    }));

  const shade = body["shadecircles"] === true;
  const shadedCircles = shade ? circleIndices : [];
  const circles = shade ? [] : circleIndices;

  const puzzle: ServerPuzzle = {
    rows,
    cols,
    blocks,
    circles,
    ...(shadedCircles.length > 0 ? { shadedCircles } : {}),
    clues: {
      across: buildClues(acrossParsed, runs.across),
      down: buildClues(downParsed, runs.down),
    },
    solution,
  };

  const features: PuzzleFeatures = {
    rebus: solution.some((s) => s !== null && s.length > 1),
    circles: circles.length > 0,
    shadedCircles: shadedCircles.length > 0,
  };

  return { ok: true, puzzle, features };
}
