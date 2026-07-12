/**
 * .puz (Across Lite) translator unit vectors (PROTOCOL.md section 12; DESIGN.md section 7, D21;
 * ROADMAP 6.1). `translatePuz` is pure, so these run with no infrastructure. They pin the binary
 * parse: the header magic and dimensions, Latin-1 (never UTF-8) string decoding, the CIB / global
 * / masked-checksum verification, the scrambled-puzzle rejection, the interleaved clue ordering
 * dealt against grid-derived numbering, the GEXT circles and GRBS/RTBL rebus sections, and that
 * the shared domain checks apply identically to this format.
 *
 * FIXTURES ARE BUILT BYTE BY BYTE. `buildPuz` lays down a real `.puz` file and computes the real
 * checksums the format defines, so a valid file is genuinely valid and a deliberately corrupted
 * one (a flipped grid byte, a wrong clue count, a set scramble tag) is genuinely corrupt. Nothing
 * here is a captured real puzzle: every grid and clue is invented (DESIGN.md section 7 firm rule).
 *
 * Test names cite the invariant they defend so coverage is greppable.
 */
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { translatePuz } from "./puz";
import type { IngestErrorCode } from "./ingest";

// --- The byte-exact builder ----------------------------------------------------------------

/** The `.puz` 16-bit rotate-and-add checksum, mirrored from the parser (the format's primitive). */
function cksum(bytes: Buffer, seed = 0): number {
  let sum = seed & 0xffff;
  for (const b of bytes) {
    sum = (sum >>> 1) | ((sum & 1) << 15);
    sum = (sum + b) & 0xffff;
  }
  return sum;
}

/** The text-section checksum: title/author/copyright/notes fold their bytes + NUL when non-empty;
 * every clue folds without a NUL. Mirrors the parser's `textChecksum`. */
function textChecksum(
  seed: number,
  title: string,
  author: string,
  copyright: string,
  clues: readonly string[],
  notepad: string,
): number {
  let sum = seed;
  const withNul = (s: string): void => {
    if (s === "") return;
    sum = cksum(
      Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]),
      sum,
    );
  };
  withNul(title);
  withNul(author);
  withNul(copyright);
  for (const c of clues) sum = cksum(Buffer.from(c, "latin1"), sum);
  withNul(notepad);
  return sum;
}

const MASK = "ICHEATED";

interface PuzSpec {
  width: number;
  height: number;
  /** Row-major solution grid: '.' a block, a letter otherwise, '-' an empty (missing) cell. */
  grid: string;
  /** Clues in the file's interleaved order (across-before-down at each numbered cell). */
  clues: string[];
  title?: string;
  author?: string;
  copyright?: string;
  notepad?: string;
  scrambledTag?: number;
  scrambledChecksum?: number;
  /** Optional player-state grid override (defaults to an unsolved '-'/'.' grid). */
  player?: string;
  /** Extra sections, appended after the notepad in the given order. */
  extras?: { name: string; data: Buffer }[];
}

/**
 * Build a valid `.puz` file for a spec, computing every checksum for real. The result is the
 * base64 the envelope carries. Callers mutate the returned bytes (see `corrupt`) to build the
 * negative fixtures without recomputing, so a single flipped byte is what the checksum test sees.
 */
