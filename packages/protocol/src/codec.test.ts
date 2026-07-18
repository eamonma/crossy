// Contract snapshot tests for the wire codec. Fixtures are the literal message examples from
// PROTOCOL.md §§2, 4, 5, 6; the decoders are made to satisfy them (TDD). Each `then` object is the
// exact decoded shape, so a schema drift from PROTOCOL.md fails here.
import { describe, expect, it } from "vitest";
import {
  decodeBoard,
  decodeClientMessage,
  decodeServerMessage,
  encode,
} from "./codec";

// The §4 board example, with `<userId>` and the trailing `...` made concrete.
const BOARD_FIXTURE = {
  seq: 412,
  status: "ongoing",
  firstFillAt: "2026-07-07T19:02:11Z",
  completedAt: null,
  abandonedAt: null,
  cells: [
    { v: "A", by: "u1" },
    { v: null, by: null },
  ],
  checkedWrongCells: [3, 17],
  checkCount: 1,
  checkVote: null,
  participants: [
    {
      userId: "u1",
      displayName: "Ana",
      avatarUrl: "https://cdn.discordapp.com/avatars/u1/hash.png",
      color: "#7F77DD",
      role: "host",
      connected: true,
    },
  ],
  cursors: [{ userId: "u1", cell: 17, direction: "across" }],
  recentCommandIds: ["cmd-1", "cmd-2"],
  stats: null,
};

// Assert the decode succeeded without erasing the discriminated-union value type: the caller's
// own `if (result.ok)` then narrows to the real message type.
function assertOk(result: { readonly ok: boolean }): void {
  expect(result.ok).toBe(true);
}

describe("board payload (PROTOCOL.md §4)", () => {
  it("decodes the §4 example verbatim", () => {
    const result = decodeBoard(BOARD_FIXTURE);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(BOARD_FIXTURE);
  });

  it("decodes a completed board with non-null stats", () => {
    const completed = {
      ...BOARD_FIXTURE,
      status: "completed",
      completedAt: "2026-07-07T19:40:03Z",
      stats: {
        solveTimeSeconds: 2272,
        totalEvents: 899,
        participantCount: 4,
        checkCount: 2,
      },
    };
    const result = decodeBoard(completed);
    assertOk(result);
    if (result.ok) expect(result.value.stats).toEqual(completed.stats);
  });

  it("decodes stats carrying activeSolveSeconds and sittingCount (additive, §4, D29)", () => {
    const completed = {
      ...BOARD_FIXTURE,
      status: "completed",
      completedAt: "2026-07-07T19:40:03Z",
      stats: {
        solveTimeSeconds: 29160,
        totalEvents: 899,
        participantCount: 4,
        checkCount: 2,
        activeSolveSeconds: 360,
        sittingCount: 2,
      },
    };
    const result = decodeBoard(completed);
    assertOk(result);
    if (result.ok) expect(result.value.stats).toEqual(completed.stats);
  });

  it("tolerates stats frozen before sittings shipped: absence decodes clean, no keys invented (§4, D29)", () => {
    const frozen = {
      solveTimeSeconds: 2272,
      totalEvents: 899,
      participantCount: 4,
      checkCount: 2,
    };
    const result = decodeBoard({
      ...BOARD_FIXTURE,
      status: "completed",
      completedAt: "2026-07-07T19:40:03Z",
      stats: frozen,
    });
    assertOk(result);
    // No activeSolveSeconds/sittingCount keys appear, so `toEqual` against the input holds and
    // a client's fallback to solveTimeSeconds engages (§4: never backfilled).
    if (result.ok) expect(result.value.stats).toEqual(frozen);
  });

  it("decodes a board carrying an open check vote (PROTOCOL.md §4, §10; D32)", () => {
    const withVote = {
      ...BOARD_FIXTURE,
      checkVote: {
        openedSeq: 740,
        by: "u1",
        electorate: ["u1", "u2", "u3"],
        approvals: ["u1"],
        rejections: [],
        needed: 2,
        expiresAt: "2026-07-07T19:32:10Z",
      },
    };
    const result = decodeBoard(withVote);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(withVote);
  });

  it("tolerates a board with no checkVote key, so a pre-vote snapshot still decodes (additive, §14)", () => {
    const { checkVote, ...noVote } = BOARD_FIXTURE;
    void checkVote;
    const result = decodeBoard(noVote);
    assertOk(result);
    // No checkVote key is invented when the snapshot omits it.
    if (result.ok) expect(result.value).toEqual(noVote);
  });

  it("rejects a board missing a required field as malformed", () => {
    const { seq, ...noSeq } = BOARD_FIXTURE;
    void seq;
    const result = decodeBoard(noSeq);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });
});

