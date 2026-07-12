// NYT v6 translator (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP 6.1 x4). One
// NYT v6 puzzle JSON document (the shape of a /svc/crosswords/v6/puzzle/*.json response, as
// present in the nytimes.com puzzle page) in; either an accepted internal `ServerPuzzle` or
// exactly one named rejection with a stable code. Same contract as the other translators:
// fixed documented check order, and rejection messages never echo solution or document content
// (INV-6 discipline).
//
// The document shape is pinned from the thisisparker/xword-dl project (MIT), the parsing
// reference (DESIGN.md section 15; the free mini page serves no puzzle JSON in its HTML, so the
// live embed could not be confirmed without authenticating, which this project never does):
//   {body: [{cells, clues, clueLists?, dimensions: {width, height}}],
//    title?, constructors?, editor?, publicationDate?, ...}
// `cells` is row-major, one entry per cell. THE BLOCK RULE, pinned from the reference's
// `if not square:` branch: a falsy cell is a block, which in the served JSON is the empty
// object `{}` (a `null` entry is the same falsy family and reads identically). Any cell object
// with at least one key is playable: {answer, label?, clues?, type?, ...}. A playable cell
// without an `answer` is how a stripped or unauthenticated payload looks (label and clues
// survive, answers do not), which is SOLUTION_MISSING, never a block. A multi-character
// `answer` is a rebus, subject to the shared cap. A numeric `type` other than 1 marks the cell
// circled or shaded (the reference collapses both into one markup bit, so both land in
// `circles` here; the default when absent is 1, plain).
// `clues` entries are {cells: [indices], direction: "Across"|"Down", label, text: [{plain}]};
// clue text is `text[0].plain` (the reference reads exactly that, `or ""` when absent) and
// `label` influences nothing: numbering is grid-derived, then the document's entries are
// cross-checked against the derived runs cell-for-cell.
// A `body` with more than one puzzle is an acrostic or variety document the one-grid model
// cannot represent: a named VALIDATION, matching the reference's daily parser, which reads
// `body[0]` only.
import { asciiUppercase } from "@crossy/protocol";
import type { ServerPuzzle, Solution } from "@crossy/protocol";
import {
  checkDimensions,
  checkSolutionGrid,
  deriveWordRuns,
  isObject,
  isPositiveInt,
  normalizeClueText,
  readMetadata,
  reject,
} from "./ingest";
import type { IngestResult, PuzzleFeatures, WordRun } from "./ingest";

/** The one cell `type` value that means a plain cell (reference default when absent). */
const PLAIN_CELL_TYPE = 1;

/** One structurally validated clue entry: its slot cells and its raw display text. */
interface NytClue {
  readonly direction: "across" | "down";
  readonly cells: readonly number[];
  readonly text: string;
}

function isCellIndexArray(x: unknown, cellCount: number): x is number[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.every((i) => typeof i === "number" && Number.isInteger(i)) &&
    x.every((i) => (i as number) >= 0 && (i as number) < cellCount)
  );
}

/**
 * Read one raw clue entry into its validated shape, or null when malformed. Structure only.
 * The v6 direction names are capitalized (`Across`/`Down`) and matched exactly, never
 * case-folded (stable identifiers, no INV-1 surface). `text` must be a non-empty array of
 * objects (the reference indexes `text[0]` unconditionally); its `plain` is read leniently,
 * absent or non-string reading as empty, exactly the reference's `.get("plain") or ""`.
 * `label` is deliberately unread: numbering is grid-derived.
 */
function readClue(raw: unknown, cellCount: number): NytClue | null {
  if (!isObject(raw)) return null;
  const direction = raw["direction"];
  if (direction !== "Across" && direction !== "Down") return null;
  const cells = raw["cells"];
  if (!isCellIndexArray(cells, cellCount)) return null;
  const text = raw["text"];
  if (!Array.isArray(text) || text.length === 0 || !isObject(text[0])) {
    return null;
  }
  const plain = text[0]["plain"];
  return {
    direction: direction === "Across" ? "across" : "down",
    cells,
    text: typeof plain === "string" ? plain : "",
  };
}

/**
 * Join the `constructors` byline list like the reference (`join_bylines(l, "and")`): one name
 * verbatim, two joined with "and", more with commas and a final ", and". Read leniently like
 * all display metadata: a malformed list reads as no author, never a rejection. The joined
 * string then passes through `readMetadata` (entity-decode, trim, cap).
 */
