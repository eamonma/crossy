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
// The real XWord Info / NYT export carries many optional fields present-but-`null` rather than
// absent (`circles`, `shadecircles`, `type`, `bbars`, `rbars`, and the metadata keys). The rule
// at this boundary is uniform: for every OPTIONAL field, `null` reads exactly like absent. Barred
// grids (`bbars` / `rbars`) are a known-incompatible flag and reject, because edge bars move word
// boundaries and would silently misplace clue cells (DESIGN.md section 7, PROTOCOL.md section 12).
// Clue markup is CAPTURED as structured runs here (owner ruling 2026-07-12; see clue-runs.ts), the
// one place the external format is ever translated (DESIGN.md section 7, D13): each clue carries a
// plain `text` projection and, when styled, a `runs` decomposition. Formatting is never stripped
// and never sent as raw HTML on the wire; runs are clue prose, so INV-6 is untouched.
//
// Check order is fixed and documented on `translateXwordInfo` so the same bad puzzle always
// yields the same code (deterministic, total).
//
// With the multi-format registry (PROTOCOL.md section 12, D21) this file also exports the
// shared pieces every translator uses so the named rejections apply uniformly across formats:
// the dimension cap and per-cell domain checks (`checkDimensions`, `checkSolutionGrid`),
// grid-derived numbering (`deriveWordRuns`), the clue-markup translator seam (`buildRunClue`,
// from clue-runs.ts), and metadata reading. Entity decoding lives in the leaf entities.ts so both
// this boundary and clue-runs.ts can share it without a dependency cycle.
import { asciiUppercase } from "@crossy/protocol";
import type { ServerPuzzle, Solution, Clue } from "@crossy/protocol";
import { decodeEntities } from "./entities";
import { parseClueRuns } from "./clue-runs";
import type { ClueRun } from "./clue-runs";

/**
 * A clue as ingestion builds it: the protocol `Clue` plus the additive `runs` from the clue-markup
 * translator (owner ruling 2026-07-12). It is a local structural widening because the shared
 * protocol `Clue` type does not yet carry `runs`; the orchestrator reconciles this by adding
 * `runs?: readonly ClueRun[]` to `Clue`/`ClientClue` in packages/protocol, after which this alias
 * collapses to `Clue`. `runs` is present only when the clue is styled (clue-runs.ts law 2), so an
 * all-plain clue is byte-identical to the protocol `Clue` and rides the wire as a bare string.
 * INV-6 is untouched: `runs` is clue prose, never solution data, and it projects through
 * `toClientPuzzle` by construction like every other `PuzzleBase` field.
 */
export type RunClue = Clue & { readonly runs?: readonly ClueRun[] };

/**
 * Attach the clue-markup translator's output to a grid-derived clue slot. `parseClueRuns` returns
 * the plain `text` projection and, only when styled, the `runs` decomposition (clue-runs.ts). The
 * `runs` field is spread conditionally so it is genuinely ABSENT for a plain clue, never present as
 * `undefined` (the workspace runs `exactOptionalPropertyTypes`, so an explicit `undefined` would
 * be a distinct, wrong shape). Every translator builds its clues through here, so the markup rule
 * is applied identically across formats (PROTOCOL.md section 12).
 */
export function buildRunClue(
  number: number,
  rawClueText: string,
  cellIndices: readonly number[],
): RunClue {
  const { text, runs } = parseClueRuns(rawClueText);
  return runs === undefined
    ? { number, text, cellIndices }
    : { number, text, cellIndices, runs };
}

/** DESIGN.md section 7 / D13: a grid may be at most 25 cells in either dimension. */
const MAX_DIMENSION = 25;
/** DESIGN.md section 5, SP5: a solution cell holds at most 10 characters. */
const MAX_REBUS_LENGTH = 10;
/**
 * Cap on the stored puzzle title and author. 200 characters is generous for a real crossword
 * title or byline while bounding the column; an over-long value is truncated here, never a
 * rejection (the puzzle is otherwise valid, and this is display metadata, not a domain rule).
 */
const MAX_METADATA_LENGTH = 200;
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
 * (DESIGN.md section 7, PROTOCOL.md section 12, SP5). `SOLUTION_MISSING` joins with the
 * multi-format registry (PROTOCOL.md section 12, D11): a well-formed document with no complete
 * solution grid, which only translators for formats that can omit solutions (guardian) emit.
 */
export type IngestErrorCode =
  | "VALIDATION"
  | "DIAGRAMLESS"
  | "OVERSIZE_GRID"
  | "DEGENERATE_GRID"
  | "REBUS_TOO_LONG"
  | "UNSOLVABLE_CELL"
  | "AMBIGUOUS_SOLUTION"
  | "SOLUTION_MISSING";

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
      /**
       * Display metadata parsed from the document, or null when absent/empty. Kept alongside the
       * puzzle rather than inside `ServerPuzzle` on purpose: title and author are not wire puzzle
       * facts (they never reach the solve screen's `ClientPuzzle`), only signed-in-home list
       * content. The API persists them to the `puzzles.title`/`puzzles.author` columns. They are
       * display content: never normalized or compared (INV-1 does not apply) and never solutions
       * (INV-6 untouched).
       */
      readonly title: string | null;
      readonly author: string | null;
    }
  | {
      readonly ok: false;
      readonly code: IngestErrorCode;
      readonly message: string;
    };

