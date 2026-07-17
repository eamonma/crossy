// The isolation contract (owner ruling, the Analysis legend): which washes stay full and which
// dim when a solver is isolated, and the legend's tap semantics (tap isolates, same tap clears,
// another tap switches). The multiplier rides fill-opacity over whatever the mosaic painted, so
// these tests also pin the composition guarantees: full strength is exactly 1 (the paint is
// untouched) and the dim is a fraction of the ground-facing tint, never a color swap.
import { describe, expect, it } from "vitest";
import {
  ISOLATION_DIM,
  isolationAlpha,
  nextIsolation,
} from "./mosaicIsolation";
import { mosaicCells, WASH_ALPHA } from "./mosaicReveal";

describe("isolationAlpha: full vs dimmed washes under an isolated solver", () => {
  it("no isolation: every cell keeps its full wash (multiplier exactly 1, the paint untouched)", () => {
    expect(isolationAlpha("u-1", null)).toBe(1);
    expect(isolationAlpha("u-2", null)).toBe(1);
    expect(isolationAlpha(undefined, null)).toBe(1);
  });

  it("the isolated solver's cells stay full; every other owner dims toward the ground", () => {
    expect(isolationAlpha("u-1", "u-1")).toBe(1);
    expect(isolationAlpha("u-2", "u-1")).toBe(ISOLATION_DIM);
    // An unowned cell paints no rect, but its multiplier still dims, never brightens.
    expect(isolationAlpha(undefined, "u-1")).toBe(ISOLATION_DIM);
  });

  it("dims via opacity toward the ground: the multiplier is a real fraction, so over the settled wash the tint stays visible but quiet", () => {
    expect(ISOLATION_DIM).toBeGreaterThan(0);
    expect(ISOLATION_DIM).toBeLessThan(1);
    const dimmedWash = WASH_ALPHA * ISOLATION_DIM;
    expect(dimmedWash).toBeGreaterThan(0);
    expect(dimmedWash).toBeLessThan(WASH_ALPHA);
  });

  it("maps a real owner map: exactly the isolated solver's cells read full", () => {
    // A 2x2 board, no blocks: u-1 owns 0 and 3, u-2 owns 1, cell 2 is unowned.
    const ownerMap: Record<number, string> = { 0: "u-1", 1: "u-2", 3: "u-1" };
    const cells = mosaicCells({
      cols: 2,
      rows: 2,
      blocks: new Set<number>(),
      letters: new Map<number, string>(),
      ownerMap,
      roster: { "u-1": { color: "#3e63dd" }, "u-2": { color: "#e5484d" } },
    });
    const full = cells
      .filter((c) => isolationAlpha(ownerMap[c.index], "u-1") === 1)
      .map((c) => c.index);
    expect(full).toEqual([0, 3]);
  });
});

describe("nextIsolation: the legend's tap semantics", () => {
  it("tapping a row isolates that solver", () => {
    expect(nextIsolation(null, "u-1")).toBe("u-1");
  });

  it("tapping the same row again clears isolation", () => {
    expect(nextIsolation("u-1", "u-1")).toBeNull();
  });

  it("tapping a different row switches to that solver (never a stuck mode)", () => {
    expect(nextIsolation("u-1", "u-2")).toBe("u-2");
  });

  it("self-isolation is the same gesture: your own row toggles like any other", () => {
    expect(nextIsolation(null, "self")).toBe("self");
    expect(nextIsolation("self", "self")).toBeNull();
  });
});
