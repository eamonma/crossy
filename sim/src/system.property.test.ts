// Randomized multi-client programs against the real pipeline. Each property runs a
// generated stream of commands and network faults (delay, single-frame loss forcing
// resync, disconnect and reconnect forcing snapshot reconciliation), settles the world,
// then asserts a system invariant. A failure prints its seed and shrinks to a minimal
// script; re-run with SIM_SEED=<n> to reproduce (the M2 exit criterion).

import { describe, it } from "vitest";
import fc from "fast-check";
import { programArb, runProgram } from "./arbitraries";
import { RUNS, simParams } from "./config";
import {
  assertConvergence,
  assertNoDoubleApply,
  assertTotalOrder,
} from "./asserts";

describe("system invariants under randomized multi-client sessions", () => {
  it("INV-2 total order: the server emits contiguous seq with no gaps or duplicates", async () => {
    await fc.assert(
      fc.asyncProperty(programArb(), async (program) => {
        const sim = await runProgram(program);
        await sim.settle();
        assertTotalOrder(sim);
      }),
      simParams(RUNS.inProcess),
    );
  });

  it("INV-10 convergence: after settle every client's rendered board equals the server's sequenced board", async () => {
    await fc.assert(
      fc.asyncProperty(programArb(), async (program) => {
        const sim = await runProgram(program);
        await sim.settle();
        assertConvergence(sim);
      }),
      simParams(RUNS.inProcess),
    );
  });

  it("idempotency (PROTOCOL.md section 5, section 8): a re-sent commandId within the window never double-applies", async () => {
    await fc.assert(
      fc.asyncProperty(programArb(), async (program) => {
        const sim = await runProgram(program);
        await sim.settle();
        assertNoDoubleApply(sim);
      }),
      simParams(RUNS.inProcess),
    );
  });
});
