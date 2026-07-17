/**
 * Runs the post-game analysis reducers against the vectors/analysis/ conformance family,
 * the golden written before these projections (CLAUDE.md house rule; PROTOCOL.md §13,
 * design/post-game/ANALYSIS.md). A narrow per-family reader: it globs each fixture, runs
 * the matching reducer, and deep-equals the result against the case's `then`.
 *
 * - solve-trace.json: solveTrace(given.events, new Map(given.solution)) === then.trace.
 * - momentum.json:    momentum(given.trace) === then ({durationSeconds, samples}).
 * - moments.json:     moments(given.trace) === then ({firstToFall, lastSquare, turningPoint}).
 * - sittings.json:    the two-cluster keyed fixture (D29): collapseIdle(given.events) ===
 *                     then.events, and sittings(given.events, solution) === then.
 *
 * The COMPOSED (D29) cases in momentum.json, moments.json, and sequence.json carry
 * given.events and given.solution beside given.trace; for those this reader additionally
 * asserts the pipeline equality the family README pins for Wave 11.2:
 * solveTrace(collapseIdle(events), solution) deep-equals the pinned trace, closing the
 * pipeline before the reducer runs.
 *
 * The family sits at the top level (not vectors/v1/), so the closed v1 runner never globs
 * it; this reader adopts it exactly as vectors/analysis/README.md prescribes, copying the
 * first-correct reader pattern.
 *
 * Test files are exempt from INV-9 (.dependency-cruiser.cjs), so node:fs / node:path are
 * allowed here; the reducers themselves import only ./comparator and ./types.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BURST_WINDOW_MS,
  collapseIdle,
  MOMENTUM_SAMPLES,
  moments,
  momentum,
  SITTING_GAP_MS,
  sittings,
  solveSequence,
  solveTrace,
} from "./index";
import type {
  Beat,
  SequenceStep,
  SittingSpan,
  Solution,
  TraceEntry,
  TurningPoint,
} from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsRoot = resolve(here, "../../../vectors/analysis");

interface SolveEventJson {
  readonly seq: number;
  readonly cell: number;
  readonly userId: string;
  readonly value: string | null;
  readonly at: number;
}

interface SolveTraceCase {
  readonly name: string;
  readonly given: {
    readonly solution: [number, string][];
    readonly events: SolveEventJson[];
  };
  readonly then: { readonly trace: TraceEntry[] };
}

/**
 * A trace-projection given: the trace, plus (COMPOSED (D29) cases only) the events and
 * solution whose pipeline the trace is pinned to equal.
 */
interface TraceGiven {
  readonly trace: TraceEntry[];
  readonly events?: SolveEventJson[];
  readonly solution?: [number, string][];
}

interface MomentumCase {
  readonly name: string;
  readonly given: TraceGiven;
  readonly then: {
    readonly durationSeconds: number;
    readonly samples: number[];
  };
}

interface MomentsCase {
  readonly name: string;
  readonly given: TraceGiven;
  readonly then: {
    readonly firstToFall: Beat | null;
    readonly lastSquare: Beat | null;
    readonly turningPoint: TurningPoint | null;
  };
}

interface SequenceCase {
  readonly name: string;
  readonly given: TraceGiven;
  readonly then: { readonly sequence: SequenceStep[] };
}

interface CollapseIdleCase {
  readonly name: string;
  readonly given: { readonly events: SolveEventJson[] };
  readonly then: { readonly events: SolveEventJson[] };
}

interface SittingsCase {
  readonly name: string;
  readonly given: {
    readonly solution: [number, string][];
    readonly events: SolveEventJson[];
  };
  readonly then: {
    readonly count: number;
    readonly spans: SittingSpan[];
    readonly wallSeconds: number;
  };
}

/** Read one fixture file as a bare array of cases (README.md skipped: prose, not a fixture). */
function loadCases<T>(file: string): T[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(vectorsRoot, file), "utf8"),
  );
  return raw as T[];
}

/** Deserialize the [cell, expected] pairs into the engine's Solution (Map<number, string>). */
function buildSolution(pairs: [number, string][]): Solution {
  return new Map(pairs);
}

