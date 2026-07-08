// Cell value rules (PROTOCOL.md §3). A value is a string matching VALUE_PATTERN after
// normalization, or null for an empty cell. Normalization is ASCII-only so the TypeScript
// and Swift ports agree byte for byte (INV-1); locale-aware casing is forbidden because
// Turkish `i` uppercases to `İ` (U+0130) under a locale and would diverge the ports.

/** The charset for a filled value, checked after ASCII normalization (PROTOCOL.md §3, §11). */
export const VALUE_PATTERN = /^[A-Z0-9]{1,10}$/;

/**
 * Map `a`-`z` to `A`-`Z` and leave every other code unit unchanged (INV-1). This is the
 * whole of normalization: no `toLocaleUpperCase`, no Unicode case folding. The Swift port
 * mirrors this scalar-by-scalar; the comparator and reducer vectors pin the agreement.
 */
export function asciiUppercase(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    out +=
      code >= 0x61 && code <= 0x7a
        ? String.fromCharCode(code - 0x20)
        : String.fromCharCode(code);
  }
  return out;
}

/** Normalize a raw wire value to its canonical form (PROTOCOL.md §3). */
export function normalizeValue(input: string): string {
  return asciiUppercase(input);
}

/**
 * Whether a filled value is legal (PROTOCOL.md §11 INVALID_VALUE): it matches VALUE_PATTERN
 * after ASCII normalization. `İ` (U+0130) and `ı` (U+0131) are left unchanged by the
 * ASCII-only rule, so they fail the pattern identically on both ports (INV-1).
 */
export function isValidValue(raw: string): boolean {
  return VALUE_PATTERN.test(normalizeValue(raw));
}
