// .puz (Across Lite) translator (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP
// 6.1). The envelope document is a STRING: standard base64 of the raw `.puz` file bytes exactly
// as the extension read them off disk or a page (PROTOCOL.md section 12 already reserves this
// shape: "a future format, for example binary `.puz`, carried base64 in `document`"). The
// extension never decodes the file (DESIGN.md section 7: the extension is deliberately dumb);
// the base64 decode and the whole binary parse happen here, in the ACL, so the external format
// is still parsed exactly once, at the boundary. Same contract as the other translators: a fixed
// documented check order, one named rejection with a stable code, and rejection messages never
// echo solution or file content (INV-6 discipline).
//
// THE FILE FORMAT is well documented publicly; this parser follows the canonical Across Lite
// layout (the same layout the `puzpy` / `xword-dl` references parse):
//
//   Header (52 bytes, little-endian u16 where numeric):
//     0x00  u16  global (file) checksum
//     0x02  12   the magic "ACROSS&DOWN\0"
//     0x0E  u16  CIB checksum (over the 8 header bytes at 0x2C..0x33)
//     0x10  4    masked low checksums (the "ICHEATED" low nibble, XOR-masked)
//     0x14  4    masked high checksums (the "ICHEATED" high nibble, XOR-masked)
//     0x18  4    version string, NUL-padded (e.g. "1.3\0")
//     0x1C  2    reserved (1C)
//     0x1E  u16  scrambled checksum (0 unless the solution is scrambled)
//     0x20  12   reserved (20)
//     0x2C  u8   width  (columns)
//     0x2D  u8   height (rows)
//     0x2E  u16  clue count
//     0x30  u16  unknown bitmask
//     0x32  u16  scrambled tag (nonzero => the solution is locked/scrambled)
//   Then, contiguous:
//     width*height  solution grid bytes ('.' is a block, a letter otherwise, '-' means empty
//                   which for a solution grid is a missing answer)
//     width*height  player-state grid bytes (the saved fill; IGNORED, DESIGN.md section 7)
//     NUL-terminated strings, Latin-1 (ISO-8859-1) throughout: title, author, copyright, then
//     exactly `clue count` clue strings, then the notepad. STRINGS ARE NEVER UTF-8: the format
//     predates Unicode and stores one byte per character in Latin-1.
//   Then zero or more extra sections, each: <4-byte ASCII name><u16 len><u16 checksum><len bytes>\0
//     GEXT  the per-cell markup grid; bit 0x80 marks a circled cell (mapped to `circles`)
//     GRBS  the per-cell rebus-index grid (0 = no rebus, n = rebus table key n-1)
//     RTBL  the rebus answer table, "<key>:<answer>;" repeated (key is space-padded to width 2)
//     LTIM  the saved timer; IGNORED (DESIGN.md section 7)
//
// CHECKSUMS are verified, not merely parsed: the CIB checksum, the global checksum, and the two
// masked low/high checksum groups. A mismatch is a corrupt file, a clean VALIDATION, never a
// crash. The checksum algorithm is the format's own 16-bit rotate-and-add over specific byte
// ranges; the masked pair is that same primitive over four ranges, XOR-folded with the constant
// "ICHEATED". Getting the ranges right is the whole of it, so the byte-exact test builder
// computes real checksums and this parser recomputes them the same way.
//
// SCRAMBLED puzzles are REJECTED, never unscrambled (the owner's condition and DESIGN.md section
// 7: named rejection, no silent salvage). The scrambled tag at 0x32 and a nonzero scrambled
// checksum at 0x1E both signal a locked solution; either rejects, because an unscrambled parse
// would store ciphertext as the answer and every check would fail.
//
// REBUS is ACCEPTED, not rejected: the Crossy model represents a multi-character cell natively
// (`Solution` is a string, `features.rebus` exists, the comparator accepts the full string or its
// first character, DESIGN.md section 5 D12), so a GRBS/RTBL rebus translates into multi-character
// solution cells subject to the shared 10-character cap (`REBUS_TOO_LONG`). It is never flattened
// to a single letter.
import { Buffer } from "node:buffer";
import { asciiUppercase } from "@crossy/protocol";
import type { ServerPuzzle, Solution } from "@crossy/protocol";
import {
  checkDimensions,
  checkSolutionGrid,
  decodeEntities,
  deriveWordRuns,
  reject,
} from "./ingest";
import type { IngestResult, PuzzleFeatures, WordRun } from "./ingest";

