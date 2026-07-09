// Shared assertions the properties read. Each throws a message rich enough that the
// fast-check counterexample plus the message pinpoints the divergence. They assert against
// the real objects: the server board is the actor's snapshot, the rendered board is the
// store's renderValue, so a pass means the real pipeline and the real store agree.

import type { Sim } from "./sim";

/**
 * Convergence: after the world settles, every client renders exactly the server's
 * sequenced board, holds no leftover overlay, and is caught up to the server seq. This is
 * INV-10 (clients render sequenced state plus overlay only, overlay never orphaned) taken
 * to its fixpoint, and the DESIGN.md section 11 convergence guarantee.
 */
export function assertConvergence(sim: Sim): void {
  const board = sim.serverBoard();
  const playable = sim.playableCells();
  for (const client of sim.clients) {
    if (client.store.sync !== "live") {
      throw new Error(
        `client ${client.index} did not return to live (sync=${client.store.sync})`,
      );
    }
    if (client.store.overlay.length !== 0) {
      throw new Error(
        `client ${client.index} kept a non-empty overlay after settle: ` +
          JSON.stringify(client.store.overlay),
      );
    }
    if (client.store.seq !== board.seq) {
      throw new Error(
        `client ${client.index} seq ${client.store.seq} != server seq ${board.seq}`,
      );
    }
    for (const cell of playable) {
      const rendered = client.store.renderValue(cell);
      const server = board.cells[cell]?.v ?? null;
      if (rendered !== server) {
        throw new Error(
          `client ${client.index} cell ${cell} renders ${JSON.stringify(
            rendered,
          )} but server board holds ${JSON.stringify(server)}`,
        );
      }
    }
  }
}

/**
 * INV-2 total order: the seqs the server emitted are a gap-free, duplicate-free ascending
 * run. A fresh game starts at seq 1; every accepted command (and the terminal event)
 * consumes exactly the next seq, so the observed stream must be 1, 2, 3, ...
 */
export function assertTotalOrder(sim: Sim, startSeq = 0): void {
  const events = sim.sequencedServerEvents();
  let expected = startSeq + 1;
  for (const event of events) {
    if (event.seq !== expected) {
      throw new Error(
        `INV-2 broken: expected seq ${expected}, saw ${event.seq} ` +
          `(stream ${JSON.stringify(events.map((e) => e.seq))})`,
      );
    }
    expected += 1;
  }
}

/**
 * Command idempotency (PROTOCOL.md section 5, section 8): a commandId that is re-sent
 * inside the recent-command window is dropped, so the server never broadcasts two cellSets
 * for one commandId. Reconnect and gap recovery both re-send, so this exercises the dedup.
 */
export function assertNoDoubleApply(sim: Sim): void {
  for (const [commandId, count] of sim.cellSetCountByCommandId()) {
    if (count !== 1) {
      throw new Error(
        `commandId ${commandId} produced ${count} cellSets: dedup failed`,
      );
    }
  }
}

/** No cellSet ever follows the terminal event's seq: the board froze (INV-4). */
export function assertFrozenAfterTerminal(sim: Sim): void {
  const events = sim.sequencedServerEvents();
  const terminal = events.find(
    (e) => e.type === "gameCompleted" || e.type === "gameAbandoned",
  );
  if (terminal === undefined) return;
  for (const event of events) {
    if (event.type === "cellSet" && event.seq > terminal.seq) {
      throw new Error(
        `INV-4 broken: cellSet at seq ${event.seq} followed terminal at seq ${terminal.seq}`,
      );
    }
  }
}
