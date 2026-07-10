// Store behaviors the client-store vectors deliberately leave to the client: the
// conflict-flash trigger (PROTOCOL.md section 8: view animation, so the vectors
// exclude it; the store still owns detecting it), the Wave 2.1d terminal-state rule
// (mutation freezes locally and never reaches the wire), and the transport-drop
// transition into reconnecting.
import { describe, expect, it } from "vitest";
import type { Board, CellSetMessage, ClientMessage } from "@crossy/protocol";
import { GameStore } from "./gameStore";
import type { ConflictFlash } from "./gameStore";

function board(overrides: Partial<Board> = {}): Board {
  return {
    seq: 0,
    status: "ongoing",
    firstFillAt: null,
    completedAt: null,
    abandonedAt: null,
    cells: Array.from({ length: 20 }, () => ({ v: null, by: null })),
    participants: [],
    cursors: [],
    recentCommandIds: [],
    stats: null,
    ...overrides,
  };
}

function cellSet(overrides: Partial<CellSetMessage>): CellSetMessage {
  return {
    type: "cellSet",
    seq: 1,
    cell: 0,
    value: "A",
    by: "u-other",
    commandId: "c-other",
    at: "2026-07-07T00:00:00Z",
    ...overrides,
  };
}

interface Harness {
  store: GameStore;
  sent: ClientMessage[];
  flashes: ConflictFlash[];
}

/** A store brought live via a welcome (self is "me"), with sends and flashes recorded. */
function makeStore(welcomeBoard: Board): Harness {
  const sent: ClientMessage[] = [];
  const store = new GameStore({
    transport: { send: (message) => sent.push(message) },
  });
  const flashes: ConflictFlash[] = [];
  store.subscribeFlash((flash) => flashes.push(flash));
  store.receive({
    type: "welcome",
    protocolVersion: 1,
    self: { userId: "me", role: "solver" },
    board: welcomeBoard,
  });
  return { store, sent, flashes };
}

describe("conflict flash trigger (PROTOCOL.md section 8, D02)", () => {
  it("flashes when another user's cellSet changes a non-null value you render", () => {
    const cells = board().cells.map((c, i) =>
      i === 3 ? { v: "A", by: "me" } : c,
    );
    const { store, flashes } = makeStore(board({ cells }));
    store.receive(cellSet({ seq: 1, cell: 3, value: "B", by: "u2" }));
    expect(flashes).toEqual([{ cell: 3, by: "u2" }]);
    expect(store.renderValue(3)).toBe("B");
  });

  it("flashes on an erase: another user's clear of your rendered letter is never silent", () => {
    const cells = board().cells.map((c, i) =>
      i === 3 ? { v: "A", by: "me" } : c,
    );
    const { store, flashes } = makeStore(board({ cells }));
    store.receive(cellSet({ seq: 1, cell: 3, value: null, by: "u2" }));
    expect(flashes).toEqual([{ cell: 3, by: "u2" }]);
    expect(store.renderValue(3)).toBe(null);
  });

  it("does not flash when another user fills a cell you render as empty", () => {
    const { store, flashes } = makeStore(board());
    store.receive(cellSet({ seq: 1, cell: 3, value: "B", by: "u2" }));
    expect(flashes).toEqual([]);
    expect(store.renderValue(3)).toBe("B");
  });

  it("does not flash on your own echo (commandId match clears the overlay instead, INV-10)", () => {
    const { store, flashes } = makeStore(board());
    store.placeLetter(3, "A", "c1");
    store.receive(
      cellSet({ seq: 1, cell: 3, value: "A", by: "me", commandId: "c1" }),
    );
    expect(flashes).toEqual([]);
    expect(store.overlay).toEqual([]);
  });

  it("does not flash when a still-pending overlay entry masks the change (render is unchanged)", () => {
    const { store, flashes } = makeStore(board());
    store.placeLetter(3, "K", "c-mine");
    store.receive(cellSet({ seq: 1, cell: 3, value: "B", by: "u2" }));
    // The overlay still renders K on top of the sequenced B, so nothing visible changed.
    expect(store.renderValue(3)).toBe("K");
    expect(flashes).toEqual([]);
  });
});

