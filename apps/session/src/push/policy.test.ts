// ActivityPushPolicy fold rules (PROTOCOL.md "Live Activity push"). The policy is pure, so these
// tests are headless: feed a memory, an observation, a content-state, and a clock; assert the
// decisions and the next memory. Time is data (nowMs), so the debounce is pinned without a real
// timer. Test names cite the section / invariant they defend.

import { describe, expect, it } from "vitest";
import type { LiveActivityContentState } from "@crossy/protocol";
import {
  DEBOUNCE_MS,
  DISMISS_AFTER_MS,
  INITIAL_POLICY_STATE,
  STALE_AFTER_MS,
  flushPending,
  fold,
} from "./policy";
import type { PolicyState } from "./policy";

function cs(
  over: Partial<LiveActivityContentState> = {},
): LiveActivityContentState {
  return {
    pucks: [{ initial: "A", red: 1, green: 2, blue: 3, connected: true }],
    filled: 10,
    total: 78,
    status: "ongoing",
    completedAt: null,
    ...over,
  };
}

describe("§12a policy: presence pushes immediately at priority 10", () => {
  it("emits one update, priority 10, to the whole game", () => {
    const r = fold(INITIAL_POLICY_STATE, { kind: "presence" }, cs(), 1000);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      event: "update",
      priority: 10,
      audience: { kind: "game" },
    });
    expect(r.decisions[0]!.staleAfterMs).toBe(STALE_AFTER_MS);
    expect(r.state.lastSent).not.toBeNull();
  });
});

describe("§12a policy: terminal ships an end with a dismissal date", () => {
  it("completed emits event end, priority 10, dismissMs set", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal" },
      cs({
        status: "completed",
        completedAt: "2026-07-11T19:40:03Z",
        filled: 78,
      }),
      2000,
    );
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      event: "end",
      priority: 10,
      audience: { kind: "game" },
      dismissMs: DISMISS_AFTER_MS,
    });
  });

  it("abandoned emits an end too", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal" },
      cs({ status: "abandoned", filled: 12 }),
      2000,
    );
    expect(r.decisions[0]!.event).toBe("end");
  });

  it("a terminal supersedes a held fill (pendingFill cleared)", () => {
    // Prime a held fill, then a terminal arrives before the window opens.
    const held: PolicyState = {
      lastSent: cs({ filled: 5 }),
      lastSentAtMs: 0,
      lastFillPushAtMs: 0,
      pendingFill: cs({ filled: 6 }),
    };
    const r = fold(
      held,
      { kind: "terminal" },
      cs({
        status: "completed",
        completedAt: "2026-07-11T00:00:00Z",
        filled: 78,
      }),
      1000,
    );
    expect(r.state.pendingFill).toBeNull();
    expect(r.decisions[0]!.event).toBe("end");
  });
});

describe("§12a policy: fill is debounced latest-state at priority 5", () => {
  it("first fill pushes immediately (no prior fill push)", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "fill" },
      cs({ filled: 11 }),
      1000,
    );
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ event: "update", priority: 5 });
    expect(r.state.lastFillPushAtMs).toBe(1000);
  });

  it("a fill inside the window is held, not pushed, and asks for a wake", () => {
    const primed: PolicyState = {
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: null,
    };
    const r = fold(primed, { kind: "fill" }, cs({ filled: 12 }), 1000 + 5000);
    expect(r.decisions).toHaveLength(0);
    expect(r.state.pendingFill).toEqual(cs({ filled: 12 }));
    expect(r.wakeAtMs).toBe(1000 + DEBOUNCE_MS);
  });

  it("only the latest held state survives, never a queue of intermediates", () => {
    let state: PolicyState = {
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: null,
    };
    state = fold(state, { kind: "fill" }, cs({ filled: 12 }), 2000).state;
    state = fold(state, { kind: "fill" }, cs({ filled: 13 }), 3000).state;
    state = fold(state, { kind: "fill" }, cs({ filled: 14 }), 4000).state;
    // Three fills inside the window collapse to one held state: the latest.
    expect(state.pendingFill).toEqual(cs({ filled: 14 }));
  });

  it("a held fill flushes once the window opens (flushPending)", () => {
    const held: PolicyState = {
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: cs({ filled: 14 }),
    };
    const r = flushPending(held, 1000 + DEBOUNCE_MS);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ event: "update", priority: 5 });
    expect(r.state.pendingFill).toBeNull();
    expect(r.state.lastSent).toEqual(cs({ filled: 14 }));
  });

  it("flushPending before the window re-asks for a wake, holding the state", () => {
    const held: PolicyState = {
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: cs({ filled: 14 }),
    };
    const r = flushPending(held, 1500);
    expect(r.decisions).toHaveLength(0);
    expect(r.wakeAtMs).toBe(1000 + DEBOUNCE_MS);
  });

  it("a fill past the window pushes immediately again", () => {
    const primed: PolicyState = {
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: null,
    };
    const r = fold(
      primed,
      { kind: "fill" },
      cs({ filled: 20 }),
      1000 + DEBOUNCE_MS,
    );
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]!.priority).toBe(5);
  });
});

