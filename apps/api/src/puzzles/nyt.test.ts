/**
 * NYT v6 translator unit vectors (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP
 * 6.1 x4). `translateNyt` is pure, so these run with no infrastructure. They pin the v6 JSON ->
 * ServerPuzzle translation: the reference-pinned block rule (a falsy cell, `{}` or null, is a
 * block), grid-derived numbering cross-checked cell-for-cell against the document's clue
 * entries, the SOLUTION_MISSING contract for stripped payloads, the multi-body rejection, and
 * that the shared domain checks apply identically to this format.
 *
 * Every fixture is SYNTHETIC (DESIGN.md section 7 firm rule): hand-written documents in the v6
 * shape with invented grids and clue text, never real NYT puzzle content. The shape is pinned
 * from thisisparker/xword-dl (MIT), the parsing reference; the free mini page serves no puzzle
 * JSON in its HTML, so the live embed was not probed further (no authentication, ever).
 *
 * Test names cite the invariant they defend so coverage is greppable.
 */
import { describe, expect, it } from "vitest";
import { translateNyt } from "./nyt";
import type { IngestErrorCode } from "./ingest";

/** One synthetic v6 clue entry; `label` is sabotage bait (numbering must be grid-derived). */
function clue(
  cells: number[],
  direction: "Across" | "Down",
  text: string,
): Record<string, unknown> {
  return { cells, direction, label: "99", text: [{ plain: text }] };
}

/**
 * A synthetic 3x3 with a center block. Row-major grid: CAT / U#A / DOG. The block is the empty
 * object `{}`, the reference's falsy rule. Cell labels are sabotaged where present.
 */
function doc(): Record<string, unknown> {
  return {
    body: [
      {
        cells: [
          { answer: "C", label: "99" },
          { answer: "A" },
          { answer: "T", label: "99" },
          { answer: "U" },
          {},
          { answer: "A" },
          { answer: "D", label: "99" },
          { answer: "O" },
          { answer: "G" },
        ],
        clues: [
          clue([0, 1, 2], "Across", "Feline (3)"),
          clue([6, 7, 8], "Across", "Canine (3)"),
          clue([0, 3, 6], "Down", "Chewed morsel (3)"),
          clue([2, 5, 8], "Down", "Label (3)"),
        ],
        clueLists: [{ name: "Across", clues: [0, 1] }],
        dimensions: { width: 3, height: 3 },
      },
    ],
    constructors: ["Synthia Synthetic"],
    editor: "Ed Itor",
    publicationDate: "2026-01-01",
    copyright: "2026, Synthetic",
  };
}

/** Shorthand: mutate body[0] of a fresh doc. */
function withGrid(patch: Record<string, unknown>): Record<string, unknown> {
  const d = doc();
  const grid = (d["body"] as Record<string, unknown>[])[0]!;
  (d["body"] as unknown[])[0] = { ...grid, ...patch };
  return d;
}

/** Assert acceptance and narrow to the ok result. */
function accept(body: unknown) {
  const r = translateNyt(body);
  if (!r.ok) throw new Error(`expected accept, got ${r.code}: ${r.message}`);
  return r;
}

/** Assert exactly this rejection code; return the message for content checks. */
function expectReject(body: unknown, code: IngestErrorCode): string {
  const r = translateNyt(body);
  expect(r.ok ? "ACCEPTED" : r.code).toBe(code);
  return r.ok ? "" : r.message;
}

const SOLVED = ["C", "A", "T", "U", null, "A", "D", "O", "G"];

