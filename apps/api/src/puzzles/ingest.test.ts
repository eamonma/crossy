/**
 * Ingestion ACL unit vectors (ROADMAP Phase 3 Track C, G1; DESIGN.md section 7; SP5).
 *
 * `translateXwordInfo` is pure (no IO, no DB), so these run with no infrastructure. They pin the
 * XWord Info -> ServerPuzzle translation, every named rejection, the ASCII-only charset rule
 * (INV-1), first-character acceptance (D12), and the fixed check order that makes the same bad
 * puzzle yield the same code. The HTTP wiring and the INV-6 no-leak backstop on every rejection
 * path live in api.test.ts, driven as the crossy_api role.
 *
 * Test names cite the named rejection or invariant they defend so coverage is greppable.
 */
import { describe, expect, it } from "vitest";
import { translateXwordInfo } from "./ingest";
import type { IngestErrorCode } from "./ingest";

/** A well-formed 2x2 all-playable XWord Info document, the base most cases perturb. */
function base(): Record<string, unknown> {
  return {
    size: { rows: 2, cols: 2 },
    grid: ["H", "I", "O", "N"],
    clues: {
      across: ["1. friendly opener", "3. keyboard basics"],
      down: ["1. up top", "2. and beside"],
    },
  };
}

/** Assert acceptance and narrow to the ok result. */
function accept(body: unknown) {
  const r = translateXwordInfo(body);
  if (!r.ok) throw new Error(`expected accept, got ${r.code}: ${r.message}`);
  return r;
}

/** Assert exactly this rejection code. */
function expectReject(body: unknown, code: IngestErrorCode): string {
  const r = translateXwordInfo(body);
  expect(r.ok ? "ACCEPTED" : r.code).toBe(code);
  return r.ok ? "" : r.message;
}

describe("ingestion ACL: XWord Info translation (DESIGN.md section 7)", () => {
  it("translates a 2x2 document into the internal ServerPuzzle with grid-derived clues", () => {
    const r = accept(base());
    expect(r.puzzle.rows).toBe(2);
    expect(r.puzzle.cols).toBe(2);
    expect(r.puzzle.blocks).toEqual([]);
    expect(r.puzzle.circles).toEqual([]);
    expect(r.puzzle.solution).toEqual(["H", "I", "O", "N"]);
    expect(r.puzzle.clues.across).toEqual([
      { number: 1, text: "friendly opener", cellIndices: [0, 1] },
      { number: 3, text: "keyboard basics", cellIndices: [2, 3] },
    ]);
    expect(r.puzzle.clues.down).toEqual([
      { number: 1, text: "up top", cellIndices: [0, 2] },
      { number: 2, text: "and beside", cellIndices: [1, 3] },
    ]);
  });

  it("derives blocks, numbering, and cellIndices from grid geometry (DESIGN.md section 7)", () => {
    const r = accept({
      size: { rows: 3, cols: 3 },
      grid: ["A", "B", "C", "D", ".", "E", "F", "G", "H"],
      clues: {
        across: ["1. top row", "3. bottom row"],
        down: ["1. left col", "2. right col"],
      },
    });
    expect(r.puzzle.blocks).toEqual([4]);
    expect(r.puzzle.solution).toEqual([
      "A",
      "B",
      "C",
      "D",
      null,
      "E",
      "F",
      "G",
      "H",
    ]);
    expect(r.puzzle.clues.across).toEqual([
      { number: 1, text: "top row", cellIndices: [0, 1, 2] },
      { number: 3, text: "bottom row", cellIndices: [6, 7, 8] },
    ]);
    expect(r.puzzle.clues.down).toEqual([
      { number: 1, text: "left col", cellIndices: [0, 3, 6] },
      { number: 2, text: "right col", cellIndices: [2, 5, 8] },
    ]);
  });

  it("stores a multi-character rebus answer in full (D12; SP5 observed max 4)", () => {
    const r = accept({ ...base(), grid: ["STAR", "I", "O", "N"] });
    expect(r.puzzle.solution).toEqual(["STAR", "I", "O", "N"]);
    expect(r.features.rebus).toBe(true);
  });

  it("reads a parallel circles array into cell indices (DESIGN.md section 7)", () => {
    const r = accept({ ...base(), circles: [1, 0, 0, 1] });
    expect(r.puzzle.circles).toEqual([0, 3]);
    expect(r.puzzle.shadedCircles).toBeUndefined();
    expect(r.features.circles).toBe(true);
  });

  it("routes circled cells to shadedCircles when shadecircles is set (DESIGN.md section 7)", () => {
    const r = accept({ ...base(), circles: [1, 0, 0, 1], shadecircles: true });
    expect(r.puzzle.circles).toEqual([]);
    expect(r.puzzle.shadedCircles).toEqual([0, 3]);
    expect(r.features.shadedCircles).toBe(true);
  });
});

