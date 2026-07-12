// HTML entity decoding for clue text and display metadata: the shared leaf both the ingest
// boundary (ingest.ts) and the clue-markup translator (clue-runs.ts) build on. It lives in its own
// module so those two can each depend on it without depending on each other (the dependency-cruiser
// no-circular boundary rule): entities.ts imports nothing local, ingest.ts and clue-runs.ts both
// import it, and only ingest.ts depends on clue-runs.ts, so the graph stays acyclic.
//
// The decode is one left-to-right pass over the standard entities NYT-via-XWord-Info and the other
// registry formats carry; the client renders clue text as plain text (DESIGN.md section 10), so an
// undecoded entity would display literally.

/**
 * The named HTML entities ingestion decodes in clue text. Apostrophes usually arrive as the
 * numeric `&#39;`, handled by the numeric branch below; `apos` covers the named spelling for the
 * same character. `nbsp` decodes to U+00A0, a Unicode whitespace character JS `\s` matches, so the
 * clue-markup seam then collapses it to a single ASCII space like any other whitespace
 * (clue-runs.ts law 6); a `&nbsp;` in display metadata decodes the same way and trims out.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** One entity token: a decimal `&#NN;`, a hex `&#xNN;`, or a named run like `&amp;`. */
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Decode the standard HTML entities in one left-to-right pass, so `&amp;lt;` decodes to the
 * literal `&lt;` and never doubly to `<`. Unknown named entities and out-of-range or surrogate
 * numeric references are left verbatim; only a recognized entity is rewritten. Tags are NOT touched
 * here (the clue-markup translator parses them off the raw string first, clue-runs.ts law 8); this
 * is the entity pass only.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (match, token: string) => {
    if (token.charAt(0) === "#") {
      const isHex = token.charAt(1) === "x" || token.charAt(1) === "X";
      const code = isHex
        ? Number.parseInt(token.slice(2), 16)
        : Number.parseInt(token.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match; // lone surrogate
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[token];
    return named === undefined ? match : named;
  });
}