/** Standard base64, optional padding. Stricter than a lenient decoder on purpose (INV-1). */
const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;
/** The header magic at offset 0x02, NUL-terminated (11 chars + the terminating NUL). */
const MAGIC = "ACROSS&DOWN\u0000";
/** The fixed header length; the grids and strings begin immediately after it. */
const HEADER_LENGTH = 0x34;
/** A `.puz` block cell in the solution grid. */
const BLOCK_TOKEN = ".";
/** An empty cell in the solution grid ('-' means the answer is missing for that cell). */
const EMPTY_TOKEN = "-";
/** GEXT markup bit that marks a circled cell. */
const GEXT_CIRCLED = 0x80;
/** The XOR mask folded into the masked low/high checksums (the format's "ICHEATED"). */
const CHECKSUM_MASK = "ICHEATED";
/** Cap on the stored title and author, matching the other translators' MAX_METADATA_LENGTH. */
const MAX_METADATA_LENGTH = 200;
/**
 * A sane cap on the decoded file size, in line with the 25x25 puzzle bound (DESIGN.md section 7):
 * a legitimate `.puz` at the cap is a few kilobytes (625 solution + 625 player bytes, strings,
 * and small extra sections). 1 MiB is generous headroom while refusing a payload that could only
 * be an attack or a mistake; the base64 body is itself bounded by the route's JSON body handling.
 */
const MAX_FILE_BYTES = 1 << 20;

/** Header fields read once and reused across the checksum checks and the parse. */
interface Header {
  readonly globalChecksum: number;
  readonly cibChecksum: number;
  readonly maskedLow: Buffer;
  readonly maskedHigh: Buffer;
  readonly scrambledChecksum: number;
  readonly width: number;
  readonly height: number;
  readonly clueCount: number;
  readonly scrambledTag: number;
}

/** A decoded extra section: its 4-char name and its raw data bytes (checksum already verified). */
interface Extra {
  readonly name: string;
  readonly data: Buffer;
}

/**
 * The `.puz` 16-bit checksum primitive: for each byte, rotate the running 16-bit accumulator
 * right by one (low bit wraps to bit 15) and add the byte, keeping 16 bits. This is the format's
 * own algorithm, shared by the CIB, global, and masked checksums; only the byte ranges differ.
 */
function checksumRegion(bytes: Buffer, seed = 0): number {
  let sum = seed & 0xffff;
  for (const b of bytes) {
    sum = (sum >>> 1) | ((sum & 1) << 15);
    sum = (sum + b) & 0xffff;
  }
  return sum;
}

/** Decode a Latin-1 (ISO-8859-1) byte range to a string; the format is never UTF-8 (INV-6 note). */
function latin1(bytes: Buffer): string {
  return bytes.toString("latin1");
}

/**
 * Read one NUL-terminated Latin-1 string starting at `offset`, returning the string and the
 * offset just past its terminator. A run that reaches the end of the buffer with no NUL is a
 * truncated file: the caller treats a null return as VALIDATION.
 */
function readCString(
  buf: Buffer,
  offset: number,
): { value: string; next: number } | null {
  const end = buf.indexOf(0, offset);
  if (end === -1) return null;
  return { value: latin1(buf.subarray(offset, end)), next: end + 1 };
}

/**
 * Decode the base64 envelope document to the raw file bytes, or a named failure. Strict: a
 * non-base64 string is refused rather than salvaged, and an oversized decode is refused before it
 * is parsed. The message is content-free (INV-6): it names the shape problem, never file bytes.
 */
