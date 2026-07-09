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
 */
export type ApiErrorCode =
  | "UNAUTHORIZED" // 401: bad or missing bearer token
  | "FULL_ACCOUNT_REQUIRED" // 403: a guest attempted a create action (DESIGN.md §8)
  | "NOT_PARTICIPANT" // 403: authenticated, but not a member of this game
  | "DENIED" // 403: on the game's denylist, or a wrong invite code
  | "GAME_NOT_FOUND" // 404: unknown gameId
  | "PUZZLE_NOT_FOUND" // 404: unknown puzzleId
  | "VALIDATION" // 400: malformed or missing request body
  | "DIAGRAMLESS" // 422: a diagramless puzzle, unsupported in v4 (DESIGN.md §7, D13)
  | "OVERSIZE_GRID" // 422: a grid larger than 25x25 in some dimension (DESIGN.md §7, SP5)
  | "DEGENERATE_GRID" // 422: zero playable cells, completion would be vacuous (DESIGN.md §7)
  | "REBUS_TOO_LONG" // 422: a solution cell longer than the 10-char cap (SP5)
  | "UNSOLVABLE_CELL" // 422: a solution cell no legal input can satisfy (DESIGN.md §7, SP5)
  | "AMBIGUOUS_SOLUTION"; // 422: two clues for one slot, a Schroedinger puzzle (SP5)

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  UNAUTHORIZED: 401,
  FULL_ACCOUNT_REQUIRED: 403,
  NOT_PARTICIPANT: 403,
  DENIED: 403,
  GAME_NOT_FOUND: 404,
  PUZZLE_NOT_FOUND: 404,
  VALIDATION: 400,
  DIAGRAMLESS: 422,
  OVERSIZE_GRID: 422,
  DEGENERATE_GRID: 422,
  REBUS_TOO_LONG: 422,
  UNSOLVABLE_CELL: 422,
  AMBIGUOUS_SOLUTION: 422,
};

/** Serialize an API error to its JSON body and HTTP status. */
export function fail(c: Context, code: ApiErrorCode, message: string) {
  return c.json({ error: code, message }, STATUS[code]);
}