function buildBytes(spec: PuzSpec): Buffer {
  const {
    width,
    height,
    grid,
    clues,
    title = "",
    author = "",
    copyright = "",
    notepad = "",
    scrambledTag = 0,
    scrambledChecksum = 0,
    player: playerOverride,
    extras = [],
  } = spec;
  const cellCount = width * height;
  const solution = Buffer.from(grid, "latin1");
  // The player grid: '.' where the solution is a block, '-' (empty) elsewhere, the usual saved
  // state for an unsolved puzzle. An explicit override lets a test seat a solved player grid to
  // prove the parser ignores it. Either way the checksum folds this exact content.
  const player = Buffer.from(
    playerOverride ??
      grid
        .split("")
        .map((c) => (c === "." ? "." : "-"))
        .join(""),
    "latin1",
  );

  const strings = Buffer.concat([
    Buffer.from(`${title}\0`, "latin1"),
    Buffer.from(`${author}\0`, "latin1"),
    Buffer.from(`${copyright}\0`, "latin1"),
    ...clues.map((c) => Buffer.from(`${c}\0`, "latin1")),
    Buffer.from(`${notepad}\0`, "latin1"),
  ]);

  const extraBlock = Buffer.concat(
    extras.map((e) => {
      const head = Buffer.alloc(8);
      head.write(e.name, 0, "latin1");
      head.writeUInt16LE(e.data.length, 4);
      head.writeUInt16LE(cksum(e.data), 6);
      return Buffer.concat([head, e.data, Buffer.from([0])]);
    }),
  );

  const header = Buffer.alloc(0x34);
  header.write("ACROSS&DOWN\0", 0x02, "latin1");
  header.write("1.3\0", 0x18, "latin1");
  header.writeUInt16LE(scrambledChecksum & 0xffff, 0x1e);
  header.writeUInt8(width, 0x2c);
  header.writeUInt8(height, 0x2d);
  header.writeUInt16LE(clues.length, 0x2e);
  header.writeUInt16LE(0x0001, 0x30); // unknown bitmask, a common real value
  header.writeUInt16LE(scrambledTag & 0xffff, 0x32);

  // CIB over the 8 bytes at 0x2C..0x33 (width, height, clue count, bitmask, scramble tag).
  const cib = cksum(header.subarray(0x2c, 0x34));
  header.writeUInt16LE(cib, 0x0e);

  // Global: CIB seed, then solution, player, then the text section.
  let global = cksum(solution, cib);
  global = cksum(player, global);
  global = textChecksum(global, title, author, copyright, clues, notepad);
  header.writeUInt16LE(global, 0x00);

  // Masked low/high: the four partials XOR the mask.
  const cSol = cksum(solution);
  const cGrid = cksum(player);
  const cText = textChecksum(0, title, author, copyright, clues, notepad);
  const partials = [cib, cSol, cGrid, cText];
  for (let i = 0; i < 4; i += 1) {
    header.writeUInt8((partials[i]! & 0xff) ^ MASK.charCodeAt(i), 0x10 + i);
    header.writeUInt8(
      ((partials[i]! >> 8) & 0xff) ^ MASK.charCodeAt(i + 4),
      0x14 + i,
    );
  }
  void cellCount;
  return Buffer.concat([header, solution, player, strings, extraBlock]);
}

/** Build the base64 envelope document for a spec. */
function buildPuz(spec: PuzSpec): string {
  return buildBytes(spec).toString("base64");
}

/** Copy the bytes, mutate one, return the new base64 (for byte-flip corruption fixtures). */
function corrupt(spec: PuzSpec, offset: number, value: number): string {
  const bytes = Buffer.from(buildBytes(spec));
  bytes[offset] = value;
  return bytes.toString("base64");
}

/** A GEXT markup grid: one byte per cell, 0x80 for a circled index, 0 otherwise. */
function gext(cellCount: number, circled: number[]): Buffer {
  const data = Buffer.alloc(cellCount, 0);
  for (const i of circled) data[i] = 0x80;
  return data;
}

/** A GRBS rebus grid (one byte per cell, `key + 1` where a rebus sits) and its RTBL table. */
function rebusSections(
  cellCount: number,
  entries: { cell: number; key: number; answer: string }[],
): { name: string; data: Buffer }[] {
  const grbs = Buffer.alloc(cellCount, 0);
  for (const e of entries) grbs[e.cell] = e.key + 1;
  const rtbl = entries
    .map((e) => `${String(e.key).padStart(2, " ")}:${e.answer};`)
    .join("");
  return [
    { name: "GRBS", data: grbs },
    { name: "RTBL", data: Buffer.from(rtbl, "latin1") },
  ];
}

