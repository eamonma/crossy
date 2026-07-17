// The public share link mint (design/post-game/SHARE.md wave S2; PROTOCOL.md §12). A completed game
// mints (or returns) an unguessable token whose URL fronts the OpenGraph share page and card. This
// is a thin REST call over the same authedFetch seam every other web mutation rides: the server is
// the single writer of the token, and the response carries only the shareable URL and the token, no
// solution content (INV-6). Idempotent server-side, so a re-tap of "Copy share link" returns the
// same URL rather than minting a second live link.
import type { Bearer } from "./authedFetch";
import { authedFetch } from "./authedFetch";

/** Mint (or return) the game's public share link and resolve to the URL to copy. Throws on any
 * non-2xx (a non-member's NOT_PARTICIPANT, an ongoing game's GAME_NOT_FOUND) so the copy button
 * stays un-confirmed rather than copying nothing. */
export async function mintShareLink(
  apiBase: string,
  bearer: Bearer,
  gameId: string,
): Promise<string> {
  const res = await authedFetch(bearer, `${apiBase}/games/${gameId}/share`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`POST /games/${gameId}/share ${res.status}`);
  const body = (await res.json()) as { shareUrl: string; token: string };
  return body.shareUrl;
}