describe("handshake (PROTOCOL.md §2)", () => {
  it("decodes the §2 hello example, resumeFromSeq included", () => {
    const hello = {
      type: "hello",
      protocolVersion: 1,
      token: "<access JWT>",
      resumeFromSeq: 123,
    };
    const result = decodeClientMessage(hello);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(hello);
  });

  it("decodes hello without the optional resumeFromSeq", () => {
    const hello = { type: "hello", protocolVersion: 1, token: "jwt" };
    const result = decodeClientMessage(hello);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(hello);
  });

  it("decodes the §2 welcome example with an embedded board", () => {
    const welcome = {
      type: "welcome",
      protocolVersion: 1,
      self: { userId: "u1", role: "solver" },
      board: BOARD_FIXTURE,
    };
    const result = decodeServerMessage(welcome);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(welcome);
  });

  it("versioning posture: a hello for an unsupported version still decodes; the server negotiates (§2, §14)", () => {
    const future = { type: "hello", protocolVersion: 999, token: "jwt" };
    const result = decodeClientMessage(future);
    assertOk(result);
    if (result.ok && result.value.type === "hello") {
      expect(result.value.protocolVersion).toBe(999);
    }
  });
});

describe("client to server messages (PROTOCOL.md §5)", () => {
  const cases: Array<{ name: string; frame: Record<string, unknown> }> = [
    {
      name: "placeLetter",
      frame: { type: "placeLetter", commandId: "c1", cell: 17, value: "A" },
    },
    {
      name: "clearCell",
      frame: { type: "clearCell", commandId: "c2", cell: 17 },
    },
    {
      name: "moveCursor",
      frame: { type: "moveCursor", cell: 17, direction: "across" },
    },
    {
      name: "react",
      frame: { type: "react", emoji: "🎉", cell: 17 },
    },
    { name: "checkPuzzle", frame: { type: "checkPuzzle", commandId: "c3" } },
    {
      name: "castCheckVote",
      frame: {
        type: "castCheckVote",
        commandId: "c4",
        voteSeq: 740,
        approve: true,
      },
    },
    { name: "heartbeat", frame: { type: "heartbeat" } },
    { name: "requestSync", frame: { type: "requestSync" } },
  ];

  for (const { name, frame } of cases) {
    it(`decodes ${name} to its exact shape`, () => {
      const result = decodeClientMessage(frame);
      assertOk(result);
      if (result.ok) expect(result.value).toEqual(frame);
    });
  }

  it("maps an unrecognized command type to unknown_type (PROTOCOL.md §5 UNKNOWN_TYPE)", () => {
    const result = decodeClientMessage({ type: "frobnicate", commandId: "c9" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unknown_type");
      expect(result.error.type).toBe("frobnicate");
    }
  });

  it("rejects a placeLetter missing value as malformed", () => {
    const result = decodeClientMessage({
      type: "placeLetter",
      commandId: "c1",
      cell: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });
});

describe("sequenced events (PROTOCOL.md §6)", () => {
  it("decodes the §6 cellSet example", () => {
    const cellSet = {
      type: "cellSet",
      seq: 413,
      cell: 17,
      value: "A",
      by: "u1",
      commandId: "c1",
      at: "2026-07-07T19:02:11Z",
    };
    const result = decodeServerMessage(cellSet);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(cellSet);
  });

  it("decodes a cellSet with a null value (a clear)", () => {
    const cleared = {
      type: "cellSet",
      seq: 414,
      cell: 17,
      value: null,
      by: "u2",
      commandId: "c2",
      at: "2026-07-07T19:03:00Z",
    };
    const result = decodeServerMessage(cleared);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(cleared);
  });

  it("decodes the first-fill cellSet carrying firstFillAt on the delta path (§6)", () => {
    const firstFill = {
      type: "cellSet",
      seq: 8,
      cell: 0,
      value: "A",
      by: "u1",
      commandId: "c-first",
      at: "2026-07-07T19:02:11Z",
      firstFillAt: "2026-07-07T19:02:11Z",
    };
    const result = decodeServerMessage(firstFill);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(firstFill);
  });

  it("omits firstFillAt when absent, so an older/non-first cellSet is unchanged (§3, §6, §14)", () => {
    const later = {
      type: "cellSet",
      seq: 9,
      cell: 1,
      value: "B",
      by: "u2",
      commandId: "c-second",
      at: "2026-07-07T19:03:00Z",
    };
    const result = decodeServerMessage(later);
    assertOk(result);
    // The decoded value carries no firstFillAt key, so `toEqual` against the input holds.
    if (result.ok) expect(result.value).toEqual(later);
  });

  it("decodes the §6 gameCompleted example", () => {
    const completed = {
      type: "gameCompleted",
      seq: 900,
      at: "2026-07-07T19:40:03Z",
      stats: {
        solveTimeSeconds: 2272,
        totalEvents: 899,
        participantCount: 4,
        checkCount: 2,
      },
    };
    const result = decodeServerMessage(completed);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(completed);
  });

  it("decodes the §6 puzzleChecked example: sequenced, attributed by the proposer, wrongCells indices only (§10, D32, INV-6)", () => {
    const checked = {
      type: "puzzleChecked",
      seq: 743,
      wrongCells: [3, 17, 44],
      checkCount: 2,
      by: "u1",
      commandId: "c-check",
      at: "2026-07-07T19:31:44Z",
    };
    const result = decodeServerMessage(checked);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(checked);
  });

  it("tolerates a puzzleChecked without by, so a pre-vote frame still decodes (additive, §14)", () => {
    const checked = {
      type: "puzzleChecked",
      seq: 742,
      wrongCells: [3, 17, 44],
      checkCount: 2,
      commandId: "c-check",
      at: "2026-07-07T19:31:40Z",
    };
    const result = decodeServerMessage(checked);
    assertOk(result);
    // No `by` key is invented when the frame omits it.
    if (result.ok) expect(result.value).toEqual(checked);
  });

  it("decodes the §6 checkVoteOpened example: proposer, frozen electorate, needed, expiresAt (§10, D32)", () => {
    const opened = {
      type: "checkVoteOpened",
      seq: 740,
      by: "u1",
      electorate: ["u1", "u2", "u3"],
      needed: 2,
      expiresAt: "2026-07-07T19:32:10Z",
      commandId: "c-check",
      at: "2026-07-07T19:31:40Z",
    };
    const result = decodeServerMessage(opened);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(opened);
  });

  it("decodes the §6 checkVoteCast example: voteSeq identity, voter, ballot (§10, D32)", () => {
    const cast = {
      type: "checkVoteCast",
      seq: 741,
      voteSeq: 740,
      by: "u2",
      approve: true,
      commandId: "c-ballot",
      at: "2026-07-07T19:31:44Z",
    };
    const result = decodeServerMessage(cast);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(cast);
  });

  it("decodes the §6 checkVoteClosed passed example: no reason on a pass (§10, D32)", () => {
    const closed = {
      type: "checkVoteClosed",
      seq: 742,
      voteSeq: 740,
      outcome: "passed",
      at: "2026-07-07T19:31:44Z",
    };
    const result = decodeServerMessage(closed);
    assertOk(result);
    // No `reason` key is invented on a passing close.
    if (result.ok) expect(result.value).toEqual(closed);
  });

  it("decodes a checkVoteClosed failed EXPIRED, carrying the reason (§10, D32)", () => {
    const closed = {
      type: "checkVoteClosed",
      seq: 812,
      voteSeq: 800,
      outcome: "failed",
      reason: "EXPIRED",
      at: "2026-07-07T19:32:10Z",
    };
    const result = decodeServerMessage(closed);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(closed);
  });

  it("rejects a checkVoteClosed with an unknown outcome as malformed (§10, D32)", () => {
    const result = decodeServerMessage({
      type: "checkVoteClosed",
      seq: 742,
      voteSeq: 740,
      outcome: "vetoed",
      at: "2026-07-07T19:31:44Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("rejects a checkVoteClosed with an unknown reason as malformed (§10, D32)", () => {
    const result = decodeServerMessage({
      type: "checkVoteClosed",
      seq: 742,
      voteSeq: 740,
      outcome: "cancelled",
      reason: "BORED",
      at: "2026-07-07T19:31:44Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("rejects a puzzleChecked with a negative wrongCells index as malformed (§3 cell indexing)", () => {
    const result = decodeServerMessage({
      type: "puzzleChecked",
      seq: 742,
      wrongCells: [3, -1],
      checkCount: 2,
      commandId: "c-check",
      at: "2026-07-07T19:31:40Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("rejects a puzzleChecked missing seq as malformed (it is a sequenced event, §6)", () => {
    const result = decodeServerMessage({
      type: "puzzleChecked",
      wrongCells: [3],
      checkCount: 1,
      commandId: "c-check",
      at: "2026-07-07T19:31:40Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("decodes the §6 gameAbandoned example", () => {
    const abandoned = {
      type: "gameAbandoned",
      seq: 641,
      at: "2026-07-07T19:41:00Z",
      by: "u1",
    };
    const result = decodeServerMessage(abandoned);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(abandoned);
  });
});

describe("ephemeral notices (PROTOCOL.md §6)", () => {
  const cases: Array<{ name: string; frame: Record<string, unknown> }> = [
    { name: "sync", frame: { type: "sync", board: BOARD_FIXTURE } },
    {
      name: "playerConnected",
      frame: {
        type: "playerConnected",
        userId: "u2",
        displayName: "Bo",
        avatarUrl: "https://www.gravatar.com/avatar/abc?d=404",
        color: "#33AA88",
        role: "solver",
      },
    },
    {
      name: "playerDisconnected",
      frame: { type: "playerDisconnected", userId: "u2" },
    },
    {
      name: "cursor",
      frame: { type: "cursor", userId: "u2", cell: 5, direction: "down" },
    },
    {
      name: "reaction",
      frame: { type: "reaction", userId: "u2", emoji: "🎉", cell: 5 },
    },
    { name: "kicked", frame: { type: "kicked", reason: "removed by host" } },
  ];

  for (const { name, frame } of cases) {
    it(`decodes ${name} to its exact shape`, () => {
      const result = decodeServerMessage(frame);
      assertOk(result);
      if (result.ok) expect(result.value).toEqual(frame);
    });
  }

  it("ignores an unknown notice type (PROTOCOL.md §3: ignore and log)", () => {
    const result = decodeServerMessage({ type: "sparkle", glitter: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unknown_type");
  });

  it("no longer knows the removed per-user checkRequest/checkResult pair (§14 amendment; D27)", () => {
    // The room check is the only check: the old pair was removed, not kept alongside.
    const request = decodeClientMessage({
      type: "checkRequest",
      commandId: "c3",
    });
    expect(request.ok).toBe(false);
    if (!request.ok) expect(request.error.kind).toBe("unknown_type");
    const reply = decodeServerMessage({
      type: "checkResult",
      commandId: "c4",
      wrongCells: [3],
    });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe("unknown_type");
  });
});

describe("emoji reactions: shape only, receive-any (PROTOCOL.md §5, §6, §9)", () => {
  it("decodes a react whose emoji is outside the v1 set: receive-any, the codec checks shape not set membership (§9)", () => {
    const result = decodeClientMessage({ type: "react", emoji: "🔥", cell: 3 });
    assertOk(result);
    if (result.ok && result.value.type === "react") {
      expect(result.value.emoji).toBe("🔥");
    }
  });

  it("decodes a reaction whose emoji is outside the v1 set: a receiver MUST NOT reject an unknown emoji (receive-any, send-gated, §9)", () => {
    const result = decodeServerMessage({
      type: "reaction",
      userId: "u2",
      emoji: "🦀",
      cell: 3,
    });
    assertOk(result);
    if (result.ok && result.value.type === "reaction") {
      expect(result.value.emoji).toBe("🦀");
    }
  });

  it("ignores unknown extra fields on react and reaction (forward compatibility, §3)", () => {
    const react = decodeClientMessage({
      type: "react",
      emoji: "🎉",
      cell: 3,
      futureField: { nested: true },
    });
    assertOk(react);
    if (react.ok) {
      expect(react.value).not.toHaveProperty("futureField");
      expect(react.value).toEqual({ type: "react", emoji: "🎉", cell: 3 });
    }
    const reaction = decodeServerMessage({
      type: "reaction",
      userId: "u2",
      emoji: "🎉",
      cell: 3,
      futureField: 1,
    });
    assertOk(reaction);
    if (reaction.ok) expect(reaction.value).not.toHaveProperty("futureField");
  });

  it("rejects a react missing emoji as malformed", () => {
    const result = decodeClientMessage({ type: "react", cell: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("rejects a reaction with a mistyped cell as malformed", () => {
    const result = decodeServerMessage({
      type: "reaction",
      userId: "u2",
      emoji: "🎉",
      cell: "3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("rejects an empty emoji as malformed (non-empty shape rule, §9)", () => {
    const result = decodeClientMessage({ type: "react", emoji: "", cell: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("rejects an emoji over 32 UTF-8 bytes as malformed (§9)", () => {
    // Nine 🎉 graphemes are 36 UTF-8 bytes (4 each), past the 32-byte shape cap.
    const result = decodeClientMessage({
      type: "react",
      emoji: "🎉".repeat(9),
      cell: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("accepts an emoji exactly at the 32 UTF-8 byte cap (§9)", () => {
    // Eight 🎉 graphemes are exactly 32 UTF-8 bytes, the inclusive boundary.
    const result = decodeClientMessage({
      type: "react",
      emoji: "🎉".repeat(8),
      cell: 3,
    });
    assertOk(result);
  });
});

describe("participant avatarUrl (PROTOCOL.md §4)", () => {
  it("decodes a null avatarUrl as a first-class value, not an error", () => {
    const board = {
      ...BOARD_FIXTURE,
      participants: [{ ...BOARD_FIXTURE.participants[0], avatarUrl: null }],
    };
    const result = decodeBoard(board);
    assertOk(result);
    if (result.ok) expect(result.value.participants[0]?.avatarUrl).toBeNull();
  });

  it("preserves the avatarUrl string opaquely, no provider inference", () => {
    const url = "https://cdn.discordapp.com/avatars/u1/hash.png";
    const result = decodeBoard(BOARD_FIXTURE);
    assertOk(result);
    if (result.ok) expect(result.value.participants[0]?.avatarUrl).toBe(url);
  });

  it("rejects a non-string, non-null avatarUrl as malformed", () => {
    const board = {
      ...BOARD_FIXTURE,
      participants: [{ ...BOARD_FIXTURE.participants[0], avatarUrl: 42 }],
    };
    const result = decodeBoard(board);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });

  it("carries avatarUrl on playerConnected too (PROTOCOL.md §6)", () => {
    const result = decodeServerMessage({
      type: "playerConnected",
      userId: "u2",
      displayName: "Bo",
      avatarUrl: null,
      color: "#33AA88",
      role: "solver",
    });
    assertOk(result);
    if (result.ok && result.value.type === "playerConnected") {
      expect(result.value.avatarUrl).toBeNull();
    }
  });
});

describe("error message (PROTOCOL.md §6, §11)", () => {
  it("decodes a non-fatal error carrying a commandId", () => {
    const err = {
      type: "error",
      code: "INVALID_VALUE",
      message: "fails ^[A-Z0-9]{1,10}$",
      fatal: false,
      commandId: "c1",
    };
    const result = decodeServerMessage(err);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(err);
  });

  it("decodes a fatal error without a commandId", () => {
    const err = {
      type: "error",
      code: "PROTOCOL_VERSION_UNSUPPORTED",
      message: "supported: {1}",
      fatal: true,
    };
    const result = decodeServerMessage(err);
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(err);
  });

  it("rejects an unknown error code as malformed", () => {
    const result = decodeServerMessage({
      type: "error",
      code: "NONSENSE",
      message: "x",
      fatal: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed");
  });
});

describe("parse posture (PROTOCOL.md §3, §14)", () => {
  it("ignores unknown fields, returning a clean object (forward compatibility)", () => {
    const withExtra = {
      type: "cellSet",
      seq: 1,
      cell: 0,
      value: "A",
      by: "u1",
      commandId: "c1",
      at: "2026-07-07T00:00:00Z",
      futureField: { nested: true },
    };
    const result = decodeServerMessage(withExtra);
    assertOk(result);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("futureField");
      expect(Object.keys(result.value).sort()).toEqual(
        ["at", "by", "cell", "commandId", "seq", "type", "value"].sort(),
      );
    }
  });

  it("rejects a non-object frame and a frame with no type as malformed", () => {
    for (const bad of [42, "string", null, [], {}, { type: 7 }]) {
      const result = decodeClientMessage(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("malformed");
    }
  });
});

describe("round trip: encode then decode", () => {
  it("preserves a client message", () => {
    const msg = { type: "placeLetter", commandId: "c1", cell: 3, value: "Z" };
    const result = decodeClientMessage(JSON.parse(encode(msg as never)));
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(msg);
  });

  it("preserves a server message with a board", () => {
    const welcome = {
      type: "welcome",
      protocolVersion: 1,
      self: { userId: "u1", role: "spectator" },
      board: BOARD_FIXTURE,
    };
    const result = decodeServerMessage(JSON.parse(encode(welcome as never)));
    assertOk(result);
    if (result.ok) expect(result.value).toEqual(welcome);
  });
});
