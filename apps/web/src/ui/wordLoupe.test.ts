import { describe, expect, it } from "vitest";
import {
  showsWordLoupe,
  wordLoupeForSelection,
  wordLoupeGeometry,
} from "./wordLoupe";

describe("wordLoupeGeometry (INV-4 frozen-board review; PROTOCOL.md section 3)", () => {
  it("projects an Across word and its selected cell", () => {
    const geometry = wordLoupeGeometry({ cells: [16, 17, 18, 19] }, 18, 15, 15);
    expect(geometry.lens.left).toBeCloseTo(6);
    expect(geometry.lens.top).toBeCloseTo(6);
    expect(geometry.lens.width).toBeCloseTo(28);
    expect(geometry.lens.height).toBeCloseTo(8);
    expect(geometry.focus.left).toBeCloseTo(20);
    expect(geometry.focus.top).toBeCloseTo(6.667);
    expect(geometry.focus.width).toBeCloseTo(6.667);
    expect(geometry.focus.height).toBeCloseTo(6.667);
  });

  it("projects a Down word beyond the grid edge and falls back to its first cell", () => {
    const geometry = wordLoupeGeometry(
      { cells: [2, 17, 32, 47, 62] },
      99,
      15,
      15,
    );
    expect(geometry.lens.left).toBeCloseTo(12.667);
    expect(geometry.lens.top).toBeCloseTo(-0.667);
    expect(geometry.lens.width).toBeCloseTo(8);
    expect(geometry.lens.height).toBeCloseTo(34.667);
    expect(geometry.focus.left).toBeCloseTo(13.333);
    expect(geometry.focus.top).toBe(0);
    expect(geometry.focus.width).toBeCloseTo(6.667);
    expect(geometry.focus.height).toBeCloseTo(6.667);
  });

  it("keeps the focus box fixed when the selected direction changes", () => {
    const grid = { cols: 3, rows: 3, blocks: new Set<number>() };
    const across = wordLoupeForSelection(grid, "across", 4);
    const down = wordLoupeForSelection(grid, "down", 4);
    expect(across?.focus).toEqual(down?.focus);
    expect(across?.lens.width).toBeGreaterThan(across?.lens.height ?? 0);
    expect(down?.lens.height).toBeGreaterThan(down?.lens.width ?? 0);
  });

  it("rejects an empty clue instead of producing invalid percentages", () => {
    expect(() => wordLoupeGeometry({ cells: [] }, 0, 15, 15)).toThrow(
      "word loupe needs a non-empty grid and clue",
    );
  });
});

describe("showsWordLoupe (the loupe belongs only to the settled completed board, iOS/Android parity)", () => {
  it("shows over the settled record when nothing is playing back", () => {
    expect(showsWordLoupe(true, false)).toBe(true);
  });

  it("hides over the reveal arc: the bloom and the held peak play uncovered", () => {
    expect(showsWordLoupe(false, false)).toBe(false);
  });

  it("hides while a replay scrubs, and returns when the replay ends on the settled record", () => {
    expect(showsWordLoupe(true, true)).toBe(false);
    expect(showsWordLoupe(true, false)).toBe(true);
  });

  it("a static mount (revisit, tab switch back) is already settled, so the loupe shows immediately", () => {
    // The caller derives `settled = !revealing || settleBeat` (CompletedMosaic): with no arc in
    // flight the signal is true from the first report.
    expect(showsWordLoupe(true, false)).toBe(true);
  });
});
