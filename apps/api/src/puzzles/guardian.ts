// Guardian translator (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP 6.1 x2).
// One Guardian crossword JSON document, as embedded in its puzzle page, in; either an accepted
// internal `ServerPuzzle` or exactly one named rejection with a stable code. Same contract as
// `translateXwordInfo`: the external format is parsed exactly once, here at the boundary, with
// a fixed check order documented on the function, and rejection messages never echo solution
// or document content (INV-6 discipline).
//
// The page serves one server-rendered <gu-island name="CrosswordComponent"> whose props are
// entity-escaped JSON of {data, canRenderAds}; the extension posts props.data as the envelope
// document, never that wrapper (Wave 6.2 contract). The document shape (confirmed against live
// theguardian.com puzzle pages; fixtures in tests are synthetic, never real Guardian content,
// DESIGN.md section 7):
//   {id, number, name, date, dimensions: {cols, rows}, entries: [...], solutionAvailable,
//    creator?: {name, webUrl}}
// and per entry:
//   {id, number, humanNumber, clue, direction: "across"|"down", length, group: [entryIds],
//    position: {x, y}, separatorLocations, solution?}
// `position` is 0-based with x the column and y the row. `group` lists the linked entries with
// the head first; an ungrouped entry's group is its own id alone. A continuation entry still
// carries its own solution. `separatorLocations` is display-only and ignored here.
//
// The grid is derived from the entries: a cell covered by any entry is playable, a cell covered
// by none is a block. Numbering is then derived from that grid's geometry (deriveWordRuns),
// never trusted from the document, matching the xwordinfo boundary; the document's `number` and
// `humanNumber` influence nothing. Clue text is taken verbatim from each entry (a real Guardian
// continuation carries its own "See 19") and translated through the shared markup seam
// (clue-runs.ts), so its `{text, runs}` is captured like every other format; only a continuation
// whose clue PROJECTS TO EMPTY gets the synthesized "See <n>" built from the head's grid number.
import { asciiUppercase } from "@crossy/protocol";
import type { ServerPuzzle, Solution } from "@crossy/protocol";
import {
  buildRunClue,
  checkDimensions,
  checkSolutionGrid,
  deriveWordRuns,
  isObject,
  isPositiveInt,
  readMetadata,
  reject,
} from "./ingest";
import type { IngestResult, PuzzleFeatures, RunClue, WordRun } from "./ingest";
import { parseClueRuns } from "./clue-runs";

/** One structurally validated entry, positions already flattened to a start cell index. */
interface GuardianEntry {
  readonly id: string;
  readonly clue: string;
  readonly direction: "across" | "down";
  readonly length: number;
  readonly start: number;
  readonly cells: readonly number[];
  readonly headId: string;
  readonly solution: unknown;
}

function isNonNegativeInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/**
 * Read one raw entry into its validated shape, or null when malformed. Structure only: the
 * solution is carried through untouched (its checks have their own codes and order). `group`
 * is read leniently like the boundary's other optional fields: absent, null, or empty reads as
 * the entry being its own head; a present non-string-array is malformed. A head must carry its
 * clue as a string; a continuation's clue is read leniently (absent or non-string reads as
 * empty), because a missing continuation clue is synthesized later, never a rejection.
 */
function readEntry(
  raw: unknown,
  rows: number,
  cols: number,
): GuardianEntry | null {
  if (!isObject(raw)) return null;
  const id = raw["id"];
  const direction = raw["direction"];
  const length = raw["length"];
  const position = raw["position"];
  if (typeof id !== "string") return null;
  if (direction !== "across" && direction !== "down") return null;
  if (!isPositiveInt(length)) return null;
  if (!isObject(position)) return null;
  const x = position["x"];
  const y = position["y"];
  if (!isNonNegativeInt(x) || !isNonNegativeInt(y)) return null;
  if (x >= cols || y >= rows) return null;
  // The run must stay inside the grid.
  if (direction === "across" && x + length > cols) return null;
  if (direction === "down" && y + length > rows) return null;

  const group = raw["group"];
  let headId = id;
  if (group !== undefined && group !== null) {
    if (!Array.isArray(group) || !group.every((g) => typeof g === "string")) {
      return null;
    }
    if (group.length > 0) headId = group[0] as string;
  }

  const clueRaw = raw["clue"];
  let clue: string;
  if (typeof clueRaw === "string") {
    clue = clueRaw;
  } else if (headId !== id) {
    clue = ""; // a continuation without clue text gets the synthesized "See <n>" later
  } else {
    return null; // a head must carry its clue text
  }

  const start = y * cols + x;
  const step = direction === "across" ? 1 : cols;
  const cells: number[] = [];
  for (let k = 0; k < length; k += 1) cells.push(start + k * step);

  return {
    id,
    clue,
    direction,
    length,
    start,
    cells,
    headId,
    solution: raw["solution"],
  };
}

