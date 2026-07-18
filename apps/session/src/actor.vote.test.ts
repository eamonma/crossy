// The attributed check vote's server half (PROTOCOL.md §10; D32; Wave 15.3). Pure unit tests that
// drive a real GameActor with recording connections and a recording persistence port, a hand-wound
// clock, and vitest fake timers for the TTL, so the whole vote lifecycle is exercised without
// Docker. Test names cite the invariant or section they defend. The integration suite
// (session.integration.test.ts) proves the same semantics end to end over real sockets and Postgres.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage, Stats } from "@crossy/protocol";
import { CHECK_VOTE_TTL_MS, GameActor } from "./actor";
import type { Connection } from "./actor";
import { hydrateGame } from "./hydrate";
import type { GameStateRow, PuzzleSnapshot } from "./hydrate";
import type {
  CheckEventRow,
  GamePersistence,
  StateSnapshot,
  VoteEventRow,
} from "./writer";

const PUZZLE: PuzzleSnapshot = {
  rows: 1,
  cols: 3,
  blocks: [],
  solution: ["A", "B", "C"],
};

const BASE_MS = Date.parse("2026-07-18T12:00:00.000Z");

/** A game_state row whose grid is full but wrong at cell 0 (X, B, C), so a check has one failure. */
function fullWrongState(): GameStateRow {
  return {
    status: "ongoing",
    board: {
      cells: [
        { v: "X", by: "u1" },
        { v: "B", by: "u1" },
        { v: "C", by: "u1" },
      ],
      checkedWrongCells: [],
      checkCount: 0,
    },
    lastSeq: 3,
    firstFillAt: "2026-07-18T11:59:00.000Z",
    completedAt: null,
    abandonedAt: null,
    stats: null,
    recentCommandIds: [],
  };
}

/** A recording persistence port: captures the last snapshot and every flushed vote-event row. */
class RecordingPersistence implements GamePersistence {
  snapshot: StateSnapshot | null = null;
  readonly checkRows: CheckEventRow[] = [];
  readonly voteRows: VoteEventRow[] = [];

  async flush(
    _gameId: string,
    _events: readonly unknown[],
    checks: readonly CheckEventRow[],
    voteEvents: readonly VoteEventRow[],
    snap: StateSnapshot,
  ): Promise<void> {
    this.checkRows.push(...checks);
    this.voteRows.push(...voteEvents);
    this.snapshot = snap;
  }

  async flushTerminal(
    _gameId: string,
    _events: readonly unknown[],
    checks: readonly CheckEventRow[],
    voteEvents: readonly VoteEventRow[],
    build: (
      participantCount: number,
      eventAtMs: readonly number[],
    ) => { snap: StateSnapshot; stats: Stats },
  ): Promise<Stats> {
    this.checkRows.push(...checks);
    this.voteRows.push(...voteEvents);
    const { snap, stats } = build(1, []);
    this.snapshot = snap;
    return stats;
  }
}

interface Rec extends Connection {
  frames: ServerMessage[];
}

function conn(userId: string, role: "host" | "solver" | "spectator"): Rec {
  const frames: ServerMessage[] = [];
  return { userId, role, frames, send: (f) => frames.push(f) };
}

/** Build an actor over a full-wrong grid with the given connections attached (flush inline). */
function makeActor(
  persistence: RecordingPersistence,
  conns: Rec[],
  state: GameStateRow = fullWrongState(),
): GameActor {
  const actor = new GameActor(
    "game-1",
    hydrateGame(PUZZLE, state),
    persistence,
    () => new Date(),
    { flushEventThreshold: 1, flushIntervalMs: 600_000 },
  );
  for (const c of conns) actor.addConnection(c);
  return actor;
}

const check = (commandId: string) =>
  ({ type: "checkPuzzle", commandId }) as const;
const ballot = (commandId: string, voteSeq: number, approve: boolean) =>
  ({ type: "castCheckVote", commandId, voteSeq, approve }) as const;
