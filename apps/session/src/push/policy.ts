// ActivityPushPolicy: the pure fold that turns a room observation into Live Activity push
// decisions. This is the server-side twin of the iOS SolveActivityPolicy: no IO, no timers, no
// clock of its own. Time arrives as a parameter (`nowMs`) and the per-game memory arrives as
// `prev`; the fold returns the next memory plus the decisions to enact. Every rule here is pinned
// by policy.test.ts, named by the section it defends.
//
// The rules (PROTOCOL.md "Live Activity push", the brief's policy section):
//   - Presence change (a cluster member connects or disconnects) and terminal moments (completed,
//     abandoned): push IMMEDIATELY at priority 10. Terminal ships as an `end` event with the final
//     content-state and a dismissal date so the island retires.
//   - Fill progress: DEBOUNCED LATEST-STATE. At most one update per DEBOUNCE_MS, carrying the
//     counts at send time (never a queue of intermediate states), at priority 5.
//   - A content-state identical to the last one sent never pushes (per-game dedupe).
//   - A kick: the kicked member's OWN tokens get an `end` for that game; everyone else gets a
//     normal presence update.
//
// The policy decides WHAT and WHEN; the emitter (emitter.ts) owns the fan-out to tokens, the host
// selection, and the actual HTTP. The policy never sees a token or a device: it works in
// content-states and abstract priorities, so it stays a headless fold.

import type { LiveActivityContentState } from "@crossy/protocol";

/**
 * Debounce window for fill progress (the brief's default, tuned later). Stale grid progress is low
 * value, so one update every 20 s is plenty to keep the lock-screen fill bar roughly honest without
 * a push per keystroke. Presence and terminal moments bypass this entirely (they are immediate).
 */
export const DEBOUNCE_MS = 20_000;

/**
 * The `stale-date` offset carried on an update: how long the widget should treat the pushed
 * content-state as fresh before rendering its stale register. Set to 3x the debounce window: a
 * healthy channel refreshes fill well inside it (every 20 s), and presence pushes reset it too, so
 * the widget only crosses into stale after a real gap of about a minute with no fill and no presence
 * change. Short enough that a genuinely quiet or dropped channel visibly goes stale rather than
 * showing a frozen count as if it were live.
 */
export const STALE_AFTER_MS = 3 * DEBOUNCE_MS;

/** APNs priority: 10 delivers immediately (presence, terminal); 5 is throttled (fill). */
export type PushPriority = 10 | 5;

/** The ActivityKit envelope event: an in-flight update, or the terminal end. */
export type PushEvent = "update" | "end";

/** Which tokens a decision targets: the whole game's roster, or one member's own tokens. */
export type PushAudience =
  | { readonly kind: "game" }
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "exceptUser"; readonly userId: string };

/**
 * One push decision the emitter enacts: send this content-state, as this event, at this priority,
 * to this audience. `dismissMs` is present only on an `end` (the dismissal-date offset); the
 * emitter stamps the absolute date from its own clock at send time.
 */
export interface PushDecision {
  readonly event: PushEvent;
  readonly priority: PushPriority;
  readonly contentState: LiveActivityContentState;
  readonly audience: PushAudience;
  /** On `update`: how long the widget renders this as fresh before its stale register. */
  readonly staleAfterMs?: number;
  /** On `end`: how long the system keeps the ended activity before auto-dismissing it. */
  readonly dismissMs?: number;
}

/**
 * Dismissal offset for a terminal `end`: how long the completed or abandoned island lingers before
 * the system retires it. Fifteen minutes lets a player who backgrounded the app still glance at the
 * final board (the solve time, the finished fill) on their lock screen after they finish, then it
 * clears itself. Long enough to be seen, short enough not to squat the lock screen.
 */
export const DISMISS_AFTER_MS = 15 * 60 * 1000;

/** The kind of room observation the policy folds. */
export type Observation =
  | { readonly kind: "presence" }
  | { readonly kind: "fill" }
  | { readonly kind: "terminal" }
  | { readonly kind: "kick"; readonly userId: string };

/**
 * Per-game policy memory, carried between folds. `lastSent` is the content-state most recently
 * emitted for this game (for dedupe); `lastSentAtMs` and `lastFillPushAtMs` gate the debounce;
 * `pendingFill` is the latest fill content-state held back by the debounce, waiting for the window
 * to open. The emitter persists this per game and threads it back in.
 */
