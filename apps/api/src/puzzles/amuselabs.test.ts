/**
 * AmuseLabs (PuzzleMe) translator unit vectors (PROTOCOL.md section 12; DESIGN.md section 7,
 * D21; ROADMAP 6.1 x3). `translateAmuseLabs` is pure, so these run with no infrastructure. They
 * pin the server-side blob decode (plain base64 and the embedded-key scramble, xword-dl's cases
 * 1 and 2; the keyless case 3 is a named VALIDATION), the column-major box orientation
 * (box[col][row], reference-pinned), grid-derived numbering, the SOLUTION_MISSING contract for
 * empty cells, and that the shared domain checks apply identically to this format. They also
 * pin the second document form (PROTOCOL.md section 12): the page's own decoded puzzle object,
 * captured in the frame, enters the same validation with no decode step and exactly the same
 * strictness.
 *
 * Every fixture is SYNTHETIC (DESIGN.md section 7 firm rule): hand-written documents in the
 * PuzzleMe shape, encoded here in the test itself, never real AmuseLabs puzzle content. The
 * shape and the encoding variants are pinned from thisisparker/xword-dl (MIT), the parsing
 * reference.
 *
 * Test names cite the invariant they defend so coverage is greppable.
 */
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { translateAmuseLabs } from "./amuselabs";
import type { IngestErrorCode } from "./ingest";

/** A block cell in the PuzzleMe box (the reference's marker). */
const BLOCK = "\u0000";

/** One synthetic placed word; `word`, `nBoxes`, and `clueNum` are sabotage bait, never read. */
function pw(
  clue: string,
  acrossNotDown: boolean,
  x: number,
  y: number,
): Record<string, unknown> {
  return {
    clue: { clue },
    acrossNotDown,
    x,
    y,
    word: "UNREAD",
    nBoxes: 99,
    clueNum: 99,
  };
}

/**
 * A synthetic 3x3 with a center block, as decoded JSON. Row-major grid: CAT / U#A / DOG.
 * The box is COLUMN-MAJOR (box[col][row]), so its columns read CUD / A#O / TAG; a row-major
 * misread would produce different letters, which pins the orientation.
 */
function doc(): Record<string, unknown> {
  return {
    title: "Synthetic PuzzleMe No 1",
    author: "Synthia",
    w: 3,
    h: 3,
    box: [
      ["C", "U", "D"],
      ["A", BLOCK, "O"],
      ["T", "A", "G"],
    ],
    placedWords: [
      pw("Feline (3)", true, 0, 0),
      pw("Chewed morsel (3)", false, 0, 0),
      pw("Label (3)", false, 2, 0),
      pw("Canine (3)", true, 0, 2),
    ],
  };
}

/** Encode as the plain variant: standard base64 of UTF-8 JSON (xword-dl case 1). */
function encodePlain(document: unknown): string {
  return Buffer.from(JSON.stringify(document), "utf8").toString("base64");
}

/**
 * Encode as the embedded-key variant (xword-dl case 2). `keyHex` is the key in APPLICATION
 * order: each hex digit + 2 is a chunk length. The blob's tail carries the key reversed, and
 * chunk reversal is an involution, so scrambling walks the same chunks the decoder will.
 */
function encodeScrambled(document: unknown, keyHex: string): string {
  const chars = encodePlain(document).split("");
  const key = keyHex.split("").map((c) => Number.parseInt(c, 16) + 2);
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
  return `${chars.join("")}.${keyHex.split("").reverse().join("")}`;
}

/** Assert acceptance and narrow to the ok result. */
function accept(body: unknown) {
  const r = translateAmuseLabs(body);
  if (!r.ok) throw new Error(`expected accept, got ${r.code}: ${r.message}`);
  return r;
}

/** Assert exactly this rejection code; return the message for content checks. */
function expectReject(body: unknown, code: IngestErrorCode): string {
  const r = translateAmuseLabs(body);
  expect(r.ok ? "ACCEPTED" : r.code).toBe(code);
  return r.ok ? "" : r.message;
}

const SOLVED = ["C", "A", "T", "U", null, "A", "D", "O", "G"];