function readConstructors(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const names = raw
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.trim())
    .filter((n) => n !== "");
  if (names.length === 0) return null;
  const joined =
    names.length > 2
      ? `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]!}`
      : names.join(" and ");
  return readMetadata(joined);
}

/**
 * Translate one NYT v6 puzzle JSON document into an internal `ServerPuzzle`, or reject it with
 * a single named code. The check order is fixed so the same bad document always yields the same
 * code:
 *
 *  1. VALIDATION          document is a JSON object
 *  2. VALIDATION          `body` is a non-empty array
 *  3. VALIDATION          `body` carries exactly one puzzle (multi-body: acrostics and variety
 *                         documents are not supported; named message)
 *  4. VALIDATION          `body[0]` carries `dimensions` with positive integer width and height
 *  5. OVERSIZE_GRID       width or height exceeds 25 (shared cap; bounds later per-cell work)
 *  6. VALIDATION          `cells` is width*height entries, each a block (`{}` or null, the
 *                         reference's falsy rule) or a cell object
 *  7. VALIDATION          `clues` is an array of well-formed entries
 *  8. SOLUTION_MISSING    a playable cell's `answer` is absent, null, non-string, or empty
 *                         (a stripped or unauthenticated payload)
 *  9. DEGENERATE_GRID     zero playable cells (shared check)
 * 10. REBUS_TOO_LONG      shared check (a multi-character answer is a rebus)
 * 11. UNSOLVABLE_CELL     a cell outside A-Z0-9 after ASCII-uppercasing (shared check, D12)
 * 12. AMBIGUOUS_SOLUTION  two clues claim one slot (same direction and start cell)
 * 13. VALIDATION          the clues do not match the grid-derived word runs cell-for-cell;
 *                         else ACCEPT
 *
 * Structure is checked before semantics and each per-cell rule scans the whole grid before the
 * next code, so the code chosen never depends on cell or entry order. Steps 9-11 are the shared
 * domain checks every translator runs (PROTOCOL.md section 12: named rejections apply
 * uniformly). Answers are ASCII-uppercased at materialization (INV-1). Numbering comes from
 * `deriveWordRuns`, never from `label` or cell labels.
 */
