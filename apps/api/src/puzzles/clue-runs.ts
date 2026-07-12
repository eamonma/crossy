// Clue markup translator: the one seam where an external clue's HTML markup becomes structured
// runs (owner ruling 2026-07-12; PROTOCOL.md section 12; DESIGN.md section 7, D13). The external
// format is translated exactly once, here at ingest; formatting is CAPTURED as runs and rendered
// downstream, never stripped and never sent as raw HTML on the wire (INV-6 is untouched: runs are
// clue prose, never solution data). Every translator in the registry (xwordinfo, nyt, amuselabs,
// guardian) funnels its raw clue string through `parseClueRuns`, so the markup rule applies
// uniformly across formats.
//
// The output is `{ text, runs? }`: `text` is the plain projection (concatenation of every run's
// text equals it exactly) and `runs` is the styled decomposition, OMITTED when the whole clue is
// unstyled so an all-plain clue stays a bare string on the wire. The canonical-form laws this
// module implements (each has at least one test in clue-runs.test.ts):
//
//  1. Plain projection: the concatenation of runs' `t` equals `text` exactly.
//  2. `runs` is omitted when the whole clue is unstyled (never an all-plain runs array).
//  3. No empty run; `s` is omitted rather than empty; no duplicate styles.
//  4. Style order inside `s` is fixed: "b", "i", "sub", "sup".
//  5. Adjacent runs with identical style sets merge (minimal form).
//  6. `text` is the normalized plain string: tags parsed out, entities decoded, Unicode
//     whitespace collapsed to single ASCII spaces, trimmed.
//  7. Vocabulary: <i>/<em> -> "i"; <b>/<strong> -> "b"; <sub> -> "sub"; <sup> -> "sup". Any other
//     tag contributes no style but keeps its content. <br> in any form becomes a single space.
//  8. Order law: tags are parsed on the raw string BEFORE entities are decoded, so `&lt;i&gt;` is
//     literal text (never formatting) and `3 < 4` is preserved (a `<` not starting a whitelist or
//     any real tag is literal).
//  9. Nesting flattens to style sets (a run inside <b><i> carries {b, i}).
// 10. Whitespace collapse operates on the projection; a collapsed run of whitespace carries the
//     styles of its FIRST whitespace character; a run emptied by collapse or by the outer trim is
//     dropped.
// 11. Literal characters pass through untouched, notably a leading `*` on a starred clue.
// 12. Malformed tags are forgiving and deterministic: an unclosed whitelist tag styles through the
//     end of the string, and a stray closing tag with no matching opener is dropped (its style is
//     simply not popped). This is the behavior noted for the wave; it is total (never throws) and
//     order-independent.
//
// This module reuses the shared entity decoder (the same one-pass decode the strip-only seam
// used), applied per run AFTER the tags are parsed off the raw string (law 8). The decoder lives in
// the leaf entities.ts, not ingest.ts, so ingest.ts can depend on this translator without a cycle.
import { decodeEntities } from "./entities";

/** The style vocabulary a run may carry (law 7). A superset would need a protocol change. */
export type ClueStyle = "b" | "i" | "sub" | "sup";

/**
 * One run of clue text with a uniform style set. `t` is the plain (entity-decoded) text of the
 * run; `s` is the set of styles covering it, omitted when the run is plain (law 3). The `t` of
 * every run concatenated is the clue's plain `text` (law 1).
 */
export interface ClueRun {
  readonly t: string;
  readonly s?: readonly ClueStyle[];
}

/**
 * A translated clue: the plain projection `text` (law 6) and, only when some run is styled, the
 * `runs` decomposition (law 2). The shape is additive over the protocol `Clue` (which carries
 * `{ number, text, cellIndices }`): a translator spreads this onto its built clue, so an all-plain
 * clue is byte-identical to the pre-markup output and a styled clue gains `runs`.
 */
export interface ClueRuns {
  readonly text: string;
  readonly runs?: readonly ClueRun[];
}

/** The fixed order styles are emitted in inside a run's `s` (law 4). */
const STYLE_ORDER: readonly ClueStyle[] = ["b", "i", "sub", "sup"];

/** Map a whitelist tag name (already ASCII-lowercased) to the style it contributes (law 7). */
const TAG_STYLE: Readonly<Record<string, ClueStyle>> = {
  i: "i",
  em: "i",
  b: "b",
  strong: "b",
  sub: "sub",
  sup: "sup",
};

