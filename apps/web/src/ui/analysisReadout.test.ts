// The Analysis tab core's contract: M:SS never renders NaN, the summary counts distinct solvers and
// entries off the owner map alone, the legend keeps the mosaic's colors and drops non-owners, and
// the ribbon math maps the break time onto the same bucket the server binned. Degenerate solves (an
// empty duration, an all-zero momentum, a null moment) collapse cleanly, never a NaN or an empty
// span. These pin the arithmetic the screenshots cannot.
import { describe, expect, it } from "vitest";
import type { AnalysisResponse } from "./completionAttribution";
import {
  analysisSummary,
  formatMSS,
  legendSolvers,
  momentumHasSignal,
  RIBBON_SAMPLES,
  ribbonAreaPath,
  ribbonLinePath,
  ribbonPoints,
  timeToSampleIndex,
  type RibbonBox,
} from "./analysisReadout";

const INDIGO = "#3e63dd";
const RED = "#e5484d";
const TEAL = "#12a594";

function bundle(over: Partial<AnalysisResponse> = {}): AnalysisResponse {
  return {
    owners: over.owners ?? {},
    momentum: over.momentum ?? { durationSeconds: 0, samples: [] },
    moments: over.moments ?? {
      firstToFall: null,
      lastSquare: null,
      turningPoint: null,
    },
  };
}