describe("terminal states freeze mutation locally (ROADMAP Wave 2.1d; INV-4 scope)", () => {
  it("refuses placeLetter after completed: no overlay entry, nothing reaches the wire", () => {
    const { store, sent } = makeStore(board({ status: "completed" }));
    store.placeLetter(3, "A", "c1");
    expect(store.overlay).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("refuses clearCell after abandoned: no overlay entry, nothing reaches the wire", () => {
    const { store, sent } = makeStore(board({ status: "abandoned" }));
    store.clearCell(3, "c1");
    expect(store.overlay).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("an in-order gameCompleted freezes mutation and applies stats", () => {
    const { store, sent } = makeStore(board({ seq: 5 }));
    store.receive({
      type: "gameCompleted",
      seq: 6,
      at: "2026-07-07T01:00:00Z",
      stats: { solveTimeSeconds: 60, totalEvents: 5, participantCount: 2 },
    });
    expect(store.status).toBe("completed");
    expect(store.seq).toBe(6);
    expect(store.stats?.participantCount).toBe(2);
    store.placeLetter(0, "A", "c1");
    expect(sent).toEqual([]);
  });
});

describe("connection loss (PROTOCOL.md section 7: reconnecting)", () => {
  it("a transport drop goes reconnecting and preserves the overlay for the re-send", () => {
    const { store } = makeStore(board());
    store.placeLetter(3, "K", "c-live");
    store.connectionLost();
    expect(store.sync).toBe("reconnecting");
    expect(store.overlay).toEqual([
      { commandId: "c-live", cell: 3, value: "K" },
    ]);
  });

  it("normalizes letters ASCII-only before sending (INV-1)", () => {
    const { store, sent } = makeStore(board());
    store.placeLetter(3, "k", "c1");
    expect(sent).toEqual([
      { type: "placeLetter", commandId: "c1", cell: 3, value: "K" },
    ]);
  });
});

describe("first-fill timing on the delta path (PROTOCOL.md section 6; the derived timer, gameTime.ts)", () => {
  const T1 = "2026-07-07T19:02:11Z";

  it("starts the timer on the delta: the first fill's cellSet sets firstFillAt without waiting for a snapshot", () => {
    const { store } = makeStore(board({ seq: 0, firstFillAt: null }));
    expect(store.firstFillAt).toBe(null);
    store.receive(
      cellSet({ seq: 1, cell: 0, value: "A", by: "u1", firstFillAt: T1 }),
    );
    expect(store.firstFillAt).toBe(T1);
  });

  it("is set once: a later fill's cellSet without firstFillAt does not move the origin (PROTOCOL.md section 6)", () => {
    const { store } = makeStore(board({ seq: 0, firstFillAt: null }));
    store.receive(
      cellSet({ seq: 1, cell: 0, value: "A", by: "u1", firstFillAt: T1 }),
    );
    store.receive(cellSet({ seq: 2, cell: 1, value: "B", by: "u2" }));
    expect(store.firstFillAt).toBe(T1);
    expect(store.seq).toBe(2);
  });

  it("reconnect keeps the origin: a welcome snapshot after the first fill reports the same firstFillAt (PROTOCOL.md section 7)", () => {
    const { store } = makeStore(board({ seq: 0, firstFillAt: null }));
    store.receive(
      cellSet({ seq: 1, cell: 0, value: "A", by: "u1", firstFillAt: T1 }),
    );
    store.connectionLost();
    const cells = board().cells.map((c, i) =>
      i === 0 ? { v: "A", by: "u1" } : c,
    );
    store.receive({
      type: "welcome",
      protocolVersion: 1,
      self: { userId: "me", role: "solver" },
      board: board({ seq: 1, firstFillAt: T1, cells }),
    });
    expect(store.firstFillAt).toBe(T1);
    expect(store.sync).toBe("live");
  });

  it("is idempotent on redelivery: a stale first-fill cellSet re-applies neither the origin nor the seq (PROTOCOL.md section 7)", () => {
    const { store } = makeStore(board({ seq: 0, firstFillAt: null }));
    store.receive(
      cellSet({ seq: 1, cell: 0, value: "A", by: "u1", firstFillAt: T1 }),
    );
    store.receive(
      cellSet({ seq: 1, cell: 0, value: "A", by: "u1", firstFillAt: T1 }),
    );
    expect(store.firstFillAt).toBe(T1);
    expect(store.seq).toBe(1);
  });
});