const types = (c: Rec) => c.frames.map((f) => f.type);
const last = (c: Rec) => c.frames[c.frames.length - 1]!;
const errors = (c: Rec) =>
  c.frames.filter(
    (f): f is Extract<ServerMessage, { type: "error" }> => f.type === "error",
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("solo electorate auto-passes at open (PROTOCOL.md §10; D32)", () => {
  it("emits the checkVoteOpened/checkVoteClosed/puzzleChecked triple, attributed, in one command (§6, §10)", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "solver");
    const actor = makeActor(p, [u1]);

    await actor.submit(u1, check("c1"));

    expect(types(u1)).toEqual([
      "checkVoteOpened",
      "checkVoteClosed",
      "puzzleChecked",
    ]);
    const opened = u1.frames[0] as Extract<
      ServerMessage,
      { type: "checkVoteOpened" }
    >;
    expect(opened).toMatchObject({
      seq: 4,
      by: "u1",
      electorate: ["u1"],
      needed: 1,
      commandId: "c1",
    });
    // expiresAt is the session-stamped absolute timeout (INV-9), now + TTL.
    expect(Date.parse(opened.expiresAt)).toBe(BASE_MS + CHECK_VOTE_TTL_MS);
    expect(typeof opened.at).toBe("string");

    const closed = u1.frames[1] as Extract<
      ServerMessage,
      { type: "checkVoteClosed" }
    >;
    expect(closed).toMatchObject({ seq: 5, voteSeq: 4, outcome: "passed" });
    expect(closed).not.toHaveProperty("reason");

    const checked = u1.frames[2] as Extract<
      ServerMessage,
      { type: "puzzleChecked" }
    >;
    expect(checked).toMatchObject({
      seq: 6,
      wrongCells: [0],
      checkCount: 1,
      by: "u1",
      commandId: "c1",
    });

    // The vote closed, so the snapshot heals to no open vote (PROTOCOL.md §4).
    expect(p.snapshot?.board.checkVote).toBeNull();
    expect(p.snapshot?.lastSeq).toBe(6);
    // check_events carries the proposer; check_vote_events carries opened + closed.
    expect(p.checkRows).toEqual([
      expect.objectContaining({ seq: 6, userId: "u1" }),
    ]);
    expect(p.voteRows.map((r) => [r.kind, r.seq, r.outcome])).toEqual([
      ["opened", 4, null],
      ["closed", 5, "passed"],
    ]);
  });
});

describe("a multi-elector vote opens then passes on a decisive approval (PROTOCOL.md §10; D32)", () => {
  it("opens with needed=2 and stays open, then a second approval closes passed with puzzleChecked.by = proposer", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const u3 = conn("u3", "solver");
    const actor = makeActor(p, [u1, u2, u3]);

    await actor.submit(u1, check("c1"));
    // Opened, no close: approvals start at [u1], needed 2 (PROTOCOL.md §10).
    expect(types(u1)).toEqual(["checkVoteOpened"]);
    expect(p.snapshot?.board.checkVote).toMatchObject({
      openedSeq: 4,
      approvals: ["u1"],
      rejections: [],
      electorate: ["u1", "u2", "u3"],
    });

    await actor.submit(u2, ballot("c2", 4, true));
    // Cast then a decisive close: passed, followed by puzzleChecked attributed to the proposer.
    expect(types(u2).slice(-3)).toEqual([
      "checkVoteCast",
      "checkVoteClosed",
      "puzzleChecked",
    ]);
    const checked = last(u3) as Extract<
      ServerMessage,
      { type: "puzzleChecked" }
    >;
    expect(checked).toMatchObject({
      by: "u1",
      commandId: "c1",
      wrongCells: [0],
      checkCount: 1,
    });
    expect(p.snapshot?.board.checkVote).toBeNull();
    expect(p.voteRows.map((r) => r.kind)).toEqual(["opened", "cast", "closed"]);
    expect(p.voteRows[1]).toMatchObject({
      kind: "cast",
      userId: "u2",
      approve: true,
    });
  });
});

describe("a vote fails when a majority becomes unreachable (PROTOCOL.md §10; D32)", () => {
  it("records a non-decisive rejection, then closes failed REJECTED on the decisive one (no puzzleChecked)", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const u3 = conn("u3", "solver");
    const actor = makeActor(p, [u1, u2, u3]);

    await actor.submit(u1, check("c1"));
    await actor.submit(u2, ballot("c2", 4, false)); // 3 - 1 = 2, not < 2: stays open
    expect(types(u2).slice(-1)).toEqual(["checkVoteCast"]);
    expect(p.snapshot?.board.checkVote).toMatchObject({ rejections: ["u2"] });

    await actor.submit(u3, ballot("c3", 4, false)); // 3 - 2 = 1 < 2: majority unreachable
    const closed = last(u3) as Extract<
      ServerMessage,
      { type: "checkVoteClosed" }
    >;
    expect(closed).toMatchObject({ outcome: "failed", reason: "REJECTED" });
    expect(u3.frames.some((f) => f.type === "puzzleChecked")).toBe(false);
    expect(p.snapshot?.board.checkVote).toBeNull();
    // A failed vote increments nothing: no check_events row.
    expect(p.checkRows).toHaveLength(0);
  });
});