export interface PolicyState {
  readonly lastSent: LiveActivityContentState | null;
  readonly lastSentAtMs: number | null;
  readonly lastFillPushAtMs: number | null;
  readonly pendingFill: LiveActivityContentState | null;
}

/** The empty memory for a game the policy has not pushed yet. */
export const INITIAL_POLICY_STATE: PolicyState = {
  lastSent: null,
  lastSentAtMs: null,
  lastFillPushAtMs: null,
  pendingFill: null,
};

/** The fold's output: the next memory, the decisions to enact, and any due-time to re-poll. */
export interface PolicyResult {
  readonly state: PolicyState;
  readonly decisions: readonly PushDecision[];
  /**
   * When a fill was debounced (held for the window), the ms timestamp the emitter should re-run
   * the fold at to flush it. Null when nothing is pending. The emitter arms one timer per game off
   * this, so the debounce is real-time without the policy holding a timer (time stays data).
   */
  readonly wakeAtMs: number | null;
}

/** Two content-states are duplicates iff their canonical JSON matches. Order is fixed by encode. */
function sameContentState(
  a: LiveActivityContentState,
  b: LiveActivityContentState,
): boolean {
  return encodeContentState(a) === encodeContentState(b);
}

/**
 * Canonical JSON for a content-state, key order fixed so a serialized comparison is stable and a
 * re-serialization on the wire matches. This is also the exact bytes the emitter sends under
 * `aps.content-state`, so dedupe compares what will actually be pushed.
 */
export function encodeContentState(cs: LiveActivityContentState): string {
  return JSON.stringify({
    pucks: cs.pucks.map((p) => ({
      initial: p.initial,
      red: p.red,
      green: p.green,
      blue: p.blue,
      connected: p.connected,
    })),
    filled: cs.filled,
    total: cs.total,
    status: cs.status,
    completedAt: cs.completedAt,
  });
}

/**
 * Fold one observation into decisions. Pure: same inputs, same output. `nowMs` is the clock as
 * data; `prev` is the per-game memory; `contentState` is the current room condensed to the payload
 * (built by the emitter from actor state, so the policy never touches the board). Returns the next
 * memory, the decisions, and a wake time if a fill was held.
 */
export function fold(
  prev: PolicyState,
  observation: Observation,
  contentState: LiveActivityContentState,
  nowMs: number,
): PolicyResult {
  switch (observation.kind) {
    case "terminal":
      return terminalFold(prev, contentState, nowMs);
    case "kick":
      return kickFold(prev, observation.userId, contentState, nowMs);
    case "presence":
      return immediateUpdateFold(prev, contentState, nowMs);
    case "fill":
      return fillFold(prev, contentState, nowMs);
  }
}

/**
 * A held fill becomes due: the emitter calls this when its debounce timer fires. It flushes
 * `pendingFill` if the window has now opened and the state is still novel, else it is a no-op (the
 * pending state was already superseded by a presence or terminal push). Pure, clock as data.
 */
export function flushPending(prev: PolicyState, nowMs: number): PolicyResult {
  if (prev.pendingFill === null) {
    return { state: prev, decisions: [], wakeAtMs: null };
  }
  const windowOpen =
    prev.lastFillPushAtMs === null ||
    nowMs - prev.lastFillPushAtMs >= DEBOUNCE_MS;
  if (!windowOpen) {
    // Not due yet; keep holding and ask to be woken when the window opens.
    return {
      state: prev,
      decisions: [],
      wakeAtMs: prev.lastFillPushAtMs! + DEBOUNCE_MS,
    };
  }
  const pending = prev.pendingFill;
  if (prev.lastSent !== null && sameContentState(prev.lastSent, pending)) {
    // Superseded by an identical later push; drop it (duplicate suppression).
    return {
      state: { ...prev, pendingFill: null },
      decisions: [],
      wakeAtMs: null,
    };
  }
  return {
    state: {
      lastSent: pending,
      lastSentAtMs: nowMs,
      lastFillPushAtMs: nowMs,
      pendingFill: null,
    },
    decisions: [updateDecision(pending, 5, STALE_AFTER_MS)],
    wakeAtMs: null,
  };
}