describe("ingestion ACL: charset and INV-1 (ASCII-only casing)", () => {
  it("ASCII-uppercases lowercase solution letters (INV-1, never locale-aware)", () => {
    const r = accept({ ...base(), grid: ["h", "i", "o", "n"] });
    expect(r.puzzle.solution).toEqual(["H", "I", "O", "N"]);
  });

  it("keeps digits in the enterable charset (SP5; v2 parity)", () => {
    const r = accept({ ...base(), grid: ["1", "2", "O", "N"] });
    expect(r.puzzle.solution).toEqual(["1", "2", "O", "N"]);
  });

  it("accepts a first-char-enterable symbol rebus like A/B (D12; SP5)", () => {
    const r = accept({ ...base(), grid: ["A/B", "I", "O", "N"] });
    expect(r.puzzle.solution).toEqual(["A/B", "I", "O", "N"]);
  });

  it("rejects a non-ASCII solution cell as UNSOLVABLE_CELL, not locale-folded (INV-1)", () => {
    // asciiUppercase leaves an accented letter unchanged, so its first char is outside A-Z0-9.
    expectReject({ ...base(), grid: ["é", "I", "O", "N"] }, "UNSOLVABLE_CELL");
  });
});

describe("ingestion ACL: named rejections (SP5; PROTOCOL.md section 12)", () => {
  it("rejects a whole-symbol solution cell as UNSOLVABLE_CELL (SP5 AVClub `/` case)", () => {
    expectReject({ ...base(), grid: ["/", "I", "O", "N"] }, "UNSOLVABLE_CELL");
  });

  it("rejects an empty playable solution cell as UNSOLVABLE_CELL", () => {
    expectReject({ ...base(), grid: ["", "I", "O", "N"] }, "UNSOLVABLE_CELL");
  });

  it("rejects a solution longer than 10 as REBUS_TOO_LONG (SP5 cap of 10)", () => {
    expectReject(
      { ...base(), grid: ["ABCDEFGHIJK", "I", "O", "N"] },
      "REBUS_TOO_LONG",
    );
  });

  it("accepts a solution of exactly 10 characters (REBUS_TOO_LONG boundary)", () => {
    const r = accept({ ...base(), grid: ["ABCDEFGHIJ", "I", "O", "N"] });
    expect(r.puzzle.solution[0]).toBe("ABCDEFGHIJ");
  });

  it("rejects a grid over 25 in a dimension as OVERSIZE_GRID (D13; SP5 both dims)", () => {
    expectReject(
      {
        size: { rows: 26, cols: 26 },
        grid: [],
        clues: { across: [], down: [] },
      },
      "OVERSIZE_GRID",
    );
  });

  it("checks each dimension independently for OVERSIZE_GRID (SP5: non-square, even dims)", () => {
    expectReject(
      {
        size: { rows: 2, cols: 26 },
        grid: [],
        clues: { across: [], down: [] },
      },
      "OVERSIZE_GRID",
    );
    expectReject(
      {
        size: { rows: 26, cols: 2 },
        grid: [],
        clues: { across: [], down: [] },
      },
      "OVERSIZE_GRID",
    );
  });

  it("accepts a grid at exactly 25 in a dimension (OVERSIZE_GRID boundary)", () => {
    const r = accept({
      size: { rows: 1, cols: 25 },
      grid: Array.from({ length: 25 }, () => "A"),
      clues: { across: ["1. long row"], down: [] },
    });
    expect(r.puzzle.cols).toBe(25);
    expect(r.puzzle.clues.across[0]?.cellIndices).toHaveLength(25);
  });

  it("rejects a grid with zero playable cells as DEGENERATE_GRID (DESIGN.md section 7)", () => {
    expectReject(
      {
        size: { rows: 2, cols: 2 },
        grid: [".", ".", ".", "."],
        clues: { across: [], down: [] },
      },
      "DEGENERATE_GRID",
    );
  });

  it("rejects a diagramless document by type flag as DIAGRAMLESS (D13)", () => {
    expectReject({ ...base(), type: "diagramless" }, "DIAGRAMLESS");
  });

  it("rejects a diagramless document by boolean flag as DIAGRAMLESS (D13)", () => {
    expectReject({ ...base(), diagramless: true }, "DIAGRAMLESS");
  });

  it("rejects two clues for one slot as AMBIGUOUS_SOLUTION (SP5 Schroedinger)", () => {
    expectReject(
      {
        ...base(),
        clues: {
          across: ["1. clue a", "1. clue b"],
          down: ["1. up top", "2. and beside"],
        },
      },
      "AMBIGUOUS_SOLUTION",
    );
  });
});

