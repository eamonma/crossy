// ActivityPushPolicy fold rules (PROTOCOL.md "Live Activity push"). The policy is pure, so these
// tests are headless: feed a memory, an observation, a content-state, and a clock; assert the
// decisions and the next memory. Time is data (nowMs), so the debounce is pinned without a real
// timer. Test names cite the section / invariant they defend.

import { describe, expect, it } from "vitest";
import type { LiveActivityContentState } from "@crossy/protocol";
import {
  ANNOUNCE_MS,
  COMPLETION_ALERT_BODY_UNNAMED,
  COMPLETION_ALERT_SOUND,
  COMPLETION_ALERT_TITLE,
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

/** A PolicyState with the new terminal-announce fields defaulted, so tests set only what they pin. */
function st(over: Partial<PolicyState> = {}): PolicyState {
  return {
    lastSent: null,
    lastSentAtMs: null,
    lastFillPushAtMs: null,
    pendingFill: null,
    pendingEnd: null,
    pendingEndAtMs: null,
    ...over,
  };
}

/** A completed content-state, the terminal frame the completion path pushes. */
function completed(
  over: Partial<LiveActivityContentState> = {},
): LiveActivityContentState {
  return cs({
    status: "completed",
    completedAt: "2026-07-11T19:40:03Z",
    filled: 78,
    ...over,
  });
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

describe("§12a policy: completed announces itself (owner ruling: done is an EVENT)", () => {
  it("completed emits an ALERTING update first (priority 10, aps.alert), not a quiet end", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal", roomName: "Sunday Crew" },
      completed(),
      2000,
    );
    // At T: exactly one decision, an alerting update. The end is held, not emitted here.
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      event: "update",
      priority: 10,
      audience: { kind: "game" },
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(r.decisions[0]!.alert).toEqual({
      title: COMPLETION_ALERT_TITLE,
      body: "Sunday Crew",
      sound: COMPLETION_ALERT_SOUND,
    });
  });

  it("the alert body falls back to a fixed line when the room is unnamed", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal", roomName: null },
      completed(),
      2000,
    );
    expect(r.decisions[0]!.alert!.body).toBe(COMPLETION_ALERT_BODY_UNNAMED);
  });

  it("the end is HELD as pendingEnd and asks for a wake at T + ANNOUNCE_MS", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal", roomName: "R" },
      completed(),
      2000,
    );
    expect(r.state.pendingEnd).toEqual(completed());
    expect(r.state.pendingEndAtMs).toBe(2000 + ANNOUNCE_MS);
    expect(r.wakeAtMs).toBe(2000 + ANNOUNCE_MS);
    // No end in the immediate decisions: the announcement gets its moment first.
    expect(r.decisions.some((d) => d.event === "end")).toBe(false);
  });

  it("the held end flushes as an end with a dismissal date once ANNOUNCE_MS passes", () => {
    const after = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal", roomName: "R" },
      completed(),
      2000,
    ).state;
    const flushed = flushPending(after, 2000 + ANNOUNCE_MS);
    expect(flushed.decisions).toHaveLength(1);
    expect(flushed.decisions[0]).toMatchObject({
      event: "end",
      priority: 10,
      audience: { kind: "game" },
      dismissMs: DISMISS_AFTER_MS,
    });
    // No alert on the end, and the held state is cleared.
    expect(flushed.decisions[0]!.alert).toBeUndefined();
    expect(flushed.state.pendingEnd).toBeNull();
    expect(flushed.state.pendingEndAtMs).toBeNull();
  });

  it("flushing the held end before ANNOUNCE_MS re-asks for a wake, holding the end", () => {
    const after = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal", roomName: "R" },
      completed(),
      2000,
    ).state;
    const early = flushPending(after, 2000 + ANNOUNCE_MS - 1);
    expect(early.decisions).toHaveLength(0);
    expect(early.wakeAtMs).toBe(2000 + ANNOUNCE_MS);
    expect(early.state.pendingEnd).toEqual(completed());
  });
});

describe("§12a policy: abandoned is a single quiet end (the asymmetry is deliberate)", () => {
  it("abandoned emits one end, priority 10, dismissMs set, and NO alert", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "terminal", roomName: "R" },
      cs({ status: "abandoned", filled: 12 }),
      2000,
    );
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      event: "end",
      priority: 10,
      audience: { kind: "game" },
      dismissMs: DISMISS_AFTER_MS,
    });
    expect(r.decisions[0]!.alert).toBeUndefined();
    // No announcement is scheduled: an abandonment is not a celebration.
    expect(r.state.pendingEnd).toBeNull();
    expect(r.wakeAtMs).toBeNull();
  });

  it("a completed terminal supersedes a held fill (pendingFill cleared)", () => {
    // Prime a held fill, then a completion arrives before the fill window opens.
    const held = st({
      lastSent: cs({ filled: 5 }),
      lastSentAtMs: 0,
      lastFillPushAtMs: 0,
      pendingFill: cs({ filled: 6 }),
    });
    const r = fold(
      held,
      { kind: "terminal", roomName: "R" },
      completed(),
      1000,
    );
    expect(r.state.pendingFill).toBeNull();
    // The completion's own decision is the alerting update; the held fill is gone.
    expect(r.decisions[0]!.event).toBe("update");
    expect(r.decisions[0]!.alert).toBeDefined();
  });

  it("an abandoned terminal supersedes a held fill (pendingFill cleared)", () => {
    const held = st({
      lastSent: cs({ filled: 5 }),
      lastSentAtMs: 0,
      lastFillPushAtMs: 0,
      pendingFill: cs({ filled: 6 }),
    });
    const r = fold(
      held,
      { kind: "terminal", roomName: "R" },
      cs({ status: "abandoned", filled: 6 }),
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
    const primed = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
    });
    const r = fold(primed, { kind: "fill" }, cs({ filled: 12 }), 1000 + 5000);
    expect(r.decisions).toHaveLength(0);
    expect(r.state.pendingFill).toEqual(cs({ filled: 12 }));
    expect(r.wakeAtMs).toBe(1000 + DEBOUNCE_MS);
  });

  it("only the latest held state survives, never a queue of intermediates", () => {
    let state: PolicyState = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
    });
    state = fold(state, { kind: "fill" }, cs({ filled: 12 }), 2000).state;
    state = fold(state, { kind: "fill" }, cs({ filled: 13 }), 3000).state;
    state = fold(state, { kind: "fill" }, cs({ filled: 14 }), 4000).state;
    // Three fills inside the window collapse to one held state: the latest.
    expect(state.pendingFill).toEqual(cs({ filled: 14 }));
  });

  it("a held fill flushes once the window opens (flushPending)", () => {
    const held = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: cs({ filled: 14 }),
    });
    const r = flushPending(held, 1000 + DEBOUNCE_MS);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ event: "update", priority: 5 });
    expect(r.state.pendingFill).toBeNull();
    expect(r.state.lastSent).toEqual(cs({ filled: 14 }));
  });

  it("flushPending before the window re-asks for a wake, holding the state", () => {
    const held = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
      pendingFill: cs({ filled: 14 }),
    });
    const r = flushPending(held, 1500);
    expect(r.decisions).toHaveLength(0);
    expect(r.wakeAtMs).toBe(1000 + DEBOUNCE_MS);
  });

  it("a fill past the window pushes immediately again", () => {
    const primed = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
    });
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
    const primed = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 1000,
      lastFillPushAtMs: 1000,
    });
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
    const primed = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 0,
      lastFillPushAtMs: 0,
    });
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
