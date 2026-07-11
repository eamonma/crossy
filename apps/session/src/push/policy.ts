// ActivityPushPolicy: the pure fold that turns a room observation into Live Activity push
// decisions. This is the server-side twin of the iOS SolveActivityPolicy: no IO, no timers, no
// clock of its own. Time arrives as a parameter (`nowMs`) and the per-game memory arrives as
// `prev`; the fold returns the next memory plus the decisions to enact. Every rule here is pinned
// by policy.test.ts, named by the section it defends.
//
// The rules (PROTOCOL.md "Live Activity push", the brief's policy section):
//   - Presence change (a cluster member connects or disconnects): push IMMEDIATELY at priority 10.
//   - Terminal moments split by outcome, because done is an EVENT (owner ruling 2026-07-11):
//       * COMPLETED: TWO decisions. At T an alerting `update` at priority 10 carrying the final
//         content-state plus an `aps.alert` ("Solved together", the room name), so the system
//         auto-expands the island and lights a dark lock screen. At T + ANNOUNCE_MS the `end` event
//         with the same final content-state and a dismissal date, scheduled through the SAME wakeAtMs
//         timer machinery the fill debounce uses. The announcement gets its moment, then the island
//         retires.
//       * ABANDONED: ONE quiet `end`, no alert, no celebration. The asymmetry is deliberate.
//   - Fill progress: DEBOUNCED LATEST-STATE. At most one update per DEBOUNCE_MS, carrying the
//     counts at send time (never a queue of intermediate states), at priority 5.
//   - A content-state identical to the last one sent never pushes (per-game dedupe).
//   - A kick: the kicked member's OWN tokens get a quiet `end` for that game; everyone else gets a
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
 * content-state as fresh before rendering its stale register. Thirty minutes (owner ruling
 * 2026-07-11). Stale must detect a BROKEN channel, not a quiet room: a healthy room where nobody
 * types for two minutes must not dim the crew. Only a real gap of half an hour with no fill and no
 * presence change (well past any normal think-pause) crosses into stale, so a live-but-quiet island
 * keeps showing its last true frame, and only a genuinely dropped channel visibly goes stale.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;

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
 * An ActivityKit alert dictionary (Apple's documented Live Activity payload shape: `aps.alert`
 * with `title`, `body`, and `sound` as siblings). Present only on an ALERTING update: it makes the
 * push break through, so the system auto-expands the island and lights a dark lock screen. The
 * emitter writes this verbatim under `aps.alert`. Carries a title and the room name as body, never
 * board content (INV-6). The completion frame is the only alerting push; every other push is quiet.
 */
export interface PushAlert {
  readonly title: string;
  readonly body: string;
  readonly sound: string;
}

/**
 * The title on the completion alert. A fixed, warm, ASCII line (INV-1 casing is moot for a literal);
 * the body carries the room name so a member sees which room finished. "Solved together" names the
 * event the ruling insists on: done is not a quiet pixel change, it announces itself.
 */
export const COMPLETION_ALERT_TITLE = "Solved together";

/** The completion alert body when a room carries no display name (the `games.name` column is null). */
export const COMPLETION_ALERT_BODY_UNNAMED = "Your crossword is complete";

/**
 * The standard system sound for a Live Activity alert. Apple's documented payload places `sound`
 * inside the `alert` dictionary; `"default"` is the standard notification sound. This is the value
 * the completion alert carries so the announcement is heard as well as seen.
 */
export const COMPLETION_ALERT_SOUND = "default";

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
  /**
   * On an ALERTING update (only the completion frame): the `aps.alert` block that makes the push
   * break through, auto-expanding the island. Absent on every quiet push.
   */
  readonly alert?: PushAlert;
}

/**
 * Dismissal offset for a terminal `end`: how long the completed or abandoned island lingers before
 * the system retires it. Five minutes (owner ruling 2026-07-11: fifteen was too long a squat on the
 * lock screen). Long enough for a player who backgrounded the app to glance at the final board (the
 * solve time, the finished fill) after they finish, short enough that the island does not overstay.
 */
export const DISMISS_AFTER_MS = 5 * 60 * 1000;

/**
 * The gap between a completion's alerting update and its `end` (owner ruling 2026-07-11: the end
 * follows once the announcement has had its moment). Six seconds lets the auto-expanded island hold
 * "Solved together" long enough to register before the activity ships its terminal frame and starts
 * its dismissal clock. Scheduled through the fill debounce's wakeAtMs timer, never a new timer path.
 */
export const ANNOUNCE_MS = 6000;

/**
 * The room name rides the observation, not the content-state (INV-6 keeps the content-state to
 * counts and render facts). The completion alert body needs it; every other observation ignores it.
 * The emitter reads it from the game row it already loads at hydration and passes it here.
 */
export interface TerminalObservation {
  readonly kind: "terminal";
  /** The room's display name for the completion alert body; may be null when the room is unnamed. */
  readonly roomName: string | null;
}