function decodeFile(
  document: unknown,
): { ok: true; bytes: Buffer } | { ok: false; message: string } {
  if (typeof document !== "string") {
    return {
      ok: false,
      message: "a puz document must be the base64 file string",
    };
  }
  if (!BASE64_SHAPE.test(document)) {
    return { ok: false, message: "the document is not valid base64" };
  }
  const bytes = Buffer.from(document, "base64");
  // Buffer.from is lenient about a base64 length that is not a multiple of 4; a strict re-encode
  // round-trip catches a string that decoded to fewer bytes than it claimed, so two different
  // strings can never alias to one file (the amuselabs boundary uses the same strictness). Both
  // sides drop trailing padding so `AA` and `AA==` compare equal.
  const canonical = (s: string): string => s.replace(/=+$/, "");
  if (canonical(bytes.toString("base64")) !== canonical(document)) {
    return { ok: false, message: "the document is not valid base64" };
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return { ok: false, message: "the decoded file exceeds the size cap" };
  }
  return { ok: true, bytes };
}

/**
 * Read the fixed 52-byte header, or null when the buffer is too short or the magic is wrong. The
 * magic check is what separates a `.puz` file from arbitrary base64: an absent or wrong magic is
 * not this format at all.
 */
function readHeader(buf: Buffer): Header | null {
  if (buf.length < HEADER_LENGTH) return null;
  if (latin1(buf.subarray(0x02, 0x02 + MAGIC.length)) !== MAGIC) return null;
  return {
    globalChecksum: buf.readUInt16LE(0x00),
    cibChecksum: buf.readUInt16LE(0x0e),
    maskedLow: buf.subarray(0x10, 0x14),
    maskedHigh: buf.subarray(0x14, 0x18),
    scrambledChecksum: buf.readUInt16LE(0x1e),
    width: buf.readUInt8(0x2c),
    height: buf.readUInt8(0x2d),
    clueCount: buf.readUInt16LE(0x2e),
    scrambledTag: buf.readUInt16LE(0x32),
  };
}

/**
 * The text-section checksum, computed the canonical `.puz` way (the `puzpy` reference rule). The
 * order is title, author, copyright, then every clue, then the notepad. Title, author, copyright,
 * and the notepad fold their bytes PLUS a terminating NUL, but ONLY when the string is non-empty;
 * an empty one contributes nothing. Every clue folds its bytes WITHOUT a NUL. This asymmetry is
 * the format's, not ours: it is why the text checksum cannot be a flat fold over the raw string
 * region, and why a corrupt clue count or a mangled string surfaces here as a mismatch.
 */
function textChecksum(
  seed: number,
  title: string,
  author: string,
  copyright: string,
  clues: readonly string[],
  notepad: string,
): number {
  let sum = seed;
  const foldWithNul = (s: string): void => {
    if (s === "") return;
    // The bytes of `s` in Latin-1, then a single NUL terminator (0x00).
    sum = checksumRegion(
      Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]),
      sum,
    );
  };
  foldWithNul(title);
  foldWithNul(author);
  foldWithNul(copyright);
  for (const clue of clues) {
    sum = checksumRegion(Buffer.from(clue, "latin1"), sum);
  }
  foldWithNul(notepad);
  return sum;
}

/**
 * Verify the four checksum groups the format defines (CIB, global, and the masked low/high
 * pair), recomputing each over its documented byte range and comparing to the stored value.
 * Returns true only when all match. The ranges:
 *
 *   CIB     the 8 header bytes at 0x2C..0x33 (width, height, clue count, bitmask, scramble tag)
 *   global  the CIB checksum, then the solution grid, the player grid, then the text section
 *           (`textChecksum` above), each fold seeded by the running total
 *   masked  four partial checksums (CIB, solution, player grid, and the text section on a zero
 *           seed) XOR-folded byte by byte with the ASCII of "ICHEATED": the low byte of each into
 *           maskedLow, the high byte into maskedHigh
 *
 * A mismatch means a corrupt file; the caller turns a false here into a clean VALIDATION.
 */
