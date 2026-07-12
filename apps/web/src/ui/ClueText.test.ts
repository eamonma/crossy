// The clue-runs rendering logic, tested as pure segments (the .tsx render is the thin wrapper).
// These pin the owner ruling (2026-07-12: clue markup is rendered as structured runs, never
// stripped, never raw HTML): unstyled and pre-feature clues render exactly today's plain text
// (the permanent fallback), styled runs expand into canonical style sets in the fixed wrap order,
// and unknown wire styles are tolerated (ignored) for forward compatibility.
import { describe, expect, it } from "vitest";
import { MISSING_CLUE, clueSegments } from "./ClueText";

describe("clueSegments", () => {
  it("renders plain text as a single unstyled segment when runs are absent (fallback path)", () => {
    expect(clueSegments({ text: "Capital of France" })).toEqual([
      { text: "Capital of France", styles: [] },
    ]);
  });

  it("renders the em-dash placeholder when both text and runs are absent (demo boards)", () => {
    expect(clueSegments({})).toEqual([{ text: MISSING_CLUE, styles: [] }]);
  });

  it("keeps unstyled runs as bare text segments", () => {
    expect(
      clueSegments({ text: "Plain clue", runs: [{ t: "Plain clue" }] }),
    ).toEqual([{ text: "Plain clue", styles: [] }]);
  });

  it("carries each run's styles onto its own segment", () => {
    expect(
      clueSegments({
        text: "See 3-Down",
        runs: [{ t: "See " }, { t: "3-Down", s: ["i"] }],
      }),
    ).toEqual([
      { text: "See ", styles: [] },
      { text: "3-Down", styles: ["i"] },
    ]);
  });

  it("reorders a run's styles into the fixed wrap order b, i, sub, sup", () => {
    expect(
      clueSegments({ text: "x", runs: [{ t: "x", s: ["sup", "i", "b"] }] }),
    ).toEqual([{ text: "x", styles: ["b", "i", "sup"] }]);
  });

  it("tolerates unknown style strings by ignoring them (forward compatibility)", () => {
    expect(
      clueSegments({
        text: "H2O",
        runs: [
          { t: "H" },
          { t: "2", s: ["sub", "blink" as never] },
          { t: "O" },
        ],
      }),
    ).toEqual([
      { text: "H", styles: [] },
      { text: "2", styles: ["sub"] },
      { text: "O", styles: [] },
    ]);
  });

  it("dedupes repeated styles within one run", () => {
    expect(
      clueSegments({ text: "x", runs: [{ t: "x", s: ["b", "b", "i"] }] }),
    ).toEqual([{ text: "x", styles: ["b", "i"] }]);
  });

  it("drops empty runs and falls back to plain text when nothing remains", () => {
    expect(clueSegments({ text: "Whole", runs: [{ t: "" }] })).toEqual([
      { text: "Whole", styles: [] },
    ]);
  });

  it("preserves run order so the concatenated text matches the plain clue", () => {
    const segments = clueSegments({
      text: "abc",
      runs: [{ t: "a", s: ["b"] }, { t: "b" }, { t: "c", s: ["i"] }],
    });
    expect(segments.map((s) => s.text).join("")).toBe("abc");
  });
});
