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
  checkCount: 1,
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

  it("backfills checkCount: 0 into stats persisted before the room check landed (PROTOCOL.md §4; D27)", () => {
    const legacyStats = {
      solveTimeSeconds: 62,
      totalEvents: 3,
      participantCount: 2,
    };
    const hydrated = hydrateGame(snapshot, {
      ...completedRow,
      stats: legacyStats,
    });
    expect(hydrated.stats).toEqual({ ...legacyStats, checkCount: 0 });
  });
});

describe("hydrateGame room-check state round-trip (PROTOCOL.md §4, §10; D27; INV-5)", () => {
  it("restores the standing marks and the permanent count from the board snapshot object", () => {
    const hydrated = hydrateGame(snapshot, {
      ...completedRow,
      status: "ongoing",
      completedAt: null,
      stats: null,
      board: {
        cells: [
          { v: "X", by: "u1" },
          { v: "B", by: "u1" },
          { v: "C", by: "u2" },
        ],
        checkedWrongCells: [0],
        checkCount: 2,
      },
    });
    expect(hydrated.boardState.checkedWrong).toEqual(new Set([0]));
    expect(hydrated.boardState.checkCount).toBe(2);
    expect(hydrated.boardState.filledCount).toBe(3);
    expect(hydrated.boardState.cells.get(0)).toEqual({ v: "X", by: "u1" });
  });

  it("reads a legacy bare-array board as no standing marks and a zero count (expand/contract, DESIGN.md §9)", () => {
    const hydrated = hydrateGame(snapshot, {
      ...completedRow,
      status: "ongoing",
      completedAt: null,
      stats: null,
    });
    expect(hydrated.boardState.checkedWrong.size).toBe(0);
    expect(hydrated.boardState.checkCount).toBe(0);
    expect(hydrated.boardState.filledCount).toBe(3);
  });

  it("starts a never-played game with no marks and a zero count", () => {
    const hydrated = hydrateGame(snapshot, null);
    expect(hydrated.boardState.checkedWrong.size).toBe(0);
    expect(hydrated.boardState.checkCount).toBe(0);
  });
});

describe("hydrateGame open-vote round-trip (PROTOCOL.md §4, §10; D32; INV-5)", () => {
  const openVoteBoard = {
    cells: [
      { v: "X", by: "u1" },
      { v: "B", by: "u1" },
      { v: "C", by: "u2" },
    ],
    checkedWrongCells: [],
    checkCount: 0,
    checkVote: {
      openedSeq: 4,
      by: "u1",
      commandId: "c-open",
      electorate: ["u1", "u2", "u3"],
      approvals: ["u1"],
      rejections: [],
      expiresAt: "2026-07-08T00:05:00.000Z",
    },
  };

  it("restores the engine checkVote (without expiresAt) and carries expiresAt beside it (INV-9)", () => {
    const hydrated = hydrateGame(snapshot, {
      ...completedRow,
      status: "ongoing",
      completedAt: null,
      stats: null,
      lastSeq: 4,
      board: openVoteBoard,
    });
    // The engine board carries the pure vote fields, no clock (INV-9).
    expect(hydrated.boardState.checkVote).toEqual({
      openedSeq: 4,
      by: "u1",
      commandId: "c-open",
      electorate: ["u1", "u2", "u3"],
      approvals: ["u1"],
      rejections: [],
    });
    // The session-owned expiresAt rides HydratedGame separately, so the actor re-arms or expires.
    expect(hydrated.checkVoteExpiresAt).toBe("2026-07-08T00:05:00.000Z");
  });

  it("reads a legacy bare-array board and a pre-vote object as no open vote (expand/contract, §9)", () => {
    const legacy = hydrateGame(snapshot, {
      ...completedRow,
      status: "ongoing",
      completedAt: null,
      stats: null,
    });
    expect(legacy.boardState.checkVote).toBeNull();
    expect(legacy.checkVoteExpiresAt).toBeNull();

    const preVote = hydrateGame(snapshot, {
      ...completedRow,
      status: "ongoing",
      completedAt: null,
      stats: null,
      board: {
        cells: [{ v: "A", by: "u1" }],
        checkedWrongCells: [],
        checkCount: 0,
      },
    });
    expect(preVote.boardState.checkVote).toBeNull();
    expect(preVote.checkVoteExpiresAt).toBeNull();
  });
});