describe("nyt translator: happy path (PROTOCOL.md section 12; DESIGN.md section 7)", () => {
  it("reads an empty cell object as a block (the reference's falsy rule, pinned)", () => {
    const r = accept(doc());
    expect(r.puzzle.rows).toBe(3);
    expect(r.puzzle.cols).toBe(3);
    expect(r.puzzle.blocks).toEqual([4]);
    expect(r.puzzle.solution).toEqual(SOLVED);
  });

  it("reads a null cell as a block too (the same falsy family as {})", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as unknown[];
    cells[4] = null;
    expect(accept(d).puzzle.blocks).toEqual([4]);
  });

  it("derives clue numbering from the grid, never from labels or entry order", () => {
    // Every label is already sabotaged to "99"; shuffle the clue entries as well.
    const d = doc();
    (
      (d["body"] as Record<string, unknown>[])[0]!["clues"] as unknown[]
    ).reverse();
    const r = accept(d);
    expect(r.puzzle.clues.across).toEqual([
      { number: 1, text: "Feline (3)", cellIndices: [0, 1, 2] },
      { number: 3, text: "Canine (3)", cellIndices: [6, 7, 8] },
    ]);
    expect(r.puzzle.clues.down).toEqual([
      { number: 1, text: "Chewed morsel (3)", cellIndices: [0, 3, 6] },
      { number: 2, text: "Label (3)", cellIndices: [2, 5, 8] },
    ]);
  });

  it("decodes HTML entities in text[0].plain, like the xwordinfo boundary (DESIGN.md section 7)", () => {
    const d = doc();
    const clues = (d["body"] as Record<string, unknown>[])[0]![
      "clues"
    ] as Record<string, unknown>[];
    clues[0] = clue([0, 1, 2], "Across", "Rock &amp; roll cat (3)");
    expect(accept(d).puzzle.clues.across[0]?.text).toBe("Rock & roll cat (3)");
  });

  it("strips HTML tags from text[0].plain through the shared seam (DESIGN.md section 7, D13)", () => {
    const d = doc();
    const clues = (d["body"] as Record<string, unknown>[])[0]![
      "clues"
    ] as Record<string, unknown>[];
    clues[0] = clue(
      [0, 1, 2],
      "Across",
      "<i>Feline</i>, when 3 &lt; 4<br/>(3)",
    );
    // Tags removed, <br/> to a space, &lt; decoded to a visible < after the strip.
    expect(accept(d).puzzle.clues.across[0]?.text).toBe(
      "Feline, when 3 < 4 (3)",
    );
  });

  it("reads a missing text[0].plain leniently as empty text (the reference's or-empty rule)", () => {
    const d = doc();
    const clues = (d["body"] as Record<string, unknown>[])[0]![
      "clues"
    ] as Record<string, unknown>[];
    clues[0] = {
      cells: [0, 1, 2],
      direction: "Across",
      label: "1",
      text: [{ formatted: "<i>styled only</i>" }],
    };
    expect(accept(d).puzzle.clues.across[0]?.text).toBe("");
  });

  it("joins constructors as the byline and reads absent title as null (readMetadata semantics)", () => {
    const one = accept(doc());
    expect(one.author).toBe("Synthia Synthetic");
    expect(one.title).toBeNull();
    const two = accept({ ...doc(), constructors: ["Ada A.", "Babbage B."] });
    expect(two.author).toBe("Ada A. and Babbage B.");
    const three = accept({
      ...doc(),
      constructors: ["Ada A.", "Babbage B.", "Curie C."],
      title: "SYNTHETIC SUNDAY &amp; CO",
    });
    expect(three.author).toBe("Ada A., Babbage B., and Curie C.");
    expect(three.title).toBe("SYNTHETIC SUNDAY & CO");
    // Malformed constructors read as no author, never a rejection (display metadata).
    expect(accept({ ...doc(), constructors: "Synthia" }).author).toBeNull();
  });

  it("accepts a multi-character answer as a rebus under the shared cap", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as Record<string, unknown>[];
    cells[0] = { answer: "CAB" };
    const r = accept(d);
    expect(r.puzzle.solution[0]).toBe("CAB");
    expect(r.features.rebus).toBe(true);
  });

  it("reads a numeric cell type other than 1 as circled (the reference's one markup bit)", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as Record<string, unknown>[];
    cells[0] = { answer: "C", type: 2 }; // circled
    cells[2] = { answer: "T", type: 3 }; // shaded: same markup bit as circled
    cells[6] = { answer: "D", type: 1 }; // explicit plain
    const r = accept(d);
    expect(r.puzzle.circles).toEqual([0, 2]);
    expect(r.features).toEqual({
      rebus: false,
      circles: true,
      shadedCircles: false,
    });
    expect(accept(doc()).puzzle.circles).toEqual([]);
  });

  it("ignores clueLists, editor, publicationDate, copyright, and unknown fields", () => {
    const r = accept({ ...doc(), subcategory: 0, extra: true });
    expect(r.puzzle.solution).toEqual(SOLVED);
  });
});