// --- The reference fixture -----------------------------------------------------------------

// A 3x3 with a center block. Row-major solution: CAT / U#A / DOG.
//   across runs: 1=[0,1,2] CAT, 3=[6,7,8] DOG
//   down   runs: 1=[0,3,6] CUD, 2=[2,5,8] TAG
// Grid-derived numbering: cell 0 starts across(1) and down(1) -> number 1; cell 2 starts down(2);
// cell 6 starts across(3). Interleaved clue order (ascending number, across before down):
//   1-across, 1-down, 2-down, 3-across.
const GRID_3x3 = "CATU.ADOG";
const CLUES_3x3 = [
  "Feline (3)", // 1 across
  "Chewed morsel (3)", // 1 down
  "Label (3)", // 2 down
  "Canine (3)", // 3 across
];
const SOLVED = ["C", "A", "T", "U", null, "A", "D", "O", "G"];

function base3x3(overrides: Partial<PuzSpec> = {}): PuzSpec {
  return {
    width: 3,
    height: 3,
    grid: GRID_3x3,
    clues: [...CLUES_3x3],
    title: "Synthetic Puzzle",
    author: "Synthia Synthetic",
    copyright: "(c) 2026 Synthetic",
    ...overrides,
  };
}

/** Assert acceptance and narrow to the ok result. */
function accept(document: unknown) {
  const r = translatePuz(document);
  if (!r.ok) throw new Error(`expected accept, got ${r.code}: ${r.message}`);
  return r;
}

/** Assert exactly this rejection code; return the message for content checks. */
function expectReject(document: unknown, code: IngestErrorCode): string {
  const r = translatePuz(document);
  expect(r.ok ? "ACCEPTED" : r.code).toBe(code);
  return r.ok ? "" : r.message;
}

describe("puz translator: happy path (PROTOCOL.md section 12; DESIGN.md section 7)", () => {
  it("parses the header, grid, and solution from a byte-exact valid file", () => {
    const r = accept(buildPuz(base3x3()));
    expect(r.puzzle.rows).toBe(3);
    expect(r.puzzle.cols).toBe(3);
    expect(r.puzzle.blocks).toEqual([4]);
    expect(r.puzzle.solution).toEqual(SOLVED);
  });

  it("maps width to cols and height to rows on a non-square grid", () => {
    // 4 wide, 2 tall: SPAN / OKAY, no blocks.
    const r = accept(
      buildPuz({
        width: 4,
        height: 2,
        grid: "SPANOKAY",
        // across: 1=[0..3], 5=[4..7]; down: 1..4 each length 2. Interleaved: 1a,1d,2d,3d,4d,5a.
        clues: ["1a", "1d", "2d", "3d", "4d", "5a"],
      }),
    );
    expect(r.puzzle.rows).toBe(2);
    expect(r.puzzle.cols).toBe(4);
    expect(r.puzzle.solution).toEqual(["S", "P", "A", "N", "O", "K", "A", "Y"]);
  });

  it("derives numbering from the grid and deals the interleaved clue list across/down in order", () => {
    const r = accept(buildPuz(base3x3()));
    expect(r.puzzle.clues.across).toEqual([
      { number: 1, text: "Feline (3)", cellIndices: [0, 1, 2] },
      { number: 3, text: "Canine (3)", cellIndices: [6, 7, 8] },
    ]);
    expect(r.puzzle.clues.down).toEqual([
      { number: 1, text: "Chewed morsel (3)", cellIndices: [0, 3, 6] },
      { number: 2, text: "Label (3)", cellIndices: [2, 5, 8] },
    ]);
  });

  it("reads title and author, dropping copyright, as display metadata", () => {
    const r = accept(buildPuz(base3x3()));
    expect(r.title).toBe("Synthetic Puzzle");
    expect(r.author).toBe("Synthia Synthetic");
    // Empty metadata reads as null, never a rejection.
    const bare = accept(
      buildPuz(base3x3({ title: "", author: "", copyright: "" })),
    );
    expect(bare.title).toBeNull();
    expect(bare.author).toBeNull();
  });

  it("ignores the player-state grid entirely (DESIGN.md section 7)", () => {
    // Seat a fully SOLVED player grid (the checksums fold it, so the file stays valid). The
    // parser must still take its answer from the solution grid, not the player grid, and a
    // block cell must stay '.' in the player grid or the file is not well-formed.
    const r = accept(buildPuz(base3x3({ player: "CATU.ADOG" })));
    expect(r.puzzle.solution).toEqual(SOLVED);
    expect(r.puzzle.blocks).toEqual([4]);
  });
});

