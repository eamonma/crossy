// ASCII-only casing, shared by the reducer's value normalization and the comparator
// (INV-1). Locale-aware casing is forbidden: toLocaleUpperCase would map Turkish `i`
// to `İ` (U+0130) and diverge the TypeScript and Swift ports. The reducer and
// comparator vectors pin the Turkish dotted and dotless i to catch that mistake.

/** Map `a-z` to `A-Z` by code point; leave every other code unit unchanged. */
export function asciiUpper(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // 0x61..0x7a is a-z; subtract 0x20 to reach A-Z. Everything else, including any
    // non-ASCII code unit, is copied verbatim.
    out += String.fromCharCode(
      code >= 0x61 && code <= 0x7a ? code - 0x20 : code,
    );
  }
  return out;
}
