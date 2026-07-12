// AmuseLabs (PuzzleMe) translator (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP
// 6.1 x3). The envelope document is a STRING: the raw encoded blob exactly as found in the page
// (`window.rawc` / `window.puzzleEnv.rawc` / the `params` script's `rawc`); the extension never
// decodes it (DESIGN.md section 7: the extension is deliberately dumb). Decoding is translation
// and happens here, in the ACL, so the external format is still parsed exactly once, at the
// boundary. Same contract as the other translators: fixed documented check order, one named
// rejection with a stable code, and rejection messages never echo blob or decoded content
// (INV-6 discipline).
//
// Encoding variants are pinned from the thisisparker/xword-dl project (MIT), the parsing
// reference (DESIGN.md section 15):
//
//   1. Plain: the blob is standard base64 of a UTF-8 JSON object (xword-dl's original case).
//   2. Embedded-key scramble (xword-dl's "case 2, the first obfuscation"): the blob is
//      `<scrambled>.<tail>` where the tail, read in reverse, is a hex key; each hex digit plus 2
//      gives a chunk length. Successive chunks of the scrambled part are reversed in place
//      (cycling through the key, a final single character is left alone), which restores the
//      base64 of variant 1. Chunk reversal is an involution, so the same walk both scrambles
//      and unscrambles.
//   3. Keyless scramble (xword-dl's "case 3"): the key lives outside the blob, in a separate
//      script on the page (current xword-dl brute-forces it). A blob whose key is not embedded
//      cannot be decoded deterministically from the document alone, so it is a named VALIDATION
//      here, never a heuristic search (D21: adapters absorb drift by name, not by guessing).
//
// The decoded document shape, also pinned from the reference:
//   {title, author, w, h, box, placedWords, cellInfos?, ...}
// `box` is COLUMN-MAJOR: `box[col][row]`, `w` columns of `h` cells (xword-dl reads
// `box[col_num][row_num]` scanning rows outer, columns inner). A cell is `"\x00"` for a block,
// a single character, a multi-character rebus, or `""` when the outlet served no answer.
// `placedWords` entries carry `{x, y, acrossNotDown, clue: {clue}, ...}` with 0-based x the
// column and y the row; `nBoxes`, `word`, and `clueNum` are ignored (the grid is the solution
// source and numbering is derived, matching the reference, which reads none of them for the
// solution). `cellInfos` entries carry `{x, y, isCircled, ...}` for the circle overlay.
import { Buffer } from "node:buffer";
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

/** PuzzleMe marks a block with a NUL character in the box (xword-dl reference). */
const BLOCK_TOKEN = "\u0000";
/** Standard base64, optional padding. Stricter than the reference's lenient decoder on purpose. */
const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;
/** The embedded key tail: hex digits, read in reverse, each plus 2 (xword-dl case 2). */
const HEX_KEY = /^[0-9a-fA-F]+$/;
/** How much each embedded hex key digit is offset to yield a chunk length (xword-dl case 2). */
const KEY_DIGIT_OFFSET = 2;

/** One structurally validated placed word: its slot and its raw clue text. */
interface PlacedWord {
  readonly direction: "across" | "down";
  readonly start: number;
  readonly clue: string;
}

/** A decoded blob, or a named decode failure (message is content-free, INV-6). */
type DecodeOutcome =
  | { readonly ok: true; readonly document: unknown }
  | { readonly ok: false; readonly message: string };

function isNonNegativeInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/**
 * Strictly decode standard base64 into UTF-8 JSON, or null. `fatal` UTF-8 decoding and the
 * charset gate keep this deterministic: a blob either is this encoding or it is not, with no
 * lenient salvage (the reference's Python decoder silently discards foreign characters; ours
 * refuses instead, so two different blobs can never alias).
 */
