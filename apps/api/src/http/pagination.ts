// Shared pagination for the list endpoints (`GET /games`, `GET /puzzles`). Cursor pagination
// only, no offsets: a `limit` (clamped) plus an optional `createdAt` cursor `before`. A
// `createdAt` cursor is stable under inserts (a new row never shifts an older page), which
// offset pagination cannot promise, and it needs no server-side cursor state.

/** Default page size when `limit` is absent or unparseable. */
export const DEFAULT_LIMIT = 50;
/** Hard cap on page size; a larger `limit` is clamped down, never an error. */
export const MAX_LIMIT = 100;

/**
 * Clamp the `limit` query param to `[1, MAX_LIMIT]`, defaulting to `DEFAULT_LIMIT` when it is
 * absent or not a finite number. A too-large or too-small value is clamped rather than
 * rejected, so a client that over-asks still gets a bounded, well-formed page.
 */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/**
 * Parse the optional `before` cursor: an ISO 8601 timestamp the page filters strictly before
 * (`created_at < before`). Absent or empty means the first page (no cursor). A present but
 * unparseable value is a client error (`ok: false`), which the handler maps to `VALIDATION`,
 * rather than being silently ignored (which would return the first page and mask the bug).
 */
export type BeforeCursor =
  { readonly ok: true; readonly before: Date | null } | { readonly ok: false };

export function parseBefore(raw: string | undefined): BeforeCursor {
  if (raw === undefined || raw === "") return { ok: true, before: null };
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return { ok: false };
  return { ok: true, before: new Date(ms) };
}
