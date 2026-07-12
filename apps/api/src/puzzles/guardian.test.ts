/**
 * Guardian translator unit vectors (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP
 * 6.1 x2). `translateGuardian` is pure, so these run with no infrastructure. They pin the
 * Guardian JSON -> ServerPuzzle translation: the entry-derived grid (uncovered cells are
 * blocks), grid-derived numbering, grouped entries, the SOLUTION_MISSING contract, the
 * conflicting-overlap rejection, and that the shared domain checks apply identically to this
 * format (OVERSIZE_GRID, DEGENERATE_GRID, UNSOLVABLE_CELL).
 *
 * Every fixture is SYNTHETIC (DESIGN.md section 7 firm rule): hand-written documents in the
 * Guardian shape, never real Guardian puzzle content. The shape they mimic was confirmed
 * against live pages: 0-based `position` (x = column, y = row), `group` listing the head entry
 * first, continuation entries carrying their own `solution`.
 *
 * Test names cite the invariant they defend so coverage is greppable.
 */
import { describe, expect, it } from "vitest";
import { translateGuardian } from "./guardian";
import type { IngestErrorCode } from "./ingest";

/** One synthetic Guardian entry; spread overrides onto it per case. */
function entry(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    separatorLocations: {},
    ...overrides,
  };
}

/**
 * A synthetic 3x3 quick with a center block. Across: CAT (row 0), DOG (row 2); down: CUD
 * (col 0), TAG (col 2). Derived numbering: 1 at cell 0 (across + down), 2 at cell 2 (down),
 * 3 at cell 6 (across).
 */
function base(): Record<string, unknown> {
  return {
    id: "crosswords/quick/1",
    number: 1,
    name: "Synthetic quick No 1",
    date: 1700000000000,
    crosswordType: "quick",
    dimensions: { cols: 3, rows: 3 },
    solutionAvailable: true,
    entries: [
      entry({
        id: "1-across",
        number: 1,
        humanNumber: "1",
        clue: "Feline (3)",
        direction: "across",
        length: 3,
        group: ["1-across"],
        position: { x: 0, y: 0 },
        solution: "CAT",
      }),
      entry({
        id: "1-down",
        number: 1,
        humanNumber: "1",
        clue: "Chewed morsel (3)",
        direction: "down",
        length: 3,
        group: ["1-down"],
        position: { x: 0, y: 0 },
        solution: "CUD",
      }),
      entry({
        id: "2-down",
        number: 2,
        humanNumber: "2",
        clue: "Label (3)",
        direction: "down",
        length: 3,
        group: ["2-down"],
        position: { x: 2, y: 0 },
        solution: "TAG",
      }),
      entry({
        id: "3-across",
        number: 3,
        humanNumber: "3",
        clue: "Canine (3)",
        direction: "across",
        length: 3,
        group: ["3-across"],
        position: { x: 0, y: 2 },
        solution: "DOG",
      }),
    ],
  };
}

/** `base()` with the two across entries linked: 1-across is the head, 3-across continues it. */
function grouped(): Record<string, unknown> {
  const doc = base();
  const entries = doc["entries"] as Record<string, unknown>[];
  entries[0] = {
    ...entries[0],
    clue: "Feline, then canine (3,3)",
    group: ["1-across", "3-across"],
  };
  entries[3] = {
    ...entries[3],
    clue: "See 1",
    group: ["1-across", "3-across"],
  };
  return doc;
}

/** Assert acceptance and narrow to the ok result. */
function accept(body: unknown) {
  const r = translateGuardian(body);
  if (!r.ok) throw new Error(`expected accept, got ${r.code}: ${r.message}`);
  return r;
}

/** Assert exactly this rejection code; return the message for content checks. */
function expectReject(body: unknown, code: IngestErrorCode): string {
  const r = translateGuardian(body);
  expect(r.ok ? "ACCEPTED" : r.code).toBe(code);
  return r.ok ? "" : r.message;
}

