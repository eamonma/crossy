// Completion invariants under generated races. INV-3: exactly one gameCompleted, ever,
// including the full-but-wrong board corrected by an in-place overwrite and two clients
// racing the final cells. INV-4: once terminal, every mutation is rejected and nothing
// mutates. Both run over randomized programs; a failure prints its seed.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { completionProgramArb, runProgram } from "./arbitraries";
import { RUNS, simParams } from "./config";
import { Sim, completedSeedState } from "./sim";
import type { SimPuzzle } from "./sim";
import { assertConvergence, assertFrozenAfterTerminal } from "./asserts";

const TERMINAL_PUZZLES: readonly SimPuzzle[] = [
  { rows: 1, cols: 2, blocks: [], solution: ["A", "B"] },
  { rows: 1, cols: 3, blocks: [], solution: ["A", "B", "C"] },
  { rows: 2, cols: 2, blocks: [], solution: ["A", "B", "C", "D"] },
];

describe("completion invariants under generated races", () => {
  it("INV-3 exactly one gameCompleted under last-cell races and in-place correction", async () => {
    await fc.assert(
      fc.asyncProperty(completionProgramArb(), async (program) => {
        const sim = await runProgram(program);
        await sim.settle();

        // Never more than one completion, whatever the interleaving (INV-3).
        expect(sim.completionCount()).toBeLessThanOrEqual(1);
        // A full, correct board completes exactly once (level-triggered, so an in-place
        // correction that leaves filledCount unchanged still fires it).
        if (sim.boardIsCorrectAndFull()) {
          expect(sim.completionCount()).toBe(1);
          expect(sim.serverBoard().status).toBe("completed");
        }
        // No cellSet ever follows the completion, and clients converge (INV-4, INV-10).
        assertFrozenAfterTerminal(sim);
        assertConvergence(sim);
      }),
      simParams(RUNS.inProcess),
    );
  });

  it("INV-4 terminal freeze: every mutation after a terminal event is rejected server-side", async () => {
    const postTerminalArb = fc
      .constantFrom(...TERMINAL_PUZZLES)
      .chain((puzzle) => {
        const numCells = puzzle.rows * puzzle.cols;
        const mutationArb = fc.record({
          cell: fc.integer({ min: 0, max: numCells - 1 }),
          value: fc.option(fc.constantFrom("A", "B", "Z"), { nil: null }),
        });
        return fc
          .array(mutationArb, { minLength: 1, maxLength: 8 })
          .map((mutations) => ({ puzzle, mutations }));
      });

    await fc.assert(
      fc.asyncProperty(postTerminalArb, async ({ puzzle, mutations }) => {
        const sim = new Sim({
          puzzle,
          clients: [{ role: "solver" }, { role: "solver" }],
          actorOptions: { flushEventThreshold: 1, flushIntervalMs: 6_000_000 },
          seedState: completedSeedState(puzzle),
        });
        await sim.init();

        for (const mutation of mutations) {
          const client = mutation.cell % 2;
          const codes = await sim.forceMutate(
            client,
            mutation.cell,
            mutation.value,
          );
          // The server rejects the mutation on the terminal state, before cell/value gates.
          expect(codes).toContain("GAME_NOT_ONGOING");
        }

        // Nothing mutated: no cellSet, no second completion, status still terminal (INV-4).
        expect(sim.completionCount()).toBe(0);
        expect(
          sim.sequencedServerEvents().some((e) => e.type === "cellSet"),
        ).toBe(false);
        expect(sim.serverBoard().status).toBe("completed");

        await sim.settle();
        assertConvergence(sim);
      }),
      simParams(RUNS.inProcess),
    );
  });
});