/**
 * Translate one Guardian crossword JSON document into an internal `ServerPuzzle`, or reject it
 * with a single named code. The check order is fixed so the same bad document always yields the
 * same code:
 *
 *  1. VALIDATION          body is a JSON object
 *  2. VALIDATION          `dimensions` carries positive integer rows and cols
 *  3. OVERSIZE_GRID       rows or cols exceeds 25 (shared cap; bounds all later per-entry work)
 *  4. VALIDATION          `entries` is an array of well-formed entries whose runs stay in-grid
 *  5. SOLUTION_MISSING    `solutionAvailable` is false, or an entry has no solution string
 *  6. VALIDATION          an entry's solution length differs from its declared length
 *  7. VALIDATION          two overlapping entries disagree on a shared cell's letter
 *  8. DEGENERATE_GRID     zero playable cells (shared check; e.g. an empty entries array)
 *  9. REBUS_TOO_LONG      shared check (a Guardian cell is one character; kept for uniformity)
 * 10. UNSOLVABLE_CELL     a cell outside A-Z0-9 after ASCII-uppercasing (shared check, D12)
 * 11. AMBIGUOUS_SOLUTION  two entries claim one slot (same start cell and direction)
 * 12. VALIDATION          a grouped entry references a head not in the document
 * 13. VALIDATION          the entries do not match the grid-derived word runs; else ACCEPT
 *
 * Structure is checked before semantics and each per-entry rule scans every entry before the
 * next code, so the code chosen never depends on entry order. Steps 8-10 are the shared domain
 * checks every translator runs (PROTOCOL.md section 12: named rejections apply uniformly).
 * Solutions are ASCII-uppercased before the overlap comparison (INV-1), so casing differences
 * between two entries never manufacture a conflict.
 */
