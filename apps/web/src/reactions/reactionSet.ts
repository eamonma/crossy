// The v1 reaction SEND set (PROTOCOL.md §9): the five graphemes this client is gated to send, in
// one ordered place the tray, the leader HUD, and the key handler all read, so a slot, a keycap,
// and a fired emoji can never drift apart. Sending is the only thing this set gates; receiving is
// receive-any (a client renders any well-formed reaction it gets, §9), so nothing here filters an
// incoming emoji. Per-user or widened sets plug in HERE later (DESIGN.md D24): the grapheme rides
// the wire, so swapping this array for a server-provided one needs no protocol bump.

/**
 * A leader-HUD compass slot. The five keys are the physical W / E / A / S / D cluster under the
 * left hand, and each slot's screen direction matches where its key sits in that cluster, so the
 * radial layout reads as the keys themselves.
 */
export type ReactionSlot = "up" | "upper-right" | "right" | "down" | "left";

export interface ReactionOption {
  /** The grapheme carried on the wire (PROTOCOL.md §9), never a symbolic token. */
  readonly emoji: string;
  /** The leader-HUD key, lowercase ASCII; matched case-folded (INV-1). */
  readonly leaderKey: string;
  /** The keycap glyph shown in the HUD, and in the tray for the two direct-key slots. */
  readonly keyLabel: string;
  /** Where the slot sits in the radial HUD, matching its key's place under the hand. */
  readonly slot: ReactionSlot;
  /** The no-HUD direct key, when one exists: `?` fires 🤔 and `!` fires 🎉 (Wave 7.3). */
  readonly directKey?: string;
}

export const REACTION_SET: readonly ReactionOption[] = [
  { emoji: "🎉", leaderKey: "w", keyLabel: "W", slot: "up", directKey: "!" },
  {
    emoji: "🤔",
    leaderKey: "e",
    keyLabel: "E",
    slot: "upper-right",
    directKey: "?",
  },
  { emoji: "👀", leaderKey: "d", keyLabel: "D", slot: "right" },
  { emoji: "💀", leaderKey: "s", keyLabel: "S", slot: "down" },
  { emoji: "🫡", leaderKey: "a", keyLabel: "A", slot: "left" },
];

/** The key that opens the radial HUD around the cursor cell (Wave 7.3). */
export const LEADER_KEY = "/";

// Lookups the key handler reads, built once rather than scanned on every keystroke.
const byLeaderKey = new Map(REACTION_SET.map((o) => [o.leaderKey, o]));
const byDirectKey = new Map(
  REACTION_SET.filter((o) => o.directKey !== undefined).map((o) => [
    o.directKey as string,
    o,
  ]),
);

/** ASCII-only lowercase (INV-1): map A-Z to a-z, leave every other code point alone. */
function asciiLower(ch: string): string {
  const code = ch.charCodeAt(0);
  return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
}

/** The option a leader key selects while the HUD is open, case-folded (INV-1). */
export function optionForLeaderKey(key: string): ReactionOption | undefined {
  if (key.length !== 1) return undefined;
  return byLeaderKey.get(asciiLower(key));
}

/** The option a direct key fires with no HUD: `?` → 🤔, `!` → 🎉 (Wave 7.3). */
export function optionForDirectKey(key: string): ReactionOption | undefined {
  return byDirectKey.get(key);
}
