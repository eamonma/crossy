// The sittings presentation contract (DESIGN.md D29; SITTINGS.md "Presentation", owner rulings):
// active time is THE headline time with a fallback for frozen pre-D29 stats, the sitting count is
// context only at 2 or more (a single-sitting game reads exactly as today), and the ribbon's seam
// ticks sit at the interior span boundaries on the active axis, with the zero-width edge-span
// clamp corner drawing nothing.
import { describe, expect, it } from "vitest";
import type { Sittings } from "./completionAttribution";
import {
  headlineSolveSeconds,
  seamTickSeconds,
  sittingsSuffix,
} from "./sittingsReadout";

describe("headlineSolveSeconds (D29: active time is THE time)", () => {
  it("prefers the additive activeSolveSeconds over the wall-clock solveTimeSeconds", () => {
    expect(
      headlineSolveSeconds({
        solveTimeSeconds: 29160,
        activeSolveSeconds: 360,
      }),
    ).toBe(360);
  });

  it("falls back to solveTimeSeconds on stats frozen before sittings shipped (PROTOCOL §4)", () => {
    expect(headlineSolveSeconds({ solveTimeSeconds: 2272 })).toBe(2272);
  });

  it("falls back on a non-finite active value, never a NaN headline", () => {
    expect(
      headlineSolveSeconds({
        solveTimeSeconds: 2272,
        activeSolveSeconds: Number.NaN,
      }),
    ).toBe(2272);
  });

  it("keeps a real zero: a clamped-to-0 active time is a value, not absence", () => {
    expect(
      headlineSolveSeconds({ solveTimeSeconds: 5, activeSolveSeconds: 0 }),
    ).toBe(0);
  });
});

describe("sittingsSuffix (D29: context, never a second stat, only at 2+)", () => {
  it("reads 'N sittings' at two or more", () => {
    expect(sittingsSuffix(2)).toBe("2 sittings");
    expect(sittingsSuffix(3)).toBe("3 sittings");
  });

  it("is null at one (a single-sitting game reads exactly as today, no suffix)", () => {
    expect(sittingsSuffix(1)).toBeNull();
  });

  it("is null when the count is absent or degenerate (an older bundle or frozen stats)", () => {
    expect(sittingsSuffix(undefined)).toBeNull();
    expect(sittingsSuffix(null)).toBeNull();
    expect(sittingsSuffix(0)).toBeNull();
    expect(sittingsSuffix(Number.NaN)).toBeNull();
  });
});

describe("seamTickSeconds (D29: interior boundaries on the active axis, PROTOCOL §12)", () => {
  const twoSittings: Sittings = {
    count: 2,
    spans: [
      { startSeconds: 0, endSeconds: 300 },
      { startSeconds: 300, endSeconds: 360 },
    ],
    wallSeconds: 29160,
  };

  it("marks the one seam of a two-sitting solve at spans[0].endSeconds", () => {
    expect(seamTickSeconds(twoSittings)).toEqual([300]);
  });

  it("marks count-1 seams for a longer partition, in axis order", () => {
    expect(
      seamTickSeconds({
        count: 3,
        spans: [
          { startSeconds: 0, endSeconds: 25 },
          { startSeconds: 25, endSeconds: 50 },
          { startSeconds: 50, endSeconds: 100 },
        ],
        wallSeconds: 100000,
      }),
    ).toEqual([25, 50]);
  });

  it("is empty when sittings are absent (an older cached bundle degrades to no seams)", () => {
    expect(seamTickSeconds(undefined)).toEqual([]);
  });

  it("is empty for a single sitting (one span [0, durationSeconds], nothing interior)", () => {
    expect(
      seamTickSeconds({
        count: 1,
        spans: [{ startSeconds: 0, endSeconds: 360 }],
        wallSeconds: 360,
      }),
    ).toEqual([]);
  });

  it("drops a boundary pinned to the axis edge: a zero-width edge span draws no tick", () => {
    // The clamp corner PROTOCOL §12 pins: a wrong-writes-only first sitting degenerates to a
    // zero-width span at the start of the axis, so its boundary sits at 0 and draws nothing.
    expect(
      seamTickSeconds({
        count: 2,
        spans: [
          { startSeconds: 0, endSeconds: 0 },
          { startSeconds: 0, endSeconds: 360 },
        ],
        wallSeconds: 29160,
      }),
    ).toEqual([]);
  });

  it("dedupes coincident boundaries to one tick", () => {
    expect(
      seamTickSeconds({
        count: 3,
        spans: [
          { startSeconds: 0, endSeconds: 180 },
          { startSeconds: 180, endSeconds: 180 },
          { startSeconds: 180, endSeconds: 360 },
        ],
        wallSeconds: 90000,
      }),
    ).toEqual([180]);
  });
});
