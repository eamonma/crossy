// The actor's half of passivation (DESIGN.md §6 "passivate"): idle time is measured from
// the moment the last socket leaves, and an evicted actor refuses every new attachment so
// the connect path re-resolves through the registry instead of writing through a ghost
// the registry no longer knows (INV-7 single writer). Pure unit tests: the persistence
// port is a no-op fake, no IO, a hand-wound clock.

import { describe, expect, it } from "vitest";
import { GameActor } from "./actor";
import type { Connection } from "./actor";
import { hydrateGame } from "./hydrate";
import type { GamePersistence } from "./writer";

const persistence: GamePersistence = {
  flush: async () => undefined,
  flushTerminal: async (_gameId, _events, _checks, build) => build(1, []).stats,
};

function makeActor(nowMs: () => number): GameActor {
  const hydrated = hydrateGame(
    { rows: 1, cols: 3, blocks: [], solution: ["A", "B", "C"] },
    null,
  );
  return new GameActor("g1", hydrated, persistence, () => new Date(nowMs()));
}

function conn(userId: string): Connection {
  return { userId, role: "solver", send: () => undefined };
}

describe("passivation idle tracking (DESIGN.md §6)", () => {
  it("counts idle from hydration for an actor that never held a socket (DESIGN.md §6)", () => {
    let clock = 1_000;
    const actor = makeActor(() => clock);
    clock = 61_000;
    expect(actor.idleMillis(new Date(clock))).toBe(60_000);
  });

  it("is not idle while any socket is attached, and re-arms on the last close (DESIGN.md §6)", () => {
    let clock = 1_000;
    const actor = makeActor(() => clock);
    const a = conn("u1");
    const b = conn("u2");
    actor.addConnection(a);
    actor.addConnection(b);
    expect(actor.idleMillis(new Date(clock))).toBeNull();

    actor.removeConnection(a);
    expect(actor.idleMillis(new Date(clock))).toBeNull();

    clock = 5_000;
    actor.removeConnection(b);
    clock = 8_000;
    expect(actor.idleMillis(new Date(clock))).toBe(3_000);
  });

  it("re-arms idle when a kick empties the connection set (DESIGN.md §6, INV-8)", () => {
    let clock = 1_000;
    const actor = makeActor(() => clock);
    actor.addConnection(conn("u1"));
    expect(actor.idleMillis(new Date(clock))).toBeNull();

    clock = 2_000;
    actor.disconnectUser("u1", "kicked");
    expect(actor.idleMillis(new Date(3_000))).toBe(1_000);
  });
});

describe("evicted actors refuse attachment (DESIGN.md §6, INV-7)", () => {
  it("refuses addConnection after markEvicted, so the handshake re-resolves (INV-7)", () => {
    const actor = makeActor(() => 1_000);
    actor.markEvicted();
    expect(actor.addConnection(conn("u1"))).toEqual({ attached: false });
    expect(actor.connectionCount).toBe(0);
  });

  it("attaches normally before eviction, reporting the first socket per user (PROTOCOL.md §6, §9)", () => {
    const actor = makeActor(() => 1_000);
    expect(actor.addConnection(conn("u1"))).toEqual({
      attached: true,
      firstForUser: true,
    });
    expect(actor.addConnection(conn("u1"))).toEqual({
      attached: true,
      firstForUser: false,
    });
    expect(actor.connectionCount).toBe(2);
  });
});