describe("puz translator: Latin-1 string decoding (never UTF-8)", () => {
  it("decodes high Latin-1 bytes as single characters, never UTF-8 multi-byte", () => {
    // 0xE9 is 'é' in Latin-1 (one byte). A UTF-8 reader would mis-decode or replace it. Placed in
    // the title (display metadata), which is not charset-validated, so it survives verbatim.
    const eAcute = String.fromCharCode(0xe9);
    const r = accept(buildPuz(base3x3({ title: `Caf${eAcute}` })));
    expect(r.title).toBe(`Caf${eAcute}`);
    expect(r.title!.length).toBe(4); // C a f é — four characters, not five UTF-8 bytes
  });

  it("decodes a Latin-1 clue byte as one character (0xA9 is the copyright sign)", () => {
    const copySign = String.fromCharCode(0xa9);
    const clues = [`${copySign} Feline (3)`, ...CLUES_3x3.slice(1)];
    const r = accept(buildPuz(base3x3({ clues })));
    expect(r.puzzle.clues.across[0]!.text).toBe(`${copySign} Feline (3)`);
  });
});

describe("puz translator: checksum verification (corrupt files reject cleanly, never crash)", () => {
  it("accepts a file whose four checksum groups all verify", () => {
    expect(accept(buildPuz(base3x3())).puzzle.blocks).toEqual([4]);
  });

  it("rejects a flipped solution-grid byte as VALIDATION (global + masked mismatch)", () => {
    // Offset 0x34 is the first solution cell; flip 'C' (0x43) to 'X' (0x58) without recomputing.
    const message = expectReject(corrupt(base3x3(), 0x34, 0x58), "VALIDATION");
    expect(message).toContain("checksum");
  });

  it("rejects a tampered CIB field as VALIDATION (the CIB checksum guard fires first)", () => {
    // Flip a byte of the stored CIB checksum at 0x0E.
    expectReject(corrupt(base3x3(), 0x0e, 0xff), "VALIDATION");
  });

  it("rejects a tampered global checksum as VALIDATION", () => {
    expectReject(corrupt(base3x3(), 0x00, 0xff), "VALIDATION");
  });

  it("rejects a tampered masked-low checksum as VALIDATION", () => {
    expectReject(corrupt(base3x3(), 0x10, 0xff), "VALIDATION");
  });

  it("rejects a clue-count that disagrees with the file's clue list as VALIDATION", () => {
    // Bump the stored clue count at 0x2E without adding a clue string. The CIB checksum folds
    // this field, so it fails the CIB verify: a clean VALIDATION, never a read past the strings.
    expectReject(corrupt(base3x3(), 0x2e, 0x09), "VALIDATION");
  });

  it("never echoes solution content in a checksum-rejection message (INV-6)", () => {
    // A valid 3x3 with a planted marker solution, then a corrupted grid byte.
    const marked = base3x3({
      grid: "MARK.WORS", // MAR / K#W / ORS around a center block (playable, enterable)
      clues: CLUES_3x3,
    });
    const message = expectReject(corrupt(marked, 0x35, 0x58), "VALIDATION");
    expect(message).not.toContain("MARK");
    expect(message).not.toContain("WORS");
  });
});

