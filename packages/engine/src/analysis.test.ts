/**
 * Runs the post-game analysis reducers against the vectors/analysis/ conformance family,
 * the golden written before these projections (CLAUDE.md house rule; PROTOCOL.md §13,
 * design/post-game/ANALYSIS.md). A narrow per-family reader: it globs each fixture, runs
 * the matching reducer, and deep-equals the result against the case's `then`.
 *
 * - solve-trace.json: solveTrace(given.events, new Map(given.solution)) === then.trace.
 * - momentum.json:    momentum(given.trace) === then ({durationSeconds, samples}).
 * - moments.json:     moments(given.trace) === then ({firstToFall, lastSquare, turningPoint}).
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
  MOMENTUM_SAMPLES,
  moments,
  momentum,
  solveSequence,
  solveTrace,
} from "./index";
import type {
  Beat,
  SequenceStep,
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

interface MomentumCase {
  readonly name: string;
  readonly given: { readonly trace: TraceEntry[] };
  readonly then: {
    readonly durationSeconds: number;
    readonly samples: number[];
  };
}

interface MomentsCase {
  readonly name: string;
  readonly given: { readonly trace: TraceEntry[] };
  readonly then: {
    readonly firstToFall: Beat | null;
    readonly lastSquare: Beat | null;
    readonly turningPoint: TurningPoint | null;
  };
}

interface SequenceCase {
  readonly name: string;
  readonly given: { readonly trace: TraceEntry[] };
  readonly then: { readonly sequence: SequenceStep[] };
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
      expect(momentum(c.given.trace)).toEqual(c.then);
    });
  }
});

describe("moments vectors (vectors/analysis/moments.json)", () => {
  for (const c of loadCases<MomentsCase>("moments.json")) {
    it(c.name, () => {
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
      expect(solveSequence(c.given.trace)).toEqual(c.then.sequence);
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
