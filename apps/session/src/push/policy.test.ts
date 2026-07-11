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

describe("§12a policy: fill is LEADING-EDGE with trailing coalescing", () => {
  it("leading fire: a fill after quiet pushes immediately, never trailing the window", () => {
    // No prior fill push (quiet): the first fill leads at once, it does not wait DEBOUNCE_MS.
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "fill" },
      cs({ filled: 11 }),
      0,
    );
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ event: "update", priority: 5 });
    // The window re-arms on the leading fire: lastFillPushAtMs stamps this push.
    expect(r.state.lastFillPushAtMs).toBe(0);
  });

  it("in-window coalesce: fills inside the window collapse to the latest held state", () => {
    let state: PolicyState = fold(
      INITIAL_POLICY_STATE,
      { kind: "fill" },
      cs({ filled: 11 }),
      0,
    ).state;
    // Three fills before the window opens: none push, only the latest is held (no queue).
    const a = fold(state, { kind: "fill" }, cs({ filled: 12 }), 5_000);
    expect(a.decisions).toHaveLength(0);
    state = a.state;
    state = fold(state, { kind: "fill" }, cs({ filled: 13 }), 6_000).state;
    const c = fold(state, { kind: "fill" }, cs({ filled: 14 }), 7_000);
    expect(c.decisions).toHaveLength(0);
    expect(c.state.pendingFill).toEqual(cs({ filled: 14 }));
    // The wake is anchored to the leading push, so the trailing flush is one window later.
    expect(c.wakeAtMs).toBe(DEBOUNCE_MS);
  });

  it("trailing flush carries the latest held state at the window boundary", () => {
    const held = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 0,
      lastFillPushAtMs: 0,
      pendingFill: cs({ filled: 14 }),
    });
    const flushed = flushPending(held, DEBOUNCE_MS);
    expect(flushed.decisions).toHaveLength(1);
    expect(flushed.decisions[0]).toMatchObject({
      event: "update",
      priority: 5,
    });
    expect(flushed.state.lastSent).toEqual(cs({ filled: 14 }));
    expect(flushed.state.pendingFill).toBeNull();
    // The window re-arms on the trailing flush too, so the next leading fire needs a fresh window.
    expect(flushed.state.lastFillPushAtMs).toBe(DEBOUNCE_MS);
  });

  it("re-arm: a fill one window after the leading fire leads again", () => {
    const afterLead = st({
      lastSent: cs({ filled: 11 }),
      lastSentAtMs: 0,
      lastFillPushAtMs: 0,
    });
    const r = fold(
      afterLead,
      { kind: "fill" },
      cs({ filled: 20 }),
      DEBOUNCE_MS,
    );
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]!.priority).toBe(5);
    expect(r.state.lastFillPushAtMs).toBe(DEBOUNCE_MS);
  });
});

describe("§12a policy: a welcome hands a fresh token the current authoritative frame", () => {
  it("emits one immediate priority-10 update to the registering user's own tokens", () => {
    const r = fold(
      INITIAL_POLICY_STATE,
      { kind: "welcome", userId: "u7" },
      cs({ filled: 30 }),
      1000,
    );
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      event: "update",
      priority: 10,
      audience: { kind: "user", userId: "u7" },
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(r.wakeAtMs).toBeNull();
  });

  it("BYPASSES the game-level dedupe: it fires even when the state equals lastSent", () => {
    // A presence push already set lastSent to this exact frame; the whole roster has it. A fresh
    // token that just registered has received nothing, so the welcome must still deliver it.
    const primed = fold(
      INITIAL_POLICY_STATE,
      { kind: "presence" },
      cs(),
      1000,
    ).state;
    const r = fold(primed, { kind: "welcome", userId: "u7" }, cs(), 2000);
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({
      event: "update",
      audience: { kind: "user", userId: "u7" },
    });
  });

  it("still updates lastSent to the sent frame (current truth for everyone), without a fill re-arm", () => {
    const primed = st({
      lastSent: cs({ filled: 5 }),
      lastSentAtMs: 500,
      lastFillPushAtMs: 500,
      pendingFill: cs({ filled: 6 }),
    });
    const r = fold(
      primed,
      { kind: "welcome", userId: "u7" },
      cs({ filled: 9 }),
      2000,
    );
    // lastSent refreshes to the truth this token received, so the next dedupe stays honest...
    expect(r.state.lastSent).toEqual(cs({ filled: 9 }));
    expect(r.state.lastSentAtMs).toBe(2000);
    // ...but a welcome is not a fill, so it neither opens nor re-arms the fill window,
    // and it leaves any held pendingFill/pendingEnd untouched (it targets one user out of band).
    expect(r.state.lastFillPushAtMs).toBe(500);
    expect(r.state.pendingFill).toEqual(cs({ filled: 6 }));
  });

  it("a following presence to the whole game deduplicates against the welcome's lastSent", () => {
    // The welcome recorded current truth as lastSent; a presence carrying the same frame is a no-op.
    const afterWelcome = fold(
      INITIAL_POLICY_STATE,
      { kind: "welcome", userId: "u7" },
      cs(),
      1000,
    ).state;
    const presence = fold(afterWelcome, { kind: "presence" }, cs(), 2000);
    expect(presence.decisions).toHaveLength(0);
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
