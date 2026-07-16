// The roster port for the Live Activity push channel. This is the server-side twin of the iOS
// render rules the island already speaks, ported here so the pushed content-state matches what the
// widget would draw from the same participant facts. It fixes three things the payload needs:
//
//   1. the twelve dark-ground roster colors and the slot rule
//      (apps/ios/Sources/CrossyDesign/IdentityRoster.swift, the ratified canonical, its header note),
//   2. the puck initial rule
//      (apps/ios/Sources/CrossyUI/GridPresence.swift `initial(of:)`), and
//   3. the cluster rule: which members become pucks, in what order, capped at 4
//      (apps/ios/Sources/CrossyUI/RosterList.swift `cluster`/`ordered`).
//
// The iOS files carry the ratification note; this port cites them and does not fork behavior. A
// test pins the twelve values and the slot rule against those files (roster.test.ts). INV-6: a puck
// carries presence and render facts only (initial, color, connected), the same facts the §4
// participant payload already puts on the wire; nothing here is solution-bearing. INV-1: the
// initial is ASCII-uppercased bytewise, no locale folding, the same way values.ts normalizes.

import type { LiveActivityPuck } from "@crossy/protocol";
import { LIVE_ACTIVITY_MAX_PUCKS } from "@crossy/protocol";

/** An 8-bit sRGB triple, the dark-ground form a puck paints directly (RGBColor.swift). */
export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/**
 * The twelve dark-ground roster values, in slot order, ported verbatim from
 * IdentityRoster.swift (the `darkGround` of each entry, in the `colors` array order:
 * violet, poppy, teal, magenta, ochre, cobalt, moss, rust, plum, cyan, coral, slate). The island's
 * black glass is a dark ground (GridGround.rosterColor picks `darkGround` when `isDark`), so a puck
 * on the Live Activity uses the dark-ground component. Slot order is the cross-client contract:
 * reordering reassigns everyone's color, so the order matches the Swift `colors` array exactly.
 */
export const ROSTER_DARK_GROUND: readonly Rgb[] = [
  rgb(0x9d95ff), // violet
  rgb(0xff7a50), // poppy
  rgb(0x3bc7b4), // teal
  rgb(0xe06b9e), // magenta
  rgb(0xe0a93e), // ochre
  rgb(0x6e93e8), // cobalt
  rgb(0x90b45e), // moss
  rgb(0xd97862), // rust
  rgb(0xb278c6), // plum
  rgb(0x4fbcce), // cyan
  rgb(0xf4917f), // coral
  rgb(0x8c99ba), // slate
];

/** Unpack a 0xRRGGBB literal into 8-bit components, the RGBColor(_:) rule (RGBColor.swift). */
function rgb(rgb24: number): Rgb {
  return {
    red: (rgb24 >> 16) & 0xff,
    green: (rgb24 >> 8) & 0xff,
    blue: rgb24 & 0xff,
  };
}

/**
 * The roster slot from a wire color string, the `IdentityRoster.slot(forWireColor:)` rule: parse
 * `#RRGGBB` (case-insensitive ASCII hex, INV-1) and take the 24-bit value mod 12. Returns null on
 * anything that is not exactly `#` plus six ASCII hex digits, so the caller falls back to the
 * user-id hash (rosterColorForMember), matching `GridPresence.rosterColor`. The wire string is
 * authoritative: the session itself derives it (colorForUser, `hash & 0xffffff` formatted
 * `#RRGGBB`), so slotting from it keeps server and client on the same slot given the same wire.
 */