export function translateNyt(body: unknown): IngestResult {
  // 1.
  if (!isObject(body)) {
    return reject("VALIDATION", "puzzle must be a JSON object");
  }

  // 2.
  const bodies = body["body"];
  if (!Array.isArray(bodies) || bodies.length === 0) {
    return reject("VALIDATION", "body must be a non-empty array");
  }

  // 3.
  if (bodies.length > 1) {
    return reject(
      "VALIDATION",
      "multi-body documents (acrostics and variety puzzles) are not supported",
    );
  }

  // 4.
  const grid = bodies[0] as unknown;
  if (!isObject(grid)) {
    return reject("VALIDATION", "body[0] must be a JSON object");
  }
  const dimensions = grid["dimensions"];
  if (
    !isObject(dimensions) ||
    !isPositiveInt(dimensions["width"]) ||
    !isPositiveInt(dimensions["height"])
  ) {
    return reject(
      "VALIDATION",
      "dimensions must carry positive integer width and height",
    );
  }
  const rows = dimensions["height"];
  const cols = dimensions["width"];

  // 5.
  const oversize = checkDimensions(rows, cols);
  if (oversize !== null) return oversize;

  // 6. Row-major cells; the block rule is the reference's falsy branch: `{}` or null.
  const cellCount = rows * cols;
  const rawCells = grid["cells"];
  if (!Array.isArray(rawCells) || rawCells.length !== cellCount) {
    return reject(
      "VALIDATION",
      `cells must be an array of ${cellCount} entries`,
    );
  }
  const cells: (Record<string, unknown> | null)[] = [];
  for (const raw of rawCells) {
    if (raw === null) {
      cells.push(null);
    } else if (isObject(raw)) {
      cells.push(Object.keys(raw).length === 0 ? null : raw);
    } else {
      return reject(
        "VALIDATION",
        "every cell must be a block or a cell object",
      );
    }
  }

  // 7.
  const rawClues = grid["clues"];
  if (!Array.isArray(rawClues)) {
    return reject("VALIDATION", "clues must be an array");
  }
  const clues: NytClue[] = [];
  for (const [i, raw] of rawClues.entries()) {
    const clue = readClue(raw, cellCount);
    if (clue === null) {
      return reject(
        "VALIDATION",
        `clue at index ${i} is not a well-formed v6 clue entry`,
      );
    }
    clues.push(clue);
  }

  // 8. v1 requires solutions at ingest (D11). A playable cell without a string answer is the
  //    stripped-payload signal (absent, null, non-string, and empty all read as missing, like
  //    the guardian boundary). The whole grid is scanned before the code fires.
  for (const cell of cells) {
    if (cell === null) continue;
    const answer = cell["answer"];
    if (typeof answer !== "string" || answer === "") {
      return reject(
        "SOLUTION_MISSING",
        "a playable cell carries no answer (a stripped or unauthenticated payload)",
      );
    }
  }

  // Materialize blocks, the normalized (ASCII-uppercased, INV-1) solution grid, and the circle
  // overlay (the reference's markup rule: a numeric `type` other than 1 is circled or shaded,
  // collapsed into one bit; a non-numeric `type` reads as plain, lenient like display fields).
  const blocks: number[] = [];
  const solution: (Solution | null)[] = [];
  const circles: number[] = [];
  for (const [i, cell] of cells.entries()) {
    if (cell === null) {
      blocks.push(i);
      solution.push(null);
      continue;
    }
    solution.push(asciiUppercase(cell["answer"] as string) as Solution);
    const type = cell["type"];
    if (typeof type === "number" && type !== PLAIN_CELL_TYPE) circles.push(i);
  }

  // 9, 10, 11. The shared per-cell domain checks (degenerate, rebus cap, enterability).
  const domain = checkSolutionGrid(solution);
  if (domain !== null) return domain;

  // 12. One clue per slot: two entries with the same direction and start cell are two clues
  //     for one slot (the same signal as the other translators).
  const bySlot = new Map<string, NytClue>();
  for (const clue of clues) {
    const key = `${clue.direction}:${clue.cells[0]}`;
    if (bySlot.has(key)) {
      return reject(
        "AMBIGUOUS_SOLUTION",
        "a direction lists more than one clue for a single slot",
      );
    }
    bySlot.set(key, clue);
  }

  // 13. Every grid-derived run must be exactly one clue entry, cell-for-cell, and vice versa;
  //     numbering comes from the runs, never from the document's labels.
  const runs = deriveWordRuns(rows, cols, (i) => solution[i] === null);
  if (runs.across.length + runs.down.length !== clues.length) {
    return reject("VALIDATION", "the clues do not match the grid's word runs");
  }
  const matchRun = (
    run: WordRun,
    direction: "across" | "down",
  ): NytClue | null => {
    const clue = bySlot.get(`${direction}:${run.cells[0]}`);
    if (clue === undefined || clue.cells.length !== run.cells.length) {
      return null;
    }
    for (const [k, cell] of run.cells.entries()) {
      if (clue.cells[k] !== cell) return null;
    }
    return clue;
  };
  const buildClues = (
    direction: "across" | "down",
    wordRuns: readonly WordRun[],
  ) => {
    const built = [];
    for (const run of wordRuns) {
      const clue = matchRun(run, direction);
      if (clue === null) return null;
      built.push({
        number: run.number,
        text: normalizeClueText(clue.text),
        cellIndices: run.cells,
      });
    }
    return built;
  };
  const across = buildClues("across", runs.across);
  const down = buildClues("down", runs.down);
  if (across === null || down === null) {
    return reject("VALIDATION", "the clues do not match the grid's word runs");
  }

  const puzzle: ServerPuzzle = {
    rows,
    cols,
    blocks,
    circles,
    clues: { across, down },
    solution,
  };

  // A multi-character answer is a rebus; circles come from the cell `type` markup. The
  // reference does not tell circled from shaded (one markup bit), so shading is structurally
  // false and both render as circles.
  const features: PuzzleFeatures = {
    rebus: solution.some((s) => s !== null && s.length > 1),
    circles: circles.length > 0,
    shadedCircles: false,
  };

  // Display metadata, parsed last: never affects acceptance or the chosen code. Dailies
  // usually carry no title (the reference falls back to the print date, a client concern);
  // the byline is the joined `constructors` list. `editor` and `publicationDate` are unread.
  const title = readMetadata(body["title"]);
  const author = readConstructors(body["constructors"]);

  return { ok: true, puzzle, features, title, author };
}
