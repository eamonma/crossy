// The store's check-vote behavior (PROTOCOL.md §4, §6, §7, §10, §11; D32). The three vote events are
// sequenced and apply under the same seq gate as cellSet; the open vote rides every snapshot and is
// replaced wholesale; a bare puzzleChecked (the rollout window) applies marks with no vote UI; and
// the four non-fatal vote errors clear the optimistic intent without drama. Test names cite the
// section/invariant they defend (house rule).
import { describe, expect, it } from "vitest";
import { GameStore } from "./gameStore";
import type { VoteClosedSignal } from "./gameStore";
import type {
  CheckVoteCastEvent,
  CheckVoteClosedEvent,
  CheckVoteOpenedEvent,
  OpenCheckVote,
  WebBoard,
  WebClientMessage,
} from "./checkVoteWire";

function board(overrides: Partial<WebBoard> = {}): WebBoard {
  return {
    seq: 30,
    status: "ongoing",
    firstFillAt: "2026-07-07T19:00:00Z",
    completedAt: null,
    abandonedAt: null,
    cells: Array.from({ length: 3 }, () => ({ v: "A", by: "u1" })),
    checkedWrongCells: [],
    checkCount: 0,
    checkVote: null,
    participants: [],
    cursors: [],
    recentCommandIds: [],
    stats: null,
    ...overrides,
  };
}

interface Harness {
  store: GameStore;
  sent: WebClientMessage[];
  closes: VoteClosedSignal[];
}

function makeStore(welcomeBoard: WebBoard, self = "u1"): Harness {
  const sent: WebClientMessage[] = [];
  const store = new GameStore({ transport: { send: (m) => sent.push(m) } });
  const closes: VoteClosedSignal[] = [];
  store.subscribeVoteClosed((c) => closes.push(c));
  store.receive({
    type: "welcome",
    protocolVersion: 1,
    self: { userId: self, role: "solver" },
    board: welcomeBoard,
  });
  return { store, sent, closes };
}

const opened = (
  o: Partial<CheckVoteOpenedEvent> = {},
): CheckVoteOpenedEvent => ({
  type: "checkVoteOpened",
  seq: 31,
  by: "u1",
  electorate: ["u1", "u2", "u3"],
  needed: 2,
  expiresAt: "2026-07-07T19:31:40Z",
  commandId: "c1",
  at: "2026-07-07T19:31:10Z",
  ...o,
});

const cast = (o: Partial<CheckVoteCastEvent> = {}): CheckVoteCastEvent => ({
  type: "checkVoteCast",
  seq: 32,
  voteSeq: 31,
  by: "u2",
  approve: true,
  commandId: "c2",
  at: "2026-07-07T19:31:14Z",
  ...o,
});

const closed = (
  o: Partial<CheckVoteClosedEvent> = {},
): CheckVoteClosedEvent => ({
  type: "checkVoteClosed",
  seq: 33,
  voteSeq: 31,
  outcome: "passed",
  at: "2026-07-07T19:31:14Z",
  ...o,
});

describe("§6/§7 checkVoteOpened is sequenced: applied under the seq gate, approvals start as [by]", () => {
  it("opens the vote at lastApplied+1 with approvals [proposer] and advances seq (§10)", () => {
    const { store } = makeStore(board());
    store.receive(opened());
    expect(store.seq).toBe(31);
    expect(store.checkVote).toEqual<OpenCheckVote>({
      openedSeq: 31,
      by: "u1",
      electorate: ["u1", "u2", "u3"],
      approvals: ["u1"],
      rejections: [],
      needed: 2,
      expiresAt: "2026-07-07T19:31:40Z",
    });
  });

  it("a gap (seq > lastApplied+1) resyncs and does not open the vote (§7)", () => {
    const { store, sent } = makeStore(board());
    store.receive(opened({ seq: 33 }));
    expect(store.sync).toBe("resyncing");
    expect(store.checkVote).toBeNull();
    expect(sent).toContainEqual({ type: "requestSync" });
  });
});

describe("§6 checkVoteCast records a ballot on the named vote, ascending (INV-1)", () => {
  it("adds an approval and a rejection to their ascending arrays", () => {
    const { store } = makeStore(board());
    store.receive(opened());
    store.receive(cast({ seq: 32, by: "u3", approve: true }));
    store.receive(cast({ seq: 33, by: "u2", approve: false }));
    expect(store.checkVote?.approvals).toEqual(["u1", "u3"]);
    expect(store.checkVote?.rejections).toEqual(["u2"]);
  });

  it("ignores a ballot whose voteSeq names a different vote (a stale ballot, §6)", () => {
    const { store } = makeStore(board());
    store.receive(opened());
    store.receive(cast({ seq: 32, voteSeq: 999, by: "u2" }));
    expect(store.checkVote?.approvals).toEqual(["u1"]);
  });
});