export function slotForWireColor(color: string): number | null {
  if (color.length !== 7 || color.charCodeAt(0) !== 0x23 /* '#' */) return null;
  let value = 0;
  for (let i = 1; i < 7; i++) {
    const c = color.charCodeAt(i);
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
  return value % ROSTER_DARK_GROUND.length;
}

/**
 * The dark-ground roster color for a wire color string, the render color a puck carries. Falls back
 * to slot 0 only when the string is unparseable AND no user-id fallback is supplied; the member
 * path (puckFromMember) always supplies the user-id fallback, mirroring
 * `GridPresence.rosterColor(wireColor:userId:)` (wire first, hash of id second).
 */
export function darkGroundForWireColor(color: string): Rgb | null {
  const slot = slotForWireColor(color);
  return slot === null ? null : ROSTER_DARK_GROUND[slot]!;
}

/**
 * The puck initial: the display name's first character, ASCII-uppercased bytewise (INV-1), empty
 * when the name is empty. Exact port of `GridPresence.initial(of:)`: it takes the first character
 * (a full Unicode scalar / grapheme in Swift `String.first`; here the first code point via the
 * iterator so a surrogate pair stays whole), then uppercases each of its UTF-8 bytes in the ASCII
 * range only (0x61-0x7A minus 0x20), leaving non-ASCII bytes verbatim. For the ASCII display names
 * this reduces to "uppercase the first letter"; the byte rule is what keeps a non-ASCII name from
 * diverging between the two ports.
 */
export function puckInitial(displayName: string): string {
  const iterator = displayName[Symbol.iterator]();
  const first = iterator.next();
  if (first.done === true) return "";
  const bytes = new TextEncoder().encode(first.value);
  const upped = bytes.map((b) => (b >= 0x61 && b <= 0x7a ? b - 0x20 : b));
  return new TextDecoder().decode(upped);
}

/** A member the cluster rule reads: the presence and render facts, no board content (INV-6). */
export interface RosterMember {
  readonly userId: string;
  readonly displayName: string;
  /** The wire color string `#RRGGBB` (PROTOCOL.md §4), authoritative for slotting. */
  readonly wireColor: string;
  /** A spectator is never a puck (the presence ruling 2026-07-10); host and solver are. */
  readonly isSpectator: boolean;
  readonly connected: boolean;
}

/**
 * ASCII-byte lexicographic order over two strings (INV-1: no locale collation). The `<` on the
 * shorter-prefix case matches Swift's `compareASCII` (a prefix sorts before its extension).
 */
function compareAscii(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const n = Math.min(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ab[i] !== bb[i]) return ab[i]! < bb[i]!;
  }
  return ab.length < bb.length;
}

/**
 * Presence order, the `RosterList.ordered` rule: connected members first, then away; within each
 * group by display name (ASCII bytes) then user id (ASCII bytes), so the cluster never shuffles
 * between renders. A stable, total order over the byte comparisons.
 */
export function orderedMembers(
  members: readonly RosterMember[],
): RosterMember[] {
  return [...members].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    const nameEqual =
      a.displayName.length === b.displayName.length &&
      a.displayName === b.displayName;
    if (nameEqual) return compareAscii(a.userId, b.userId) ? -1 : 1;
    return compareAscii(a.displayName, b.displayName) ? -1 : 1;
  });
}

/**
 * The cluster, the `RosterList.cluster` rule (owner ruling 2026-07-10): only the people playing,
 * host or solver, never a spectator, in presence order, capped at LIVE_ACTIVITY_MAX_PUCKS (4). A
 * puck in the pill means "solving". Returns render-ready pucks for the content-state.
 */
export function clusterPucks(
  members: readonly RosterMember[],
): LiveActivityPuck[] {
  const playing = orderedMembers(members).filter((m) => !m.isSpectator);
  return playing.slice(0, LIVE_ACTIVITY_MAX_PUCKS).map(puckFromMember);
}

/**
 * One render-ready puck from a member: the ASCII initial, the dark-ground roster color (wire color
 * first, user-id hash fallback via slot), the connected flag for away-dimming, and the opaque
 * userId (the avatar-art key). The color authority chain mirrors `GridPresence.rosterColor`. The
 * user-id fallback reuses the session's own color derivation indirectly: colorForUser produces the
 * same `#RRGGBB` the wire carries, so an absent or malformed wire color still resolves to a stable
 * slot per user.
 */
export function puckFromMember(member: RosterMember): LiveActivityPuck {
  const color =
    darkGroundForWireColor(member.wireColor) ??
    darkGroundForUserId(member.userId);
  return {
    initial: puckInitial(member.displayName),
    red: color.red,
    green: color.green,
    blue: color.blue,
    connected: member.connected,
    // The opaque member id, carried through so the widget can key locally-cached avatar art off it.
    // The same id the §4 participant payload already puts on the wire; nothing solution-bearing.
    userId: member.userId,
  };
}

/**
 * The user-id fallback slot: `fnv1a32(userId) & 0xffffff` mod 12, the exact residue
 * `slot(forWireColor:)` takes on the wire string colorForUser would produce for this user. Kept
 * here (not imported from the protocol's string form) so the arithmetic is one hop and matches the
 * Swift `IdentityRoster.color(forWireColor:)` path the fallback feeds. INV-1: FNV over UTF-16 code
 * units, bytewise, no locale.
 */
function darkGroundForUserId(userId: string): Rgb {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const wire24 = (hash >>> 0) & 0xffffff;
  return ROSTER_DARK_GROUND[wire24 % ROSTER_DARK_GROUND.length]!;
}
