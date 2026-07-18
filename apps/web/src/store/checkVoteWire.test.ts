// The web vote-wire shim (PROTOCOL.md §4, §6, §11; D32). Until @crossy/protocol grows these types,
// decodeWebServerMessage wraps the protocol codec: it decodes the three vote events and vote-coded
// errors the base codec would reject, attaches board.checkVote to snapshots and `by` to
// puzzleChecked, and passes everything else straight through. Nothing here carries a cell value
// (INV-6).
import { describe, expect, it } from "vitest";
import { decodeWebServerMessage, readOpenCheckVote } from "./checkVoteWire";

describe("§6 the three vote events decode (the base codec rejects them as unknown)", () => {
  it("decodes checkVoteOpened", () => {
    const r = decodeWebServerMessage({
      type: "checkVoteOpened",
      seq: 31,
      by: "u1",
      electorate: ["u1", "u2", "u3"],
      needed: 2,
      expiresAt: "2026-07-07T19:31:40Z",
      commandId: "c1",
      at: "2026-07-07T19:31:10Z",
    });
    expect(r.ok && r.value).toEqual({
      type: "checkVoteOpened",
      seq: 31,
      by: "u1",
      electorate: ["u1", "u2", "u3"],
      needed: 2,
      expiresAt: "2026-07-07T19:31:40Z",
      commandId: "c1",
      at: "2026-07-07T19:31:10Z",
    });
  });

  it("decodes checkVoteCast and checkVoteClosed, reason optional (§6)", () => {
    const cast = decodeWebServerMessage({
      type: "checkVoteCast",
      seq: 32,
      voteSeq: 31,
      by: "u2",
      approve: false,
      commandId: "c2",
      at: "2026-07-07T19:31:14Z",
    });
    expect(cast.ok && cast.value.type).toBe("checkVoteCast");

    const passed = decodeWebServerMessage({
      type: "checkVoteClosed",
      seq: 33,
      voteSeq: 31,
      outcome: "passed",
      at: "2026-07-07T19:31:14Z",
    });
    expect(passed.ok && passed.value).not.toHaveProperty("reason");

    const failed = decodeWebServerMessage({
      type: "checkVoteClosed",
      seq: 33,
      voteSeq: 31,
      outcome: "failed",
      reason: "REJECTED",
      at: "2026-07-07T19:31:14Z",
    });
    expect(failed.ok && failed.value).toMatchObject({
      outcome: "failed",
      reason: "REJECTED",
    });
  });

  it("rejects a malformed vote frame (a bad outcome) as malformed, not a crash", () => {
    const r = decodeWebServerMessage({
      type: "checkVoteClosed",
      seq: 33,
      voteSeq: 31,
      outcome: "nope",
      at: "x",
    });
    expect(r.ok).toBe(false);
  });
});

describe("§4/§6 snapshots gain board.checkVote and puzzleChecked gains by", () => {
  it("attaches board.checkVote off a welcome (null and the object both)", () => {
    const base = {
      type: "welcome" as const,
      protocolVersion: 1,
      self: { userId: "u1", role: "solver" as const },
      board: {
        seq: 1,
        status: "ongoing",
        firstFillAt: null,
        completedAt: null,
        abandonedAt: null,
        cells: [{ v: null, by: null }],
        checkedWrongCells: [],
        checkCount: 0,
        participants: [],
        cursors: [],
        recentCommandIds: [],
        stats: null,
      },
    };
    const withNull = decodeWebServerMessage(base);
    expect(
      withNull.ok &&
        withNull.value.type === "welcome" &&
        withNull.value.board.checkVote,
    ).toBeNull();

    const withVote = decodeWebServerMessage({
      ...base,
      board: {
        ...base.board,
        checkVote: {
          openedSeq: 1,
          by: "u1",
          electorate: ["u1"],
          approvals: ["u1"],
          rejections: [],
          needed: 1,
          expiresAt: "2026-07-07T19:31:40Z",
        },
      },
    });
    expect(
      withVote.ok &&
        withVote.value.type === "welcome" &&
        withVote.value.board.checkVote?.by,
    ).toBe("u1");
  });

  it("attaches by to puzzleChecked (D32 attribution), tolerating its absence", () => {
    const withBy = decodeWebServerMessage({
      type: "puzzleChecked",
      seq: 33,
      wrongCells: [0, 2],
      checkCount: 1,
      by: "u1",
      commandId: "c1",
      at: "2026-07-07T19:31:15Z",
    });
    expect(
      withBy.ok && withBy.value.type === "puzzleChecked" && withBy.value.by,
    ).toBe("u1");

    const bare = decodeWebServerMessage({
      type: "puzzleChecked",
      seq: 33,
      wrongCells: [1],
      checkCount: 1,
      commandId: "c1",
      at: "2026-07-07T19:31:15Z",
    });
    expect(
      bare.ok && bare.value.type === "puzzleChecked" && bare.value.by,
    ).toBeUndefined();
  });
});

describe("§11 vote-coded errors decode (asErrorCode would reject them)", () => {
  it("decodes a non-fatal VOTE_PENDING with its commandId", () => {
    const r = decodeWebServerMessage({
      type: "error",
      code: "VOTE_PENDING",
      message: "a vote is open",
      fatal: false,
      commandId: "p1",
    });
    expect(r.ok && r.value).toEqual({
      type: "error",
      code: "VOTE_PENDING",
      message: "a vote is open",
      fatal: false,
      commandId: "p1",
    });
  });

  it("passes a base error (a known code) straight through the protocol codec", () => {
    const r = decodeWebServerMessage({
      type: "error",
      code: "GRID_NOT_FULL",
      message: "fill it",
      fatal: false,
      commandId: "x1",
    });
    expect(r.ok && r.value.type).toBe("error");
  });
});

describe("readOpenCheckVote is tolerant (a bad vote never sinks a good snapshot)", () => {
  it("returns null for null/undefined and for a malformed object", () => {
    expect(readOpenCheckVote(null)).toBeNull();
    expect(readOpenCheckVote(undefined)).toBeNull();
    expect(readOpenCheckVote({ by: "u1" })).toBeNull();
  });
});