/** The kind of room observation the policy folds. */
export type Observation =
  | { readonly kind: "presence" }
  | { readonly kind: "fill" }
  | TerminalObservation
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
  /**
   * A completion's terminal `end`, held back until T + ANNOUNCE_MS so the alerting update gets its
   * moment first. The alerting update already went out; this is the follow-up `end` waiting for the
   * announce window to close. Null unless a completion is mid-announcement. Flushed by flushPending
   * through the same timer machinery as pendingFill, so no new timer path exists.
   */
  readonly pendingEnd: LiveActivityContentState | null;
  /** When the held `pendingEnd` becomes due (its alerting update's send time + ANNOUNCE_MS). */
  readonly pendingEndAtMs: number | null;
}

/** The empty memory for a game the policy has not pushed yet. */
export const INITIAL_POLICY_STATE: PolicyState = {
  lastSent: null,
  lastSentAtMs: null,
  lastFillPushAtMs: null,
  pendingFill: null,
  pendingEnd: null,
  pendingEndAtMs: null,
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
      return terminalFold(prev, observation.roomName, contentState, nowMs);
    case "kick":
      return kickFold(prev, observation.userId, contentState, nowMs);
    case "presence":
      return immediateUpdateFold(prev, contentState, nowMs);
    case "fill":
      return fillFold(prev, contentState, nowMs);
  }
}

/**
 * A held decision becomes due: the emitter calls this when its timer fires. Two things can be held:
 * a completion's follow-up `end` (pendingEnd, waiting out the ANNOUNCE_MS window after the alerting
 * update) or a debounced fill (pendingFill). The held end takes precedence: it is a terminal, so if
 * both are somehow present the fill is dropped. Pure, clock as data.
 */
export function flushPending(prev: PolicyState, nowMs: number): PolicyResult {
  if (prev.pendingEnd !== null) {
    return flushPendingEnd(prev, nowMs);
  }
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
      ...prev,
      lastSent: pending,
      lastSentAtMs: nowMs,
      lastFillPushAtMs: nowMs,
      pendingFill: null,
    },
    decisions: [updateDecision(pending, 5, STALE_AFTER_MS)],
    wakeAtMs: null,
  };
}

/**
 * Flush a completion's held `end`: the follow-up terminal frame after the alerting update has had
 * its ANNOUNCE_MS moment. If the window has not opened yet, keep holding and re-ask for a wake. Once
 * open, emit the `end` with the dismissal date and clear the held state. The end is NOT deduped
 * against lastSent: the alerting update set lastSent to this same content-state, but the end is a
 * different envelope event (it retires the island), so it must still go out.
 */
function flushPendingEnd(prev: PolicyState, nowMs: number): PolicyResult {
  const end = prev.pendingEnd!;
  const dueAtMs = prev.pendingEndAtMs ?? nowMs;
  if (nowMs < dueAtMs) {
    // The announcement is still having its moment; keep holding and ask to be woken when it ends.
    return { state: prev, decisions: [], wakeAtMs: dueAtMs };
  }
  return {
    state: {
      ...prev,
      pendingFill: null,
      pendingEnd: null,
      pendingEndAtMs: null,
    },
    decisions: [endDecision(end, { kind: "game" })],
    wakeAtMs: null,
  };
}

/**
 * Terminal: the outcome decides the shape (owner ruling 2026-07-11, done is an EVENT).
 *   - COMPLETED: TWO decisions across time. Now, an ALERTING update at priority 10 carrying the
 *     final content-state and the `aps.alert` ("Solved together" + room name) that auto-expands the
 *     island. The `end` is HELD as pendingEnd until nowMs + ANNOUNCE_MS and asks for a wake, so the
 *     announcement gets its moment before the terminal frame and the dismissal clock. The follow-up
 *     end flushes through the same wakeAtMs machinery the fill debounce uses (flushPending).
 *   - ABANDONED (and any non-completed terminal): ONE quiet `end` now, no alert. The asymmetry is
 *     deliberate: an abandonment is not a celebration.
 * A terminal supersedes any held fill either way. Dedupe still guards a re-emit of the same frame.
 */
function terminalFold(
  prev: PolicyState,
  roomName: string | null,
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
  if (cs.status === "completed") {
    // The alerting update lands now; the end is held so the announcement has its moment.
    const endAtMs = nowMs + ANNOUNCE_MS;
    return {
      state: {
        lastSent: cs,
        lastSentAtMs: nowMs,
        lastFillPushAtMs: prev.lastFillPushAtMs,
        pendingFill: null, // a terminal supersedes any held fill
        pendingEnd: cs,
        pendingEndAtMs: endAtMs,
      },
      decisions: [
        {
          event: "update",
          priority: 10,
          contentState: cs,
          audience: { kind: "game" },
          staleAfterMs: STALE_AFTER_MS,
          alert: {
            title: COMPLETION_ALERT_TITLE,
            body: roomName ?? COMPLETION_ALERT_BODY_UNNAMED,
            sound: COMPLETION_ALERT_SOUND,
          },
        },
      ],
      wakeAtMs: endAtMs,
    };
  }
  // Abandoned (or any other terminal): a single quiet end, no alert, no held follow-up.
  return {
    state: {
      lastSent: cs,
      lastSentAtMs: nowMs,
      lastFillPushAtMs: prev.lastFillPushAtMs,
      pendingFill: null, // a terminal supersedes any held fill
      pendingEnd: null,
      pendingEndAtMs: null,
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
        ...prev,
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
      ...prev,
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
        ...prev,
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