export function translateGuardian(body: unknown): IngestResult {
  // 1.
  if (!isObject(body)) {
    return reject("VALIDATION", "puzzle must be a JSON object");
  }

  // 2.
  const dimensions = body["dimensions"];
  if (
    !isObject(dimensions) ||
    !isPositiveInt(dimensions["rows"]) ||
    !isPositiveInt(dimensions["cols"])
  ) {
    return reject(
      "VALIDATION",
      "dimensions must carry positive integer rows and cols",
    );
  }
  const rows = dimensions["rows"];
  const cols = dimensions["cols"];

  // 3.
  const oversize = checkDimensions(rows, cols);
  if (oversize !== null) return oversize;

  // 4.
  const rawEntries = body["entries"];
  if (!Array.isArray(rawEntries)) {
    return reject("VALIDATION", "entries must be an array");
  }
  const entries: GuardianEntry[] = [];
  for (const [i, raw] of rawEntries.entries()) {
    const e = readEntry(raw, rows, cols);
    if (e === null) {
      return reject(
        "VALIDATION",
        `entry at index ${i} is not a well-formed Guardian entry`,
      );
    }
    entries.push(e);
  }

  // 5. v1 requires solutions at ingest (D11): the flag first, then every entry. Absent, null,
  //    or empty reads as missing (SOLUTION_MISSING, the puzzle page simply has no answers yet);
  //    a present string of the wrong shape is malformed and falls to step 6.
  if (body["solutionAvailable"] === false) {
    return reject(
      "SOLUTION_MISSING",
      "the document declares no solution available",
    );
  }
  for (const e of entries) {
    if (typeof e.solution !== "string" || e.solution === "") {
      return reject("SOLUTION_MISSING", "an entry carries no solution");
    }
  }

  // 6.
  for (const e of entries) {
    if ((e.solution as string).length !== e.length) {
      return reject(
        "VALIDATION",
        "an entry's solution length differs from its declared length",
      );
    }
  }

  // 7. Fill the derived grid, ASCII-uppercased first (INV-1). A cell covered by no entry stays
  //    null and becomes a block.
  const cellCount = rows * cols;
  const solution: (Solution | null)[] = new Array<Solution | null>(
    cellCount,
  ).fill(null);
  for (const e of entries) {
    const letters = asciiUppercase(e.solution as string);
    for (const [k, cell] of e.cells.entries()) {
      const letter = letters.charAt(k) as Solution;
      const existing = solution[cell];
      if (existing !== null && existing !== letter) {
        return reject(
          "VALIDATION",
          "two entries disagree on a shared cell's letter",
        );
      }
      solution[cell] = letter;
    }
  }

  // 8, 9, 10. The shared per-cell domain checks (degenerate, rebus cap, enterability).
  const domain = checkSolutionGrid(solution);
  if (domain !== null) return domain;

  // 11. One entry per slot: two entries with the same start cell and direction are two clues
  //     for one slot (the xwordinfo duplicate-number signal, PROTOCOL.md section 12).
  const bySlot = new Map<string, GuardianEntry>();
  for (const e of entries) {
    const key = `${e.direction}:${e.start}`;
    if (bySlot.has(key)) {
      return reject(
        "AMBIGUOUS_SOLUTION",
        "a direction lists more than one entry for a single slot",
      );
    }
    bySlot.set(key, e);
  }

  // 12.
  const byId = new Map<string, GuardianEntry>(entries.map((e) => [e.id, e]));
  for (const e of entries) {
    if (e.headId !== e.id && !byId.has(e.headId)) {
      return reject(
        "VALIDATION",
        "a grouped entry references a head entry not in the document",
      );
    }
  }

  // 13. Every grid-derived run must be exactly one entry and vice versa; numbering comes from
  //     the runs, never from the document. Abutting entries merge into one run and mismatch.
  const blocks: number[] = [];
  for (const [i, s] of solution.entries()) if (s === null) blocks.push(i);
  const runs = deriveWordRuns(rows, cols, (i) => solution[i] === null);
  if (runs.across.length + runs.down.length !== entries.length) {
    return reject(
      "VALIDATION",
      "the entries do not match the grid's word runs",
    );
  }
  const numberById = new Map<string, number>();
  const matchRun = (
    run: WordRun,
    direction: "across" | "down",
  ): GuardianEntry | null => {
    const e = bySlot.get(`${direction}:${run.cells[0]}`);
    if (e === undefined || e.cells.length !== run.cells.length) return null;
    return e;
  };
  const matched: {
    across: { run: WordRun; entry: GuardianEntry }[];
    down: { run: WordRun; entry: GuardianEntry }[];
  } = { across: [], down: [] };
  for (const direction of ["across", "down"] as const) {
    for (const run of runs[direction]) {
      const e = matchRun(run, direction);
      if (e === null) {
        return reject(
          "VALIDATION",
          "the entries do not match the grid's word runs",
        );
      }
      numberById.set(e.id, run.number);
      matched[direction].push({ run, entry: e });
    }
  }

  // Clue text: every slot uses the document's own clue text verbatim (extraction fidelity:
  // real Guardian continuations carry their own "See 19" text), translated through the shared
  // markup seam (clue-runs.ts) so Guardian clues capture <i>/<b>/<sub>/<sup> as runs like every
  // other format. Only a continuation whose clue PROJECTS TO EMPTY (absent, non-string, blank, or
  // markup-only, so the plain projection is "") gets the synthesized "See <n>", where n is the
  // head slot's grid-derived number, never the document's numbering. Emptiness is judged on the
  // projected text, not the raw string, so a `<i></i>`-only continuation still synthesizes.
  // Guardian clues carry no number prefix to strip.
  const rawClue = (e: GuardianEntry): string => {
    if (e.headId === e.id) return e.clue;
    // A continuation with no own text (its projection is empty) synthesizes "See <n>".
    if (parseClueRuns(e.clue).text === "")
      return `See ${numberById.get(e.headId)}`;
    return e.clue;
  };
  const buildClues = (
    list: { run: WordRun; entry: GuardianEntry }[],
  ): RunClue[] =>
    list.map(({ run, entry }) =>
      buildRunClue(run.number, rawClue(entry), run.cells),
    );

  const puzzle: ServerPuzzle = {
    rows,
    cols,
    blocks,
    circles: [],
    clues: {
      across: buildClues(matched.across),
      down: buildClues(matched.down),
    },
    solution,
  };

  // Computed like every translator for uniformity; a Guardian cell is one character, so rebus
  // is structurally false, and the format has no circles or shading.
  const features: PuzzleFeatures = {
    rebus: solution.some((s) => s !== null && s.length > 1),
    circles: false,
    shadedCircles: false,
  };

  // Display metadata, parsed last: never affects acceptance or the chosen code.
  const title = readMetadata(body["name"]);
  const creator = body["creator"];
  const author = isObject(creator) ? readMetadata(creator["name"]) : null;

  return { ok: true, puzzle, features, title, author };
}