function checksumsValid(
  buf: Buffer,
  header: Header,
  gridBytes: number,
  strings: {
    title: string;
    author: string;
    copyright: string;
    clues: readonly string[];
    notepad: string;
  },
): boolean {
  const cib = checksumRegion(buf.subarray(0x2c, 0x34));
  if (cib !== header.cibChecksum) return false;

  const solution = buf.subarray(HEADER_LENGTH, HEADER_LENGTH + gridBytes);
  const player = buf.subarray(
    HEADER_LENGTH + gridBytes,
    HEADER_LENGTH + gridBytes * 2,
  );

  // The global checksum seeds with the CIB checksum, folds the two grids, then the text section.
  let global = checksumRegion(solution, cib);
  global = checksumRegion(player, global);
  global = textChecksum(
    global,
    strings.title,
    strings.author,
    strings.copyright,
    strings.clues,
    strings.notepad,
  );
  if (global !== header.globalChecksum) return false;

  // The masked pair: four partial checksums, then an XOR-fold with the mask.
  const cSol = checksumRegion(solution);
  const cGrid = checksumRegion(player);
  const cText = textChecksum(
    0,
    strings.title,
    strings.author,
    strings.copyright,
    strings.clues,
    strings.notepad,
  );
  const partials = [cib, cSol, cGrid, cText];
  for (let i = 0; i < 4; i += 1) {
    const maskLow = CHECKSUM_MASK.charCodeAt(i);
    const maskHigh = CHECKSUM_MASK.charCodeAt(i + 4);
    const expectLow = (partials[i]! & 0xff) ^ maskLow;
    const expectHigh = ((partials[i]! >> 8) & 0xff) ^ maskHigh;
    if (header.maskedLow[i] !== expectLow) return false;
    if (header.maskedHigh[i] !== expectHigh) return false;
  }
  return true;
}

/**
 * Walk the extra sections that follow the notepad string. Each is a 4-byte ASCII name, a u16
 * length, a u16 data checksum, `length` data bytes, and a NUL. A section whose stored checksum
 * does not match its data is corrupt (VALIDATION via the null return); a section that runs past
 * the buffer is truncated (also null). Sections we do not model are kept but skipped by name.
 */
function readExtras(buf: Buffer, start: number): Extra[] | null {
  const extras: Extra[] = [];
  let at = start;
  while (at < buf.length) {
    // A trailing run after the last real section is not a section header once fewer than eight
    // bytes remain, or once the four name bytes are not four uppercase ASCII letters.
    if (at + 8 > buf.length) break;
    const name = latin1(buf.subarray(at, at + 4));
    if (!/^[A-Z]{4}$/.test(name)) break;
    const length = buf.readUInt16LE(at + 4);
    const stored = buf.readUInt16LE(at + 6);
    const dataStart = at + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 1 > buf.length) return null; // truncated: data or the terminating NUL is missing
    const data = buf.subarray(dataStart, dataEnd);
    if (checksumRegion(data) !== stored) return null; // corrupt section
    extras.push({ name, data });
    at = dataEnd + 1; // skip the terminating NUL
  }
  return extras;
}

/**
 * Parse the RTBL rebus table into a map from key to answer. The format is "<key>:<answer>;"
 * repeated, where the key is the numeric string the GRBS grid references (GRBS stores `key + 1`,
 * 0 meaning "no rebus"), space-padded to width two. Answers are Latin-1 already (the whole file
 * was decoded that way). A malformed table entry yields null (VALIDATION).
 */
function parseRebusTable(data: Buffer): Map<number, string> | null {
  const table = new Map<number, string>();
  const text = latin1(data);
  // A trailing separator is optional; split and drop the empty tail.
  for (const entry of text.split(";")) {
    if (entry === "") continue;
    const colon = entry.indexOf(":");
    if (colon === -1) return null;
    const key = Number(entry.slice(0, colon).trim());
    const answer = entry.slice(colon + 1);
    if (!Number.isInteger(key) || key < 0) return null;
    table.set(key, answer);
  }
  return table;
}