describe("ingestion ACL: explicit non-rejections (SP5: do not reject these)", () => {
  it("accepts an asymmetric grid: 180-symmetry is not a validity invariant (SP5)", () => {
    const r = accept({
      size: { rows: 3, cols: 3 },
      grid: [".", "B", "C", "D", "E", "F", "G", "H", "I"],
      clues: {
        across: ["1. row0", "3. row1", "4. row2"],
        down: ["1. col1", "2. col2", "3. col0"],
      },
    });
    expect(r.puzzle.blocks).toEqual([0]);
    expect(r.puzzle.clues.across).toHaveLength(3);
  });

  it("accepts unchecked cells crossed by a single word (SP5: tolerate them)", () => {
    // The center-block 3x3 leaves B, D, E, G each in exactly one word; ingestion must not choke.
    const r = accept({
      size: { rows: 3, cols: 3 },
      grid: ["A", "B", "C", "D", ".", "E", "F", "G", "H"],
      clues: {
        across: ["1. top row", "3. bottom row"],
        down: ["1. left col", "2. right col"],
      },
    });
    // B (index 1) appears in the across word only, never in a down word.
    const inDown = r.puzzle.clues.down.some((cl) => cl.cellIndices.includes(1));
    const inAcross = r.puzzle.clues.across.some((cl) =>
      cl.cellIndices.includes(1),
    );
    expect(inAcross).toBe(true);
    expect(inDown).toBe(false);
  });
});

describe("ingestion ACL: check order is deterministic and total", () => {
  it("prefers OVERSIZE_GRID over an unsolvable cell (size gate is first)", () => {
    expectReject(
      {
        size: { rows: 26, cols: 26 },
        grid: ["/"],
        clues: { across: [], down: [] },
      },
      "OVERSIZE_GRID",
    );
  });

  it("prefers REBUS_TOO_LONG over UNSOLVABLE_CELL across different cells", () => {
    // Cell 0 is too long; cell 1 is an unsolvable whole-symbol. Length is scanned first.
    expectReject(
      { ...base(), grid: ["ABCDEFGHIJK", "/", "O", "N"] },
      "REBUS_TOO_LONG",
    );
  });

  it("prefers REBUS_TOO_LONG over UNSOLVABLE_CELL for one cell that is both", () => {
    expectReject(
      {
        size: { rows: 1, cols: 1 },
        grid: ["////////////"],
        clues: { across: [], down: [] },
      },
      "REBUS_TOO_LONG",
    );
  });
});

