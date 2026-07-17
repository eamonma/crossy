// Hex color arithmetic, pure TS (this package imports nothing). The card's one color
// operation is the linear mix: an owner's roster hex pulled most of the way toward the
// card face so the mosaic reads as a wash, not a paint bucket (SHARE.md layout contract).

/** `#RRGGBB` -> [r, g, b], or null when the string is not a six-digit hex color.
 * ASCII hex digits only (INV-1: no locale-aware parsing anywhere values are read). */
export function parseHex(hex: string): [number, number, number] | null {
  if (hex.length !== 7 || hex.charCodeAt(0) !== 0x23 /* '#' */) return null;
  const out: number[] = [];
  for (let i = 1; i < 7; i += 2) {
    const hi = hexDigit(hex.charCodeAt(i));
    const lo = hexDigit(hex.charCodeAt(i + 1));
    if (hi === null || lo === null) return null;
    out.push((hi << 4) | lo);
  }
  return [out[0]!, out[1]!, out[2]!];
}

function hexDigit(c: number): number | null {
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10; // A-F
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10; // a-f
  return null;
}

/**
 * Mix `hex` toward `toward` by `amount` (0 keeps hex, 1 becomes toward), clamped.
 * A malformed input degrades to `toward` (the card face), so a bad color can never
 * crash a card or paint garbage; it simply vanishes into the ground.
 */
export function mixHex(hex: string, toward: string, amount: number): string {
  const a = parseHex(hex);
  const b = parseHex(toward);
  if (b === null) return toward;
  if (a === null) return toward;
  const t = Math.min(1, Math.max(0, amount));
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return (
    "#" +
    [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}
