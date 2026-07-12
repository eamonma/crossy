/**
 * Clue-markup translator unit vectors (owner ruling 2026-07-12; PROTOCOL.md section 12; DESIGN.md
 * section 7, D13). `parseClueRuns` is pure (no IO, no DB), so these run with no infrastructure.
 * They pin the canonical-form laws that turn an external clue's HTML markup into structured runs:
 * a plain `text` projection plus, only when styled, a `runs` decomposition. Formatting is captured,
 * never stripped and never sent as raw HTML (INV-6 untouched: runs are clue prose, not solution).
 *
 * The parallel clue-formatting agent is authoring conformance vectors under `vectors/` for exactly
 * this contract. These cases are hand-written unit vectors today; wiring the file-based vectors in
 * later is a ONE-diff change: add a `describe` that reads `vectors/clue-runs/*.json`
 * (each `{ raw, text, runs? }`) with the same `readFileSync`/`resolve(here, "../../../vectors/...")`
 * shape packages/protocol's live-activity.test.ts uses, then run each case through `expectRuns`
 * below. `expectRuns` already takes the exact `{ text, runs? }` shape a vector case would carry, so
 * no per-case rewrite is needed. See the report for the note to the orchestrator.
 *
 * Test names cite the numbered law they defend so coverage is greppable.
 */
import { describe, expect, it } from "vitest";
import { parseClueRuns } from "./clue-runs";
import type { ClueRuns } from "./clue-runs";

/** Assert the full canonical `{ text, runs? }` output for one raw clue (the vector-case shape). */
function expectRuns(raw: string, expected: ClueRuns): void {
  expect(parseClueRuns(raw)).toEqual(expected);
}

/** The plain projection alone, for the many laws that pin `text`. */
function text(raw: string): string {
  return parseClueRuns(raw).text;
}

describe("clue-runs law 1: plain projection equals the concatenation of run texts", () => {
  it("law 1: the runs' t joined is exactly the text, styled or not", () => {
    const r = parseClueRuns("plain <b>bold</b> tail");
    expect(r.runs).toBeDefined();
    expect(r.runs!.map((run) => run.t).join("")).toBe(r.text);
    expect(r.text).toBe("plain bold tail");
  });

  it("law 1: holds for a nested and adjacent-styled clue too", () => {
    const r = parseClueRuns("<b>a<i>b</i></b><i>c</i>d");
    expect(r.runs!.map((run) => run.t).join("")).toBe(r.text);
  });
});

describe("clue-runs law 2: runs omitted when the whole clue is unstyled", () => {
  it("law 2: a plain clue returns a bare { text } with no runs key", () => {
    expectRuns("just words", { text: "just words" });
    expect(parseClueRuns("just words").runs).toBeUndefined();
  });

  it("law 2: a non-whitelist tag styles nothing, so its clue is still bare { text }", () => {
    // <span> contributes no style (law 7), so nothing is styled and runs is omitted (law 2).
    expectRuns("a <span>b</span> c", { text: "a b c" });
  });
});

describe("clue-runs law 3: no empty run; s omitted not empty; no duplicate styles", () => {
  it("law 3: a plain run carries no s key at all", () => {
    const r = parseClueRuns("<b>bold</b> plain");
    expect(r.runs).toEqual([{ t: "bold", s: ["b"] }, { t: " plain" }]);
    expect(r.runs![1]).not.toHaveProperty("s");
  });

  it("law 3: an empty styled span produces no run (never { t: '' })", () => {
    // <i></i> covers nothing, so it contributes no run and, being the only markup, no styling.
    expectRuns("a<i></i>b", { text: "ab" });
  });

  it("law 3: a doubled opener does not duplicate the style in s", () => {
    expectRuns("<b><b>x</b></b>", { text: "x", runs: [{ t: "x", s: ["b"] }] });
  });
});

describe("clue-runs law 4: style order inside s is b, i, sub, sup", () => {
  it("law 4: a run under all four styles lists them in the fixed order", () => {
    // Open in a scrambled order; s must still emit b, i, sub, sup.
    expectRuns("<sup><sub><i><b>x</b></i></sub></sup>", {
      text: "x",
      runs: [{ t: "x", s: ["b", "i", "sub", "sup"] }],
    });
  });

  it("law 4: i before nothing, b before i (a two-style run is ordered)", () => {
    expectRuns("<i><b>x</b></i>", {
      text: "x",
      runs: [{ t: "x", s: ["b", "i"] }],
    });
  });
});

describe("clue-runs law 5: adjacent runs with identical style sets merge", () => {
  it("law 5: two abutting bold spans become one bold run", () => {
    expectRuns("<b>a</b><b>b</b>", {
      text: "ab",
      runs: [{ t: "ab", s: ["b"] }],
    });
  });

  it("law 5: bold then a plain gap then bold stays three runs (no cross-gap merge)", () => {
    expectRuns("<b>a</b> <b>b</b>", {
      text: "a b",
      runs: [{ t: "a", s: ["b"] }, { t: " " }, { t: "b", s: ["b"] }],
    });
  });
});

describe("clue-runs law 6: text is the normalized plain string", () => {
  it("law 6: tags parsed out, entities decoded, whitespace collapsed, trimmed", () => {
    expect(text("  <b>Sat</b> &amp;   <i>Sun</i>  ")).toBe("Sat & Sun");
  });

  it("law 6: a Unicode whitespace run (tab, NBSP entity, newline) collapses to one ASCII space", () => {
    expect(text("a\t\n&nbsp; b")).toBe("a b");
  });
});

