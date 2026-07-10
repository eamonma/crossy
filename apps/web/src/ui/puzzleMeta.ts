// Client-side read of a crossword JSON document's display metadata (title, byline, day,
// geometry, clue count), used by the create screen to preview a loaded puzzle and prefill
// the game name before anything is uploaded. Deliberately not a validator: the server's
// ingestion ACL (apps/api puzzles/ingest.ts) owns acceptance, and this reader must never
// block an upload the server would take. It reads only display fields, never the grid or
// answers, so the create screen keeps its INV-6 posture of never handling solution content
// from local state. The entity decode mirrors ingestion's (one pass, standard entities) so
// the title previewed here matches the title the server stores.

export interface PuzzleMeta {
  readonly title: string | null;
  readonly author: string | null;
  readonly editor: string | null;
  /** The document's date string as written, e.g. "7/10/2026"; display-only. */
  readonly date: string | null;
  /** The document's day-of-week string as written, e.g. "Friday"; display-only. */
  readonly dayOfWeek: string | null;
  readonly rows: number | null;
  readonly cols: number | null;
  readonly clueCount: number | null;
}

/** Matches ingestion's cap on stored display metadata. */
const MAX_METADATA_LENGTH = 200;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (match, token: string) => {
    if (token.charAt(0) === "#") {
      const isHex = token.charAt(1) === "x" || token.charAt(1) === "X";
      const code = isHex
        ? Number.parseInt(token.slice(2), 16)
        : Number.parseInt(token.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[token];
    return named === undefined ? match : named;
  });
}

/** One optional display string: absent, null, or non-string reads as absent (the NYT export
 * ships `title: null` on untitled puzzles); a present string is decoded, trimmed, capped. */
function readString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const decoded = decodeEntities(raw).trim();
  if (decoded === "") return null;
  return decoded.slice(0, MAX_METADATA_LENGTH);
}

function readDimension(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? raw
    : null;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Read the display metadata out of one puzzle JSON string, or null when the text is not a
 * JSON object at all (the one shape the server also rejects outright). Every field is
 * independently optional: a document with no metadata still returns a PuzzleMeta of nulls,
 * because the create screen treats "loaded but anonymous" and "loaded with a byline" as the
 * same happy path.
 */
export function readPuzzleMeta(raw: string): PuzzleMeta | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(doc)) return null;

  const size = doc["size"];
  const rows = isObject(size) ? readDimension(size["rows"]) : null;
  const cols = isObject(size) ? readDimension(size["cols"]) : null;

  const clues = doc["clues"];
  let clueCount: number | null = null;
  if (isObject(clues)) {
    const across = clues["across"];
    const down = clues["down"];
    if (Array.isArray(across) && Array.isArray(down)) {
      clueCount = across.length + down.length;
    }
  }

  return {
    title: readString(doc["title"]),
    author: readString(doc["author"]),
    editor: readString(doc["editor"]),
    date: readString(doc["date"]),
    dayOfWeek: readString(doc["dow"]),
    rows,
    cols,
    clueCount,
  };
}
