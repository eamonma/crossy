// The REST error contract for the core API (PROTOCOL.md §12: "the API's own contract
// lives with the API"). PROTOCOL.md §11 enumerates the WebSocket error codes; the REST
// boundary reuses the names that carry the same meaning (GAME_NOT_FOUND, DENIED,
// NOT_PARTICIPANT) and adds the REST-only ones this slice needs. Every failure is a
// small JSON body `{ error, message }` plus the matching HTTP status, so a client keys
// on a stable string, never on prose.
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The REST error codes this API returns. Shared meanings track PROTOCOL.md §11.
 *
 * The ingestion ACL adds the named puzzle rejections (DESIGN.md §7, PROTOCOL.md §12, SP5).
 * They carry 422 (Unprocessable Content), which draws the line the ingestion contract needs:
 * VALIDATION (400) means the body is not a well-formed XWord Info document, while a named
 * rejection means the document parses but the puzzle violates a domain rule the user can read
 * and act on ("this cell is unsolvable", "the grid is too big"). The status split is not pinned
 * by PROTOCOL.md §12; it is proposed here for the docs amendment ledger.
 *
 * The M3a membership lifecycle (kick, abandon, account deletion) adds two REST-only codes not
 * in the PROTOCOL.md §12 table, flagged for the docs amendment ledger. FORBIDDEN (403) is the
 * genuinely new one: a caller who is authenticated and a participant but not permitted the
 * action (a non-host kicking or abandoning, or a host targeting themselves in a kick).
 * PROTOCOL.md §12 states the self-kick 403 but names no code, and §11's ROLE_FORBIDDEN is
 * scoped to a spectator's WS mutation, so a dedicated REST code is clearer than overloading it.
 * INTERNAL (500) reuses the §11 name for a server fault, returned when a downstream call the
 * action depends on (the session-service notify for an abandon) fails.
 *
 * The multi-format ingest envelope (PROTOCOL.md §12, Phase 6, D21) adds UNKNOWN_FORMAT (the
 * envelope names a format outside the registry; the message names the format and never echoes
 * the document) and SOLUTION_MISSING (a well-formed document with no complete solution grid;
 * v1 requires solutions at ingest so check and completion work unchanged, D11).
 *
 * RATE_LIMITED (429) is the REST-only code the invite/join code paths return when a caller spends
 * their fixed window (http/rate-limit.ts), carrying a `Retry-After` header. Application-level
 * defense in depth behind Cloudflare's edge limiter; flagged for the docs amendment ledger.
 *
 * The display-name write (`PATCH /me`, DESIGN.md name-onboarding, PROTOCOL.md §12) adds the three
 * NAME_* codes, all 422 (Unprocessable Content), matching the ingestion precedent: the body is
 * well-formed JSON (a malformed body is 400 VALIDATION) but the name violates a domain rule the
 * user can read and fix (empty, too long, or a disallowed character). INV-1 casing does NOT apply
 * to names (it is cell-values only); a name is display content, so the block-list rejects only what
 * breaks rendering or spoofs order.
 */
export type ApiErrorCode =
  | "UNAUTHORIZED" // 401: bad or missing bearer token
  | "FULL_ACCOUNT_REQUIRED" // 403: a guest attempted a create action (DESIGN.md §8)
  | "NOT_PARTICIPANT" // 403: authenticated, but not a member of this game
  | "DENIED" // 403: on the game's denylist, or a wrong invite code
  | "FORBIDDEN" // 403: a member, but not permitted this action (host-only, or self-kick)
  | "GAME_NOT_FOUND" // 404: unknown gameId
  | "PUZZLE_NOT_FOUND" // 404: unknown puzzleId
  | "VALIDATION" // 400: malformed or missing request body
  | "INTERNAL" // 500: a server fault, e.g. a required downstream call failed (PROTOCOL.md §11)
  | "DIAGRAMLESS" // 422: a diagramless puzzle, unsupported in v4 (DESIGN.md §7, D13)
  | "OVERSIZE_GRID" // 422: a grid larger than 25x25 in some dimension (DESIGN.md §7, SP5)
  | "DEGENERATE_GRID" // 422: zero playable cells, completion would be vacuous (DESIGN.md §7)
  | "REBUS_TOO_LONG" // 422: a solution cell longer than the 10-char cap (SP5)
  | "UNSOLVABLE_CELL" // 422: a solution cell no legal input can satisfy (DESIGN.md §7, SP5)
  | "AMBIGUOUS_SOLUTION" // 422: two clues for one slot, a Schroedinger puzzle (SP5)
  | "UNKNOWN_FORMAT" // 400: the envelope names a format not in the registry (PROTOCOL.md §12)
  | "SOLUTION_MISSING" // 422: a well-formed document with no complete solution grid (PROTOCOL.md §12, D11)
  | "NAME_REQUIRED" // 422: a display name that is empty after canonicalization (PATCH /me)
  | "NAME_TOO_LONG" // 422: a display name over 40 graphemes after canonicalization (PATCH /me)
  | "NAME_INVALID" // 422: a display name with a control, lone zero-width, or bidi-override char (PATCH /me)
  | "RATE_LIMITED"; // 429: the caller spent their rate-limit window on a code path (http/rate-limit.ts)

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  UNAUTHORIZED: 401,
  FULL_ACCOUNT_REQUIRED: 403,
  NOT_PARTICIPANT: 403,
  DENIED: 403,
  FORBIDDEN: 403,
  GAME_NOT_FOUND: 404,
  PUZZLE_NOT_FOUND: 404,
  VALIDATION: 400,
  INTERNAL: 500,
  DIAGRAMLESS: 422,
  OVERSIZE_GRID: 422,
  DEGENERATE_GRID: 422,
  REBUS_TOO_LONG: 422,
  UNSOLVABLE_CELL: 422,
  AMBIGUOUS_SOLUTION: 422,
  UNKNOWN_FORMAT: 400,
  SOLUTION_MISSING: 422,
  NAME_REQUIRED: 422,
  NAME_TOO_LONG: 422,
  NAME_INVALID: 422,
  RATE_LIMITED: 429,
};

/** Serialize an API error to its JSON body and HTTP status. */
export function fail(c: Context, code: ApiErrorCode, message: string) {
  return c.json({ error: code, message }, STATUS[code]);
}
