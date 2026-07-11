// The iOS Live Activity content-state payload (PROTOCOL.md "Live Activity push"). One JSON
// object rides inside the standard APNs Live Activity envelope as `aps.content-state`. The
// TypeScript emitter (a later slice in apps/session) encodes it; the Swift widget's Codable
// decodes it. This type is the shared shape, pinned by the vectors in vectors/live-activity/
// (the same normative-fixture posture as deriveMask/Mask for the puzzle silhouette).
//
// INV-6: progress is COUNTS ONLY (`filled`/`total`). No letters, no cell coordinates, nothing
// derivable toward the solution ever rides this payload. The roster is presence and render
// facts (initial, color, connected), which the participant payload (PROTOCOL.md §4) already
// carries on the wire; none of it is solution-bearing.
//
// INV-1: `initial` is a single ASCII-uppercased letter, cased byte for byte the same way the
// value normalizer is, so the TypeScript emitter and the Swift decoder agree with no locale
// folding.

/**
 * One roster puck, render-ready for the Live Activity island's dark ground. The color is
 * resolved server-side into 8-bit sRGB components so the widget paints it directly without a
 * palette lookup. `connected` drives away-dimming (a disconnected member's puck dims but stays
 * in the cluster).
 */
export interface LiveActivityPuck {
  /** A single ASCII-uppercased initial (INV-1). One glyph; never a full name. */
  readonly initial: string;
  /** sRGB red component, 0-255. */
  readonly red: number;
  /** sRGB green component, 0-255. */
  readonly green: number;
  /** sRGB blue component, 0-255. */
  readonly blue: number;
  /** False dims the puck for an away member; the puck stays in the cluster (PROTOCOL.md). */
  readonly connected: boolean;
  /**
   * The member's opaque user id, the same value every §4 participant payload carries. The widget
   * keys locally-cached avatar art off it; the key reveals nothing about the solution (INV-6). Null
   * when unknown. Tolerant decoders treat an absent field the same as null (PROTOCOL.md 12a).
   */
  readonly userId: string | null;
}

/** The three lifecycle states a Live Activity content-state reports (PROTOCOL.md §4 mirror). */
export type LiveActivityStatus = "ongoing" | "completed" | "abandoned";

/**
 * The Live Activity content-state (PROTOCOL.md "Live Activity push"). The server mutates a
 * running activity by pushing this inside `aps.content-state`; a terminal state ships as an
 * `end` event carrying the final content-state.
 *
 * The cluster rides content-state (not the activity's immutable attributes), so a member who
 * joins after the activity started still appears. `filled`/`total` are counts only (INV-6).
 * `completedAt` is set exactly when `status` is `"completed"`, and is null otherwise (ongoing
 * and abandoned both carry null: an abandoned game never completed).
 */
export interface LiveActivityContentState {
  /** The live roster cluster, at most 4, in presence order. */
  readonly pucks: readonly LiveActivityPuck[];
  /** Filled playable cells. A count, never the cells themselves (INV-6). */
  readonly filled: number;
  /** Total playable cells. A count (INV-6). */
  readonly total: number;
  readonly status: LiveActivityStatus;
  /** ISO-8601 UTC, set exactly when `status` is `"completed"`, else null. */
  readonly completedAt: string | null;
}

/** The lock-screen cap on a Live Activity: readers filter the token registry by this window. */
export const LIVE_ACTIVITY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** The cluster shows at most this many pucks (PROTOCOL.md). */
export const LIVE_ACTIVITY_MAX_PUCKS = 4;