/**
 * The composed-equality assertion (D29, vectors/analysis/README.md): where a COMPOSED case
 * carries events and solution beside its trace, the pinned trace IS the production
 * pipeline's output, solveTrace(collapseIdle(events), solution). Asserted before the
 * reducer runs, closing the pipeline end to end.
 */
function assertComposedPipeline(given: TraceGiven): void {
  if (given.events === undefined || given.solution === undefined) return;
  expect(
    solveTrace(collapseIdle(given.events), buildSolution(given.solution)),
  ).toEqual(given.trace);
}

describe("solveTrace vectors (vectors/analysis/solve-trace.json)", () => {
  for (const c of loadCases<SolveTraceCase>("solve-trace.json")) {
    it(c.name, () => {
      const trace = solveTrace(c.given.events, buildSolution(c.given.solution));
      // INV-6: the trace carries userIds, cells, and numbers only. then.trace never names
      // a solution value, so equality proves no letter surfaces through the projection.
      expect(trace).toEqual(c.then.trace);
    });
  }
});

describe("momentum vectors (vectors/analysis/momentum.json)", () => {
  for (const c of loadCases<MomentumCase>("momentum.json")) {
    it(c.name, () => {
      assertComposedPipeline(c.given);
      expect(momentum(c.given.trace)).toEqual(c.then);
    });
  }
});

describe("moments vectors (vectors/analysis/moments.json)", () => {
  for (const c of loadCases<MomentsCase>("moments.json")) {
    it(c.name, () => {
      assertComposedPipeline(c.given);
      expect(moments(c.given.trace)).toEqual(c.then);
    });
  }
});

describe("solveSequence vectors (vectors/analysis/sequence.json)", () => {
  for (const c of loadCases<SequenceCase>("sequence.json")) {
    it(c.name, () => {
      // INV-6: then.sequence never names a userId or a solution value, so equality proves the
      // replay's foundation carries cells and relative times only. The case's extra `intent`
      // field is prose, ignored here.
      assertComposedPipeline(c.given);
      expect(solveSequence(c.given.trace)).toEqual(c.then.sequence);
    });
  }
});

// One keyed fixture, two clusters, bound each to its function (the family's documented
// departure from bare arrays, as titles.json; vectors/analysis/README.md).
const sittingsFixture = JSON.parse(
  readFileSync(join(vectorsRoot, "sittings.json"), "utf8"),
) as {
  readonly collapseIdle: CollapseIdleCase[];
  readonly sittings: SittingsCase[];
};

describe("collapseIdle vectors (vectors/analysis/sittings.json, collapseIdle cluster)", () => {
  it("adopts all 8 cases; a miscount means a case was silently skipped", () => {
    expect(sittingsFixture.collapseIdle).toHaveLength(8);
  });

  for (const c of sittingsFixture.collapseIdle) {
    it(c.name, () => {
      expect(collapseIdle(c.given.events)).toEqual(c.then.events);
    });
  }
});

describe("sittings vectors (vectors/analysis/sittings.json, sittings cluster)", () => {
  it("adopts all 10 cases; a miscount means a case was silently skipped", () => {
    expect(sittingsFixture.sittings).toHaveLength(10);
  });

  for (const c of sittingsFixture.sittings) {
    it(c.name, () => {
      // INV-6: then carries counts and seconds only, so equality proves the wire projection
      // never surfaces a userId, a value, or a solution letter.
      expect(sittings(c.given.events, buildSolution(c.given.solution))).toEqual(
        c.then,
      );
    });
  }
});