function parseBase64Json(b64: string): { value: unknown } | null {
  if (!BASE64_SHAPE.test(b64)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(b64, "base64"),
    );
    return { value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

/**
 * The chunk-reversal walk shared by scrambling and unscrambling (an involution): reverse
 * successive chunks in place, chunk lengths cycling through `key`, leaving a final lone
 * character untouched (the reference loops `while B < len - 1`). Every key entry is at least
 * 2 (hex digit + 2), so the walk always advances.
 */
function reverseChunks(text: string, key: readonly number[]): string {
  const chars = text.split("");
  let at = 0;
  let segment = 0;
  while (at < chars.length - 1) {
    const len = Math.min(key[segment % key.length]!, chars.length - at);
    for (let l = at, r = at + len - 1; l < r; l += 1, r -= 1) {
      const tmp = chars[l]!;
      chars[l] = chars[r]!;
      chars[r] = tmp;
    }
    at += len;
    segment += 1;
  }
  return chars.join("");
}

/**
 * Decode the raw blob through the supported deterministic variants. The discriminator is the
 * dot: base64 never contains one, so a dotted blob is the embedded-key scramble and an undotted
 * blob is plain base64. An undotted blob that is valid base64 but not JSON is the keyless
 * scramble (variant 3), rejected by name. Every failure message is content-free (INV-6: no blob
 * slice, no decoded text).
 */
function decodeBlob(blob: string): DecodeOutcome {
  const dot = blob.indexOf(".");
  if (dot === -1) {
    if (!BASE64_SHAPE.test(blob)) {
      return { ok: false, message: "the blob is not a recognized encoding" };
    }
    const parsed = parseBase64Json(blob);
    if (parsed === null) {
      return {
        ok: false,
        message:
          "the blob is base64 but not JSON: a keyless-scrambled blob cannot be decoded deterministically and is not supported",
      };
    }
    return { ok: true, document: parsed.value };
  }

  // Embedded-key variant: exactly one dot, a non-empty hex tail (the reference reads only the
  // first two dot-separated parts; a shape with more is not one it documents, so it rejects).
  const scrambled = blob.slice(0, dot);
  const tail = blob.slice(dot + 1);
  if (scrambled === "" || !HEX_KEY.test(tail)) {
    return {
      ok: false,
      message: "the blob's embedded key tail is not hexadecimal",
    };
  }
  const key = tail
    .split("")
    .reverse()
    .map((c) => Number.parseInt(c, 16) + KEY_DIGIT_OFFSET);
  const parsed = parseBase64Json(reverseChunks(scrambled, key));
  if (parsed === null) {
    return {
      ok: false,
      message: "the blob's embedded-key unscramble does not yield JSON",
    };
  }
  return { ok: true, document: parsed.value };
}

/**
 * Read one raw placed word into its validated shape, or null when malformed. Structure only:
 * `x`/`y` are the 0-based start (x the column, y the row), `acrossNotDown` the direction, and
 * `clue.clue` the display text. `nBoxes`, `word`, and `clueNum` are deliberately unread: the
 * grid (box) is the only solution source and numbering is grid-derived, as in the reference.
 */
function readPlacedWord(
  raw: unknown,
  rows: number,
  cols: number,
): PlacedWord | null {
  if (!isObject(raw)) return null;
  const x = raw["x"];
  const y = raw["y"];
  const acrossNotDown = raw["acrossNotDown"];
  const clue = raw["clue"];
  if (!isNonNegativeInt(x) || !isNonNegativeInt(y)) return null;
  if (x >= cols || y >= rows) return null;
  if (typeof acrossNotDown !== "boolean") return null;
  if (!isObject(clue) || typeof clue["clue"] !== "string") return null;
  return {
    direction: acrossNotDown ? "across" : "down",
    start: y * cols + x,
    clue: clue["clue"],
  };
}

/**
 * Read the optional `cellInfos` overlay into circled cell indices: absent or null reads as no
 * circles (the boundary's uniform optional-field rule), a present value must be an array of
 * objects, and an entry with `isCircled: true` must carry an in-grid `{x, y}` (the shape is
 * load-bearing: a bad index would corrupt the overlay). Non-circled entries are ignored
 * whatever else they carry (background colors and bars are not modeled).
 */
function readCircles(
  value: unknown,
  rows: number,
  cols: number,
): number[] | "malformed" | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return "malformed";
  const indices: number[] = [];
  for (const raw of value) {
    if (!isObject(raw)) return "malformed";
    if (raw["isCircled"] !== true) continue;
    const x = raw["x"];
    const y = raw["y"];
    if (!isNonNegativeInt(x) || !isNonNegativeInt(y)) return "malformed";
    if (x >= cols || y >= rows) return "malformed";
    indices.push(y * cols + x);
  }
  return indices;
}

/**
 * Translate one encoded AmuseLabs (PuzzleMe) blob into an internal `ServerPuzzle`, or reject it
 * with a single named code. The check order is fixed so the same bad document always yields the
 * same code:
 *
 *  1. VALIDATION          document is a string (the raw encoded blob, PROTOCOL.md section 12)
 *  2. VALIDATION          the blob decodes via a supported deterministic variant (plain base64,
 *                         or the embedded-key scramble; a keyless scramble is named here)
 *  3. VALIDATION          the decoded document is a JSON object
 *  4. VALIDATION          `w` and `h` are positive integers
 *  5. OVERSIZE_GRID       w or h exceeds 25 (shared cap; bounds all later per-cell work)
 *  6. VALIDATION          `box` is `w` columns of `h` strings (column-major, box[col][row])
 *  7. VALIDATION          `placedWords` is an array of well-formed in-grid entries
 *  8. VALIDATION          `cellInfos`, when present, is a well-formed circle overlay
 *  9. SOLUTION_MISSING    a playable cell's solution is empty (the outlet served no answers)
 * 10. DEGENERATE_GRID     zero playable cells (shared check)
 * 11. REBUS_TOO_LONG      shared check (a multi-character box cell is a rebus)
 * 12. UNSOLVABLE_CELL     a cell outside A-Z0-9 after ASCII-uppercasing (shared check, D12)
 * 13. AMBIGUOUS_SOLUTION  two placed words claim one slot (same start cell and direction)
 * 14. VALIDATION          the placed words do not match the grid-derived word runs; else ACCEPT
 *
 * Structure is checked before semantics and each per-cell rule scans the whole grid before the
 * next code, so the code chosen never depends on cell or entry order. Steps 10-12 are the shared
 * domain checks every translator runs (PROTOCOL.md section 12: named rejections apply
 * uniformly). Solutions are ASCII-uppercased at materialization (INV-1). Numbering comes from
 * `deriveWordRuns`, never from `clueNum` or entry order.
 */
export function translateAmuseLabs(body: unknown): IngestResult {
  // 1.
  if (typeof body !== "string") {
    return reject(
      "VALIDATION",
      "an amuselabs document must be the encoded blob string",
    );
  }

  // 2.
  const decoded = decodeBlob(body);
  if (!decoded.ok) return reject("VALIDATION", decoded.message);

  // 3.
  const doc = decoded.document;
  if (!isObject(doc)) {
    return reject("VALIDATION", "the blob must decode to a JSON object");
  }

  // 4.
  const w = doc["w"];
  const h = doc["h"];
  if (!isPositiveInt(w) || !isPositiveInt(h)) {
    return reject(
      "VALIDATION",
      "the document must carry positive integer w and h",
    );
  }
  const rows = h;
  const cols = w;

  // 5.
  const oversize = checkDimensions(rows, cols);
  if (oversize !== null) return oversize;

  // 6. Column-major, reference-pinned: `box[col][row]`, `w` columns of `h` string cells.
  const box = doc["box"];
  if (
    !Array.isArray(box) ||
    box.length !== cols ||
    !box.every(
      (column) =>
        Array.isArray(column) &&
        column.length === rows &&
        column.every((cell) => typeof cell === "string"),
    )
  ) {
    return reject(
      "VALIDATION",
      `box must be ${cols} columns of ${rows} string cells`,
    );
  }
  const columns = box as string[][];

  // 7.
  const rawWords = doc["placedWords"];
  if (!Array.isArray(rawWords)) {
    return reject("VALIDATION", "placedWords must be an array");
  }
  const words: PlacedWord[] = [];
  for (const [i, raw] of rawWords.entries()) {
    const word = readPlacedWord(raw, rows, cols);
    if (word === null) {
      return reject(
        "VALIDATION",
        `placed word at index ${i} is not a well-formed entry`,
      );
    }
    words.push(word);
  }

  // 8.
  const circleRead = readCircles(doc["cellInfos"], rows, cols);
  if (circleRead === "malformed") {
    return reject(
      "VALIDATION",
      "cellInfos must be an array of cell objects with in-grid circled cells",
    );
  }
  const circles = circleRead ?? [];

  // Materialize the row-major solution grid from the column-major box, ASCII-uppercased
  // (INV-1). A NUL cell is a block; an empty cell is a served-without-answers signal, checked
  // next as its own code so it never lands the shared UNSOLVABLE_CELL.
  const blocks: number[] = [];
  const solution: (Solution | null)[] = [];
  let missing = false;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = columns[c]![r]!;
      if (cell === BLOCK_TOKEN) {
        blocks.push(r * cols + c);
        solution.push(null);
      } else {
        if (cell === "") missing = true;
        solution.push(asciiUppercase(cell) as Solution);
      }
    }
  }

  // 9. v1 requires solutions at ingest (D11): an empty playable cell means the outlet served
  //    the puzzle without answers. The whole grid is scanned above before this code fires.
  if (missing) {
    return reject(
      "SOLUTION_MISSING",
      "the document carries no complete solution grid",
    );
  }

  // 10, 11, 12. The shared per-cell domain checks (degenerate, rebus cap, enterability).
  const domain = checkSolutionGrid(solution);
  if (domain !== null) return domain;

  // 13. One placed word per slot: two words with the same start cell and direction are two
  //     clues for one slot (the same signal as the other translators).
  const bySlot = new Map<string, PlacedWord>();
  for (const word of words) {
    const key = `${word.direction}:${word.start}`;
    if (bySlot.has(key)) {
      return reject(
        "AMBIGUOUS_SOLUTION",
        "a direction lists more than one placed word for a single slot",
      );
    }
    bySlot.set(key, word);
  }

  // 14. Every grid-derived run must be exactly one placed word and vice versa; numbering comes
  //     from the runs, never from the document. A word starting mid-run matches nothing.
  const runs = deriveWordRuns(rows, cols, (i) => solution[i] === null);
  if (runs.across.length + runs.down.length !== words.length) {
    return reject(
      "VALIDATION",
      "the placed words do not match the grid's word runs",
    );
  }
  const buildClues = (
    direction: "across" | "down",
    wordRuns: readonly WordRun[],
  ): RunClue[] | null => {
    const clues: RunClue[] = [];
    for (const run of wordRuns) {
      const word = bySlot.get(`${direction}:${run.cells[0]}`);
      if (word === undefined) return null;
      // Funnel the raw clue through the shared markup seam so PuzzleMe clues capture their
      // {text, runs} uniformly (clue-runs.ts); entities decode there too.
      clues.push(buildRunClue(run.number, word.clue, run.cells));
    }
    return clues;
  };
  const across = buildClues("across", runs.across);
  const down = buildClues("down", runs.down);
  if (across === null || down === null) {
    return reject(
      "VALIDATION",
      "the placed words do not match the grid's word runs",
    );
  }

  const puzzle: ServerPuzzle = {
    rows,
    cols,
    blocks,
    circles,
    clues: { across, down },
    solution,
  };

  // A multi-character box cell is a rebus; circles come from cellInfos. The format's shading
  // and background colors are not modeled, so shadedCircles is structurally false.
  const features: PuzzleFeatures = {
    rebus: solution.some((s) => s !== null && s.length > 1),
    circles: circles.length > 0,
    shadedCircles: false,
  };

  // Display metadata, parsed last: never affects acceptance or the chosen code.
  const title = readMetadata(doc["title"]);
  const author = readMetadata(doc["author"]);

  return { ok: true, puzzle, features, title, author };
}
