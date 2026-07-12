// The mosaic core's contract: the WCAG glyph-color pick reused from the ratified plate-study.html,
// the owner-map to color resolution the component renders, and the diagonal sweep timing. INV-6
// corollary: the mosaic draws only letters handed to it as board state, so a cell with no letter
// stays letterless; there is no path here that could surface a solution.
import { describe, expect, it } from "vitest";
import {
  bloomDelay,
  BLOOM_SPREAD_MS,
  INK,
  JITTER_MS,
  luminance,
  mosaicCells,
  settleDelay,
  SETTLE_SPREAD_MS,
  textOn,
  WHITE,
} from "./mosaicReveal";

// The five roster hues the demo and presence chrome share.
const INDIGO = "#3e63dd";
const RED = "#e5484d";
const TEAL = "#12a594";
const AMBER = "#ffb224";
const PURPLE = "#8e4ec6";

describe("textOn (WCAG glyph pick, plate-study.html)", () => {
  it("puts ink on the light fields (amber, teal, red) where dark letters read better", () => {
    // The ratified plate-study.html WCAG function computes ink for all three: amber and teal are
    // plainly light, and this red (#e5484d, red-9) lands ink too (contrast 4.17 ink vs 3.91 white).
    expect(textOn(AMBER)).toBe(INK);
    expect(textOn(TEAL)).toBe(INK);
    expect(textOn(RED)).toBe(INK);
  });

  it("puts white on the deep fields (indigo, purple)", () => {
    expect(textOn(INDIGO)).toBe(WHITE);
    expect(textOn(PURPLE)).toBe(WHITE);
  });

  it("treats a malformed color as black, so a bad hue never crashes the render", () => {
    expect(luminance("not-a-color")).toBe(0);
    expect(textOn("not-a-color")).toBe(WHITE); // white reads on black
  });
});

describe("mosaicCells (owner-map to painted cells)", () => {
  // A 3x1 strip: one owned cell, one owned-but-unknown-id cell, one block.
  const base = {
    cols: 3,
    rows: 1,
    blocks: new Set<number>([2]),
    letters: new Map<number, string>([
      [0, "A"],
      [1, "B"],
    ]),
    roster: { "u-1": { color: AMBER } },
  };

  it("paints a cell its owner's color, resolved id to roster", () => {
    const cells = mosaicCells({ ...base, ownerMap: { 0: "u-1" } });
    const painted = cells.find((c) => c.index === 0);
    expect(painted?.color).toBe(AMBER);
    expect(painted?.onColor).toBe(INK); // amber takes ink glyphs
  });

  it("leaves a cell uncolored when its owner id is unknown to the roster", () => {
    const cells = mosaicCells({ ...base, ownerMap: { 1: "u-ghost" } });
    const cell = cells.find((c) => c.index === 1);
    expect(cell?.color).toBeNull();
    expect(cell?.onColor).toBe(INK);
  });

  it("skips block cells entirely: they are never owned and never painted", () => {
    const cells = mosaicCells({ ...base, ownerMap: { 2: "u-1" } });
    expect(cells.some((c) => c.index === 2)).toBe(false);
  });

  it("carries only letters given as board state, never inventing one (INV-6 corollary)", () => {
    const cells = mosaicCells({ ...base, ownerMap: {} });
    expect(cells.find((c) => c.index === 0)?.letter).toBe("A");
    expect(cells.find((c) => c.index === 1)?.letter).toBe("B");
    // Nothing supplies cell 2 (a block) and no cell without a fill gains a letter.
    expect(
      cells.every((c) => c.letter === null || base.letters.has(c.index)),
    ).toBe(true);
  });

  it("is pure: same input yields the same cells", () => {
    const input = { ...base, ownerMap: { 0: "u-1" } };
    expect(mosaicCells(input)).toEqual(mosaicCells(input));
  });
});

describe("the diagonal sweep timing (plate-study.html arc)", () => {
  it("blooms from the top-left corner outward: cell 0 starts before the far corner", () => {
    const near = bloomDelay(0, 0, 15, 15, 0);
    const far = bloomDelay(14, 14, 15, 15, 0);
    expect(near).toBe(0);
    // The far corner sits at (14+14)/(15+15) = 0.933 of the span, so near the full spread.
    expect(far).toBeCloseTo((28 / 30) * BLOOM_SPREAD_MS, 5);
    expect(far).toBeGreaterThan(near);
  });

  it("orders cells by their anti-diagonal (col+row), so equal diagonals share a base delay", () => {
    // (3,1) and (1,3) sit on the same anti-diagonal; with no jitter their delays match.
    expect(bloomDelay(3, 1, 15, 15, 0)).toBeCloseTo(
      bloomDelay(1, 3, 15, 15, 0),
      5,
    );
  });

  it("adds the caller's jitter on top of the diagonal delay, capped at JITTER_MS", () => {
    const plain = bloomDelay(2, 2, 15, 15, 0);
    expect(bloomDelay(2, 2, 15, 15, 1)).toBeCloseTo(plain + JITTER_MS, 5);
    expect(bloomDelay(2, 2, 15, 15, 0.5)).toBeCloseTo(plain + JITTER_MS / 2, 5);
  });

  it("settles in the same diagonal order but a quicker, quieter spread", () => {
    const near = settleDelay(0, 0, 15, 15);
    const far = settleDelay(14, 14, 15, 15);
    expect(near).toBe(0);
    expect(far).toBeCloseTo((28 / 30) * SETTLE_SPREAD_MS, 5);
    expect(far).toBeLessThan(bloomDelay(14, 14, 15, 15, 0)); // the settle is faster than the bloom
  });
});