describe("nyt translator: SOLUTION_MISSING (PROTOCOL.md section 12, D11)", () => {
  it("rejects a stripped payload (labels and clues, no answers) as SOLUTION_MISSING, never blocks", () => {
    // The unauthenticated shape: playable cells keep label/clues keys, answers are gone. The
    // cells are non-empty objects, so the falsy block rule must NOT swallow them.
    const d = withGrid({
      cells: [
        { label: "1", clues: [0, 2] },
        { clues: [0] },
        { label: "2", clues: [0, 3] },
        { clues: [2] },
        {},
        { clues: [3] },
        { label: "3", clues: [1, 2] },
        { clues: [1] },
        { clues: [1, 3] },
      ],
    });
    expectReject(d, "SOLUTION_MISSING");
  });

  it("treats a null, empty, or non-string answer as missing (SOLUTION_MISSING)", () => {
    for (const answer of [null, "", 42]) {
      const d = doc();
      const cells = (d["body"] as Record<string, unknown>[])[0]![
        "cells"
      ] as Record<string, unknown>[];
      cells[0] = { answer, label: "1" };
      expectReject(d, "SOLUTION_MISSING");
    }
  });

  it("never echoes another cell's answer in the SOLUTION_MISSING message (INV-6)", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as Record<string, unknown>[];
    cells[0] = { answer: "MARKERWORD" }; // a rebus answer at the cap, planted as the marker
    cells[1] = { label: "1" }; // the stripped cell that trips the code
    const message = expectReject(d, "SOLUTION_MISSING");
    expect(message).not.toContain("MARKERWORD");
    expect(message).not.toContain("DOG");
  });
});

describe("nyt translator: multi-body documents reject as VALIDATION (named)", () => {
  it("rejects a two-body document (acrostics, variety) with a named message, no echo (INV-6)", () => {
    const d = doc();
    const second = {
      ...(d["body"] as Record<string, unknown>[])[0]!,
      marker: "MARKERWORD",
    };
    (d["body"] as unknown[]).push(second);
    const message = expectReject(d, "VALIDATION");
    expect(message).toContain("not supported");
    expect(message).not.toContain("MARKERWORD");
  });

  it("rejects an empty or non-array body as VALIDATION", () => {
    expectReject({ ...doc(), body: [] }, "VALIDATION");
    expectReject({ ...doc(), body: {} }, "VALIDATION");
    expectReject({ ...doc(), body: undefined }, "VALIDATION");
  });
});

