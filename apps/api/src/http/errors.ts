// The REST error contract for the core API (PROTOCOL.md §12: "the API's own contract
// lives with the API"). PROTOCOL.md §11 enumerates the WebSocket error codes; the REST
// boundary reuses the names that carry the same meaning (GAME_NOT_FOUND, DENIED,
// NOT_PARTICIPANT) and adds the REST-only ones this slice needs. Every failure is a
// small JSON body `{ error, message }` plus the matching HTTP status, so a client keys
// on a stable string, never on prose.
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** The REST error codes this API returns. Shared meanings track PROTOCOL.md §11. */
export type ApiErrorCode =
  | "UNAUTHORIZED" // 401: bad or missing bearer token
  | "FULL_ACCOUNT_REQUIRED" // 403: a guest attempted a create action (DESIGN.md §8)
  | "NOT_PARTICIPANT" // 403: authenticated, but not a member of this game
  | "DENIED" // 403: on the game's denylist, or a wrong invite code
  | "GAME_NOT_FOUND" // 404: unknown gameId
  | "PUZZLE_NOT_FOUND" // 404: unknown puzzleId
  | "VALIDATION"; // 400: malformed or missing request body

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  UNAUTHORIZED: 401,
  FULL_ACCOUNT_REQUIRED: 403,
  NOT_PARTICIPANT: 403,
  DENIED: 403,
  GAME_NOT_FOUND: 404,
  PUZZLE_NOT_FOUND: 404,
  VALIDATION: 400,
};

/** Serialize an API error to its JSON body and HTTP status. */
export function fail(c: Context, code: ApiErrorCode, message: string) {
  return c.json({ error: code, message }, STATUS[code]);
}
