// The share-link secret (design/post-game/SHARE.md wave S2; PROTOCOL.md §12). A completed game
// mints one of these to front its public share page and OpenGraph card. The token IS the
// capability: anyone holding it can read the (spoiler-free) card, so it must be unguessable, and it
// rides in a URL, so it must be URL-safe.
//
// 256 bits from the platform CSPRNG (node:crypto), base64url-encoded: 43 characters, no padding, no
// `+`/`/`, so it interpolates into `/s/{token}` with no escaping. This is far past the 128-bit floor
// the wave sets; the code space is 2^256, so enumeration is infeasible and the per-IP rate limit on
// the public routes is a flood cap, not a brute-force gate. The API is the single writer of the
// share_tokens row this keys (INV-7); the token carries no solution content (INV-6).
import { randomBytes } from "node:crypto";

/** The byte length behind a token: 32 bytes = 256 bits, comfortably past the 128-bit floor. */
const TOKEN_BYTES = 32;

/** The share-token character grammar: base64url with no padding. A stored token that fails this is
 * shape-invalid and can be rejected before any DB probe (the same posture the invite code's CHECK
 * gives `/g/{code}`), so garbage never touches the index. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Mint a fresh, unguessable, URL-safe share token. */
export function mintShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}
