// Hydration must be a lossless inverse of the flushed snapshot (INV-5): every fact the
// actor persisted comes back, including the terminal completion stats, which PROTOCOL.md
// §4 requires to be non-null on every completed snapshot. Before this coverage, a
// rehydrated completed game served `stats: null` and every client rendered the solvers
// and entries facts as missing.

import type { Stats } from "@crossy/protocol";
import { describe, expect, it } from "vitest";
import { hydrateGame } from "./hydrate";
import type { GameStateRow, PuzzleSnapshot } from "./hydrate";

const snapshot: PuzzleSnapshot = {
  rows: 1,
  cols: 3,
  blocks: [],
  solution: ["A", "B", "C"],
};

const stats: Stats = {
  solveTimeSeconds: 62,
  totalEvents: 3,
  participantCount: 2,
};

const completedRow: GameStateRow = {
  status: "completed",
  board: [
    { v: "A", by: "u1" },
    { v: "B", by: "u1" },
    { v: "C", by: "u2" },
  ],
  lastSeq: 4,
  firstFillAt: "2026-07-08T00:00:00.000Z",
  completedAt: "2026-07-08T00:01:02.000Z",
  abandonedAt: null,
  stats: stats as unknown as Record<string, unknown>,
  recentCommandIds: ["c-1", "c-2", "c-3"],
};

describe("hydrateGame stats round-trip (PROTOCOL.md §4; INV-5)", () => {
  it("carries the persisted completion stats through to the actor (PROTOCOL.md §4, INV-5)", () => {
    const hydrated = hydrateGame(snapshot, completedRow);
    expect(hydrated.stats).toEqual(stats);
  });

  it("hydrates null stats for an ongoing game (PROTOCOL.md §4: non-null only when completed)", () => {
    const hydrated = hydrateGame(snapshot, {
      ...completedRow,
      status: "ongoing",
      completedAt: null,
      stats: null,
    });
    expect(hydrated.stats).toBeNull();
  });

  it("hydrates null stats for a game with no game_state row", () => {
    const hydrated = hydrateGame(snapshot, null);
    expect(hydrated.stats).toBeNull();
  });
});