describe("amuselabs translator: happy path (PROTOCOL.md section 12; DESIGN.md section 7)", () => {
  it("decodes a plain base64 blob and reads box column-major (box[col][row], xword-dl reference)", () => {
    const r = accept(encodePlain(doc()));
    expect(r.puzzle.rows).toBe(3);
    expect(r.puzzle.cols).toBe(3);
    expect(r.puzzle.blocks).toEqual([4]);
    expect(r.puzzle.solution).toEqual(SOLVED);
  });

  it("maps w to cols and h to rows on a non-square grid (column-major box)", () => {
    // w=3, h=2, all playable. Columns CA / AB / TE give rows CAT / ABE.
    const r = accept(
      encodePlain({
        w: 3,
        h: 2,
        box: [
          ["C", "A"],
          ["A", "B"],
          ["T", "E"],
        ],
        placedWords: [
          pw("Feline (3)", true, 0, 0),
          pw("Honest one (3)", true, 0, 1),
          pw("First two (2)", false, 0, 0),
          pw("Middle pair (2)", false, 1, 0),
          pw("Last two (2)", false, 2, 0),
        ],
      }),
    );
    expect(r.puzzle.rows).toBe(2);
    expect(r.puzzle.cols).toBe(3);
    expect(r.puzzle.solution).toEqual(["C", "A", "T", "A", "B", "E"]);
  });

  it("derives clue numbering from the grid, never from clueNum or entry order", () => {
    const d = doc();
    // Shuffle the placed words; clueNum is already sabotaged to 99 in every entry.
    (d["placedWords"] as unknown[]).reverse();
    const r = accept(encodePlain(d));
    expect(r.puzzle.clues.across).toEqual([
      { number: 1, text: "Feline (3)", cellIndices: [0, 1, 2] },
      { number: 3, text: "Canine (3)", cellIndices: [6, 7, 8] },
    ]);
    expect(r.puzzle.clues.down).toEqual([
      { number: 1, text: "Chewed morsel (3)", cellIndices: [0, 3, 6] },
      { number: 2, text: "Label (3)", cellIndices: [2, 5, 8] },
    ]);
  });

  it("decodes HTML entities in clue text, like the xwordinfo boundary (DESIGN.md section 7)", () => {
    const d = doc();
    (d["placedWords"] as Record<string, unknown>[])[0] = pw(
      "Rock &amp; roll cat (3)",
      true,
      0,
      0,
    );
    const r = accept(encodePlain(d));
    expect(r.puzzle.clues.across[0]?.text).toBe("Rock & roll cat (3)");
  });

  it("reads title and author via readMetadata semantics (decoded, trimmed, absent reads null)", () => {
    const d = doc();
    d["title"] = "  A &amp; B  ";
    delete d["author"];
    const r = accept(encodePlain(d));
    expect(r.title).toBe("A & B");
    expect(r.author).toBeNull();
    const base = accept(encodePlain(doc()));
    expect(base.title).toBe("Synthetic PuzzleMe No 1");
    expect(base.author).toBe("Synthia");
  });

  it("accepts a multi-character box cell as a rebus under the shared cap", () => {
    const d = doc();
    (d["box"] as string[][])[0]![0] = "CAB";
    const r = accept(encodePlain(d));
    expect(r.puzzle.solution[0]).toBe("CAB");
    expect(r.features.rebus).toBe(true);
  });

  it("reads circled cells from cellInfos (isCircled with in-grid x, y)", () => {
    const d = doc();
    d["cellInfos"] = [
      { x: 2, y: 0, isCircled: true },
      { x: 0, y: 0, isCircled: false },
      { x: 0, y: 2 }, // no flag reads as not circled
    ];
    const r = accept(encodePlain(d));
    expect(r.puzzle.circles).toEqual([2]);
    expect(r.features.circles).toBe(true);
    // Absent cellInfos reads as no circles, and shading is not modeled for this format.
    const base = accept(encodePlain(doc()));
    expect(base.puzzle.circles).toEqual([]);
    expect(base.features).toEqual({
      rebus: false,
      circles: false,
      shadedCircles: false,
    });
  });

  it("ignores word, nBoxes, clueNum, and unknown fields (box is the only solution source)", () => {
    // Every placed word carries word: "UNREAD" and nBoxes/clueNum sabotage already; add
    // top-level noise the reference also ignores.
    const r = accept(
      encodePlain({ ...doc(), publishTime: 1700000000000, extra: true }),
    );
    expect(r.puzzle.solution).toEqual(SOLVED);
  });
});