describe("clue-runs law 7: tag vocabulary maps to styles; others keep content; br is a space", () => {
  it("law 7: i and em both map to i", () => {
    expectRuns("<em>a</em>", { text: "a", runs: [{ t: "a", s: ["i"] }] });
    expectRuns("<i>a</i>", { text: "a", runs: [{ t: "a", s: ["i"] }] });
  });

  it("law 7: b and strong both map to b", () => {
    expectRuns("<strong>a</strong>", {
      text: "a",
      runs: [{ t: "a", s: ["b"] }],
    });
    expectRuns("<b>a</b>", { text: "a", runs: [{ t: "a", s: ["b"] }] });
  });

  it("law 7: sub and sup map to themselves", () => {
    expectRuns("H<sub>2</sub>O", {
      text: "H2O",
      runs: [{ t: "H" }, { t: "2", s: ["sub"] }, { t: "O" }],
    });
    expectRuns("x<sup>2</sup>", {
      text: "x2",
      runs: [{ t: "x" }, { t: "2", s: ["sup"] }],
    });
  });

  it("law 7: a non-whitelist tag contributes no style but keeps its inner content", () => {
    expectRuns('a <a href="x">link</a> b', { text: "a link b" });
  });

  it("law 7: every br variant becomes a single space", () => {
    expect(text("line<br>one")).toBe("line one");
    expect(text("line<br/>two")).toBe("line two");
    expect(text("line<br />three")).toBe("line three");
    expect(text("line<BR>four")).toBe("line four");
  });
});

describe("clue-runs law 8: parse tags before decoding entities", () => {
  it("law 8: &lt;i&gt; is literal text, never formatting", () => {
    // The entities decode to the LITERAL characters < i > after tag parsing, so no run is styled.
    expectRuns("&lt;i&gt;not italic&lt;/i&gt;", { text: "<i>not italic</i>" });
  });

  it("law 8: 3 < 4 is preserved (a < not starting a real tag is literal)", () => {
    expectRuns("3 < 4", { text: "3 < 4" });
  });

  it("law 8: a real <i> around escaped angle brackets styles the decoded literals", () => {
    expectRuns("<i>&lt;tag&gt;</i>", {
      text: "<tag>",
      runs: [{ t: "<tag>", s: ["i"] }],
    });
  });
});

describe("clue-runs law 9: nesting flattens to style sets", () => {
  it("law 9: text inside <b><i> carries both b and i", () => {
    expectRuns("<b>bold <i>both</i> bold</b>", {
      text: "bold both bold",
      runs: [
        { t: "bold ", s: ["b"] },
        { t: "both", s: ["b", "i"] },
        { t: " bold", s: ["b"] },
      ],
    });
  });

  it("law 9: crossed (improperly nested) tags still flatten to the covering sets", () => {
    // <b>a<i>b</b>c</i>: pop the nearest b at </b>, the i survives to </i>.
    expectRuns("<b>a<i>b</b>c</i>", {
      text: "abc",
      runs: [
        { t: "a", s: ["b"] },
        { t: "b", s: ["b", "i"] },
        { t: "c", s: ["i"] },
      ],
    });
  });
});

describe("clue-runs law 10: whitespace collapse carries the first character's styles; emptied runs drop", () => {
  it("law 10: a collapsed space spanning a style boundary takes the first whitespace char's style", () => {
    // The bold trailing space and the plain leading space fold to one space; it keeps bold (the
    // first whitespace char), then law 5 merges it back onto the bold `a`: one bold run plus plain.
    expectRuns("<b>a </b> b", {
      text: "a b",
      runs: [{ t: "a ", s: ["b"] }, { t: "b" }],
    });
  });

  it("law 10: a whitespace-only styled run collapses to one space carrying that run's style (first char)", () => {
    // The <i> covers only spaces between the words; they collapse to a single space whose style is
    // its first (italic) whitespace char (law 10). The space is real (it separates `a` and `b`), so
    // it is not dropped; only a space emptied by collapse or trim drops.
    expectRuns("a<i>   </i>b", {
      text: "a b",
      runs: [{ t: "a" }, { t: " ", s: ["i"] }, { t: "b" }],
    });
  });

  it("law 10: leading and trailing styled whitespace is trimmed away", () => {
    expectRuns("<b>  </b>word<b>  </b>", { text: "word" });
  });
});

describe("clue-runs law 11: literal characters pass through untouched", () => {
  it("law 11: a starred clue keeps its leading asterisk verbatim", () => {
    expectRuns("*Like this clue's answer", {
      text: "*Like this clue's answer",
    });
  });

  it("law 11: a star survives alongside real markup", () => {
    expectRuns("*<b>bold star</b>", {
      text: "*bold star",
      runs: [{ t: "*" }, { t: "bold star", s: ["b"] }],
    });
  });
});

describe("clue-runs law 12: malformed tags are forgiving and deterministic", () => {
  it("law 12: an unclosed whitelist tag styles through the end of the string", () => {
    expectRuns("plain <b>bold to end", {
      text: "plain bold to end",
      runs: [{ t: "plain " }, { t: "bold to end", s: ["b"] }],
    });
  });

  it("law 12: a stray closer with no opener is dropped, styling nothing", () => {
    expectRuns("no opener </b> here", { text: "no opener here" });
  });

  it("law 12: total on any input (an empty clue projects to empty text, no runs)", () => {
    expectRuns("", { text: "" });
    expectRuns("   ", { text: "" });
    expectRuns("<i></i>", { text: "" });
  });
});

describe("clue-runs: markup-only clue projects to empty (the guardian continuation signal)", () => {
  it("a clue that is only markup and whitespace has an empty projection", () => {
    // Guardian judges a continuation empty on this projected text, not the raw string.
    expect(text("<i></i>")).toBe("");
    expect(text("<b> </b>")).toBe("");
  });
});
