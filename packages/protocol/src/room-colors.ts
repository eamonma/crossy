// Room-aware participant colors (DESIGN.md §8, D28; PROTOCOL.md §4, §6; design/identity/
// ROOM-COLORS.md). The wire `color` is display-only `#RRGGBB`: every client buckets its 24-bit
// value mod 12 into the frozen identity roster (vectors/identity/roster.json) and paints the
// slot's ground variant, never the raw value. The server used to emit a bare FNV-1a hash of the
// userId, so two members of one room could bucket to the same or a perceptually adjacent slot.
// D28 fixes that entirely in the emission: assign each member a roster slot spread across the
// room, then emit a wire value that buckets to it. The client contract is untouched.
//
// Pinned by vectors/identity/room-colors.json (written before this implementation; the vector
// outranks this file, CLAUDE.md precedence). Lives in the protocol package because both services
// are apps and apps never import each other; the session's emitters all route through here.
// Arithmetic and ASCII comparisons only (INV-1), no imports, no IO; colors carry no board
// content (INV-6 untouched).

/** How many identity slots the roster holds (vectors/identity/roster.json, frozen). */
const SLOT_COUNT = 12;

/**
 * Pairwise perceptual distance between roster slots: OKLab deltaE over the LIGHT-ground hexes of
 * vectors/identity/roster.json, in slot order (violet, poppy, teal, magenta, ochre, cobalt, moss,
 * rust, plum, cyan, coral, slate), scaled by 1e5 and rounded to integers so every ordering
 * comparison is exact in any port. Computed offline (sRGB to linear to OKLab, Ottosson's
 * reference constants, Euclidean distance); the roster is frozen, so this table is a constant.
 * Symmetric, zero diagonal; the unit tests assert both.
 */
export const SLOT_DELTA_E: readonly (readonly number[])[] = [
  [
    0, 29625, 21415, 19432, 30958, 6101, 27759, 24199, 10165, 17060, 26611,
    12030,
  ], // 0 violet
  [
    29625, 0, 26966, 13370, 11717, 33427, 21629, 9407, 23358, 27831, 5444,
    24066,
  ], // 1 poppy
  [
    21415, 26966, 0, 26549, 21072, 19565, 9663, 22678, 23228, 6273, 25544,
    12996,
  ], // 2 teal
  [
    19432, 13370, 26549, 0, 21295, 24402, 25918, 10266, 11825, 25334, 11965,
    17855,
  ], // 3 magenta
  [
    30958, 11717, 21072, 21295, 0, 33272, 13997, 16161, 27926, 22678, 11250,
    24227,
  ], // 4 ochre
  [
    6101, 33427, 19565, 24402, 33272, 0, 27468, 27384, 14422, 15317, 30704,
    12043,
  ], // 5 cobalt
  [
    27759, 21629, 9663, 25918, 13997, 27468, 0, 19306, 26633, 14458, 21486,
    18017,
  ], // 6 moss
  [
    24199, 9407, 22678, 10266, 16161, 27384, 19306, 0, 16585, 23978, 11566,
    16880,
  ], // 7 rust
  [
    10165, 23358, 23228, 11825, 27926, 14422, 26633, 16585, 0, 21135, 21740,
    10903,
  ], // 8 plum
  [
    17060, 27831, 6273, 25334, 22678, 15317, 14458, 23978, 21135, 0, 25285,
    12283,
  ], // 9 cyan
  [
    26611, 5444, 25544, 11965, 11250, 30704, 21486, 11566, 21740, 25285, 0,
    22777,
  ], // 10 coral
  [
    12030, 24066, 12996, 17855, 24227, 12043, 18017, 16880, 10903, 12283, 22777,
    0,
  ], // 11 slate
];

/** FNV-1a over the UTF-16 code units of `input`, returned as an unsigned 32-bit int. Moved
 * verbatim from apps/session/src/color.ts (D28); kept ASCII and arithmetic only so any port can
 * reproduce it. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The 24-bit wire value formatted as `#RRGGBB`, uppercase (the one wire format, PROTOCOL.md §4). */
function formatWire(value24: number): string {
  return "#" + value24.toString(16).padStart(6, "0").toUpperCase();
}

/**
 * Map a user id to their stable, room-blind `#RRGGBB` hash color (DESIGN.md §8). This is the
 * pre-D28 emission, moved here from apps/session/src/color.ts; it is still the emitted bytes
 * whenever the member's preferred slot is free in their room, and the fallback for a user outside
 * any member list.
 */
export function colorForUser(userId: string): string {
  return formatWire(fnv1a(userId) & 0xffffff);
}