/** Terminal: an `end` to the whole game at priority 10, with a dismissal date. Dedupe applies. */
function terminalFold(
  prev: PolicyState,
  cs: LiveActivityContentState,
  nowMs: number,
): PolicyResult {
  if (prev.lastSent !== null && sameContentState(prev.lastSent, cs)) {
    // The terminal state was already the last frame sent (e.g. a re-emit); do not push twice.
    return {
      state: { ...prev, pendingFill: null },
      decisions: [],
      wakeAtMs: null,
    };
  }
  return {
    state: {
      lastSent: cs,
      lastSentAtMs: nowMs,
      lastFillPushAtMs: prev.lastFillPushAtMs,
      pendingFill: null, // a terminal supersedes any held fill
    },
    decisions: [endDecision(cs, { kind: "game" })],
    wakeAtMs: null,
  };
}

/**
 * Kick: the kicked member's own tokens get an `end` for this game (their island must not keep
 * ticking a room they were removed from), and everyone else gets a normal presence update at
 * priority 10. Two decisions, so the emitter fans them to the right tokens. `lastSent` tracks the
 * everyone-else update (the game's shared state); the per-user end is out of band.
 */
function kickFold(
  prev: PolicyState,
  userId: string,
  cs: LiveActivityContentState,
  nowMs: number,
): PolicyResult {
  const decisions: PushDecision[] = [endDecision(cs, { kind: "user", userId })];
  // The remaining roster gets the fresh presence state, unless it duplicates the last one sent.
  if (prev.lastSent === null || !sameContentState(prev.lastSent, cs)) {
    decisions.push({
      event: "update",
      priority: 10,
      contentState: cs,
      audience: { kind: "exceptUser", userId },
      staleAfterMs: STALE_AFTER_MS,
    });
    return {
      state: {
        lastSent: cs,
        lastSentAtMs: nowMs,
        lastFillPushAtMs: prev.lastFillPushAtMs,
        pendingFill: null,
      },
      decisions,
      wakeAtMs: null,
    };
  }
  return { state: { ...prev, pendingFill: null }, decisions, wakeAtMs: null };
}

/** Presence: an immediate `update` to the whole game at priority 10. Dedupe applies. */
function immediateUpdateFold(
  prev: PolicyState,
  cs: LiveActivityContentState,
  nowMs: number,
): PolicyResult {
  if (prev.lastSent !== null && sameContentState(prev.lastSent, cs)) {
    return {
      state: { ...prev, pendingFill: null },
      decisions: [],
      wakeAtMs: null,
    };
  }
  return {
    state: {
      lastSent: cs,
      lastSentAtMs: nowMs,
      lastFillPushAtMs: prev.lastFillPushAtMs,
      pendingFill: null, // an immediate push carries the current fill too, so drop the held one
    },
    decisions: [updateDecision(cs, 10, STALE_AFTER_MS)],
    wakeAtMs: null,
  };
}

/**
 * Fill: debounced latest-state. If the debounce window is open (>= DEBOUNCE_MS since the last fill
 * push), push now at priority 5. Otherwise hold this state as `pendingFill` (replacing any earlier
 * held state, so only the latest survives, never a queue) and ask to be woken when the window
 * opens. A fill identical to the last sent never pushes.
 */
function fillFold(
  prev: PolicyState,
  cs: LiveActivityContentState,
  nowMs: number,
): PolicyResult {
  if (prev.lastSent !== null && sameContentState(prev.lastSent, cs)) {
    // No change worth a push; also clear any stale pending that equals this.
    return {
      state: { ...prev, pendingFill: null },
      decisions: [],
      wakeAtMs: null,
    };
  }
  const windowOpen =
    prev.lastFillPushAtMs === null ||
    nowMs - prev.lastFillPushAtMs >= DEBOUNCE_MS;
  if (windowOpen) {
    return {
      state: {
        lastSent: cs,
        lastSentAtMs: nowMs,
        lastFillPushAtMs: nowMs,
        pendingFill: null,
      },
      decisions: [updateDecision(cs, 5, STALE_AFTER_MS)],
      wakeAtMs: null,
    };
  }
  // Hold the latest state; only one survives (never a queue of intermediates).
  return {
    state: { ...prev, pendingFill: cs },
    decisions: [],
    wakeAtMs: prev.lastFillPushAtMs! + DEBOUNCE_MS,
  };
}

function updateDecision(
  cs: LiveActivityContentState,
  priority: PushPriority,
  staleAfterMs: number,
): PushDecision {
  return {
    event: "update",
    priority,
    contentState: cs,
    audience: { kind: "game" },
    staleAfterMs,
  };
}

function endDecision(
  cs: LiveActivityContentState,
  audience: PushAudience,
): PushDecision {
  return {
    event: "end",
    priority: 10,
    contentState: cs,
    audience,
    dismissMs: DISMISS_AFTER_MS,
  };
}
