// The reaction SEND set (PROTOCOL.md §9, §12): the five graphemes this client offers to send, in
// one ordered place the tray, the leader HUD, and the key handler all read, so a slot, a keycap,
// and a fired emoji can never drift apart. Sending is the only thing this set gates; receiving is
// receive-any (a client renders any well-formed reaction it gets, §9), so nothing here filters an
// incoming emoji.
//
// The set is a per-user preference now (Wave 8.4; DESIGN.md D25). This file went from a constant to
// a DERIVED set: the slot geometry (the W/E/A/S/D compass, the `!`/`?` accelerators on slots 1 and 2)
// is fixed and positional, while the five emoji ride in from the account's `reactionSet` (GET/PATCH
// /me, §12) or default when it is null. resolveReactionSet builds the ordered options and the key
// lookups from a personal set once, and every consumer takes the resolved set, so nothing reads a
// module-level constant that a preference could stale.

/**
 * A leader-HUD compass slot. The five keys are the physical W / E / A / S / D cluster under the
 * left hand, and each slot's screen direction matches where its key sits in that cluster, so the
 * radial layout reads as the keys themselves.
 */
export type ReactionSlot = "up" | "upper-right" | "right" | "down" | "left";

/** The fixed, positional metadata of one slot: everything but the emoji it currently holds. The
 *  emoji rides in from the personal set; the key, keycap, direction, and accelerator do not. */
export interface ReactionSlotMeta {
  /** The leader-HUD key, lowercase ASCII; matched case-folded (INV-1). */
  readonly leaderKey: string;
  /** The keycap glyph shown in the HUD, and in the tray for the two direct-key slots. */
  readonly keyLabel: string;
  /** Where the slot sits in the radial HUD, matching its key's place under the hand. */
  readonly slot: ReactionSlot;
  /** The no-HUD direct key, when one exists: `!` fires slot 1 and `?` fires slot 2 (§9), whatever
   *  emoji those slots currently hold. */
  readonly directKey?: string;
}

export interface ReactionOption extends ReactionSlotMeta {
  /** The grapheme carried on the wire (PROTOCOL.md §9), never a symbolic token. Rides in from the
   *  personal set (or the default) at resolve time. */
  readonly emoji: string;
}

/**
 * The five slots in slot order (PROTOCOL.md §9): the compass geometry and the two accelerators.
 * Slot 1 carries `!`, slot 2 carries `?` (owner ruling; §9 "slots 1 and 2 of the sender's set"),
 * and the W/E/A/S/D cluster maps to up / upper-right / right / down / left. Fixed and positional:
 * the personal set only chooses which emoji sits in each slot, never the key or the direction.
 */
export const REACTION_SLOTS: readonly ReactionSlotMeta[] = [
  { leaderKey: "w", keyLabel: "W", slot: "up", directKey: "!" },
  { leaderKey: "e", keyLabel: "E", slot: "upper-right", directKey: "?" },
  { leaderKey: "d", keyLabel: "D", slot: "right" },
  { leaderKey: "s", keyLabel: "S", slot: "down" },
  { leaderKey: "a", keyLabel: "A", slot: "left" },
];

/**
 * The default personal set (PROTOCOL.md §9): the five emoji every account offers until it configures
 * its own, and what a null `reactionSet` resolves to. In slot order, so slot 1 (`!`) is 🔥 and slot 2
 * (`?`) is 🤔 by default. Retires the Phase 7 fixed set (🎉 🤔 👀 💀 🫡).
 */
export const DEFAULT_REACTION_SET: readonly string[] = [
  "🔥",
  "🤔",
  "🐐",
  "💀",
  "😭",
];

/**
 * The house picks the Settings quick-grid offers (Wave 8.4): the five defaults first, then a small
 * spread of common reactions. Not a catalog and not a gate (any emoji is sendable, §9); just a fast
 * path so most users never open the OS emoji picker. Order is the grid's reading order.
 */
export const HOUSE_PICKS: readonly string[] = [
  ...DEFAULT_REACTION_SET,
  "🎉",
  "👀",
  "🫡",
  "🤯",
  "❤️",
  "👏",
  "🧠",
  "🙏",
  "✨",
  "😤",
  "🥳",
];

/**
 * A personal set resolved to its ordered options plus the two key lookups. Built once per personal
 * set (memoized by the caller), rather than scanned on every keystroke: the maps key on the fixed
 * slot keys, and their values carry the slot's current emoji, so a leader or direct key resolves to
 * the emoji that slot holds right now.
 */
export interface ResolvedReactionSet {
  readonly options: readonly ReactionOption[];
  readonly byLeaderKey: ReadonlyMap<string, ReactionOption>;
  readonly byDirectKey: ReadonlyMap<string, ReactionOption>;
}

/**
 * Build the ordered options and key lookups for a personal set. `null` (or a set that is not the
 * expected length) resolves to the defaults; a well-formed personal set fills each slot in order,
 * with any missing entry falling back to the default for that slot so the tray never renders a
 * hole. The wire always carries the grapheme (§9), so a set the client has never "seen" still sends.
 */
export function resolveReactionSet(
  personal: readonly string[] | null,
): ResolvedReactionSet {
  const source =
    personal !== null && personal.length === REACTION_SLOTS.length
      ? personal
      : DEFAULT_REACTION_SET;
  const options: readonly ReactionOption[] = REACTION_SLOTS.map((meta, i) => ({
    ...meta,
    emoji: source[i] ?? DEFAULT_REACTION_SET[i] ?? "",
  }));
  const byLeaderKey = new Map(options.map((o) => [o.leaderKey, o]));
  const byDirectKey = new Map(
    options
      .filter((o) => o.directKey !== undefined)
      .map((o) => [o.directKey as string, o]),
  );
  return { options, byLeaderKey, byDirectKey };
}

/** The resolved default set, for surfaces with no personal set (the demo, a pre-seed fallback). */
export const DEFAULT_RESOLVED_REACTION_SET: ResolvedReactionSet =
  resolveReactionSet(null);

/** The key that opens the radial HUD around the cursor cell (Wave 7.3). */
export const LEADER_KEY = "/";

/** ASCII-only lowercase (INV-1): map A-Z to a-z, leave every other code point alone. */
function asciiLower(ch: string): string {
  const code = ch.charCodeAt(0);
  return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
}

/** The option a leader key selects while the HUD is open, case-folded (INV-1), against a resolved
 *  set. */
export function optionForLeaderKey(
  set: ResolvedReactionSet,
  key: string,
): ReactionOption | undefined {
  if (key.length !== 1) return undefined;
  return set.byLeaderKey.get(asciiLower(key));
}

/** The option a direct key fires with no HUD, against a resolved set: `!` fires slot 1, `?` fires
 *  slot 2, whatever those slots hold (§9). */
export function optionForDirectKey(
  set: ResolvedReactionSet,
  key: string,
): ReactionOption | undefined {
  return set.byDirectKey.get(key);
}