/** The roster slot the bare hash color buckets to: `(value % 12)`, the client rule the wire
 * contract freezes (vectors/identity/roster.json slotForWireColor). */
export function preferredSlot(userId: string): number {
  return (fnv1a(userId) & 0xffffff) % SLOT_COUNT;
}

/** The membership facts the assignment orders by. `joinedAt` is an ISO-8601 UTC instant; the
 * uniform format makes ASCII order time order. */
export interface RoomMember {
  readonly userId: string;
  readonly joinedAt: string;
}

/** ASCII (UTF-16 code unit) order; for the ASCII ids and uniform timestamps this compares, code
 * units are bytes (INV-1: no locale collation anywhere near this). */
function compareAscii(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/**
 * Assign each member of one room a roster slot (D28; the exact semantics are pinned by
 * vectors/identity/room-colors.json). Members are processed in join order (`joinedAt` ascending,
 * `userId` ascending on ties), so an earlier member's slot never depends on a later joiner:
 *
 * - A member keeps their preferred slot (hash mod 12) when no one claimed it yet.
 * - On a collision they take the free slot maximizing the minimum SLOT_DELTA_E to every claimed
 *   slot; ties break to the lower slot index.
 * - Past twelve members duplicates are unavoidable: the candidates widen from "the free slots"
 *   to "the least-claimed slots" (the same set while any slot is free), scored by the same
 *   minimum distance to every *other* claimed slot, so the first duplicate lands on the most
 *   isolated color rather than piling anywhere.
 *
 * Deterministic in the member set alone; the given order never matters. Returns userId to slot.
 */
export function assignRoomSlots(
  members: readonly RoomMember[],
): ReadonlyMap<string, number> {
  const ordered = [...members].sort((a, b) => {
    const byJoin = compareAscii(a.joinedAt, b.joinedAt);
    return byJoin !== 0 ? byJoin : compareAscii(a.userId, b.userId);
  });
  const claims: number[] = new Array<number>(SLOT_COUNT).fill(0);
  const slots = new Map<string, number>();
  for (const member of ordered) {
    const preferred = preferredSlot(member.userId);
    const slot = claims[preferred] === 0 ? preferred : spreadSlot(claims);
    claims[slot]! += 1;
    // A duplicate userId (never emitted; memberships key on user) keeps the first assignment.
    if (!slots.has(member.userId)) slots.set(member.userId, slot);
  }
  return slots;
}

/** The collision rule: among the least-claimed slots, maximize the minimum distance to every
 * other claimed slot; ties to the lower index. `claims` has at least one nonzero entry here (the
 * collided preferred slot), so every candidate scores against something. */
function spreadSlot(claims: readonly number[]): number {
  let leastClaimed = Infinity;
  for (const count of claims) {
    if (count < leastClaimed) leastClaimed = count;
  }
  let best = 0;
  let bestScore = -1;
  for (let candidate = 0; candidate < SLOT_COUNT; candidate++) {
    if (claims[candidate] !== leastClaimed) continue;
    let score = Infinity;
    for (let claimed = 0; claimed < SLOT_COUNT; claimed++) {
      if (claimed === candidate || claims[claimed] === 0) continue;
      const d = SLOT_DELTA_E[candidate]![claimed]!;
      if (d < score) score = d;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * The wire color for an assigned slot. When the slot is the member's preferred one, this is
 * byte-identical to the pre-D28 `colorForUser` emission. Otherwise the 24-bit hash value is
 * minimally adjusted so `(value % 12) === slot`: subtract the residue, add the slot, and drop by
 * one modulus step if that overflows 24 bits (subtracting 12 preserves the residue). The result
 * always stays within `#000000`..`#FFFFFF` because `value - value % 12` is non-negative.
 */
export function wireColorForSlot(userId: string, slot: number): string {
  const value = fnv1a(userId) & 0xffffff;
  const residue = value % SLOT_COUNT;
  if (residue === slot) return formatWire(value);
  let adjusted = value - residue + slot;
  if (adjusted > 0xffffff) adjusted -= SLOT_COUNT;
  return formatWire(adjusted);
}

/**
 * The one call the emitters make (PROTOCOL.md §4 participants, §6 playerConnected, the Live
 * Activity content-state): room-aware wire colors for every member, userId to `#RRGGBB`. A kept
 * preferred slot emits today's exact hash bytes; a reassigned one buckets to the assigned slot.
 */
export function assignRoomColors(
  members: readonly RoomMember[],
): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  for (const [userId, slot] of assignRoomSlots(members)) {
    colors.set(userId, wireColorForSlot(userId, slot));
  }
  return colors;
}