describe("amuselabs translator: decode variants (xword-dl reference)", () => {
  it("decodes the embedded-key scrambled variant identically to the plain variant (case 2)", () => {
    const plain = accept(encodePlain(doc()));
    const scrambled = accept(encodeScrambled(doc(), "13a"));
    expect(scrambled.puzzle).toEqual(plain.puzzle);
    expect(scrambled.title).toBe(plain.title);
  });

  it("decodes a single-digit key and a key with hex letters (case 2 key shapes)", () => {
    const plain = accept(encodePlain(doc()));
    for (const keyHex of ["0", "f", "af37", "0123456789abcdef"]) {
      expect(accept(encodeScrambled(doc(), keyHex)).puzzle).toEqual(
        plain.puzzle,
      );
    }
  });

  it("clamps the final chunk when the key overruns the blob tail (case 2 min rule)", () => {
    // A large chunk digit forces min(chunk, remaining) on the last segment.
    const plain = accept(encodePlain(doc()));
    expect(accept(encodeScrambled(doc(), "ff")).puzzle).toEqual(plain.puzzle);
  });
});

describe("amuselabs translator: undecodable blobs are VALIDATION, never heuristics (D21)", () => {
  it("rejects a non-base64 blob as VALIDATION without echoing the blob (INV-6)", () => {
    const blob = "!!!MARKERWORD-not-base64!!!";
    const message = expectReject(blob, "VALIDATION");
    expect(message).not.toContain("MARKERWORD");
  });

  it("rejects a keyless-scrambled blob (base64 but not JSON) as a named VALIDATION (case 3)", () => {
    // Valid base64 whose payload is not JSON: indistinguishable from xword-dl's case 3, whose
    // key lives outside the document. Named rejection, never a brute-force search.
    const blob = Buffer.from("MARKERWORD scrambled payload", "utf8").toString(
      "base64",
    );
    const message = expectReject(blob, "VALIDATION");
    expect(message).toContain("keyless");
    expect(message).not.toContain("MARKERWORD");
  });

  it("rejects a dotted blob whose key tail is not hexadecimal as VALIDATION", () => {
    expectReject(`${encodePlain(doc())}.notahexkey`, "VALIDATION");
    expectReject(`${encodePlain(doc())}.`, "VALIDATION");
    expectReject(".13a", "VALIDATION");
  });

  it("rejects a dotted blob that unscrambles to garbage as VALIDATION (INV-6, no echo)", () => {
    // A correct plain encoding with a key tail appended: unscrambling mangles it.
    const message = expectReject(`${encodePlain(doc())}.13a`, "VALIDATION");
    expect(message).not.toContain("Synthia");
  });

  it("rejects a blob decoding to a JSON scalar or array as VALIDATION (document object rule)", () => {
    expectReject(encodePlain(42), "VALIDATION");
    expectReject(encodePlain([doc()]), "VALIDATION");
    expectReject(encodePlain(null), "VALIDATION");
  });
});