// Targeted assertions naming the invariants they defend, on top of the fixture sweep.
describe("analysis invariants", () => {
  it("INV-6: the solve trace carries user ids only, never a solution value", () => {
    // STAR is the only value that could leak; no trace entry may carry it.
    const solution: Solution = new Map([[0, "STAR"]]);
    const trace = solveTrace(
      [{ seq: 1, cell: 0, userId: "u1", value: "STAR", at: 1000 }],
      solution,
    );
    const fields = trace.flatMap((e) => Object.values(e));
    expect(trace.map((e) => e.userId)).toEqual(["u1"]);
    expect(fields).not.toContain("STAR");
  });

  it("INV-6: the solve sequence carries cells and relative times only, never a user id or a solution value", () => {
    // A two-entry trace with a distinct owner per fill. The sequence maps to {cell, atSeconds}
    // only, so neither user id nor any solution value can surface through the projection.
    const trace: TraceEntry[] = [
      { cell: 0, userId: "u1", seq: 1, at: 1000 },
      { cell: 1, userId: "u2", seq: 2, at: 5000 },
    ];
    const values = solveSequence(trace).flatMap((step) => Object.values(step));
    expect(values).not.toContain("u1");
    expect(values).not.toContain("u2");
    expect(solveSequence(trace)).toEqual([
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 4 },
    ]);
  });

  it("INV-1: rebus first-character acceptance enters the trace via matches, ASCII case-insensitively", () => {
    // matches("STAR", "s") is true (first char, ASCII casing); the S writer sets the entry.
    const solution: Solution = new Map([[0, "STAR"]]);
    const trace = solveTrace(
      [
        { seq: 4, cell: 0, userId: "u1", value: "s", at: 4000 },
        { seq: 8, cell: 0, userId: "u2", value: "STAR", at: 8000 },
      ],
      solution,
    );
    expect(trace).toEqual([{ cell: 0, userId: "u1", seq: 4, at: 4000 }]);
  });

  it("INV-9: momentum is deterministic and its constants are the named engine values (no clock, no magic number)", () => {
    // A pure function of its input: same trace, same samples, always length MOMENTUM_SAMPLES.
    expect(MOMENTUM_SAMPLES).toBe(40);
    const trace: TraceEntry[] = [
      { cell: 0, userId: "u1", seq: 1, at: 0 },
      { cell: 1, userId: "u2", seq: 2, at: 39000 },
    ];
    const a = momentum(trace);
    const b = momentum(trace);
    expect(a).toEqual(b);
    expect(a.samples).toHaveLength(MOMENTUM_SAMPLES);
  });

  it("INV-9: the burst window is the named BURST_WINDOW_MS constant, inclusive of its edge", () => {
    expect(BURST_WINDOW_MS).toBe(30_000);
    // A single dominant gap (1s -> 100s) makes the break the fill at 100s. Two more fills
    // follow: one exactly at breakAt + BURST_WINDOW_MS (edge, counted), one 1ms past
    // (excluded). The break counts itself and the edge fill: burst 2.
    const breakAt = 100_000;
    const trace: TraceEntry[] = [
      { cell: 0, userId: "u1", seq: 1, at: 0 },
      { cell: 1, userId: "u2", seq: 2, at: 1_000 },
      { cell: 2, userId: "u3", seq: 3, at: breakAt },
      { cell: 3, userId: "u1", seq: 4, at: breakAt + BURST_WINDOW_MS },
      { cell: 4, userId: "u2", seq: 5, at: breakAt + BURST_WINDOW_MS + 1 },
    ];
    expect(moments(trace).turningPoint).toEqual({
      stallSeconds: 99,
      breakSeconds: 100,
      burst: 2,
    });
  });
});