describe("§12a policy: a duplicate content-state never pushes (dedupe)", () => {
  it("a presence push equal to the last sent is suppressed", () => {
    const first = fold(INITIAL_POLICY_STATE, { kind: "presence" }, cs(), 1000);
    const again = fold(first.state, { kind: "presence" }, cs(), 2000);
    expect(again.decisions).toHaveLength(0);
  });

  it("a fill equal to the last sent is suppressed even past the window", () => {
    const primed: PolicyState = {
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: null,
    };
    const r = fold(
      primed,
      { kind: "fill" },
      cs({ filled: 11 }),
      1000 + DEBOUNCE_MS,
    );
    expect(r.decisions).toHaveLength(0);
  });

  it("a puck presence-order or connected change is NOT a duplicate", () => {
    const first = fold(INITIAL_POLICY_STATE, { kind: "presence" }, cs(), 1000);
    const changed = cs({
      pucks: [{ initial: "A", red: 1, green: 2, blue: 3, connected: false }],
    });
    const r = fold(first.state, { kind: "presence" }, changed, 2000);
    expect(r.decisions).toHaveLength(1);
  });
});

describe("§12a policy: a kicked member's own tokens get an end (INV: island retires)", () => {
  it("emits an end to the kicked user and a presence update to everyone else", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "kick", userId: "u9" },
      cs(),
      1000,
    );
    const end = r.decisions.find((d) => d.event === "end");
    const update = r.decisions.find((d) => d.event === "update");
    expect(end).toMatchObject({
      event: "end",
      priority: 10,
      audience: { kind: "user", userId: "u9" },
      dismissMs: DISMISS_AFTER_MS,
    });
    expect(update).toMatchObject({
      event: "update",
      priority: 10,
      audience: { kind: "exceptUser", userId: "u9" },
    });
  });

  it("still ends the kicked user even when the roster state duplicates the last sent", () => {
    // Everyone else's state is unchanged (dedupe), but the kicked user must still be ended.
    const primed = fold(INITIAL_POLICY_STATE, { kind: "presence" }, cs(), 1000);
    const r = fold(primed.state, { kind: "kick", userId: "u9" }, cs(), 2000);
    const ends = r.decisions.filter((d) => d.event === "end");
    const updates = r.decisions.filter((d) => d.event === "update");
    expect(ends).toHaveLength(1);
    expect(ends[0]!.audience).toEqual({ kind: "user", userId: "u9" });
    expect(updates).toHaveLength(0); // the everyone-else update is deduped
  });
});

describe("§12a policy: the debounce window is data, not a wall clock", () => {
  it("the same fold with a later clock crosses the window deterministically", () => {
    const primed: PolicyState = {
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 0,
      lastFillPushAtMs: 0,
      pendingFill: null,
    };
    // Just inside: held. Exactly at the boundary: pushed. No timer, only the nowMs argument.
    expect(
      fold(primed, { kind: "fill" }, cs({ filled: 12 }), DEBOUNCE_MS - 1)
        .decisions,
    ).toHaveLength(0);
    expect(
      fold(primed, { kind: "fill" }, cs({ filled: 12 }), DEBOUNCE_MS).decisions,
    ).toHaveLength(1);
  });
});
