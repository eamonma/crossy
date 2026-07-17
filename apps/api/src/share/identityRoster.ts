// The API's copy of the cross-client player identity palette (DESIGN.md §8, frozen in
// vectors/identity/roster.json). The server ships each player a stable wire color (`#RRGGBB`,
// @crossy/protocol colorForUser / assignRoomColors). A client does NOT paint that raw hash; it
// buckets the wire color to one of twelve curated slots and paints the slot's light- or dark-ground
// variant, so one player reads as the SAME color on web, in push, and on iOS. This module is the
// API's copy of that table and the bucketing, needed by the server-rendered share card so the card
// wears the exact hexes the clients paint.
//
// apps never import apps (DESIGN.md layering), so this cannot import apps/web's identityRoster.ts;
// it is a deliberate duplication pinned to the same vector by identityRoster.test.ts, the pattern
// the web copy already follows. The vector is the shared normative ground the three clients and this
// server all pin against, so none can drift.

/** One identity slot: a display name and its two ground variants (the same hex a client paints). */
export interface IdentitySlot {
  readonly name: string;
  /** The variant painted on a light ground (the share card's og ground). */
  readonly light: string;
  /** The variant painted on a dark ground. */
  readonly dark: string;
}

/** The twelve identity slots, in canonical slot order (vectors/identity/roster.json). */
export const IDENTITY_ROSTER: readonly IdentitySlot[] = [
  { name: "violet", light: "#6F66D4", dark: "#9D95FF" },
  { name: "poppy", light: "#DE5722", dark: "#FF7A50" },
  { name: "teal", light: "#17917F", dark: "#3BC7B4" },
  { name: "magenta", light: "#C2497D", dark: "#E06B9E" },
  { name: "ochre", light: "#C98A1B", dark: "#E0A93E" },
  { name: "cobalt", light: "#3D6BD6", dark: "#6E93E8" },
  { name: "moss", light: "#6B8F3C", dark: "#90B45E" },
  { name: "rust", light: "#B0503C", dark: "#D97862" },
  { name: "plum", light: "#8A4E9E", dark: "#B278C6" },
  { name: "cyan", light: "#2596A8", dark: "#4FBCCE" },
  { name: "coral", light: "#E06A5A", dark: "#F4917F" },
  { name: "slate", light: "#5E6B8C", dark: "#8C99BA" },
];

/**
 * The slot a wire color buckets to: the 24-bit value of a `#RRGGBB` string modulo the roster size,
 * the exact rule the clients use (vectors/identity/roster.json slotForWireColor), so all surfaces
 * land on the same slot for one wire color. Returns null for a malformed string (wrong length,
 * missing `#`, or a non-hex digit), so a caller can fall back rather than paint a wrong slot. ASCII
 * digits only (INV-1): the parse never touches locale casing.
 */
export function slotForWireColor(wireColor: string): number | null {
  if (wireColor.length !== 7 || wireColor.charCodeAt(0) !== 0x23 /* '#' */) {
    return null;
  }
  let value = 0;
  for (let i = 1; i < 7; i += 1) {
    const c = wireColor.charCodeAt(i);
    let digit: number;
    if (c >= 0x30 && c <= 0x39)
      digit = c - 0x30; // 0-9
    else if (c >= 0x41 && c <= 0x46)
      digit = c - 0x41 + 10; // A-F
    else if (c >= 0x61 && c <= 0x66)
      digit = c - 0x61 + 10; // a-f
    else return null;
    value = (value << 4) | digit;
  }
  return value % IDENTITY_ROSTER.length;
}

/**
 * Resolve a wire color to the hex a client paints on the given ground: the bucketed slot's light- or
 * dark-ground variant. A malformed wire color (no slot) falls back to the string itself, so a bad
 * input degrades to "paint what you were given" rather than crashing or blanking a cell.
 */
export function identityColor(wireColor: string, isDark: boolean): string {
  const slot = slotForWireColor(wireColor);
  if (slot === null) return wireColor;
  const s = IDENTITY_ROSTER[slot]!;
  return isDark ? s.dark : s.light;
}
