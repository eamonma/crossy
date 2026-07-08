// A tiny in-memory session standing in for apps/session, so the demo boards drive
// the REAL store through its transport port on fake data: optimistic overlay, echo,
// gap-to-resync, reconnect reconciliation, and terminal freeze all run the same code
// paths a live socket would (INV-10). The wire is Wave 2.2's integration gate; no
// networking happens here.
import type {
  Board as WireBoard,
  Cell,
  ClientMessage,
  Cursor,
  Participant,
} from "@crossy/protocol";
import type { Board } from "../domain/boards";
import { GameStore } from "../store/gameStore";

export const SELF_USER_ID = "you";
const SELF_COLOR = "#3e63dd"; // indigo-9, matching the presence chrome

/** Deterministic teammate colors (DESIGN section 8 hashes user ids; the demo fakes it). */
const TEAMMATE_COLORS = ["#e5484d", "#12a594", "#ffb224", "#8e4ec6"];

const ECHO_DELAY_MS = 150; // long enough that the pending overlay is real
const RESYNC_DELAY_MS = 700; // long enough that the Resyncing pill is visible
const RECONNECT_DELAY_MS = 1400; // long enough that the Reconnecting pill is visible

export interface FakeSession {
  store: GameStore;
  /** A teammate overwrites the given cell: the section 8 conflict flash on a cell
   * you render non-null, a plain fill on one you render empty. */
  scribble(cell: number): void;
  /** Deliver an event with a skipped seq: the store sees the gap, requests sync,
   * and the snapshot lands after a visible delay (PROTOCOL section 7). */
  gapEvent(cell: number): void;
  /** Drop the connection, then reconnect with a welcome snapshot; pending overlay
   * entries re-send through reconciliation (PROTOCOL sections 7 and 8). */
  dropConnection(): void;
  /** Emit gameCompleted: the terminal-state rule freezes mutation, navigation
   * stays live (ROADMAP Wave 2.1d). */
  completeGame(): void;
  /** A fresh welcome with the fixture's starting board. */
  reset(): void;
  /** Clear pending timers (component teardown). */
  dispose(): void;
}

export function createFakeSession(board: Board): FakeSession {
  const { puzzle } = board;
  const cellCount = puzzle.cols * puzzle.rows;

  // Authoritative session state, the fake actor's memory.
  let cells = seedCells();
  let seq = 0;
  let status: WireBoard["status"] = "ongoing";
  let completedAt: string | null = null;
  let recentCommandIds: string[] = [];
  let connectionDown = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const participants: Participant[] = [
    {
      userId: SELF_USER_ID,
      displayName: "You",
      color: SELF_COLOR,
      role: "solver",
      connected: true,
    },
    ...board.teammates.map((teammate, index) => ({
      userId: teammate.id,
      displayName: teammate.initial,
      color: TEAMMATE_COLORS[index % TEAMMATE_COLORS.length] ?? SELF_COLOR,
      role: "solver" as const,
      connected: true,
    })),
  ];

  const cursors: Cursor[] = board.teammates.map((teammate) => ({
    userId: teammate.id,
    cell: teammate.cell,
    direction: teammate.direction,
  }));

  function seedCells(): Map<number, Cell> {
    const seeded = new Map<number, Cell>();
    for (const [cell, value] of board.initialFills) {
      seeded.set(cell, { v: value, by: "seed" });
    }
    return seeded;
  }

  function later(ms: number, run: () => void): void {
    const id = setTimeout(() => {
      timers.delete(id);
      run();
    }, ms);
    timers.add(id);
  }

  function rememberCommand(commandId: string): void {
    recentCommandIds.push(commandId);
    if (recentCommandIds.length > 64) recentCommandIds.shift(); // the K=64 ring
  }

  function snapshot(): WireBoard {
    return {
      seq,
      status,
      firstFillAt: null,
      completedAt,
      abandonedAt: null,
      cells: Array.from(
        { length: cellCount },
        (_, index) => cells.get(index) ?? { v: null, by: null },
      ),
      participants,
      cursors,
      recentCommandIds: [...recentCommandIds],
      stats: null,
    };
  }

  function deliverWelcome(): void {
    connectionDown = false;
    store.receive({
      type: "welcome",
      protocolVersion: 1,
      self: { userId: SELF_USER_ID, role: "solver" },
      board: snapshot(),
    });
  }

  /** The fake actor applying one mutation and echoing its cellSet. */
  function applyMutation(
    message: Extract<ClientMessage, { type: "placeLetter" | "clearCell" }>,
  ): void {
    if (status !== "ongoing") {
      // Belt and braces: the store already refuses locally after a terminal
      // state, so this path is unreachable from the UI (PROTOCOL section 10).
      store.receive({
        type: "error",
        code: "GAME_NOT_ONGOING",
        message: "game is not ongoing",
        fatal: false,
        commandId: message.commandId,
      });
      return;
    }
    seq += 1;
    const value = message.type === "placeLetter" ? message.value : null;
    cells.set(message.cell, { v: value, by: SELF_USER_ID });
    rememberCommand(message.commandId);
    store.receive({
      type: "cellSet",
      seq,
      cell: message.cell,
      value,
      by: SELF_USER_ID,
      commandId: message.commandId,
      at: new Date().toISOString(),
    });
  }

  // The transport port: what a socket would carry, handled in memory.
  const store = new GameStore({
    transport: {
      send(message: ClientMessage): void {
        if (connectionDown) return; // no socket: frames drop, the overlay holds
        switch (message.type) {
          case "placeLetter":
          case "clearCell":
            later(ECHO_DELAY_MS, () => applyMutation(message));
            return;
          case "requestSync":
            later(RESYNC_DELAY_MS, () => {
              if (connectionDown) return;
              store.receive({ type: "sync", board: snapshot() });
            });
            return;
          default:
            return; // hello, heartbeat, moveCursor, checkRequest: nothing to fake
        }
      },
    },
  });

  function teammateWrite(cell: number, deliver: boolean): void {
    const writer = participants[1] ?? participants[0];
    if (writer === undefined) return;
    const current = cells.get(cell)?.v ?? null;
    const value = current === "Z" ? "Q" : "Z"; // always visibly different
    seq += 1;
    cells.set(cell, { v: value, by: writer.userId });
    if (!deliver) return;
    store.receive({
      type: "cellSet",
      seq,
      cell,
      value,
      by: writer.userId,
      commandId: `fake-${seq}`,
      at: new Date().toISOString(),
    });
  }

  deliverWelcome();

  return {
    store,
    scribble(cell: number): void {
      if (status !== "ongoing") return;
      teammateWrite(cell, true);
    },
    gapEvent(cell: number): void {
      if (status !== "ongoing") return;
      teammateWrite(cell, false); // this event is lost in transit
      teammateWrite(cell, true); // this one arrives and exposes the gap
    },
    dropConnection(): void {
      connectionDown = true;
      store.connectionLost();
      later(RECONNECT_DELAY_MS, deliverWelcome);
    },
    completeGame(): void {
      if (status !== "ongoing") return;
      seq += 1;
      status = "completed";
      completedAt = new Date().toISOString();
      store.receive({
        type: "gameCompleted",
        seq,
        at: completedAt,
        stats: {
          solveTimeSeconds: 372,
          totalEvents: seq - 1,
          participantCount: participants.length,
        },
      });
    },
    reset(): void {
      cells = seedCells();
      seq += 1; // a fresh snapshot; the store replaces state wholesale
      status = "ongoing";
      completedAt = null;
      recentCommandIds = [];
      deliverWelcome();
    },
    dispose(): void {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
}