/**
 * Read one `.puz` display-metadata string (title or author) the way `readMetadata` treats the
 * other formats' strings: entity-decode, trim, cap, and null when empty. The `.puz` strings are
 * already decoded from Latin-1, so this only normalizes whitespace and bounds the length. Kept
 * local (rather than reusing the exported `readMetadata`) because the input is already a string
 * here, not the `unknown` document field the other translators hand `readMetadata`.
 */
function readMetadataText(raw: string): string | null {
  const decoded = decodeEntities(raw).trim();
  if (decoded === "") return null;
  return decoded.slice(0, MAX_METADATA_LENGTH);
}

/**
 * Translate one base64-encoded `.puz` file into an internal `ServerPuzzle`, or reject it with a
 * single named code. The check order is fixed so the same bad file always yields the same code:
 *
 *  1. VALIDATION          the document is a base64 string within the size cap
 *  2. VALIDATION          the file has the fixed header and the "ACROSS&DOWN" magic
 *  3. VALIDATION          width and height are nonzero (a zero dimension is degenerate at the
 *                         header, before any grid math)
 *  4. OVERSIZE_GRID       width or height exceeds 25 (shared cap; bounds all later per-cell work)
 *  5. VALIDATION          the solution and player grids and all strings fit the file (not truncated)
 *  6. VALIDATION          scrambled/locked solutions are rejected, never unscrambled
 *  7. VALIDATION          the four checksum groups (CIB, global, masked low/high) all verify
 *  8. VALIDATION          the extra sections (GEXT/GRBS/RTBL/...) are well-formed and checksum-clean
 *  9. VALIDATION          GRBS references an RTBL key that the table defines
 * 10. DEGENERATE_GRID     zero playable cells (shared check)
 * 11. REBUS_TOO_LONG      a rebus answer exceeds 10 characters (shared check)
 * 12. UNSOLVABLE_CELL     a cell outside A-Z0-9 after ASCII-uppercasing (shared check, D12)
 * 13. VALIDATION          the clue count does not match the grid's word runs; else ACCEPT
 *
 * Structure is checked before semantics; the header dimensions and oversize come first because
 * they are the cheapest global bound and cap the per-cell scans. Scrambled is rejected before the
 * checksums, because a locked solution is a policy rejection independent of file integrity. Steps
 * 10-12 are the shared domain checks every translator runs (PROTOCOL.md section 12: named
 * rejections apply uniformly). Solutions are ASCII-uppercased at materialization (INV-1).
 *
 * There is no AMBIGUOUS_SOLUTION path: `.puz` deals one clue string per word run in a single
 * ordered list, so it carries no per-slot duplicate signal the way the numbered formats do.
 *
 * CLUE ORDERING: `.puz` stores clues in a single interleaved list, in ascending cell-number order
 * with across before down at each numbered cell. Numbering is derived from the grid geometry
 * (`deriveWordRuns`), then the interleaved list is dealt out to the derived across/down runs in
 * that exact order, which is the format's own rule; the file carries no per-clue direction tag.
 */
