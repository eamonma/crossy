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
 * The named HTML entities ingestion decodes in clue text: the XML five plus `nbsp`, the full
 * Latin-1 set (accented letters and symbols, the classic HTML 3.2 list vendor feeds actually
 * use: `&eacute;` in Caf\u00e9, `&ntilde;` in se\u00f1or), and the common typographic set (dashes, curly
 * quotes, ellipsis, euro). Apostrophes usually arrive as the numeric `&#39;`, handled by the
 * numeric branch below; `apos` covers the named spelling. `nbsp` decodes to U+00A0, a Unicode
 * whitespace character JS `\s` matches, so the clue-markup seam collapses it to a single ASCII
 * space like any other whitespace (clue-runs.ts law 6). The boundary is deliberate: Greek and
 * math names extend here when a feed carries them; an unknown name stays verbatim, so nothing
 * is ever silently wrong (vectors/v1/clue-runs, PROTOCOL.md section 12 law 6).
 */
const NAMED_ENTITIES: Record<string, string> = {
  // XML five + nbsp
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  // Latin-1 symbols (U+00A1..U+00BF)
  iexcl: "\u00a1",
  cent: "\u00a2",
  pound: "\u00a3",
  curren: "\u00a4",
  yen: "\u00a5",
  brvbar: "\u00a6",
  sect: "\u00a7",
  uml: "\u00a8",
  copy: "\u00a9",
  ordf: "\u00aa",
  laquo: "\u00ab",
  not: "\u00ac",
  shy: "\u00ad",
  reg: "\u00ae",
  macr: "\u00af",
  deg: "\u00b0",
  plusmn: "\u00b1",
  sup2: "\u00b2",
  sup3: "\u00b3",
  acute: "\u00b4",
  micro: "\u00b5",
  para: "\u00b6",
  middot: "\u00b7",
  cedil: "\u00b8",
  sup1: "\u00b9",
  ordm: "\u00ba",
  raquo: "\u00bb",
  frac14: "\u00bc",
  frac12: "\u00bd",
  frac34: "\u00be",
  iquest: "\u00bf",
  // Latin-1 uppercase letters (U+00C0..U+00DE)
  Agrave: "\u00c0",
  Aacute: "\u00c1",
  Acirc: "\u00c2",
  Atilde: "\u00c3",
  Auml: "\u00c4",
  Aring: "\u00c5",
  AElig: "\u00c6",
  Ccedil: "\u00c7",
  Egrave: "\u00c8",
  Eacute: "\u00c9",
  Ecirc: "\u00ca",
  Euml: "\u00cb",
  Igrave: "\u00cc",
  Iacute: "\u00cd",
  Icirc: "\u00ce",
  Iuml: "\u00cf",
  ETH: "\u00d0",
  Ntilde: "\u00d1",
  Ograve: "\u00d2",
  Oacute: "\u00d3",
  Ocirc: "\u00d4",
  Otilde: "\u00d5",
  Ouml: "\u00d6",
  times: "\u00d7",
  Oslash: "\u00d8",
  Ugrave: "\u00d9",
  Uacute: "\u00da",
  Ucirc: "\u00db",
  Uuml: "\u00dc",
  Yacute: "\u00dd",
  THORN: "\u00de",
  szlig: "\u00df",
  // Latin-1 lowercase letters (U+00E0..U+00FF)
  agrave: "\u00e0",
  aacute: "\u00e1",
  acirc: "\u00e2",
  atilde: "\u00e3",
  auml: "\u00e4",
  aring: "\u00e5",
  aelig: "\u00e6",
  ccedil: "\u00e7",
  egrave: "\u00e8",
  eacute: "\u00e9",
  ecirc: "\u00ea",
  euml: "\u00eb",
  igrave: "\u00ec",
  iacute: "\u00ed",
  icirc: "\u00ee",
  iuml: "\u00ef",
  eth: "\u00f0",
  ntilde: "\u00f1",
  ograve: "\u00f2",
  oacute: "\u00f3",
  ocirc: "\u00f4",
  otilde: "\u00f5",
  ouml: "\u00f6",
  divide: "\u00f7",
  oslash: "\u00f8",
  ugrave: "\u00f9",
  uacute: "\u00fa",
  ucirc: "\u00fb",
  uuml: "\u00fc",
  yacute: "\u00fd",
  thorn: "\u00fe",
  yuml: "\u00ff",
  // Latin Extended + typographic (the HTML 4 names vendor feeds reach for)
  OElig: "\u0152",
  oelig: "\u0153",
  Scaron: "\u0160",
  scaron: "\u0161",
  Yuml: "\u0178",
  fnof: "\u0192",
  circ: "\u02c6",
  tilde: "\u02dc",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201a",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bdquo: "\u201e",
  dagger: "\u2020",
  Dagger: "\u2021",
  bull: "\u2022",
  hellip: "\u2026",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  oline: "\u203e",
  frasl: "\u2044",
  euro: "\u20ac",
  trade: "\u2122",
  minus: "\u2212",
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