describe("ingestion ACL: malformed documents reject as VALIDATION", () => {
  it("rejects a non-object body", () => {
    expectReject(42, "VALIDATION");
    expectReject([1, 2, 3], "VALIDATION");
    expectReject(null, "VALIDATION");
  });

  it("rejects a missing or non-positive size", () => {
    expectReject({ grid: [], clues: { across: [], down: [] } }, "VALIDATION");
    expectReject(
      { size: { rows: 0, cols: 2 }, grid: [], clues: { across: [], down: [] } },
      "VALIDATION",
    );
  });

  it("rejects a grid whose length does not match rows*cols", () => {
    expectReject(
      {
        size: { rows: 2, cols: 2 },
        grid: ["A", "B", "C"],
        clues: base()["clues"],
      },
      "VALIDATION",
    );
  });

  it("rejects clues that are not across/down string arrays", () => {
    expectReject(
      { ...base(), clues: { across: [], down: "nope" } },
      "VALIDATION",
    );
  });

  it("rejects a malformed circles array as VALIDATION", () => {
    expectReject({ ...base(), circles: [1, 0] }, "VALIDATION");
  });

  it("rejects a clue count that does not match the grid's word runs", () => {
    expectReject(
      {
        ...base(),
        clues: {
          across: ["1. only one"],
          down: ["1. up top", "2. and beside"],
        },
      },
      "VALIDATION",
    );
  });
});

describe("ingestion ACL: optional fields present-but-null read as absent (SP5 real NYT export; DESIGN.md section 7)", () => {
  it("treats circles: null as absent, not malformed (owner's real export ships circles: null)", () => {
    const r = accept({ ...base(), circles: null });
    expect(r.puzzle.circles).toEqual([]);
    expect(r.puzzle.shadedCircles).toBeUndefined();
    expect(r.features.circles).toBe(false);
  });

  it("treats shadecircles: null as unset, routing circles to circles (false/null/true in the wild)", () => {
    const r = accept({ ...base(), circles: [1, 0, 0, 1], shadecircles: null });
    expect(r.puzzle.circles).toEqual([0, 3]);
    expect(r.puzzle.shadedCircles).toBeUndefined();
    expect(r.features.shadedCircles).toBe(false);
  });

  it('treats type: null and type: "" as not-diagramless (optional-field rule)', () => {
    accept({ ...base(), type: null });
    accept({ ...base(), type: "" });
  });

  it("treats diagramless: null and bbars/rbars: null as absent (optional-field rule)", () => {
    accept({ ...base(), diagramless: null, bbars: null, rbars: null });
  });

  it("accepts the full real-export shape with every optional field null (SP5 real NYT export)", () => {
    const r = accept({
      title: null,
      author: null,
      editor: null,
      copyright: null,
      publisher: null,
      date: null,
      dow: null,
      notepad: null,
      jnotes: null,
      id: null,
      id2: null,
      gridnums: null,
      answers: null,
      acrossmap: null,
      downmap: null,
      key: null,
      hold: null,
      interpretcolors: null,
      mini: null,
      track: null,
      autowrap: null,
      code: null,
      admin: null,
      type: null,
      diagramless: null,
      circles: null,
      shadecircles: null,
      bbars: null,
      rbars: null,
      ...base(),
    });
    expect(r.puzzle.circles).toEqual([]);
    expect(r.puzzle.solution).toEqual(["H", "I", "O", "N"]);
  });
});

describe("ingestion ACL: barred grids reject (DESIGN.md section 7; PROTOCOL.md section 12)", () => {
  it("rejects a puzzle with bottom bars as VALIDATION (bars move word boundaries, DESIGN.md section 7)", () => {
    const message = expectReject(
      { ...base(), bbars: [0, 1, 0, 0] },
      "VALIDATION",
    );
    expect(message).toBe("barred puzzles are not supported");
  });

  it("rejects a puzzle with right bars as VALIDATION (PROTOCOL.md section 12: no barred code, use VALIDATION)", () => {
    expectReject({ ...base(), rbars: [1, 0, 0, 0] }, "VALIDATION");
  });

  it("rejects boolean-encoded bars as VALIDATION (bars parallel the circles 0/1/boolean encoding)", () => {
    expectReject(
      { ...base(), bbars: [false, true, false, false] },
      "VALIDATION",
    );
  });

  it("accepts an all-zero bars array as no bars (optional-field rule, DESIGN.md section 7)", () => {
    const r = accept({
      ...base(),
      bbars: [0, 0, 0, 0],
      rbars: [0, 0, 0, 0],
    });
    expect(r.puzzle.clues.across).toHaveLength(2);
  });

  it("accepts empty bars arrays as no bars (optional-field rule)", () => {
    accept({ ...base(), bbars: [], rbars: [] });
  });

  it("prefers barred VALIDATION over OVERSIZE_GRID (barred is a known-incompatible flag checked first)", () => {
    expectReject(
      {
        size: { rows: 26, cols: 26 },
        grid: [],
        clues: { across: [], down: [] },
        bbars: [1],
      },
      "VALIDATION",
    );
  });
});

