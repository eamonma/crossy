// The web display-name spec: the client twin of the API validator
// (apps/api/src/identity/display-name.ts), pinned to the same vector
// (vectors/identity/display-name.json) so client and server cannot drift. The field runs
// `sanitizeDisplayName` per keystroke so it never holds a value the server would reject for
// shape; the submit path canonicalizes and checks completeness before the PATCH. The spec
// constants (the max grapheme count, the disallowed-scalar ranges) live in @crossy/protocol,
// the single source (R6); this file only implements the behavior against them.
//
// A display name is user content shown back verbatim. It is never uppercased or folded
// (INV-1 casing is cell-values only). The server's grapheme count is authoritative (R7); the
// client cap is a courtesy, so a browser ICU that counts fewer than the server simply sees a
// NAME_TOO_LONG 422, an acceptable degradation.
import {
  COLLAPSIBLE_WHITESPACE,
  MAX_DISPLAY_NAME_GRAPHEMES,
  isAlwaysDisallowedScalar,
  isZeroWidthScalar,
} from "@crossy/protocol";

// One shared segmenter, grapheme mode: a ZWJ family emoji or a flag counts as one, so a name
// is never cut mid-glyph and the cap matches the server's grapheme count.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Grapheme clusters of `s`, so length is measured in user-perceived characters. */
function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (seg) => seg.segment);
}

/**
 * True if `cluster` (one grapheme) contains a disallowed scalar. A control or bidi override is
 * disallowed anywhere. A zero-width formatter (ZWJ, ZWSP, ...) is disallowed only when the
 * cluster is a LONE zero-width run (no base character): inside a valid emoji cluster the ZWJ is
 * glue and the segmenter keeps the cluster intact, so a family emoji's internal ZWJ never trips
 * the check. Mirrors the API's clusterHasDisallowedScalar exactly.
 */
function clusterHasDisallowedScalar(cluster: string): boolean {
  let allZeroWidth = true;
  let hasZeroWidth = false;
  for (const ch of cluster) {
    const cp = ch.codePointAt(0)!;
    if (isAlwaysDisallowedScalar(cp)) return true;
    if (isZeroWidthScalar(cp)) hasZeroWidth = true;
    else allZeroWidth = false;
  }
  return hasZeroWidth && allZeroWidth;
}

/**
 * Edge sanitize for the field, applied per keystroke (R6): strip every disallowed scalar and
 * cap at MAX_DISPLAY_NAME_GRAPHEMES graphemes, but do NOT trim, collapse, or NFC-normalize (the
 * field must let the user type spaces mid-name; the server and canonicalize do trim/collapse on
 * submit). Vector-pinned so the keystroke filter cannot drift from the submit path.
 */
export function sanitizeDisplayName(raw: string): string {
  const kept: string[] = [];
  let count = 0;
  for (const cluster of graphemes(raw)) {
    if (clusterHasDisallowedScalar(cluster)) continue;
    if (count >= MAX_DISPLAY_NAME_GRAPHEMES) break;
    kept.push(cluster);
    count += 1;
  }
  return kept.join("");
}

// Only collapsible layout whitespace is trimmed and collapsed. Control whitespace (tab,
// newline) is NOT whitespace here: it survives canonicalize so completeness rejects it as a
// control, so a name stays one line. Matches the API's WS/TRIM_RE/COLLAPSE_RE.
const WS = `[${COLLAPSIBLE_WHITESPACE}]`;
const TRIM_RE = new RegExp(`^${WS}+|${WS}+$`, "gu");
const COLLAPSE_RE = new RegExp(`${WS}+`, "gu");

/**
 * Canonicalize a raw name the way the server stores it (DESIGN.md name-onboarding §5), in
 * order: Unicode NFC (one visual name has one byte form), trim leading and trailing Unicode
 * White_Space, then collapse every internal whitespace run to a single ASCII space. Casing is
 * untouched (INV-1 does not apply to names). Mirrors the API's `canonicalize`.
 */
export function canonicalizeDisplayName(raw: string): string {
  return raw.normalize("NFC").replace(TRIM_RE, "").replace(COLLAPSE_RE, " ");
}

/**
 * A name ready to submit: its canonical form is 1..MAX graphemes and contains no disallowed
 * scalar. The onboarding "Continue" and the Settings "Save" gate on this so the client never
 * fires a PATCH the server would obviously reject; the server still validates authoritatively.
 */
export function isCompleteDisplayName(raw: string): boolean {
  const canonical = canonicalizeDisplayName(raw);
  if (canonical.length === 0) return false;
  const clusters = graphemes(canonical);
  if (clusters.length > MAX_DISPLAY_NAME_GRAPHEMES) return false;
  for (const cluster of clusters) {
    if (clusterHasDisallowedScalar(cluster)) return false;
  }
  return true;
}