export function translatePuz(document: unknown): IngestResult {
  // 1.
  const decoded = decodeFile(document);
  if (!decoded.ok) return reject("VALIDATION", decoded.message);
  const buf = decoded.bytes;

  // 2.
  const header = readHeader(buf);
  if (header === null) {
    return reject("VALIDATION", "not a puz file: missing header or magic");
  }

  // 3.
  const rows = header.height;
  const cols = header.width;
  if (rows === 0 || cols === 0) {
    return reject("VALIDATION", "the puz header declares a zero dimension");
  }

  // 4.
  const oversize = checkDimensions(rows, cols);
  if (oversize !== null) return oversize;

  // 5. Layout: header, solution grid, player grid, then the string block. Bound each region and
  //    read the strings, treating any short read as a truncated file (VALIDATION).
  const cellCount = rows * cols;
  const gridBytes = cellCount;
  const solutionStart = HEADER_LENGTH;
  const playerStart = solutionStart + gridBytes;
  const stringsStart = playerStart + gridBytes;
  if (buf.length < stringsStart) {
    return reject("VALIDATION", "the puz file is truncated before its grids");
  }
  const solutionGrid = buf.subarray(solutionStart, playerStart);

  const title = readCString(buf, stringsStart);
  const author = title === null ? null : readCString(buf, title.next);
  const copyright = author === null ? null : readCString(buf, author.next);
  if (title === null || author === null || copyright === null) {
    return reject(
      "VALIDATION",
      "the puz file is truncated in its metadata strings",
    );
  }
  const clueStrings: string[] = [];
  let at = copyright.next;
  for (let i = 0; i < header.clueCount; i += 1) {
    const s = readCString(buf, at);
    if (s === null) {
      return reject("VALIDATION", "the puz file is truncated in its clue list");
    }
    clueStrings.push(s.value);
    at = s.next;
  }
  const notepad = readCString(buf, at);
  if (notepad === null) {
    return reject("VALIDATION", "the puz file is truncated in its notepad");
  }
  const extrasStart = notepad.next;

  // 6. Scrambled/locked solutions reject before the checksum verify: the scrambled tag or a
  //    nonzero scrambled checksum both mean the solution grid holds ciphertext. We do not
  //    unscramble (DESIGN.md section 7: named rejection, no salvage).
  if (header.scrambledTag !== 0 || header.scrambledChecksum !== 0) {
    return reject(
      "VALIDATION",
      "the puz solution is scrambled (locked); scrambled puzzles are not supported",
    );
  }

  // 7. The file's own integrity checks: a mismatch is a corrupt upload. The text section is
  //    folded per the format's own asymmetric rule (see `textChecksum`), so the parsed strings,
  //    not a flat byte range, feed the verify.
  if (
    !checksumsValid(buf, header, gridBytes, {
      title: title.value,
      author: author.value,
      copyright: copyright.value,
      clues: clueStrings,
      notepad: notepad.value,
    })
  ) {
    return reject(
      "VALIDATION",
      "the puz file's checksums do not verify (corrupt file)",
    );
  }

  // 8. Extra sections. GEXT gives circles; GRBS + RTBL give rebus answers; the rest are skipped.
  const extras = readExtras(buf, extrasStart);
  if (extras === null) {
    return reject("VALIDATION", "a puz extra section is corrupt or truncated");
  }
  const gext = extras.find((e) => e.name === "GEXT");
  const grbs = extras.find((e) => e.name === "GRBS");
  const rtbl = extras.find((e) => e.name === "RTBL");

  const circles: number[] = [];
  if (gext !== undefined) {
    if (gext.data.length !== cellCount) {
      return reject(
        "VALIDATION",
        "the GEXT markup grid size does not match the puzzle",
      );
    }
    for (let i = 0; i < cellCount; i += 1) {
      if ((gext.data[i]! & GEXT_CIRCLED) !== 0) circles.push(i);
    }
  }

  let rebusTable: Map<number, string> | null = null;
  if (grbs !== undefined) {
    if (grbs.data.length !== cellCount) {
      return reject(
        "VALIDATION",
        "the GRBS rebus grid size does not match the puzzle",
      );
    }
    if (rtbl === undefined) {
      return reject(
        "VALIDATION",
        "the puz declares a GRBS rebus grid but no RTBL table",
      );
    }
    rebusTable = parseRebusTable(rtbl.data);
    if (rebusTable === null) {
      return reject("VALIDATION", "the puz RTBL rebus table is malformed");
    }
  }

  // Materialize blocks and the normalized (ASCII-uppercased, INV-1) solution grid. A '.' is a
  // block; a '-' is a missing answer (kept as '' so enterability rejects it, not silently
  // dropped). A GRBS entry at a playable cell replaces the single grid letter with its full
  // RTBL answer (9).
  const blocks: number[] = [];
  const solution: (Solution | null)[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    const ch = String.fromCharCode(solutionGrid[i]!);
    if (ch === BLOCK_TOKEN) {
      blocks.push(i);
      solution.push(null);
      continue;
    }
    let answer = ch === EMPTY_TOKEN ? "" : ch;
    if (grbs !== undefined && rebusTable !== null) {
      const key = grbs.data[i]!;
      if (key !== 0) {
        // 9. GRBS stores `RTBL key + 1`; 0 means "no rebus here". A reference the table does not
        //    define is a corrupt pairing.
        const rebus = rebusTable.get(key - 1);
        if (rebus === undefined) {
          return reject(
            "VALIDATION",
            "a GRBS cell references an RTBL rebus key that the table does not define",
          );
        }
        answer = rebus;
      }
    }
    solution.push(asciiUppercase(answer) as Solution);
  }

  // 10, 11, 12. The shared per-cell domain checks (degenerate, rebus cap, enterability). An empty
  //     ('') solution cell fails enterability (no A-Z0-9 first character), landing UNSOLVABLE_CELL,
  //     which is correct: a `.puz` with a '-' at a playable cell carries no answer for it.
  const domain = checkSolutionGrid(solution);
  if (domain !== null) return domain;

  // 13. Numbering from the grid, then deal the interleaved clue list to the runs.
  const runs = deriveWordRuns(rows, cols, (i) => solution[i] === null);
  if (clueStrings.length !== runs.across.length + runs.down.length) {
    return reject(
      "VALIDATION",
      "the puz clue count does not match the grid's word runs",
    );
  }

  // The interleaved order: ascending by the numbered cell, across before down at each number.
  // Build one sequence over the numbered starts, then consume clueStrings in that order. Each
  // numbered start contributes its across run (if any) then its down run (if any), which is
  // exactly the file's clue order.
  const acrossByNumber = new Map<number, WordRun>(
    runs.across.map((r) => [r.number, r]),
  );
  const downByNumber = new Map<number, WordRun>(
    runs.down.map((r) => [r.number, r]),
  );
  const numbers = [
    ...new Set([...acrossByNumber.keys(), ...downByNumber.keys()]),
  ].sort((a, b) => a - b);
  const across: {
    number: number;
    text: string;
    cellIndices: readonly number[];
  }[] = [];
  const down: {
    number: number;
    text: string;
    cellIndices: readonly number[];
  }[] = [];
  let clueAt = 0;
  for (const number of numbers) {
    const a = acrossByNumber.get(number);
    if (a !== undefined) {
      across.push({
        number,
        text: decodeEntities(clueStrings[clueAt]!.trim()),
        cellIndices: a.cells,
      });
      clueAt += 1;
    }
    const d = downByNumber.get(number);
    if (d !== undefined) {
      down.push({
        number,
        text: decodeEntities(clueStrings[clueAt]!.trim()),
        cellIndices: d.cells,
      });
      clueAt += 1;
    }
  }

  const puzzle: ServerPuzzle = {
    rows,
    cols,
    blocks,
    circles,
    clues: { across, down },
    solution,
  };

  const features: PuzzleFeatures = {
    rebus: solution.some((s) => s !== null && s.length > 1),
    circles: circles.length > 0,
    // `.puz` GEXT distinguishes no shaded-circle variant that we model; both render as circles.
    shadedCircles: false,
  };

  // Display metadata, parsed last: never affects acceptance or the chosen code. Title and author
  // are Latin-1 strings; copyright is read (to advance the string cursor) but not stored.
  const titleMeta = readMetadataText(title.value);
  const authorMeta = readMetadataText(author.value);

  return {
    ok: true,
    puzzle,
    features,
    title: titleMeta,
    author: authorMeta,
  };
}