describe("puz translator: scrambled/locked puzzles reject (we never unscramble)", () => {
  it("rejects a set scramble tag (0x32) as VALIDATION with a named message", () => {
    const message = expectReject(
      buildPuz(base3x3({ scrambledTag: 0x0004 })),
      "VALIDATION",
    );
    expect(message).toContain("scrambled");
  });

  it("rejects a nonzero scrambled checksum (0x1E) as VALIDATION", () => {
    const message = expectReject(
      buildPuz(base3x3({ scrambledChecksum: 0x1234 })),
      "VALIDATION",
    );
    expect(message).toContain("scrambled");
  });

  it("rejects scrambled BEFORE the checksum verify (a locked file is a policy rejection)", () => {
    // The scramble tag is folded into the CIB checksum, so the builder's file is checksum-valid
    // yet still rejects for being scrambled: the message names scrambling, not corruption.
    const message = expectReject(
      buildPuz(base3x3({ scrambledTag: 0x0001 })),
      "VALIDATION",
    );
    expect(message).toContain("scrambled");
    expect(message).not.toContain("checksum");
  });

  it("never echoes solution content in the scrambled rejection (INV-6)", () => {
    const message = expectReject(
      buildPuz(base3x3({ grid: "MARK.WORS", scrambledTag: 1 })),
      "VALIDATION",
    );
    expect(message).not.toContain("MARK");
    expect(message).not.toContain("WORS");
  });
});

describe("puz translator: malformed and truncated files reject as distinct VALIDATIONs", () => {
  it("rejects a non-string document (the puz envelope document is base64, never an object)", () => {
    expectReject({ grid: [] }, "VALIDATION");
    expectReject(42, "VALIDATION");
    expectReject(null, "VALIDATION");
  });

  it("rejects a non-base64 string with a base64-named message", () => {
    const message = expectReject("not base64 !!!", "VALIDATION");
    expect(message).toContain("base64");
  });

  it("rejects a short buffer with no room for the header", () => {
    expectReject(Buffer.from("tiny").toString("base64"), "VALIDATION");
  });

  it("rejects a file with the wrong magic as not-a-puz-file", () => {
    // A full-length buffer that lacks the "ACROSS&DOWN" magic at 0x02.
    const bytes = Buffer.alloc(0x34 + 20, 0);
    bytes.write("WRONGMAGIC00", 0x02, "latin1");
    const message = expectReject(bytes.toString("base64"), "VALIDATION");
    expect(message).toContain("magic");
  });

  it("rejects a file truncated before its grids", () => {
    // A valid header but the buffer ends right after it, with no room for the two grids.
    const full = Buffer.from(buildBytes(base3x3()));
    const truncated = full.subarray(0, 0x34 + 5); // header + 5 of 18 grid bytes
    expectReject(truncated.toString("base64"), "VALIDATION");
  });

  it("rejects a file truncated in its clue list", () => {
    const full = Buffer.from(buildBytes(base3x3()));
    // Cut inside the string block: keep the header, grids, and the first metadata string only.
    const cut = 0x34 + 18 + 5;
    expectReject(full.subarray(0, cut).toString("base64"), "VALIDATION");
  });

  it("rejects a zero-dimension header as VALIDATION before any grid math", () => {
    // A width of 0. The builder makes it checksum-valid, so the zero-dimension guard is what fires.
    const message = expectReject(
      buildPuz({ width: 0, height: 3, grid: "", clues: [] }),
      "VALIDATION",
    );
    expect(message).toContain("zero dimension");
  });
});