describe("ingestion ACL: title and author display metadata (signed-in home lists)", () => {
  it("parses title and author as display strings, entity-decoded like clue text (DESIGN.md section 7)", () => {
    const r = accept({
      ...base(),
      title: "Sat &amp; Sun",
      author: "Ada &amp; Bob",
    });
    expect(r.title).toBe("Sat & Sun");
    expect(r.author).toBe("Ada & Bob");
  });

  it("reads absent, null, or empty title/author as null (optional-field rule; empty stored as null)", () => {
    expect(accept(base()).title).toBeNull(); // absent
    expect(accept(base()).author).toBeNull();
    const explicitNull = accept({ ...base(), title: null, author: null });
    expect(explicitNull.title).toBeNull();
    expect(explicitNull.author).toBeNull();
    const blank = accept({ ...base(), title: "   ", author: "" });
    expect(blank.title).toBeNull();
    expect(blank.author).toBeNull();
  });

  it("preserves title/author verbatim: INV-1 ASCII casing does not apply to display content", () => {
    // Title and author are shown back verbatim, never normalized or compared, so mixed case and
    // locale-sensitive letters survive exactly as written (contrast the cell-value charset).
    const r = accept({ ...base(), title: "İstanbul MiXeD", author: "Ĳsbrand" });
    expect(r.title).toBe("İstanbul MiXeD");
    expect(r.author).toBe("Ĳsbrand");
  });

  it("reads a non-string title/author leniently as null, never rejecting an otherwise valid puzzle", () => {
    // Display metadata is not load-bearing (unlike the circles array), so a malformed value is
    // dropped rather than failing the whole ingest, mirroring the lenient type/bars handling.
    const r = accept({ ...base(), title: 42, author: { name: "x" } });
    expect(r.title).toBeNull();
    expect(r.author).toBeNull();
  });

  it("caps title and author at 200 characters (truncated, never a rejection)", () => {
    const r = accept({
      ...base(),
      title: "T".repeat(500),
      author: "A".repeat(300),
    });
    expect(r.title).toHaveLength(200);
    expect(r.author).toHaveLength(200);
  });

  it("trims surrounding whitespace before storing", () => {
    expect(accept({ ...base(), title: "  Sunday  " }).title).toBe("Sunday");
  });
});

