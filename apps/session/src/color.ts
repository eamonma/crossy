// Deterministic participant color (DESIGN.md §8): an FNV-1a hash of the user id mapped
// to a hex color, stable across devices and sessions. Kept ASCII and arithmetic only so
// any port can reproduce it. Presence colors are a display concern, not board state.

/** FNV-1a over the UTF-16 code units of `input`, returned as an unsigned 32-bit int. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Map a user id to a stable `#RRGGBB` color (DESIGN.md §8). */
export function colorForUser(userId: string): string {
  const rgb = fnv1a(userId) & 0xffffff;
  return "#" + rgb.toString(16).padStart(6, "0").toUpperCase();
}