describe("guardian translator: happy path (PROTOCOL.md section 12; DESIGN.md section 7)", () => {
  it("derives the grid from entries: covered cells playable, uncovered cells blocks", () => {
    const r = accept(base());
    expect(r.puzzle.rows).toBe(3);
    expect(r.puzzle.cols).toBe(3);
    expect(r.puzzle.blocks).toEqual([4]);
    expect(r.puzzle.solution).toEqual([
      "C",
      "A",
      "T",
      "U",
      null,
      "A",
      "D",
      "O",
      "G",
    ]);
  });

  it("derives clue numbering from grid positions, never from document numbers", () => {
    const doc = base();
    // Sabotage every document number; the derived numbering must not change.
    for (const e of doc["entries"] as Record<string, unknown>[]) {
      e["number"] = 99;
    }
    const r = accept(doc);
    expect(r.puzzle.clues.across).toEqual([
      { number: 1, text: "Feline (3)", cellIndices: [0, 1, 2] },
      { number: 3, text: "Canine (3)", cellIndices: [6, 7, 8] },
    ]);
    expect(r.puzzle.clues.down).toEqual([
      { number: 1, text: "Chewed morsel (3)", cellIndices: [0, 3, 6] },
      { number: 2, text: "Label (3)", cellIndices: [2, 5, 8] },
    ]);
  });

  it("reads title from name and author from creator.name as display metadata", () => {
    const r = accept({
      ...base(),
      creator: { name: "Synthia", webUrl: "https://example.test/synthia" },
    });
    expect(r.title).toBe("Synthetic quick No 1");
    expect(r.author).toBe("Synthia");
    // A quick with no creator (the shape live quicks ship) reads author as null.
    expect(accept(base()).author).toBeNull();
  });

  it("detects no rebus, circles, or shading: Guardian cells are single letters", () => {
    const r = accept(base());
    expect(r.features).toEqual({
      rebus: false,
      circles: false,
      shadedCircles: false,
    });
    expect(r.puzzle.circles).toEqual([]);
    expect(r.puzzle.shadedCircles).toBeUndefined();
  });

  it("decodes HTML entities in clue text, like the xwordinfo boundary (DESIGN.md section 7)", () => {
    const doc = base();
    (doc["entries"] as Record<string, unknown>[])[0]!["clue"] =
      "Rock &amp; roll cat (3)";
    const r = accept(doc);
    expect(r.puzzle.clues.across[0]?.text).toBe("Rock & roll cat (3)");
  });

  it("strips HTML tags from clue text through the shared seam (DESIGN.md section 7, D13)", () => {
    const doc = base();
    (doc["entries"] as Record<string, unknown>[])[0]!["clue"] =
      "<i>Rock</i> &amp; roll<br>cat (3)";
    const r = accept(doc);
    // Tags removed, <br> to a space, entity decoded after the strip.
    expect(r.puzzle.clues.across[0]?.text).toBe("Rock & roll cat (3)");
  });

  it("ignores unknown fields and separatorLocations (display-only in the outlet)", () => {
    const doc = base();
    (doc["entries"] as Record<string, unknown>[])[0]!["separatorLocations"] = {
      ",": [1],
    };
    accept({ ...doc, pdf: "https://example.test/x.pdf", extra: true });
  });
});

describe("guardian translator: INV-1 (ASCII-only casing)", () => {
  it("ASCII-uppercases lowercase solutions, never locale-aware (INV-1)", () => {
    const doc = base();
    for (const e of doc["entries"] as Record<string, unknown>[]) {
      e["solution"] = (e["solution"] as string).toLowerCase();
    }
    const r = accept(doc);
    expect(r.puzzle.solution).toEqual([
      "C",
      "A",
      "T",
      "U",
      null,
      "A",
      "D",
      "O",
      "G",
    ]);
  });

  it("agrees overlaps after ASCII-uppercasing, so casing never manufactures a conflict (INV-1)", () => {
    const doc = base();
    const entries = doc["entries"] as Record<string, unknown>[];
    entries[0]!["solution"] = "cat";
    entries[1]!["solution"] = "CUD";
    accept(doc);
  });

  it("rejects a non-ASCII letter as UNSOLVABLE_CELL, not locale-folded (INV-1, shared check)", () => {
    const doc = base();
    const entries = doc["entries"] as Record<string, unknown>[];
    entries[0]!["solution"] = "éAT";
    entries[1]!["solution"] = "éUD";
    expectReject(doc, "UNSOLVABLE_CELL");
  });
});

