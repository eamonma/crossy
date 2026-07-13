// Display name spec (PROTOCOL.md §12, DESIGN.md name-onboarding). The authoritative
// canonicalize + validate path the identity `/me` write runs, plus an edge `sanitize` that
// mirrors the per-keystroke client filter. All three are pinned by
// vectors/identity/display-name.json so the API, the web sanitizer, and the iOS sanitizer
// cannot drift. The spec constants (the max grapheme count, the disallowed-scalar ranges)
// live in @crossy/protocol, the single source; this file only implements the behavior.
//
// A display name is user content shown back verbatim. It is never uppercased or folded
// (INV-1 casing is cell-values only) and carries no solution content (INV-6 untouched).
import {
  COLLAPSIBLE_WHITESPACE,
  MAX_DISPLAY_NAME_GRAPHEMES,
  isAlwaysDisallowedScalar,
  isZeroWidthScalar,
} from "@crossy/protocol";

/** The named domain rejections `validate` returns, matching errors.ts and PROTOCOL.md §12. */
export type DisplayNameError =
  "NAME_REQUIRED" | "NAME_TOO_LONG" | "NAME_INVALID";

export type ValidateResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly code: DisplayNameError };

// One shared segmenter (Node 24 has Intl.Segmenter; DESIGN.md name-onboarding R7). Grapheme
// mode counts user-perceived characters, so a ZWJ family emoji or a flag counts as one and a
// name is never cut mid-glyph. The server count is authoritative; a client that counts fewer
// simply sees a NAME_TOO_LONG 422, an acceptable degradation (R7).
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Grapheme clusters of `s`, so length is measured in user-perceived characters. */
function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (seg) => seg.segment);
}

/**
 * True if `cluster` (one grapheme) contains a disallowed scalar. A control or bidi override is
 * disallowed anywhere. A zero-width formatter (ZWJ, ZWSP, ...) is disallowed only when the cluster
 * is a LONE zero-width run (no base character): inside a valid emoji cluster the ZWJ is glue and
 * the segmenter keeps the cluster intact, so a family emoji's internal ZWJ never trips the check.
 * A cluster is "lone zero-width" when every scalar in it is a zero-width formatter.
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
  // A cluster made up entirely of zero-width formatters is a lone occurrence (a base-less run),
  // which is disallowed; a zero-width scalar acting as glue in a real cluster is allowed.
  return hasZeroWidth && allZeroWidth;
}

/**
 * Canonicalize a raw name for storage (DESIGN.md name-onboarding §5), in order: Unicode NFC
 * (one visual name has one byte form), trim leading and trailing Unicode White_Space, then
 * collapse every internal whitespace run to a single ASCII space. A name is a label, not a
 * layout. Casing is untouched (INV-1 does not apply to names).
 */
const WS = `[${COLLAPSIBLE_WHITESPACE}]`;
const TRIM_RE = new RegExp(`^${WS}+|${WS}+$`, "gu");
const COLLAPSE_RE = new RegExp(`${WS}+`, "gu");

export function canonicalize(raw: string): string {
  // Only collapsible layout whitespace is trimmed and collapsed. Control whitespace (tab,
  // newline) is NOT whitespace here: it survives so `validate` rejects it as a control, so a
  // name stays one line.
  return raw.normalize("NFC").replace(TRIM_RE, "").replace(COLLAPSE_RE, " ");
}

/**
 * Validate a canonicalized name (DESIGN.md name-onboarding §5). Empty is NAME_REQUIRED;
 * over MAX_DISPLAY_NAME_GRAPHEMES graphemes is NAME_TOO_LONG; a disallowed scalar (control,
 * lone zero-width, bidi override) outside a valid emoji cluster is NAME_INVALID. Everything
 * else (every other letter, mark, number, symbol, emoji) is allowed: a block-list, not an
 * allow-list. Pass the value through `canonicalize` first.
 */
export function validate(canonical: string): ValidateResult {
  if (canonical.length === 0) return { ok: false, code: "NAME_REQUIRED" };
  const clusters = graphemes(canonical);
  if (clusters.length > MAX_DISPLAY_NAME_GRAPHEMES) {
    return { ok: false, code: "NAME_TOO_LONG" };
  }
  for (const cluster of clusters) {
    if (clusterHasDisallowedScalar(cluster)) {
      return { ok: false, code: "NAME_INVALID" };
    }
  }
  return { ok: true, value: canonical };
}

/**
 * Edge sanitize for parity with the clients (DESIGN.md name-onboarding R6): strip every
 * disallowed scalar and cap at MAX_DISPLAY_NAME_GRAPHEMES graphemes, but do NOT trim or
 * collapse whitespace and do NOT NFC-normalize. This is the per-keystroke shape the client
 * field applies so it never holds a value the server would reject for shape; the server still
 * trims, collapses, and normalizes on submit via `canonicalize`. Vector-pinned so the
 * keystroke filter cannot drift from the submit path.
 */
export function sanitize(raw: string): string {
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
