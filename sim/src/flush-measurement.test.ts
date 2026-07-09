// Flush measurement, a byproduct for the DESIGN.md section 15 / D14 threshold-tuning line
// (25 events / 5 s, adopted-by-default). It does NOT change the defaults; it drives the
// real actor at the real thresholds and records the batch size of every write-behind flush,
// so the numbers are data for that open question. Two regimes: sustained typing (the
// 25-event count threshold governs) and a slow trickle (the 5 s interval governs).

import { afterAll, describe, expect, it, vi } from "vitest";
import { Sim, RecordingPersistence } from "./sim";
import type { SimPuzzle } from "./sim";
import {
  FLUSH_EVENT_THRESHOLD,
  FLUSH_INTERVAL_MS,
} from "../../apps/session/src/actor";

/** A grid large enough that the driven streams never fill it (no terminal force-flush). */
const BIG_GRID: SimPuzzle = {
  rows: 12,
  cols: 12,
  blocks: [],
  solution: new Array<string>(144).fill("A"),
};

const report: string[] = [];

function summarize(label: string, batches: number[]): void {
  if (batches.length === 0) {
    report.push(`${label}: no flushes observed`);
    return;
  }
  const total = batches.reduce((a, b) => a + b, 0);
  const max = Math.max(...batches);
  const min = Math.min(...batches);
  const mean = (total / batches.length).toFixed(1);
  report.push(
    `${label}: ${batches.length} flushes, ${total} events, ` +
      `batch min/mean/max = ${min}/${mean}/${max}, batches = [${batches.join(", ")}]`,
  );
}

afterAll(() => {
  // Print the measurement so the run captures it as data for DESIGN.md section 15.
  const header =
    `flush thresholds in effect: ${FLUSH_EVENT_THRESHOLD} events / ` +
    `${FLUSH_INTERVAL_MS} ms (DESIGN.md section 15 defaults, unchanged)`;
  console.log(`\n[flush measurement]\n${header}\n${report.join("\n")}\n`);
});

describe("write-behind flush measurement at the DESIGN.md section 15 defaults", () => {
  it("D14: sustained typing flushes in batches bounded by the 25-event threshold", async () => {
    const persistence = new RecordingPersistence();
    const sim = new Sim({
      puzzle: BIG_GRID,
      clients: [{ role: "solver" }],
      // Empty options: the actor uses its own DESIGN.md section 15 default thresholds.
      actorOptions: {},
      persistence,
    });
    await sim.init();

    // 130 distinct-cell placements: every one is accepted, none completes the grid.
    const eventCount = 130;
    for (let cell = 0; cell < eventCount; cell++) sim.place(0, cell, "A");
    await sim.pump();
    await sim.actor.drain(); // flush the trailing partial batch, as SIGTERM would

    const batches = persistence.flushes.map((f) => f.batch);
    summarize("sustained load (count threshold)", batches);

    // The count threshold caps every non-final batch; nothing over-buffers past it.
    for (const flush of persistence.flushes) {
      expect(flush.batch).toBeLessThanOrEqual(FLUSH_EVENT_THRESHOLD);
    }
    // Every accepted event is durable exactly once (INV-5, no loss, no double-count).
    expect(batches.reduce((a, b) => a + b, 0)).toBe(eventCount);
  });

  it("D14: a slow trickle flushes on the 5 s interval, one small batch per interval", async () => {
    vi.useFakeTimers();
    try {
      const persistence = new RecordingPersistence();
      const sim = new Sim({
        puzzle: BIG_GRID,
        clients: [{ role: "solver" }],
        actorOptions: {},
        persistence,
      });
      await sim.init();

      // Three trickle bursts, each well under the count threshold, each followed by the
      // interval elapsing: the 5 s timer is what flushes them, not the event count.
      const bursts = [3, 5, 2];
      let cell = 0;
      for (const burst of bursts) {
        for (let i = 0; i < burst; i++) sim.place(0, cell++, "A");
        await sim.pump();
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
      }

      const batches = persistence.flushes.map((f) => f.batch);
      summarize("slow trickle (5 s interval)", batches);

      // Each interval flushed its burst: one flush per burst, matching the burst sizes.
      expect(batches).toEqual(bursts);
    } finally {
      vi.useRealTimers();
    }
  });
});