describe("puz translator: shared domain checks apply identically (PROTOCOL.md section 12)", () => {
  it("rejects an oversize grid as OVERSIZE_GRID before any per-cell work", () => {
    // 26 wide is over the 25x25 cap. A 26x1 all-letters grid, one across clue.
    const wide = "A".repeat(26);
    expectReject(
      buildPuz({ width: 26, height: 1, grid: wide, clues: ["1a"] }),
      "OVERSIZE_GRID",
    );
    expectReject(
      buildPuz({
        width: 1,
        height: 26,
        grid: "A".repeat(26),
        clues: ["1d"],
      }),
      "OVERSIZE_GRID",
    );
  });

  it("rejects an all-block grid as DEGENERATE_GRID (zero playable cells)", () => {
    expectReject(
      buildPuz({ width: 2, height: 2, grid: "....", clues: [] }),
      "DEGENERATE_GRID",
    );
  });

  it("rejects a '-' empty cell as UNSOLVABLE_CELL (a missing answer has no enterable first char)", () => {
    // A 3x3 where one playable cell carries '-' (the outlet served no answer for it). The grid
    // shape is otherwise the CAT/DOG grid.
    expectReject(buildPuz(base3x3({ grid: "-ATU.ADOG" })), "UNSOLVABLE_CELL");
  });

  it("rejects a whole-symbol rebus cell as UNSOLVABLE_CELL (D12 first-character rule)", () => {
    // GRBS/RTBL put a '/' answer at cell 0: no A-Z0-9 first character, so no legal input.
    const extras = rebusSections(9, [{ cell: 0, key: 0, answer: "/" }]);
    expectReject(buildPuz(base3x3({ extras })), "UNSOLVABLE_CELL");
  });
});

describe("puz translator: clue-count vs grid word runs", () => {
  it("rejects a clue count that does not match the grid's word runs as VALIDATION", () => {
    // The 3x3 has four word runs (2 across + 2 down). A file that self-consistently declares only
    // three clues (the header count folds into CIB, so it stays checksum-valid) reaches the
    // run-mismatch check and rejects there.
    expectReject(
      buildPuz(base3x3({ clues: CLUES_3x3.slice(0, 3) })),
      "VALIDATION",
    );
  });
});

describe("puz translator: GEXT circles (DESIGN.md section 7)", () => {
  it("maps GEXT 0x80 cells to the circles field and sets the feature flag", () => {
    const extras = [{ name: "GEXT", data: gext(9, [0, 8]) }];
    const r = accept(buildPuz(base3x3({ extras })));
    expect(r.puzzle.circles).toEqual([0, 8]);
    expect(r.features.circles).toBe(true);
    expect(r.features.shadedCircles).toBe(false);
  });

  it("leaves circles empty and the flag false with no GEXT section", () => {
    const r = accept(buildPuz(base3x3()));
    expect(r.puzzle.circles).toEqual([]);
    expect(r.features.circles).toBe(false);
  });

  it("rejects a GEXT grid whose size does not match the puzzle as VALIDATION", () => {
    const extras = [{ name: "GEXT", data: gext(8, [0]) }]; // 8 bytes for a 9-cell grid
    expectReject(buildPuz(base3x3({ extras })), "VALIDATION");
  });

  it("rejects a GEXT section with a wrong stored checksum as VALIDATION (corrupt section)", () => {
    // Build a valid file, then corrupt the GEXT data checksum in place.
    const extras = [{ name: "GEXT", data: gext(9, [0]) }];
    const bytes = Buffer.from(buildBytes(base3x3({ extras })));
    // The GEXT section begins after header + 2 grids + strings; find its name and bump the
    // checksum two bytes past the length field.
    const gextAt = bytes.indexOf(Buffer.from("GEXT", "latin1"));
    expect(gextAt).toBeGreaterThan(0);
    bytes[gextAt + 6] = bytes[gextAt + 6]! ^ 0xff; // flip the stored section checksum
    expectReject(bytes.toString("base64"), "VALIDATION");
  });
});