// Targeted sittings assertions (D29), on top of the fixture sweep.
describe("sittings invariants (D29)", () => {
  /** Shorthand: a correct-by-construction write event for these tests. */
  const fill = (seq: number, cell: number, at: number, value = "A") => ({
    seq,
    cell,
    userId: seq % 2 === 1 ? "u1" : "u2",
    value,
    at,
  });

  it("D29: SITTING_GAP_MS is the named frozen constant (30 minutes), never a magic number", () => {
    expect(SITTING_GAP_MS).toBe(1_800_000);
  });

  it("D29: a gap of exactly SITTING_GAP_MS is a boundary; one millisecond under is not", () => {
    // >= splits: the exact-threshold gap collapses in full, the seam shares active instant 0.
    expect(collapseIdle([fill(1, 0, 0), fill(2, 1, SITTING_GAP_MS)])).toEqual([
      fill(1, 0, 0),
      { ...fill(2, 1, SITTING_GAP_MS), at: 0 },
    ]);
    // One millisecond under stays one sitting: the identity mapping.
    const under = [fill(1, 0, 0), fill(2, 1, SITTING_GAP_MS - 1)];
    expect(collapseIdle(under)).toEqual(under);
  });

  it("D29: a negative gap (clock skew across writers) never splits a sitting", () => {
    // Seq order puts the later event hours earlier on the wall clock: the gap is negative,
    // under the threshold, so nothing collapses however large its magnitude.
    const skewed = [
      fill(1, 0, 10 * SITTING_GAP_MS),
      fill(2, 1, 0),
      fill(3, 2, 60_000),
    ];
    expect(collapseIdle(skewed)).toEqual(skewed);
    expect(
      sittings(
        skewed,
        new Map([
          [0, "A"],
          [1, "A"],
          [2, "A"],
        ]),
      ).count,
    ).toBe(1);
  });

  it("D29: activity is any event — a wrong write bridges what the trace alone would call a gap", () => {
    // Two fills 50 minutes apart would split; a wrong write halfway is presence (each gap
    // 25 minutes, under the threshold), so the partition over the FULL log (never the
    // first-correct trace) sees one sitting.
    const solution: Solution = new Map([
      [0, "A"],
      [1, "B"],
    ]);
    const gapMs = 2 * SITTING_GAP_MS - 600_000;
    const bridged = [
      fill(1, 0, 0, "A"),
      fill(2, 1, gapMs / 2, "Z"),
      fill(3, 1, gapMs, "B"),
    ];
    expect(sittings(bridged, solution).count).toBe(1);
    // The contrast: drop the bridge and the same fills split into two sittings.
    const unbridged = [fill(1, 0, 0, "A"), fill(3, 1, gapMs, "B")];
    expect(sittings(unbridged, solution).count).toBe(2);
  });

  it("D29: no gap at the threshold means the identity mapping (the compat proof)", () => {
    // Every pre-sittings analysis case is single-sitting; collapseIdle must leave such a
    // log byte-identical so the re-base changes nothing downstream.
    const singleSitting = [
      fill(1, 0, 5_000),
      fill(2, 1, 65_000),
      fill(3, 2, 65_000 + SITTING_GAP_MS - 1),
    ];
    expect(collapseIdle(singleSitting)).toEqual(singleSitting);
  });

  it("D29: a fill-less trailing sitting clamps to a zero-width span at the axis end, count stays honest", () => {
    // The vectors pin the fill-less FIRST sitting at the origin; this pins the mirror: a
    // wrong-writes-only return two hours after the last fill degenerates to [60, 60].
    const solution: Solution = new Map([
      [0, "A"],
      [1, "B"],
    ]);
    const result = sittings(
      [
        fill(1, 0, 0, "A"),
        fill(2, 1, 60_000, "B"),
        fill(3, 1, 60_000 + 7_200_000, "Z"),
      ],
      solution,
    );
    expect(result).toEqual({
      count: 2,
      spans: [
        { startSeconds: 0, endSeconds: 60 },
        { startSeconds: 60, endSeconds: 60 },
      ],
      wallSeconds: 60,
    });
  });

  it("INV-9: collapseIdle and sittings are pure — deterministic, no clock, inputs never mutated", () => {
    // Timestamps arrive as data (epoch ms); same input, same output, and the caller's
    // events keep their wall-clock ats after the remap returns.
    const events = [fill(1, 0, 1_000), fill(2, 1, 1_000 + SITTING_GAP_MS)];
    const snapshot = events.map((e) => ({ ...e }));
    const solution: Solution = new Map([
      [0, "A"],
      [1, "A"],
    ]);
    expect(collapseIdle(events)).toEqual(collapseIdle(events));
    expect(sittings(events, solution)).toEqual(sittings(events, solution));
    expect(events).toEqual(snapshot);
  });

  it("INV-6: the sittings projection carries counts and seconds only, never a value or a user id", () => {
    const solution: Solution = new Map([[0, "STAR"]]);
    const result = sittings(
      [{ seq: 1, cell: 0, userId: "u1", value: "STAR", at: 1_000 }],
      solution,
    );
    const leaves = [
      result.count,
      result.wallSeconds,
      ...result.spans.flatMap((s) => Object.values(s)),
    ];
    expect(leaves.every((v) => typeof v === "number")).toBe(true);
  });
});