describe("guardian translator: grouped entries (PROTOCOL.md section 12)", () => {
  it("keeps the head's clue text and uses the continuation's document clue verbatim", () => {
    const r = accept(grouped());
    expect(r.puzzle.clues.across).toEqual([
      { number: 1, text: "Feline, then canine (3,3)", cellIndices: [0, 1, 2] },
      { number: 3, text: "See 1", cellIndices: [6, 7, 8] },
    ]);
  });

  it("preserves a distinctive continuation clue exactly, never rewriting it (extraction fidelity)", () => {
    const doc = grouped();
    (doc["entries"] as Record<string, unknown>[])[3]!["clue"] = "See 1 across";
    const r = accept(doc);
    expect(r.puzzle.clues.across[1]?.text).toBe("See 1 across");
  });

  it("keeps solutions on their own slots across a group", () => {
    const r = accept(grouped());
    expect(r.puzzle.solution).toEqual([
      "C",
      "A",
      "T",
      "U",
      null,
      "A",
      "D",
      "O",
      "G",
    ]);
  });

  it("synthesizes See <n> from the head's grid-derived number when the continuation clue is missing", () => {
    // The synthesized fallback never trusts document numbering: sabotage the head's number and
    // humanNumber; the derived head slot number (1) must be used.
    const variants: ((c: Record<string, unknown>) => void)[] = [
      (c) => delete c["clue"], // absent
      (c) => (c["clue"] = ""), // empty
      (c) => (c["clue"] = 42), // non-string
      (c) => (c["clue"] = "   "), // whitespace-only trims to empty
    ];
    for (const mutate of variants) {
      const doc = grouped();
      const entries = doc["entries"] as Record<string, unknown>[];
      entries[0]!["number"] = 99;
      entries[0]!["humanNumber"] = "99";
      mutate(entries[3]!);
      const r = accept(doc);
      expect(r.puzzle.clues.across[1]?.text).toBe("See 1");
    }
  });

  it("rejects a continuation whose head entry is not in the document as VALIDATION", () => {
    const doc = base();
    (doc["entries"] as Record<string, unknown>[])[3]!["group"] = [
      "9-across",
      "3-across",
    ];
    expectReject(doc, "VALIDATION");
  });
});

describe("guardian translator: SOLUTION_MISSING (PROTOCOL.md section 12, D11)", () => {
  it("rejects solutionAvailable: false as SOLUTION_MISSING, even with per-entry solutions absent", () => {
    const doc = base();
    doc["solutionAvailable"] = false;
    for (const e of doc["entries"] as Record<string, unknown>[]) {
      delete e["solution"];
    }
    expectReject(doc, "SOLUTION_MISSING");
  });

  it("rejects one entry missing its solution as SOLUTION_MISSING even when solutionAvailable is true", () => {
    const doc = base();
    delete (doc["entries"] as Record<string, unknown>[])[2]!["solution"];
    expectReject(doc, "SOLUTION_MISSING");
  });

  it("treats a null or empty solution as missing (SOLUTION_MISSING), not malformed", () => {
    const doc = base();
    (doc["entries"] as Record<string, unknown>[])[0]!["solution"] = null;
    expectReject(doc, "SOLUTION_MISSING");
    const blank = base();
    (blank["entries"] as Record<string, unknown>[])[0]!["solution"] = "";
    expectReject(blank, "SOLUTION_MISSING");
  });

  it("never echoes another entry's solution in the SOLUTION_MISSING message (INV-6)", () => {
    const doc = base();
    const entries = doc["entries"] as Record<string, unknown>[];
    entries[0]!["solution"] = "XYZ";
    entries[1]!["solution"] = "XUD";
    delete entries[2]!["solution"];
    const message = expectReject(doc, "SOLUTION_MISSING");
    expect(message).not.toContain("XYZ");
    expect(message).not.toContain("XUD");
    expect(message).not.toContain("DOG");
  });
});