describe("puz translator: GRBS/RTBL rebus is ACCEPTED as multi-character cells (D12), not flattened", () => {
  it("resolves a GRBS reference through RTBL into the full multi-character answer", () => {
    // Put a rebus "CAT" answer at cell 0 (the down word CUD becomes a rebus head). The across
    // clue and the grid letter stay 'C'; the rebus makes the cell's full answer "CAT".
    const extras = rebusSections(9, [{ cell: 0, key: 5, answer: "CAT" }]);
    const r = accept(buildPuz(base3x3({ extras })));
    expect(r.puzzle.solution[0]).toBe("CAT");
    expect(r.features.rebus).toBe(true);
    // The other cells keep their single-letter answers.
    expect(r.puzzle.solution[1]).toBe("A");
  });

  it("accepts a rebus answer at the 10-character cap and rejects one over it (REBUS_TOO_LONG)", () => {
    const ok = rebusSections(9, [{ cell: 0, key: 0, answer: "ABCDEFGHIJ" }]); // 10
    expect(accept(buildPuz(base3x3({ extras: ok }))).features.rebus).toBe(true);
    const over = rebusSections(9, [{ cell: 0, key: 0, answer: "ABCDEFGHIJK" }]); // 11
    expectReject(buildPuz(base3x3({ extras: over })), "REBUS_TOO_LONG");
  });

  it("never echoes the rebus answer in the REBUS_TOO_LONG message (INV-6)", () => {
    const over = rebusSections(9, [
      { cell: 0, key: 0, answer: "MARKERWORDX" }, // 11 chars, over the cap
    ]);
    const message = expectReject(
      buildPuz(base3x3({ extras: over })),
      "REBUS_TOO_LONG",
    );
    expect(message).not.toContain("MARKERWORD");
  });

  it("rejects a GRBS reference to an RTBL key the table does not define as VALIDATION", () => {
    // GRBS marks cell 0 as rebus key 5 (stored 6) but RTBL only defines key 0.
    const grbs = Buffer.alloc(9, 0);
    grbs[0] = 6; // key 5 + 1
    const rtbl = Buffer.from(" 0:CAT;", "latin1");
    const extras = [
      { name: "GRBS", data: grbs },
      { name: "RTBL", data: rtbl },
    ];
    expectReject(buildPuz(base3x3({ extras })), "VALIDATION");
  });

  it("rejects a GRBS grid with no RTBL table as VALIDATION", () => {
    const grbs = Buffer.alloc(9, 0);
    grbs[0] = 1;
    const extras = [{ name: "GRBS", data: grbs }];
    expectReject(buildPuz(base3x3({ extras })), "VALIDATION");
  });

  it("rejects a malformed RTBL entry (no colon) as VALIDATION", () => {
    const grbs = Buffer.alloc(9, 0);
    grbs[0] = 1;
    const extras = [
      { name: "GRBS", data: grbs },
      { name: "RTBL", data: Buffer.from(" 0 CAT;", "latin1") }, // missing colon
    ];
    expectReject(buildPuz(base3x3({ extras })), "VALIDATION");
  });
});

describe("puz translator: INV-1 (ASCII-only casing)", () => {
  it("ASCII-uppercases lowercase solution letters, never locale-aware (INV-1)", () => {
    const r = accept(buildPuz(base3x3({ grid: "catu.adog" })));
    expect(r.puzzle.solution).toEqual(SOLVED);
  });

  it("rejects a non-ASCII solution letter as UNSOLVABLE_CELL, not locale-folded (INV-1)", () => {
    // 0xE9 is 'é' in Latin-1: it has no ASCII-uppercase form, so it fails enterability.
    const eAcute = String.fromCharCode(0xe9);
    expectReject(
      buildPuz(base3x3({ grid: `${eAcute}ATU.ADOG` })),
      "UNSOLVABLE_CELL",
    );
  });
});

describe("puz translator: LTIM and unknown extra sections are ignored", () => {
  it("ignores an LTIM timer section and any unknown section, still accepting", () => {
    const extras = [
      { name: "LTIM", data: Buffer.from("42,1", "latin1") },
      { name: "XXXX", data: Buffer.from([1, 2, 3]) },
      { name: "GEXT", data: gext(9, [0]) },
    ];
    const r = accept(buildPuz(base3x3({ extras })));
    expect(r.puzzle.solution).toEqual(SOLVED);
    expect(r.puzzle.circles).toEqual([0]);
  });
});