describe("nyt translator: malformed documents reject as VALIDATION", () => {
  it("rejects a non-object document (the nyt envelope document is an object, never a string)", () => {
    expectReject("eyJib2R5IjpbXX0=", "VALIDATION");
    expectReject(42, "VALIDATION");
    expectReject(null, "VALIDATION");
  });

  it("rejects missing or non-positive dimensions", () => {
    expectReject(withGrid({ dimensions: undefined }), "VALIDATION");
    expectReject(
      withGrid({ dimensions: { width: 0, height: 3 } }),
      "VALIDATION",
    );
    expectReject(
      withGrid({ dimensions: { width: "3", height: 3 } }),
      "VALIDATION",
    );
  });

  it("rejects a cells array of the wrong length or with a non-cell entry", () => {
    expectReject(withGrid({ cells: [] }), "VALIDATION");
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as unknown[];
    cells[4] = "block";
    expectReject(d, "VALIDATION");
  });

  it("rejects malformed clue entries: bad direction casing, bad cells, empty text", () => {
    const withClue = (patch: Record<string, unknown>) => {
      const d = doc();
      const clues = (d["body"] as Record<string, unknown>[])[0]![
        "clues"
      ] as Record<string, unknown>[];
      clues[0] = { ...clues[0], ...patch };
      return d;
    };
    // v6 directions are capitalized and matched exactly, never case-folded.
    expectReject(withClue({ direction: "across" }), "VALIDATION");
    expectReject(withClue({ direction: "ACROSS" }), "VALIDATION");
    expectReject(withClue({ cells: [] }), "VALIDATION");
    expectReject(withClue({ cells: [0, 1, 9] }), "VALIDATION"); // out of grid
    expectReject(withClue({ cells: "0,1,2" }), "VALIDATION");
    expectReject(withClue({ text: [] }), "VALIDATION");
    expectReject(withClue({ text: "Feline (3)" }), "VALIDATION");
    expectReject(withGrid({ clues: "none" }), "VALIDATION");
  });

  it("rejects clues that do not match the grid-derived runs cell-for-cell", () => {
    const d = doc();
    const clues = (d["body"] as Record<string, unknown>[])[0]![
      "clues"
    ] as Record<string, unknown>[];
    // Right start, wrong extent: the run is [0,1,2].
    clues[0] = clue([0, 1], "Across", "Feline, short (2)");
    expectReject(d, "VALIDATION");
    // A dropped clue: counts mismatch.
    const dropped = doc();
    (
      (dropped["body"] as Record<string, unknown>[])[0]!["clues"] as unknown[]
    ).pop();
    expectReject(dropped, "VALIDATION");
    // A clue at a non-run start: counts match, the slot lookup fails.
    const moved = doc();
    const movedClues = (moved["body"] as Record<string, unknown>[])[0]![
      "clues"
    ] as Record<string, unknown>[];
    movedClues[1] = clue([7, 8], "Across", "Canine, short (2)");
    expectReject(moved, "VALIDATION");
  });

  it("rejects two clues claiming one slot as AMBIGUOUS_SOLUTION (same direction and start)", () => {
    const d = doc();
    ((d["body"] as Record<string, unknown>[])[0]!["clues"] as unknown[]).push(
      clue([0, 1, 2], "Across", "Also feline (3)"),
    );
    expectReject(d, "AMBIGUOUS_SOLUTION");
  });
});

describe("nyt translator: shared domain checks apply identically (PROTOCOL.md section 12)", () => {
  it("rejects an oversize grid as OVERSIZE_GRID before any per-cell work", () => {
    expectReject(
      withGrid({ dimensions: { width: 26, height: 3 } }),
      "OVERSIZE_GRID",
    );
    expectReject(
      withGrid({ dimensions: { width: 3, height: 26 } }),
      "OVERSIZE_GRID",
    );
  });

  it("rejects an all-block cells array as DEGENERATE_GRID (zero playable cells)", () => {
    expectReject(
      withGrid({
        cells: [{}, {}, {}, {}, {}, {}, {}, {}, {}],
        clues: [],
      }),
      "DEGENERATE_GRID",
    );
  });

  it("rejects an over-cap rebus answer as REBUS_TOO_LONG without echoing it (INV-6)", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as Record<string, unknown>[];
    cells[0] = { answer: "MARKERWORDX" }; // 11 characters, over the cap of 10
    const message = expectReject(d, "REBUS_TOO_LONG");
    expect(message).not.toContain("MARKERWORD");
  });

  it("rejects a whole-symbol answer as UNSOLVABLE_CELL (D12 first-character rule)", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as Record<string, unknown>[];
    cells[0] = { answer: "/" };
    expectReject(d, "UNSOLVABLE_CELL");
  });
});

describe("nyt translator: INV-1 (ASCII-only casing)", () => {
  it("ASCII-uppercases lowercase answers, never locale-aware (INV-1)", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as Record<string, unknown>[];
    for (const cell of cells) {
      if (typeof cell["answer"] === "string") {
        cell["answer"] = cell["answer"].toLowerCase();
      }
    }
    expect(accept(d).puzzle.solution).toEqual(SOLVED);
  });

  it("rejects a non-ASCII letter as UNSOLVABLE_CELL, not locale-folded (INV-1, shared check)", () => {
    const d = doc();
    const cells = (d["body"] as Record<string, unknown>[])[0]![
      "cells"
    ] as Record<string, unknown>[];
    cells[0] = { answer: "é" }; // e-acute: no ASCII uppercase form
    expectReject(d, "UNSOLVABLE_CELL");
  });
});