describe("§6 checkVoteClosed clears the vote and forwards the outcome (§10)", () => {
  it("passed: clears checkVote, forwards outcome passed with no reason", () => {
    const { store, closes } = makeStore(board());
    store.receive(opened());
    store.receive(cast({ seq: 32, by: "u2", approve: true }));
    store.receive(closed({ seq: 33, outcome: "passed" }));
    expect(store.checkVote).toBeNull();
    expect(closes).toEqual([{ voteSeq: 31, outcome: "passed" }]);
  });

  it("failed REJECTED and cancelled GRID_BROKEN forward their reason", () => {
    const a = makeStore(board());
    a.store.receive(opened());
    a.store.receive(closed({ seq: 32, outcome: "failed", reason: "REJECTED" }));
    expect(a.closes).toEqual([
      { voteSeq: 31, outcome: "failed", reason: "REJECTED" },
    ]);

    const b = makeStore(board());
    b.store.receive(opened());
    b.store.receive(
      closed({ seq: 32, outcome: "cancelled", reason: "GRID_BROKEN" }),
    );
    expect(b.closes).toEqual([
      { voteSeq: 31, outcome: "cancelled", reason: "GRID_BROKEN" },
    ]);
  });
});

describe("§10 a passed close then puzzleChecked applies marks; the count is permanent", () => {
  it("marks land on the puzzleChecked at the next seq, checkVote already cleared", () => {
    const { store } = makeStore(board());
    store.receive(opened());
    store.receive(closed({ seq: 32, outcome: "passed" }));
    store.receive({
      type: "puzzleChecked",
      seq: 33,
      wrongCells: [0, 2],
      checkCount: 1,
      by: "u1",
      commandId: "c1",
      at: "2026-07-07T19:31:15Z",
    });
    expect(store.checkVote).toBeNull();
    expect([...store.checkedWrongCells].sort()).toEqual([0, 2]);
    expect(store.checkCount).toBe(1);
  });

  it("TOLERANCE: a bare puzzleChecked with no open vote applies marks and never resyncs", () => {
    const { store, sent } = makeStore(board());
    store.receive({
      type: "puzzleChecked",
      seq: 31,
      wrongCells: [1],
      checkCount: 1,
      commandId: "c9",
      at: "2026-07-07T19:31:15Z",
    });
    expect(store.checkVote).toBeNull();
    expect([...store.checkedWrongCells]).toEqual([1]);
    expect(store.sync).toBe("live");
    expect(sent).not.toContainEqual({ type: "requestSync" });
  });
});

describe("§4 the open vote rides every snapshot: replaced wholesale (INV-5)", () => {
  it("a reconnect mid-vote reconstructs the whole vote from board.checkVote", () => {
    const { store } = makeStore(board());
    const midVote: OpenCheckVote = {
      openedSeq: 31,
      by: "u1",
      electorate: ["u1", "u2", "u3"],
      approvals: ["u1", "u3"],
      rejections: [],
      needed: 2,
      expiresAt: "2026-07-07T19:31:40Z",
    };
    store.receive({
      type: "sync",
      board: board({ seq: 32, checkVote: midVote }),
    });
    expect(store.checkVote).toEqual(midVote);
    expect(store.seq).toBe(32);
  });

  it("a snapshot with checkVote null clears a locally open vote", () => {
    const { store } = makeStore(board());
    store.receive(opened());
    expect(store.checkVote).not.toBeNull();
    store.receive({ type: "sync", board: board({ seq: 31, checkVote: null }) });
    expect(store.checkVote).toBeNull();
  });
});

describe("§5/§11 the four vote errors clear the optimistic intent without drama", () => {
  it("castCheckVote sends the ballot and sets a pending intent the echo clears", () => {
    const { store, sent } = makeStore(board());
    store.receive(opened());
    store.castCheckVote(31, true, "b1");
    expect(sent).toContainEqual({
      type: "castCheckVote",
      commandId: "b1",
      voteSeq: 31,
      approve: true,
    });
    expect(store.pendingVote).toEqual({
      commandId: "b1",
      kind: "ballot",
      approve: true,
    });
    store.receive(cast({ seq: 32, by: "u1", approve: true, commandId: "b1" }));
    expect(store.pendingVote).toBeNull();
  });

  it("ALREADY_VOTED / NOT_ELECTOR / NO_VOTE_OPEN clear the ballot intent, non-fatal, no resync", () => {
    for (const code of [
      "ALREADY_VOTED",
      "NOT_ELECTOR",
      "NO_VOTE_OPEN",
    ] as const) {
      const { store, sent } = makeStore(board());
      store.receive(opened());
      store.castCheckVote(31, true, "b1");
      store.receive({
        type: "error",
        code,
        message: "no",
        fatal: false,
        commandId: "b1",
      });
      expect(store.pendingVote).toBeNull();
      expect(store.sync).toBe("live");
      expect(sent).not.toContainEqual({ type: "requestSync" });
    }
  });

  it("VOTE_PENDING clears a proposal intent (a race with a vote already open)", () => {
    const { store } = makeStore(board());
    store.checkPuzzle("p1");
    expect(store.pendingVote).toEqual({ commandId: "p1", kind: "propose" });
    store.receive({
      type: "error",
      code: "VOTE_PENDING",
      message: "open",
      fatal: false,
      commandId: "p1",
    });
    expect(store.pendingVote).toBeNull();
  });
});