describe("the timebox closes an open vote EXPIRED (PROTOCOL.md §10; D32)", () => {
  it("fires the session timer at expiresAt and closes failed EXPIRED; a later tick is a silent no-op", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const u3 = conn("u3", "solver");
    const actor = makeActor(p, [u1, u2, u3]);

    await actor.submit(u1, check("c1")); // opens, stays open (needed 2)
    await actor.submit(u2, ballot("c2", 4, false)); // one rejection, still open

    // Nothing closes before the timebox.
    await vi.advanceTimersByTimeAsync(CHECK_VOTE_TTL_MS - 1);
    expect(u1.frames.some((f) => f.type === "checkVoteClosed")).toBe(false);

    // At the timeout the session feeds the engine expireCheckVote through the mailbox.
    await vi.advanceTimersByTimeAsync(1);
    const closed = last(u1) as Extract<
      ServerMessage,
      { type: "checkVoteClosed" }
    >;
    expect(closed).toMatchObject({ outcome: "failed", reason: "EXPIRED" });
    expect(p.snapshot?.board.checkVote).toBeNull();

    // The timer is one-shot and cancelled on close: advancing again produces nothing (no double close).
    const before = u1.frames.length;
    await vi.advanceTimersByTimeAsync(CHECK_VOTE_TTL_MS * 2);
    expect(u1.frames.length).toBe(before);
  });
});

describe("a completing or grid-breaking mutation cancels an open vote (PROTOCOL.md §10; D32)", () => {
  it("a clear that empties a cell closes the vote cancelled GRID_BROKEN right after the cellSet", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const actor = makeActor(p, [u1, u2]);

    await actor.submit(u1, check("c1")); // opens (needed 2), stays open
    await actor.submit(u1, { type: "clearCell", commandId: "c2", cell: 0 });

    expect(types(u1).slice(-2)).toEqual(["cellSet", "checkVoteClosed"]);
    expect(last(u1)).toMatchObject({
      type: "checkVoteClosed",
      outcome: "cancelled",
      reason: "GRID_BROKEN",
    });
    expect(p.snapshot?.board.checkVote).toBeNull();
  });

  it("an in-place correction completes the game, cancelling the vote TERMINAL before gameCompleted", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const actor = makeActor(p, [u1, u2]);

    await actor.submit(u1, check("c1")); // opens (needed 2), stays open
    await actor.submit(u1, {
      type: "placeLetter",
      commandId: "c2",
      cell: 0,
      value: "A",
    }); // makes the grid full and correct

    // Ordering: cellSet, checkVoteClosed(TERMINAL), gameCompleted (the terminal event stays last).
    expect(types(u1).slice(-3)).toEqual([
      "cellSet",
      "checkVoteClosed",
      "gameCompleted",
    ]);
    expect(u1.frames[u1.frames.length - 2]).toMatchObject({
      type: "checkVoteClosed",
      outcome: "cancelled",
      reason: "TERMINAL",
    });
    expect(p.snapshot?.status).toBe("completed");
    expect(p.snapshot?.board.checkVote).toBeNull();
  });
});

describe("abandon mid-vote closes the vote TERMINAL before gameAbandoned (PROTOCOL.md §10; D32)", () => {
  it("emits checkVoteClosed(cancelled, TERMINAL) then gameAbandoned, persisting the vote close", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const actor = makeActor(p, [u1, u2]);

    await actor.submit(u1, check("c1")); // opens (needed 2), stays open
    await actor.abandon("u1");

    expect(types(u1).slice(-2)).toEqual(["checkVoteClosed", "gameAbandoned"]);
    expect(u1.frames[u1.frames.length - 2]).toMatchObject({
      type: "checkVoteClosed",
      outcome: "cancelled",
      reason: "TERMINAL",
    });
    expect(p.snapshot?.status).toBe("abandoned");
    expect(p.snapshot?.board.checkVote).toBeNull();
    expect(p.voteRows.map((r) => [r.kind, r.outcome, r.reason])).toEqual([
      ["opened", null, null],
      ["closed", "cancelled", "TERMINAL"],
    ]);
  });
});

describe("a mid-vote snapshot heals a reconnecting client (PROTOCOL.md §4, §10; D32; INV-5)", () => {
  it("carries the full §4 checkVote object, needed and expiresAt included", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const u3 = conn("u3", "solver");
    const actor = makeActor(p, [u1, u2, u3]);

    await actor.submit(u1, check("c1"));
    const board = actor.snapshotBoard([]);
    expect(board.checkVote).toEqual({
      openedSeq: 4,
      by: "u1",
      electorate: ["u1", "u2", "u3"],
      approvals: ["u1"],
      rejections: [],
      needed: 2,
      expiresAt: new Date(BASE_MS + CHECK_VOTE_TTL_MS).toISOString(),
    });
  });
});