describe("ingestion ACL: HTML entity decoding in clue text (DESIGN.md section 7, D13)", () => {
  const firstAcross = (acrossFirst: string): string =>
    accept({
      ...base(),
      clues: {
        across: [`1. ${acrossFirst}`, "3. plain"],
        down: ["1. up top", "2. and beside"],
      },
    }).puzzle.clues.across[0]!.text;

  it("decodes the five standard entities so clue text renders as plain text (DESIGN.md section 10)", () => {
    expect(firstAcross("salt &amp; pepper")).toBe("salt & pepper");
    expect(firstAcross("she said &quot;hi&quot;")).toBe('she said "hi"');
    expect(firstAcross("don&#39;t stop")).toBe("don't stop");
    expect(firstAcross("a &lt; b &gt; c")).toBe("a < b > c");
  });

  it("decodes decimal, hex, and named apostrophe references (DESIGN.md section 7, D13)", () => {
    expect(firstAcross("&#65;&#x42;")).toBe("AB");
    expect(firstAcross("&apos;quoted&apos;")).toBe("'quoted'");
  });

  it("decodes each entity once, never doubly (&amp;lt; is the literal &lt;)", () => {
    expect(firstAcross("&amp;lt;")).toBe("&lt;");
  });

  it("projects a whitelist tag out of the plain text, capturing it as a run instead (owner ruling 2026-07-12)", () => {
    // The plain projection drops the markup (the tag is captured in `runs`, asserted in
    // clue-runs.test.ts and the xwordinfo runs test below); unknown entities and bare ampersands
    // still survive verbatim in the projection, while known names (the Latin-1 and typographic
    // table in entities.ts) decode.
    expect(firstAcross("<i>emphasis</i>")).toBe("emphasis");
    expect(firstAcross("dash &mdash; here")).toBe("dash — here");
    expect(firstAcross("&notaname; stays")).toBe("&notaname; stays");
    expect(firstAcross("Q&A session")).toBe("Q&A session");
  });

  it("leaves out-of-range numeric references verbatim (total, never a crash)", () => {
    expect(firstAcross("&#x110000;")).toBe("&#x110000;");
    expect(firstAcross("&#0;")).toBe("&#0;");
  });
});

describe("ingestion ACL: clue markup is captured as runs at the seam (owner ruling 2026-07-12)", () => {
  // Prove the shared clue-markup translator is wired onto the built xwordinfo clue: the number
  // prefix is stripped first, then the raw remainder is translated to {text, runs}. The full law
  // matrix lives in clue-runs.test.ts; these assert the seam carries runs through THIS translator.
  const firstAcross = (acrossFirst: string) =>
    accept({
      ...base(),
      clues: {
        across: [`1. ${acrossFirst}`, "3. plain"],
        down: ["1. up top", "2. and beside"],
      },
    }).puzzle.clues.across[0]!;

  it("captures <i> as an italic run after stripping the number prefix", () => {
    expect(firstAcross("<i>emphasis</i>")).toEqual({
      number: 1,
      text: "emphasis",
      cellIndices: [0, 1],
      runs: [{ t: "emphasis", s: ["i"] }],
    });
  });

  it("omits runs entirely for a plain clue (byte-identical to the pre-markup shape, law 2)", () => {
    const clue = firstAcross("just plain words");
    expect(clue).toEqual({
      number: 1,
      text: "just plain words",
      cellIndices: [0, 1],
    });
    expect(clue).not.toHaveProperty("runs");
  });

  it("keeps a starred clue's leading asterisk verbatim (law 11)", () => {
    expect(firstAcross("*Like this clue's answer").text).toBe(
      "*Like this clue's answer",
    );
    expect(firstAcross("*Like this clue's answer")).not.toHaveProperty("runs");
  });

  it("treats &lt;i&gt; as literal text, never formatting (order law 8)", () => {
    expect(firstAcross("&lt;i&gt;x&lt;/i&gt;")).toEqual({
      number: 1,
      text: "<i>x</i>",
      cellIndices: [0, 1],
    });
  });

  it("preserves 3 < 4 as literal angle-bracket prose (order law 8)", () => {
    expect(firstAcross("3 < 4").text).toBe("3 < 4");
  });

  it("decodes &nbsp; to whitespace and collapses it (law 6)", () => {
    expect(firstAcross("a&nbsp;&nbsp;b").text).toBe("a b");
  });

  it("flattens nested <b><i> to a two-style run and merges adjacent same-style runs (laws 9, 5)", () => {
    expect(firstAcross("<b>x</b><b>y</b> <sup>z</sup>")).toEqual({
      number: 1,
      text: "xy z",
      cellIndices: [0, 1],
      runs: [{ t: "xy", s: ["b"] }, { t: " " }, { t: "z", s: ["sup"] }],
    });
  });

  it("styles through the end of the string for an unclosed tag (malformed law 12)", () => {
    expect(firstAcross("plain <b>bold to end")).toEqual({
      number: 1,
      text: "plain bold to end",
      cellIndices: [0, 1],
      runs: [{ t: "plain " }, { t: "bold to end", s: ["b"] }],
    });
  });
});