/** Build one named rejection. Shared by every translator in the registry (DESIGN.md 7). */
export function reject(code: IngestErrorCode, message: string): IngestResult {
  return { ok: false, code, message };
}

/** Shared body guard: a plain JSON object (dispatch.ts keys envelope detection on it). */
export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Shared numeric guard for dimensions and lengths. */
export function isPositiveInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x > 0;
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

/** A grid-derived word: its number (assigned by scanning the grid) and its cell run. */
export interface WordRun {
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
export function deriveWordRuns(
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

/**
 * Read one optional display-metadata string (title or author) from the document. The rule is
 * uniform with the boundary's other optional fields: absent or `null` reads as absent (real NYT
 * exports ship `title: null` / `author: null`, see the corpus fixtures). A present but non-string
 * value is read leniently as absent rather than rejecting the whole puzzle, matching how the
 * boundary treats `type` (non-string is "not diagramless") and the bars arrays (non-array is "no
 * bars"), and unlike `circles` whose shape is load-bearing: title and author are display content,
 * so a malformed value must never block an otherwise valid puzzle. A present string is
 * entity-decoded (the same one-pass decode used for clue text, so `&amp;` renders as `&`),
 * trimmed, and capped at `MAX_METADATA_LENGTH`; an empty result is stored as null.
 */
export function readMetadata(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const decoded = decodeEntities(raw).trim();
  if (decoded === "") return null;
  return decoded.slice(0, MAX_METADATA_LENGTH);
}

/**
 * Split `"17. Some clue"` into its number (for ambiguity detection) and the RAW clue remainder
 * (markup and entities intact). Only the leading `"<number>. "` prefix is removed; the remainder is
 * handed on untouched so `buildRunClue` can parse tags off it before decoding entities (clue-runs.ts
 * law 8). The old seam entity-decoded here; that now happens per run inside the markup translator.
 */
function parseClue(raw: string): { number: number | null; raw: string } {
  const m = CLUE_PREFIX.exec(raw);
  if (m && m[1] !== undefined) {
    return { number: Number(m[1]), raw: raw.slice(m[0].length) };
  }
  return { number: null, raw };
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
  // `type` is optional: `null`, `""`, or any non-`DIAGRAMLESS` string is not diagramless. Only a
  // real string that ASCII-uppercases to `DIAGRAMLESS`, or the boolean flag, triggers (INV-1).
  if (typeof t === "string" && asciiUppercase(t) === "DIAGRAMLESS") return true;
  return body["diagramless"] === true;
}

/**
 * True if a bars array carries at least one bar. XWord Info encodes bars as a `0/1` (or boolean)
 * array parallel to the grid. Following the optional-field rule, `null`, absent, an empty array,
 * or an all-zero array all mean "no bars"; any `1`/`true` element is a real bar. A non-array
 * value is not XWord Info's bar encoding, so it is read as "no bars" rather than a false positive.
 */
function hasBars(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (!Array.isArray(value)) return false;
  return value.some((v) => v === 1 || v === true);
}

/**
 * True when the document carries edge bars (`bbars` below a cell, `rbars` to its right). Bars move
 * word boundaries, so the grid-derived word runs would be wrong; v4 does not model barred grids
 * (DESIGN.md section 7, PROTOCOL.md section 12). A known-incompatible flag, like diagramless.
 */
function isBarred(body: Record<string, unknown>): boolean {
  return hasBars(body["bbars"]) || hasBars(body["rbars"]);
}

/**
 * Read an optional parallel `circles` array (XWord Info encodes circles as a `0/1` array the
 * length of the grid, SP5): the circled cell indices, `null` when absent, or the sentinel
 * `"malformed"` on a shape error. Following the optional-field rule, a present-but-`null` value
 * reads exactly like absent (the real NYT export ships `circles: null` for uncircled puzzles).
 */
function readCircleIndices(
  value: unknown,
  cellCount: number,
): number[] | "malformed" | null {
  if (value === undefined || value === null) return null;
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
 * Shared dimension cap (PROTOCOL.md section 12: the named rejections apply to every format
 * uniformly). Both dimensions are checked independently (SP5: real grids are non-square).
 * Returns the rejection, or null when the grid fits. Every translator runs this before any
 * per-cell work, so the cap bounds the scans that follow.
 */
export function checkDimensions(
  rows: number,
  cols: number,
): IngestResult | null {
  if (rows > MAX_DIMENSION || cols > MAX_DIMENSION) {
    return reject(
      "OVERSIZE_GRID",
      `grid ${rows}x${cols} exceeds the ${MAX_DIMENSION}x${MAX_DIMENSION} cap in some dimension`,
    );
  }
  return null;
}

/**
 * Shared per-cell domain checks every translator runs on its normalized (ASCII-uppercased,
 * INV-1) solution grid, in this fixed order (the xwordinfo steps 9-11):
 *
 *  1. DEGENERATE_GRID  every cell is null (zero playable cells, DESIGN.md section 7)
 *  2. REBUS_TOO_LONG   some cell's solution exceeds 10 characters (whole-grid scan)
 *  3. UNSOLVABLE_CELL  some cell's solution has no A-Z0-9 first character (D12)
 *
 * Each rule scans the whole grid before the next, so the code chosen never depends on where in
 * the grid the offending cell sits. Returns the first rejection, or null when the grid passes.
 */
export function checkSolutionGrid(
  solution: readonly (Solution | null)[],
): IngestResult | null {
  if (solution.every((s) => s === null)) {
    return reject("DEGENERATE_GRID", "grid has no playable cells");
  }
  for (const s of solution) {
    if (s !== null && s.length > MAX_REBUS_LENGTH) {
      return reject(
        "REBUS_TOO_LONG",
        `a solution cell exceeds the ${MAX_REBUS_LENGTH}-character cap`,
      );
    }
  }
  for (const s of solution) {
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
  return null;
}

/**
 * Translate one XWord Info JSON document into an internal `ServerPuzzle`, or reject it with a
 * single named code. The check order is fixed so the same bad puzzle always yields the same code:
 *
 *  1. VALIDATION          body is a JSON object
 *  2. DIAGRAMLESS         the document declares a diagramless puzzle (known-incompatible flag)
 *  3. VALIDATION          the document declares edge bars (barred grid, known-incompatible flag)
 *  4. VALIDATION          `size` is an object with positive-integer `rows` and `cols`
 *  5. OVERSIZE_GRID       `rows` or `cols` exceeds 25 (bounds all later per-cell work)
 *  6. VALIDATION          `grid` is an array of exactly `rows*cols` strings
 *  7. VALIDATION          `clues.across` and `clues.down` are arrays of strings
 *  8. VALIDATION          `circles` has the right shape when present
 *  9. DEGENERATE_GRID     the grid has zero playable cells (completion would be vacuous, 7)
 * 10. REBUS_TOO_LONG      some playable cell's normalized solution exceeds 10 characters
 * 11. UNSOLVABLE_CELL     some playable cell's normalized solution has no A-Z0-9 first character
 * 12. AMBIGUOUS_SOLUTION  a direction lists two clues for one slot (duplicate clue number)
 * 13. VALIDATION          the clue count does not match the grid's word runs; else ACCEPT
 *
 * Structure is checked before semantics; `size` and oversize come first because they are the
 * cheapest global bound and cap the per-cell scans. The two known-incompatible flags, diagramless
 * and barred, come first of all, before structural validation, because they reject a whole class
 * of puzzle regardless of its geometry. Within the per-cell rules the length cap is scanned before
 * enterability, and both are scanned over the whole grid before the next code, so the code chosen
 * never depends on where in the grid the offending cell sits.
 *
 * On acceptance the optional `title` and `author` display metadata are parsed (see
 * `readMetadata`); they never influence acceptance or the chosen rejection code.
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

  // 3. Barred grids reject before any geometry work: edge bars move word boundaries, so a barred
  //    puzzle that happened to match our clue count would land silently wrong cells (step 13 is not
  //    a reliable backstop for it). PROTOCOL.md section 12 sanctions no code for barred, so this is
  //    VALIDATION with a clear message rather than a new wire code (see the proposed follow-up).
  if (isBarred(body)) {
    return reject("VALIDATION", "barred puzzles are not supported");
  }

  // 4.
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

  // 5. The shared dimension cap (checkDimensions bounds all later per-cell work).
  const oversize = checkDimensions(rows, cols);
  if (oversize !== null) return oversize;

  // 6.
  const cellCount = rows * cols;
  const grid = body["grid"];
  if (!isStringArray(grid) || grid.length !== cellCount) {
    return reject(
      "VALIDATION",
      `grid must be an array of ${cellCount} strings`,
    );
  }

  // 7.
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

  // 8.
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

  // 9, 10, 11. The shared per-cell domain checks: degenerate grid, then the length cap over the
  //     whole grid, then enterability (first-char acceptance, D12: a whole-symbol cell like `/`
  //     has no legal input; `A/B` is fine because typing `A` completes it, SP5).
  const domain = checkSolutionGrid(solution);
  if (domain !== null) return domain;

  // 12 & 13. Structure the clues against grid-derived word runs.
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
    parsed: readonly { raw: string }[],
    wordRuns: readonly WordRun[],
  ): RunClue[] =>
    wordRuns.map((run, idx) =>
      buildRunClue(run.number, parsed[idx]!.raw, run.cells),
    );

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

  // Display metadata is parsed last: it never affects acceptance or any rejection code, so a
  // malformed title/author cannot change the outcome of an otherwise valid or invalid puzzle.
  const title = readMetadata(body["title"]);
  const author = readMetadata(body["author"]);

  return { ok: true, puzzle, features, title, author };
}
