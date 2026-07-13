// Display name spec constants (PROTOCOL.md §12, DESIGN.md name-onboarding). The single
// source the API validator and the web sanitizer import; iOS re-declares the same values and
// is pinned to them by the shared vector (vectors/identity/display-name.json). This module
// imports nothing: the constants are plain data so a Swift port mirrors them by hand.
//
// A display name is user content shown back verbatim. It is never uppercased or folded
// (INV-1 casing is cell-values only) and carries no solution content (INV-6 untouched). We
// name only what breaks rendering or spoofs visible order and permit the rest, so this is a
// block-list, not an allow-list.

/**
 * Maximum length of a display name in extended grapheme clusters (user-perceived
 * characters), not code points or UTF-16 units. 40 is generous for a display label while
 * bounding the column and the roster chip. The minimum is 1 (the empty name is forbidden,
 * which is the point of onboarding).
 */
export const MAX_DISPLAY_NAME_GRAPHEMES = 40;

/**
 * Scalars a display name may not contain (reject, do not strip). Rejecting rather than
 * silently stripping keeps the client and server counts aligned and never mutates a name
 * behind the user's back. A ZWJ (U+200D) inside a valid emoji grapheme cluster is fine: the
 * grapheme segmenter keeps the cluster intact, so the caller checks scalars only outside a
 * cluster ("no lone zero-width"). The ranges:
 *
 * - C0 controls and C1/DEL controls: `U+0000`-`U+001F`, `U+007F`-`U+009F` (newline and tab
 *   included; a name is one line).
 * - Zero-width and invisible formatters: `U+200B`-`U+200D` (ZWSP/ZWNJ/ZWJ), `U+FEFF` (BOM),
 *   `U+2060` (word joiner).
 * - Bidi overrides: `U+202A`-`U+202E`, `U+2066`-`U+2069`. These can reorder a name's visible
 *   glyphs to spoof it. Plain RTL script (Arabic, Hebrew) is not an override and is allowed.
 */
export interface ScalarRange {
  /** First disallowed code point, inclusive. */
  readonly from: number;
  /** Last disallowed code point, inclusive. */
  readonly to: number;
}

/**
 * Scalars disallowed anywhere in a name, no matter their context: the C0/C1/DEL control ranges
 * and the bidi overrides. These always break rendering or spoof visible order, so a caller
 * rejects (or, at the edge, strips) them wherever they appear.
 */
export const ALWAYS_DISALLOWED_SCALAR_RANGES: readonly ScalarRange[] = [
  { from: 0x0000, to: 0x001f }, // C0 controls (newline, tab, ...)
  { from: 0x007f, to: 0x009f }, // DEL and C1 controls
  { from: 0x202a, to: 0x202e }, // LRE, RLE, PDF, LRO, RLO
  { from: 0x2066, to: 0x2069 }, // LRI, RLI, FSI, PDI
];

/**
 * Zero-width and invisible formatters, disallowed only when LONE (their own grapheme cluster at
 * the string level), NOT when they sit inside a valid emoji grapheme cluster as glue. A ZWJ
 * (U+200D) inside a family or profession emoji is legitimate: the grapheme segmenter keeps that
 * cluster intact, so a caller judges the whole cluster as one unit and this set trips only a
 * standalone occurrence ("no lone zero-width outside an emoji cluster").
 */
export const ZERO_WIDTH_SCALAR_RANGES: readonly ScalarRange[] = [
  { from: 0x200b, to: 0x200d }, // ZWSP, ZWNJ, ZWJ
  { from: 0x2060, to: 0x2060 }, // word joiner
  { from: 0xfeff, to: 0xfeff }, // byte-order mark
];

/**
 * Every disallowed scalar range, both classes. The distinction (always vs zero-width-when-lone)
 * lives in the validator, which walks graphemes; this flat list is the union for a caller that
 * only needs "is this scalar in the block-list at all".
 */
export const DISALLOWED_SCALAR_RANGES: readonly ScalarRange[] = [
  ...ALWAYS_DISALLOWED_SCALAR_RANGES,
  ...ZERO_WIDTH_SCALAR_RANGES,
];

function inRanges(codePoint: number, ranges: readonly ScalarRange[]): boolean {
  for (const range of ranges) {
    if (codePoint >= range.from && codePoint <= range.to) return true;
  }
  return false;
}

/** True if `codePoint` is a control or bidi override, disallowed in any context. */
export function isAlwaysDisallowedScalar(codePoint: number): boolean {
  return inRanges(codePoint, ALWAYS_DISALLOWED_SCALAR_RANGES);
}

/** True if `codePoint` is a zero-width or invisible formatter (disallowed only when lone). */
export function isZeroWidthScalar(codePoint: number): boolean {
  return inRanges(codePoint, ZERO_WIDTH_SCALAR_RANGES);
}

/** True if `codePoint` falls in any disallowed range (either class). */
export function isDisallowedScalar(codePoint: number): boolean {
  return inRanges(codePoint, DISALLOWED_SCALAR_RANGES);
}

/**
 * The layout whitespace `canonicalize` trims and collapses: the Unicode White_Space scalars that
 * are NOT controls. The control whitespace (tab, newline, and the rest of U+0009-U+000D, plus the
 * C1 U+0085) is deliberately excluded, so it survives canonicalization and the validator rejects
 * it as a control (a name is one line). Used as a character class by the API and web canonicalizers.
 */
export const COLLAPSIBLE_WHITESPACE =
  "\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
