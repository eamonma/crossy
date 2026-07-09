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
 * Build the shareable invite URL from the resolved fields. The invite code is the capability a
 * new visitor needs to self-join, so it stays in the link; a null code means there is nothing to
 * share yet and the popover shows its fallback message. The optional name rides along so an
 * old-style link keeps rendering a title before the recipient becomes a member.
 */
export function buildShareUrl(args: {
  origin: string;
  pathname: string;
  gameId: string;
  code: string | null;
  name: string | null;
}): string | null {
  const { origin, pathname, gameId, code, name } = args;
  if (code === null) return null;
  const base = `${origin}${pathname}?game=${gameId}&code=${code}`;
  return name === null ? base : `${base}&name=${encodeURIComponent(name)}`;
}