describe("amuselabs translator: the decoded-object form (PROTOCOL.md section 12; D21)", () => {
  it("accepts the page's decoded puzzle object and matches the equivalent encoded blob exactly", () => {
    const fromObject = accept(doc());
    const fromBlob = accept(encodePlain(doc()));
    expect(fromObject.puzzle).toEqual(fromBlob.puzzle);
    expect(fromObject.features).toEqual(fromBlob.features);
    expect(fromObject.title).toBe(fromBlob.title);
    expect(fromObject.author).toBe(fromBlob.author);
  });

  it("rejects an object form missing its box as VALIDATION (same strictness as a decoded blob)", () => {
    const d = doc();
    delete d["box"];
    expectReject(d, "VALIDATION");
  });

  it("rejects object-form malformed placedWords with the blob path's codes", () => {
    expectReject({ ...doc(), placedWords: "none" }, "VALIDATION");
    const d = doc();
    (d["placedWords"] as Record<string, unknown>[])[0] = { x: 0 };
    expectReject(d, "VALIDATION");
  });

  it("rejects an object form whose box does not match w and h as VALIDATION", () => {
    expectReject({ ...doc(), w: 4 }, "VALIDATION");
    const d = doc();
    (d["box"] as string[][])[0] = ["C", "U"];
    expectReject(d, "VALIDATION");
  });

  it("runs the shared domain checks on the object form (OVERSIZE_GRID, SOLUTION_MISSING)", () => {
    expectReject({ ...doc(), w: 26 }, "OVERSIZE_GRID");
    const d = doc();
    (d["box"] as string[][])[0]![0] = "";
    expectReject(d, "SOLUTION_MISSING");
  });

  it("rejects a document that is neither a string nor an object as one stable, content-free VALIDATION (INV-6)", () => {
    const messages = [42, null, true, undefined, [doc()]].map((body) =>
      expectReject(body, "VALIDATION"),
    );
    expect(new Set(messages).size).toBe(1);
  });
});

describe("amuselabs translator: SOLUTION_MISSING (PROTOCOL.md section 12, D11)", () => {
  it("rejects an empty playable cell as SOLUTION_MISSING (the outlet served no answers)", () => {
    const d = doc();
    (d["box"] as string[][])[0]![0] = "";
    expectReject(encodePlain(d), "SOLUTION_MISSING");
  });

  it("rejects an all-empty box as SOLUTION_MISSING, not DEGENERATE (blocks are NUL, not empty)", () => {
    const d = doc();
    d["box"] = [
      ["", "", ""],
      ["", BLOCK, ""],
      ["", "", ""],
    ];
    expectReject(encodePlain(d), "SOLUTION_MISSING");
  });

  it("never echoes decoded answers or metadata in the SOLUTION_MISSING message (INV-6)", () => {
    const d = doc();
    d["title"] = "MARKERTITLE";
    (d["box"] as string[][])[0]![0] = "";
    const message = expectReject(encodePlain(d), "SOLUTION_MISSING");
    expect(message).not.toContain("CAT");
    expect(message).not.toContain("TAG");
    expect(message).not.toContain("MARKERTITLE");
  });
});