describe("formatMSS (never NaN, never an empty span)", () => {
  it("formats whole minutes and seconds as M:SS with a zero-padded seconds field", () => {
    expect(formatMSS(372)).toBe("6:12");
    expect(formatMSS(9)).toBe("0:09");
    expect(formatMSS(0)).toBe("0:00");
  });

  it("floors fractional seconds so a sub-second remainder never shows a decimal", () => {
    expect(formatMSS(125.9)).toBe("2:05");
  });

  it("carries the hour past 3600s (H:MM:SS), matching gameTime formatDuration", () => {
    expect(formatMSS(3661)).toBe("1:01:01");
  });

  it("reads 0:00 for a negative or non-finite input, never NaN:NaN (degenerate moment time)", () => {
    expect(formatMSS(-5)).toBe("0:00");
    expect(formatMSS(Number.NaN)).toBe("0:00");
    expect(formatMSS(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("analysisSummary (counts off the owner map alone)", () => {
  it("counts distinct owning solvers and total owned squares, with the duration label", () => {
    const s = analysisSummary(
      bundle({
        owners: { 0: "a", 1: "a", 2: "b", 3: "c" },
        momentum: { durationSeconds: 372, samples: [] },
      }),
    );
    expect(s.solverCount).toBe(3);
    expect(s.entryCount).toBe(4);
    expect(s.durationLabel).toBe("6:12");
  });

  it("collapses to zero counts and 0:00 for an empty solve (no owners, zero duration)", () => {
    const s = analysisSummary(bundle());
    expect(s.solverCount).toBe(0);
    expect(s.entryCount).toBe(0);
    expect(s.durationLabel).toBe("0:00");
  });
});

describe("moment times are degenerate, so the cards drop them (engine analysis.ts contract)", () => {
  // Pins WHY the moment cards show a warm descriptor, not a time: the engine measures every beat
  // relative to t0 = min(at), so the opening is always 0 and the closing is always the duration the
  // header already shows. Rendering either would be a meaningless 0:00 or a redundant copy.
  it("firstToFall.atSeconds is 0 (the earliest fill, measured against itself)", () => {
    const b = bundle({
      momentum: { durationSeconds: 372, samples: [] },
      moments: {
        firstToFall: { cell: 5, userId: "a", atSeconds: 0 },
        lastSquare: { cell: 9, userId: "b", atSeconds: 372 },
        turningPoint: null,
      },
    });
    expect(b.moments.firstToFall?.atSeconds).toBe(0);
  });

  it("lastSquare.atSeconds equals momentum.durationSeconds (the last fill is tEnd)", () => {
    const b = bundle({
      momentum: { durationSeconds: 372, samples: [] },
      moments: {
        firstToFall: { cell: 5, userId: "a", atSeconds: 0 },
        lastSquare: { cell: 9, userId: "b", atSeconds: 372 },
        turningPoint: null,
      },
    });
    expect(b.moments.lastSquare?.atSeconds).toBe(b.momentum.durationSeconds);
  });
});

describe("legendSolvers (mosaic colors, self as You, non-owners dropped)", () => {
  const members = [
    { userId: "a", name: "Mara", color: RED },
    { userId: "me", name: "Real Name", color: INDIGO },
    { userId: "b", name: "Jia", color: TEAL },
  ];

  it("floats self to the front and names them You, keeping the presence color", () => {
    const rows = legendSolvers(
      bundle({ owners: { 0: "a", 1: "me", 2: "b" } }),
      members,
      "me",
    );
    expect(rows[0]).toEqual({
      userId: "me",
      name: "You",
      color: INDIGO,
      self: true,
    });
    expect(rows.map((r) => r.name)).toEqual(["You", "Mara", "Jia"]);
  });

  it("drops a member who owns no square, so the legend names only colors on the board", () => {
    const rows = legendSolvers(bundle({ owners: { 0: "a" } }), members, "me");
    expect(rows.map((r) => r.userId)).toEqual(["a"]);
  });
});

describe("timeToSampleIndex (inverse of the server's bucketing)", () => {
  it("maps the endpoints to 0 and N-1 over the fixed granularity", () => {
    expect(timeToSampleIndex(0, 372)).toBe(0);
    expect(timeToSampleIndex(372, 372)).toBe(RIBBON_SAMPLES - 1);
  });

  it("maps a mid-solve break to its fractional bucket (matches floor((t/dur)*(N-1)))", () => {
    // 272s of a 372s solve -> 0.731 * 39 = 28.5x; floor lands in bucket 28, the same bin the
    // server's samples were counted into.
    const idx = timeToSampleIndex(272, 372);
    expect(Math.floor(idx)).toBe(28);
  });

  it("puts everything at index 0 for a zero or non-finite duration (single-instant solve)", () => {
    expect(timeToSampleIndex(10, 0)).toBe(0);
    expect(timeToSampleIndex(10, Number.NaN)).toBe(0);
  });
});

describe("ribbonPoints (peak-normalized samples to [0..1] points)", () => {
  it("normalizes the sample index over the span and clamps y into [0,1]", () => {
    const pts = ribbonPoints([0, 0.5, 1]);
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]);
  });

  it("clamps a stray out-of-range or non-finite sample rather than drawing off-box", () => {
    const pts = ribbonPoints([1.4, -0.2, Number.NaN]);
    expect(pts.map((p) => p.y)).toEqual([1, 0, 0]);
  });

  it("draws a flat baseline for an all-zero series (degenerate momentum, no NaN)", () => {
    const pts = ribbonPoints(new Array(RIBBON_SAMPLES).fill(0));
    expect(pts.every((p) => p.y === 0)).toBe(true);
    expect(momentumHasSignal(new Array(RIBBON_SAMPLES).fill(0))).toBe(false);
    expect(momentumHasSignal([0, 0, 0.3])).toBe(true);
  });
});

describe("ribbonLinePath / ribbonAreaPath (a smooth curve, never NaN in the d string)", () => {
  const box: RibbonBox = {
    width: 360,
    height: 100,
    padX: 6,
    padTop: 18,
    padBottom: 20,
  };

  it("emits a bezier path that starts with a move and carries no NaN", () => {
    const d = ribbonLinePath(ribbonPoints([0, 0.4, 0.9, 0.5, 0.2]), box);
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("C");
    expect(d.includes("NaN")).toBe(false);
  });

  it("returns an empty path for fewer than two points (nothing to draw)", () => {
    expect(ribbonLinePath([], box)).toBe("");
    expect(ribbonLinePath([{ x: 0, y: 0.5 }], box)).toBe("");
    expect(ribbonAreaPath([], box)).toBe("");
  });

  it("closes the area path back to the baseline", () => {
    const area = ribbonAreaPath(ribbonPoints([0.2, 0.8, 0.4]), box);
    expect(area.endsWith("Z")).toBe(true);
    // Baseline y is height - padBottom = 80.
    expect(area).toContain(",80 ");
  });
});