describe("guardian translator: malformed documents reject as VALIDATION", () => {
  it("rejects a non-object body", () => {
    expectReject(42, "VALIDATION");
    expectReject(null, "VALIDATION");
    expectReject([1], "VALIDATION");
  });

  it("rejects missing or non-positive dimensions", () => {
    expectReject({ ...base(), dimensions: undefined }, "VALIDATION");
    expectReject({ ...base(), dimensions: { cols: 0, rows: 3 } }, "VALIDATION");
  });

  it("rejects the {data, canRenderAds} island wrapper: the document is props.data itself", () => {
    // The Guardian page serves one <gu-island name="CrosswordComponent"> whose props are
    // {data, canRenderAds}; the extension posts props.data (the object with dimensions,
    // entries, solutionAvailable at top level), never the wrapper (Wave 6.2 contract).
    expectReject({ data: base(), canRenderAds: false }, "VALIDATION");
  });

  it("rejects a malformed entry: bad direction, bad length, bad position, bad group", () => {
    const withEntry = (patch: Record<string, unknown>) => {
      const doc = base();
      const entries = doc["entries"] as Record<string, unknown>[];
      entries[0] = { ...entries[0], ...patch };
      return doc;
    };
    expectReject(withEntry({ direction: "diagonal" }), "VALIDATION");
    expectReject(withEntry({ direction: "ACROSS" }), "VALIDATION");
    expectReject(withEntry({ length: 0 }), "VALIDATION");
    expectReject(withEntry({ position: { x: -1, y: 0 } }), "VALIDATION");
    expectReject(withEntry({ position: { x: "0", y: 0 } }), "VALIDATION");
    expectReject(withEntry({ group: "1-across" }), "VALIDATION");
    expectReject(withEntry({ id: 7 }), "VALIDATION");
    expectReject(withEntry({ clue: 7 }), "VALIDATION");
  });

  it("rejects an entry running past the grid edge", () => {
    const doc = base();
    (doc["entries"] as Record<string, unknown>[])[0]!["length"] = 4;
    expectReject(doc, "VALIDATION");
  });

  it("rejects a solution whose length differs from the entry's declared length", () => {
    const doc = base();
    (doc["entries"] as Record<string, unknown>[])[0]!["solution"] = "CATS";
    expectReject(doc, "VALIDATION");
  });

  it("rejects overlapping entries that disagree on a shared cell, never echoing either letter (INV-6)", () => {
    const doc = base();
    // 1-across starts with C at cell 0; 1-down claims X there.
    (doc["entries"] as Record<string, unknown>[])[1]!["solution"] = "XUD";
    const message = expectReject(doc, "VALIDATION");
    expect(message).not.toContain("CAT");
    expect(message).not.toContain("XUD");
    expect(message).not.toContain("X");
  });

  it("rejects entries that do not match the grid-derived word runs (abutting entries merge)", () => {
    // Two across entries abut on one row of a 1x6 grid: the derived run is a single 6-cell
    // word, so neither 3-cell entry matches it. Numbering comes from the grid, not the file.
    expectReject(
      {
        ...base(),
        dimensions: { cols: 6, rows: 1 },
        entries: [
          entry({
            id: "1-across",
            number: 1,
            humanNumber: "1",
            clue: "Left half (3)",
            direction: "across",
            length: 3,
            group: ["1-across"],
            position: { x: 0, y: 0 },
            solution: "CAT",
          }),
          entry({
            id: "2-across",
            number: 2,
            humanNumber: "2",
            clue: "Right half (3)",
            direction: "across",
            length: 3,
            group: ["2-across"],
            position: { x: 3, y: 0 },
            solution: "DOG",
          }),
        ],
      },
      "VALIDATION",
    );
  });

  it("rejects two entries claiming one slot as AMBIGUOUS_SOLUTION (same start and direction)", () => {
    const doc = base();
    const entries = doc["entries"] as Record<string, unknown>[];
    entries.push(
      entry({
        id: "1-across-bis",
        number: 1,
        humanNumber: "1",
        clue: "Also feline (3)",
        direction: "across",
        length: 3,
        group: ["1-across-bis"],
        position: { x: 0, y: 0 },
        solution: "CAT",
      }),
    );
    expectReject(doc, "AMBIGUOUS_SOLUTION");
  });
});

describe("guardian translator: shared domain checks apply identically (PROTOCOL.md section 12)", () => {
  it("rejects an oversize synthetic document as OVERSIZE_GRID before any per-entry work", () => {
    expectReject(
      { ...base(), dimensions: { cols: 26, rows: 3 } },
      "OVERSIZE_GRID",
    );
    expectReject(
      { ...base(), dimensions: { cols: 3, rows: 26 } },
      "OVERSIZE_GRID",
    );
  });

  it("rejects a document with no entries as DEGENERATE_GRID (zero playable cells)", () => {
    expectReject({ ...base(), entries: [] }, "DEGENERATE_GRID");
  });
});
