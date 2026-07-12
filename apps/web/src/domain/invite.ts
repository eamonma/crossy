// Invite/share resolution (ROADMAP Phase 4: retiring the two URL-param stopgaps). The API now
// returns the game `name` and `inviteCode` on GET /games/{id}, so the share popover and the game
// title no longer depend on the current URL carrying `?code=`/`?name=`. These pure helpers keep
// the transition expand/contract on the client: the API value is preferred, and the URL query
// param is a fallback so old invite links still work. Pure (no window, no fetch) so the fallback
// logic is unit-tested like the rest of the client's domain code.

/**
 * Resolve one invite field (the game name or invite code) with the API value preferred and the
 * URL query param as the fallback. An absent or empty API value falls through to the URL param
 * (itself possibly null), so a member opening a link works whether or not the server field is
 * present.
 */
export function resolveInviteField(
  apiValue: string | null | undefined,
  urlValue: string | null,
): string | null {
  if (typeof apiValue === "string" && apiValue !== "") return apiValue;
  return urlValue;
}

/**
 * Build the shareable invite URL from the resolved code, in the path-route form the router
 * serves (`/game/<id>?code=...`); links minted before path routing (`?game=<id>&code=...`)
 * keep working through the router's one-time redirect. The invite code is the capability a
 * new visitor needs to self-join, so it stays in the link; a null code means there is nothing
 * to share yet and the popover shows its fallback message. The game name is not appended:
 * a member gets it from GET /games/{id}, and no other receiving surface reads it (the
 * signed-out gate shows no title, iOS parses only the code, the unfurl copy is static).
 * `resolveInviteField` keeps reading `?name=` so already-minted links still title old games.
 */
export function buildShareUrl(args: {
  origin: string;
  gameId: string;
  code: string | null;
}): string | null {
  const { origin, gameId, code } = args;
  if (code === null) return null;
  return `${origin}/game/${encodeURIComponent(gameId)}?code=${code}`;
}

/**
 * Build the `crossy://` deep link that hands a signed-out invitee straight into the iOS app,
 * bypassing web sign-in. Universal Links already open the app from a QR or a Messages tap, but
 * they refuse to fire for a same-domain Safari tap or from an in-app browser (Discord), which is
 * exactly where an invitee lands on the web. A custom scheme can be invoked from a button on that
 * page, so the invite gate offers it. The shape mirrors the web link (`/game/<id>?code=...`); the
 * app digests it through the same parser as a scanned QR (iOS InviteScan, the `?code=` branch),
 * which reads nothing but the code. A null code means there is no link to offer.
 */
export function buildAppLink(args: {
  gameId: string;
  code: string | null;
}): string | null {
  const { gameId, code } = args;
  if (code === null) return null;
  return `crossy://game/${encodeURIComponent(gameId)}?code=${code}`;
}