describe("crash rehydrate reconciles an open vote with the wall clock (PROTOCOL.md §10; D32; INV-5)", () => {
  function stateWithOpenVote(expiresAt: string): GameStateRow {
    return {
      ...fullWrongState(),
      lastSeq: 4,
      board: {
        cells: [
          { v: "X", by: "u1" },
          { v: "B", by: "u1" },
          { v: "C", by: "u1" },
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
          expiresAt,
        },
      },
    };
  }

  it("closes an already-expired vote failed EXPIRED, consuming a seq and persisting the close", async () => {
    const p = new RecordingPersistence();
    // expiresAt one second in the past relative to BASE_MS.
    const actor = makeActor(
      p,
      [],
      stateWithOpenVote(new Date(BASE_MS - 1000).toISOString()),
    );
    // The synchronous state already reflects the close (welcome heals it), then the buffered row flushes.
    const board = actor.snapshotBoard([]);
    expect(board.checkVote).toBeNull();
    expect(board.seq).toBe(5);
    await actor.drain();
    expect(p.voteRows).toEqual([
      expect.objectContaining({
        kind: "closed",
        seq: 5,
        outcome: "failed",
        reason: "EXPIRED",
      }),
    ]);
  });

  it("re-arms the timer for a vote still in the future, which then closes EXPIRED when it fires", async () => {
    const p = new RecordingPersistence();
    const future = new Date(BASE_MS + 5_000).toISOString();
    const actor = makeActor(p, [], stateWithOpenVote(future));
    // Still open right after hydrate: the snapshot carries the vote with its original expiresAt.
    expect(actor.snapshotBoard([]).checkVote).toMatchObject({
      openedSeq: 4,
      expiresAt: future,
    });
    // The re-armed timer fires at the remaining time.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(actor.snapshotBoard([]).checkVote).toBeNull();
    expect(
      p.voteRows.some((r) => r.kind === "closed" && r.reason === "EXPIRED"),
    ).toBe(true);
  });
});

describe("the four vote error codes surface as non-fatal errors with the commandId (PROTOCOL.md §11; D32)", () => {
  it("VOTE_PENDING: a second proposal while a vote is open", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const actor = makeActor(p, [u1, u2]);
    await actor.submit(u1, check("c1")); // opens (needed 2)
    await actor.submit(u1, check("c2"));
    expect(errors(u1).at(-1)).toMatchObject({
      code: "VOTE_PENDING",
      fatal: false,
      commandId: "c2",
    });
  });

  it("NO_VOTE_OPEN: a ballot with no open vote, and a stale voteSeq", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const actor = makeActor(p, [u1, u2]);
    await actor.submit(u1, ballot("c1", 99, true)); // no vote open
    expect(errors(u1).at(-1)).toMatchObject({
      code: "NO_VOTE_OPEN",
      commandId: "c1",
    });
    await actor.submit(u1, check("c2")); // opens at seq 4
    await actor.submit(u2, ballot("c3", 999, true)); // stale voteSeq
    expect(errors(u2).at(-1)).toMatchObject({
      code: "NO_VOTE_OPEN",
      commandId: "c3",
    });
  });

  it("NOT_ELECTOR: a host/solver who joined after the electorate froze", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const actor = makeActor(p, [u1, u2]);
    await actor.submit(u1, check("c1")); // electorate frozen [u1, u2]
    const u3 = conn("u3", "solver");
    actor.addConnection(u3); // joins mid-vote, not in the frozen electorate
    await actor.submit(u3, ballot("c2", 4, true));
    expect(errors(u3).at(-1)).toMatchObject({
      code: "NOT_ELECTOR",
      commandId: "c2",
    });
  });

  it("ALREADY_VOTED: the proposer casting a ballot (already approved at proposal time)", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const u2 = conn("u2", "solver");
    const actor = makeActor(p, [u1, u2]);
    await actor.submit(u1, check("c1"));
    await actor.submit(u1, ballot("c2", 4, true));
    expect(errors(u1).at(-1)).toMatchObject({
      code: "ALREADY_VOTED",
      commandId: "c2",
    });
  });

  it("a spectator's proposal and ballot are ROLE_FORBIDDEN, the same gate as a cell mutation (§5)", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "host");
    const spec = conn("s1", "spectator");
    const actor = makeActor(p, [u1, spec]);
    await actor.submit(spec, check("c1"));
    expect(errors(spec).at(-1)).toMatchObject({
      code: "ROLE_FORBIDDEN",
      commandId: "c1",
    });
    await actor.submit(spec, ballot("c2", 4, true));
    expect(errors(spec).at(-1)).toMatchObject({
      code: "ROLE_FORBIDDEN",
      commandId: "c2",
    });
  });

  it("a duplicate commandId is dropped silently: no event, no error (PROTOCOL.md §5)", async () => {
    const p = new RecordingPersistence();
    const u1 = conn("u1", "solver");
    const actor = makeActor(p, [u1]); // solo: c1 opens and auto-passes
    await actor.submit(u1, check("c1"));
    const before = u1.frames.length;
    await actor.submit(u1, check("c1")); // same commandId
    expect(u1.frames.length).toBe(before);
    expect(errors(u1)).toHaveLength(0);
  });
});