describe("amuselabs translator: malformed structure rejects as VALIDATION", () => {
  it("rejects missing or non-positive w and h", () => {
    expectReject(encodePlain({ ...doc(), w: undefined }), "VALIDATION");
    expectReject(encodePlain({ ...doc(), w: 0 }), "VALIDATION");
    expectReject(encodePlain({ ...doc(), h: "3" }), "VALIDATION");
  });

  it("rejects a box that is not w columns of h strings (column-major shape)", () => {
    expectReject(encodePlain({ ...doc(), box: "CATUADOG" }), "VALIDATION");
    // Two columns for w=3.
    expectReject(
      encodePlain({
        ...doc(),
        box: [
          ["C", "U", "D"],
          ["A", BLOCK, "O"],
        ],
      }),
      "VALIDATION",
    );
    // A column of the wrong height.
    expectReject(
      encodePlain({
        ...doc(),
        box: [
          ["C", "U"],
          ["A", BLOCK, "O"],
          ["T", "A", "G"],
        ],
      }),
      "VALIDATION",
    );
    // A non-string cell.
    expectReject(
      encodePlain({
        ...doc(),
        box: [
          ["C", "U", "D"],
          ["A", 0, "O"],
          ["T", "A", "G"],
        ],
      }),
      "VALIDATION",
    );
  });

  it("rejects malformed placed words: bad position, bad direction flag, missing clue", () => {
    const withWord = (patch: Record<string, unknown>) => {
      const d = doc();
      const words = d["placedWords"] as Record<string, unknown>[];
      words[0] = { ...words[0], ...patch };
      return encodePlain(d);
    };
    expectReject({ ...doc(), placedWords: "none" }, "VALIDATION");
    expectReject(withWord({ x: 3 }), "VALIDATION");
    expectReject(withWord({ y: -1 }), "VALIDATION");
    expectReject(withWord({ x: "0" }), "VALIDATION");
    expectReject(withWord({ acrossNotDown: "across" }), "VALIDATION");
    expectReject(withWord({ clue: "Feline (3)" }), "VALIDATION");
    expectReject(withWord({ clue: { clue: 7 } }), "VALIDATION");
  });

  it("rejects malformed cellInfos: non-array, non-object entry, circled cell out of grid", () => {
    expectReject(encodePlain({ ...doc(), cellInfos: {} }), "VALIDATION");
    expectReject(encodePlain({ ...doc(), cellInfos: [7] }), "VALIDATION");
    expectReject(
      encodePlain({ ...doc(), cellInfos: [{ isCircled: true, x: 3, y: 0 }] }),
      "VALIDATION",
    );
    expectReject(
      encodePlain({ ...doc(), cellInfos: [{ isCircled: true }] }),
      "VALIDATION",
    );
  });

  it("rejects two placed words claiming one slot as AMBIGUOUS_SOLUTION", () => {
    const d = doc();
    (d["placedWords"] as unknown[]).push(pw("Also feline (3)", true, 0, 0));
    expectReject(encodePlain(d), "AMBIGUOUS_SOLUTION");
  });

  it("rejects placed words that do not match the grid-derived word runs (count)", () => {
    const d = doc();
    (d["placedWords"] as unknown[]).pop();
    expectReject(encodePlain(d), "VALIDATION");
  });

  it("rejects a placed word starting mid-run (no run starts there)", () => {
    const d = doc();
    const words = d["placedWords"] as Record<string, unknown>[];
    // Move 3-across's start off its run head; counts still match, the slot lookup fails.
    words[3] = pw("Canine (3)", true, 1, 2);
    expectReject(encodePlain(d), "VALIDATION");
  });
});

describe("amuselabs translator: shared domain checks apply identically (PROTOCOL.md section 12)", () => {
  it("rejects an oversize grid as OVERSIZE_GRID before any per-cell work", () => {
    expectReject(encodePlain({ ...doc(), w: 26 }), "OVERSIZE_GRID");
    expectReject(encodePlain({ ...doc(), h: 26 }), "OVERSIZE_GRID");
  });

  it("rejects an all-block box as DEGENERATE_GRID (zero playable cells)", () => {
    const column = [BLOCK, BLOCK, BLOCK];
    expectReject(
      encodePlain({
        ...doc(),
        box: [column, column, column],
        placedWords: [],
      }),
      "DEGENERATE_GRID",
    );
  });

  it("rejects an over-cap rebus cell as REBUS_TOO_LONG without echoing it (INV-6)", () => {
    const d = doc();
    (d["box"] as string[][])[0]![0] = "MARKERWORDX"; // 11 characters, over the cap of 10
    const message = expectReject(encodePlain(d), "REBUS_TOO_LONG");
    expect(message).not.toContain("MARKERWORD");
  });

  it("rejects a whole-symbol cell as UNSOLVABLE_CELL (D12 first-character rule)", () => {
    const d = doc();
    (d["box"] as string[][])[0]![0] = "/";
    expectReject(encodePlain(d), "UNSOLVABLE_CELL");
  });
});

describe("amuselabs translator: INV-1 (ASCII-only casing)", () => {
  it("ASCII-uppercases lowercase box cells, never locale-aware (INV-1)", () => {
    const d = doc();
    d["box"] = [
      ["c", "u", "d"],
      ["a", BLOCK, "o"],
      ["t", "a", "g"],
    ];
    expect(accept(encodePlain(d)).puzzle.solution).toEqual(SOLVED);
  });

  it("rejects a non-ASCII letter as UNSOLVABLE_CELL, not locale-folded (INV-1, shared check)", () => {
    const d = doc();
    (d["box"] as string[][])[0]![0] = "é"; // e-acute: no ASCII uppercase form
    expectReject(encodePlain(d), "UNSOLVABLE_CELL");
  });
});