/**
 * One HTML tag token on the RAW clue string. `<`, an optional closing slash, a NAME that must
 * start with an ASCII letter, then any run of non-angle-bracket characters (attributes, an
 * optional self-closing slash), then `>`. Requiring a letter right after the optional slash is
 * what keeps angle-bracket prose intact (law 8): `3 < 4` has a space after `<`, so it is not a
 * tag; the inner class forbids `<`/`>`, so a stray `>` never lets a match span two runs of text.
 * This is the same grammar the strip-only seam used, reused so both directions agree on what a
 * tag is.
 */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;

/** A run of Unicode whitespace on the projection, collapsed to one ASCII space (law 6, law 10). */
const WHITESPACE_RUN = /\s+/;

/**
 * One raw span carved off the clue: its text (a slice of the raw string, tags excluded) and the
 * style set active over it. Styles are carried as a boolean-per-style record so nesting flattens
 * (law 9) and duplicate openers are idempotent (two <b> still means just bold).
 */
interface RawSpan {
  readonly text: string;
  readonly styles: StyleFlags;
}

type StyleFlags = Readonly<Record<ClueStyle, boolean>>;

/** ASCII-lowercase a tag name (INV-1: never locale-aware; tag names are ASCII by grammar). */
function asciiLowerName(name: string): string {
  let out = "";
  for (let k = 0; k < name.length; k += 1) {
    const code = name.charCodeAt(k);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : name[k];
  }
  return out;
}

/** The ordered, deduplicated style list for a run, or undefined when the run is plain (law 3, 4). */
function styleList(flags: StyleFlags): readonly ClueStyle[] | undefined {
  const s = STYLE_ORDER.filter((style) => flags[style]);
  return s.length === 0 ? undefined : s;
}

/** True when two flag sets are equal, so adjacent runs sharing a style set can merge (law 5). */
function sameStyles(a: StyleFlags, b: StyleFlags): boolean {
  return a.b === b.b && a.i === b.i && a.sub === b.sub && a.sup === b.sup;
}

/**
 * Carve the raw clue string into spans of uniform style by walking its tags left to right (law 8:
 * this reads the RAW string, before any entity decode). A whitelist opener pushes its style onto a
 * stack (a matching closer pops the nearest same-style frame); a non-whitelist tag contributes no
 * style but still splits the text so its own markup never lands in a run (law 7); every `<br>`
 * variant becomes a single space (law 7). A `<` that does not begin a real tag is literal text and
 * flows into the current span untouched (law 8, law 11). An unclosed opener simply stays on the
 * stack to the end (law 12); a closer with no matching opener pops nothing and is dropped (law 12).
 */
function carveSpans(raw: string): RawSpan[] {
  const spans: RawSpan[] = [];
  // The active style stack: each frame is the style a still-open whitelist tag contributes. A
  // frame may be null for an open whitelist tag whose style is already active from an outer frame
  // (so its closer pops the right depth without double-counting), but style membership is computed
  // by scanning the stack, so nesting flattens to a set (law 9).
  const stack: (ClueStyle | null)[] = [];
  const flagsFromStack = (): StyleFlags => ({
    b: stack.includes("b"),
    i: stack.includes("i"),
    sub: stack.includes("sub"),
    sup: stack.includes("sup"),
  });

  let last = 0;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  const push = (rawText: string): void => {
    if (rawText.length > 0)
      spans.push({ text: rawText, styles: flagsFromStack() });
  };
  while ((m = TAG.exec(raw)) !== null) {
    push(raw.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === "/";
    const name = asciiLowerName(m[2]!);
    if (name === "br") {
      // A line break is a single space in the CURRENT style context (law 7). Collapse folds it
      // later if it abuts other whitespace (law 10).
      spans.push({ text: " ", styles: flagsFromStack() });
      continue;
    }
    const style = TAG_STYLE[name];
    if (style === undefined) continue; // a non-whitelist tag: no style, content already split off
    if (!closing) {
      stack.push(style);
    } else {
      // Pop the nearest matching-style frame; a stray closer with no opener pops nothing (law 12).
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k] === style) {
          stack.splice(k, 1);
          break;
        }
      }
    }
  }
  push(raw.slice(last));
  return spans;
}

