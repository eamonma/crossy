// Clue prose rendered as structured runs (owner ruling 2026-07-12: clue markup is RENDERED as
// real elements, never stripped, never raw HTML). A clue carries plain `text` always and, when
// the server sent styled prose, an optional canonical `runs` list whose `t` values concatenate
// back to `text`. This module owns both: a pure `clueSegments` that turns a clue into flat,
// serializable segments (the tested logic), and `ClueText`, the one render site everyone uses.
//
// No dangerouslySetInnerHTML anywhere: styles become nested <b>/<i>/<sub>/<sup> elements. The
// visual restraint is deliberate. Italic and bold are the surrounding font's own defaults; sub
// and sup use the semantic elements but with their font-size and line-height pinned here (not per
// call site) so a subscript or superscript never grows a tight clue row's line box.
import type { CSSProperties } from "react";
import type { Clue, ClueStyle } from "../domain/types";

/** The em-dash placeholder a missing clue text renders as, the convention every clue surface
 * already used (`clue.text ?? "—"`). Kept here so the fallback is identical wherever ClueText
 * stands in. */
export const MISSING_CLUE = "—";

/** The fixed wrap order the server also emits `s` in: bold outermost, then italic, then sub/sup.
 * A segment's styles are always reordered to this so nesting is deterministic and two segments
 * with the same style set produce identical markup regardless of the wire's ordering. */
const STYLE_ORDER: readonly ClueStyle[] = ["b", "i", "sub", "sup"];

/** One flat piece of a clue's prose: a text slice plus the known styles to wrap it in, already in
 * canonical order. This is the serializable shape the tests assert against; the component maps it
 * to elements. */
export interface ClueSegment {
  text: string;
  styles: readonly ClueStyle[];
}

function isKnownStyle(s: string): s is ClueStyle {
  return s === "b" || s === "i" || s === "sub" || s === "sup";
}

/** Normalize a run's style set: drop unknown strings (forward compatibility), dedupe, and sort
 * into the fixed wrap order. Order in equals order out is not assumed; the result is canonical. */
function canonicalStyles(raw: readonly string[] | undefined): ClueStyle[] {
  if (raw === undefined) return [];
  const seen = new Set<ClueStyle>();
  for (const s of raw) if (isKnownStyle(s)) seen.add(s);
  return STYLE_ORDER.filter((s) => seen.has(s));
}

/**
 * The pure clue-to-segments logic. Given a clue, return the pieces to render in order:
 *
 * - No `runs`: one segment carrying the plain `text` (or the em-dash placeholder when `text` is
 *   absent), unstyled. This is exactly today's rendering, so the demo boards and every pre-feature
 *   puzzle are untouched.
 * - With `runs`: one segment per run, each carrying that run's text and its canonical styles
 *   (unknown styles ignored). The server guarantees the run texts concatenate to `text`, so the
 *   visible prose is identical whether or not `runs` was sent; only the styling is added.
 *
 * A run whose text is empty is skipped (the server never sends one, but a tolerant reader costs
 * nothing). If that leaves nothing to show, fall back to the plain-text segment so a row is never
 * blank.
 */
export function clueSegments(clue: Pick<Clue, "text" | "runs">): ClueSegment[] {
  if (clue.runs !== undefined) {
    const segments: ClueSegment[] = [];
    for (const run of clue.runs) {
      if (run.t.length === 0) continue;
      segments.push({ text: run.t, styles: canonicalStyles(run.s) });
    }
    if (segments.length > 0) return segments;
  }
  return [{ text: clue.text ?? MISSING_CLUE, styles: [] }];
}

// Sub and sup keep the semantic element but are pinned to 0.75em with a zeroed line-height so
// they never stretch a clue row's line box. The browser default (line-height: normal on the
// raised/lowered box) is what would otherwise grow a tight row; setting it here, once, holds
// every call site to the same height.
const SUBSUP_STYLE: CSSProperties = { fontSize: "0.75em", lineHeight: 0 };

/** Wrap `children` in the segment's style elements, innermost last, in the fixed order. Bold is
 * outermost. Each element inherits the surrounding type; only sub/sup carry an inline style, and
 * only to constrain their box. */
function wrap(styles: readonly ClueStyle[], text: string): React.ReactNode {
  let node: React.ReactNode = text;
  // Walk the order in reverse so the first style ends up outermost.
  for (let i = styles.length - 1; i >= 0; i -= 1) {
    const style = styles[i];
    if (style === "b") node = <b>{node}</b>;
    else if (style === "i") node = <i>{node}</i>;
    else if (style === "sub") node = <sub style={SUBSUP_STYLE}>{node}</sub>;
    else node = <sup style={SUBSUP_STYLE}>{node}</sup>;
  }
  return node;
}

/**
 * A clue's prose as text. Drop-in for every `{clue.text ?? "—"}` site: unstyled clues render the
 * plain string, styled clues render nested emphasis elements, and a missing text renders the em
 * dash. It emits only text and inline elements, so it inherits the caller's type exactly and slots
 * inside whatever span or line the surface already sized.
 */
export function ClueText({ clue }: { clue: Pick<Clue, "text" | "runs"> }) {
  const segments = clueSegments(clue);
  return (
    <>
      {segments.map((seg, i) => (
        <span key={i}>{wrap(seg.styles, seg.text)}</span>
      ))}
    </>
  );
}