/**
 * Decode entities per span (law 8: AFTER tags are parsed off), then merge adjacent spans that
 * share a style set (law 5), building the projection text alongside. Decoding per span, not on the
 * joined string, keeps an entity from ever re-forming a tag boundary across a split.
 */
function decodeAndMerge(spans: readonly RawSpan[]): {
  text: string;
  runs: { text: string; styles: StyleFlags }[];
} {
  const runs: { text: string; styles: StyleFlags }[] = [];
  let text = "";
  for (const span of spans) {
    const decoded = decodeEntities(span.text);
    if (decoded === "") continue;
    text += decoded;
    const prev = runs[runs.length - 1];
    if (prev !== undefined && sameStyles(prev.styles, span.styles)) {
      prev.text += decoded;
    } else {
      runs.push({ text: decoded, styles: span.styles });
    }
  }
  return { text, runs };
}

/**
 * Collapse Unicode whitespace to single ASCII spaces on the PROJECTION, carrying styles across the
 * split (law 6, law 10). The runs are walked as one logical character stream: a maximal whitespace
 * run anywhere becomes one space that inherits the style of its FIRST whitespace character (law
 * 10); leading and trailing whitespace is trimmed. A run emptied by the collapse or the trim is
 * dropped (law 3, law 10). The result's run texts concatenate to the returned collapsed `text`
 * exactly (law 1), so the projection and the runs can never disagree.
 */
function collapse(runs: readonly { text: string; styles: StyleFlags }[]): {
  text: string;
  runs: { text: string; styles: StyleFlags }[];
} {
  // Flatten to a per-character stream so a whitespace run can span a style boundary and still
  // collapse to one space with the first character's style.
  const chars: { ch: string; styles: StyleFlags }[] = [];
  for (const run of runs) {
    for (const ch of run.text) chars.push({ ch, styles: run.styles });
  }

  const out: { ch: string; styles: StyleFlags }[] = [];
  let inWhitespace = false;
  let sawNonWhitespace = false;
  for (const c of chars) {
    if (WHITESPACE_RUN.test(c.ch)) {
      if (!inWhitespace) {
        // Open a collapsed space carrying THIS (the first) whitespace character's style (law 10).
        out.push({ ch: " ", styles: c.styles });
        inWhitespace = true;
      }
      // Subsequent whitespace in the same run folds into the space already pushed.
    } else {
      out.push(c);
      inWhitespace = false;
      sawNonWhitespace = true;
    }
  }
  // Trim: drop a single leading collapsed space and a single trailing one (law 6, law 10).
  if (out.length > 0 && out[0]!.ch === " ") out.shift();
  if (out.length > 0 && out[out.length - 1]!.ch === " ") out.pop();
  if (!sawNonWhitespace) return { text: "", runs: [] };

  // Rebuild runs by grouping adjacent characters of equal style (re-merges across the folds).
  const merged: { text: string; styles: StyleFlags }[] = [];
  let text = "";
  for (const c of out) {
    text += c.ch;
    const prev = merged[merged.length - 1];
    if (prev !== undefined && sameStyles(prev.styles, c.styles)) {
      prev.text += c.ch;
    } else {
      merged.push({ text: c.ch, styles: c.styles });
    }
  }
  return { text, runs: merged };
}

/**
 * Translate one raw clue string into its canonical `{ text, runs? }` form (all laws). `text` is
 * the plain projection; `runs` is present only when at least one run carries a style (law 2), so
 * an all-plain clue returns a bare `{ text }` and stays a plain string on the wire. This is total
 * and deterministic: any input yields a value, malformed markup included (law 12).
 */
export function parseClueRuns(raw: string): ClueRuns {
  const carved = carveSpans(raw);
  const decoded = decodeAndMerge(carved);
  const { text, runs } = collapse(decoded.runs);

  const anyStyled = runs.some((r) => styleList(r.styles) !== undefined);
  if (!anyStyled) {
    // Law 2: no run is styled, so omit `runs` entirely; the projection is the whole clue.
    return { text };
  }
  const emitted: ClueRun[] = runs.map((r) => {
    const s = styleList(r.styles);
    return s === undefined ? { t: r.text } : { t: r.text, s };
  });
  return { text, runs: emitted };
}
