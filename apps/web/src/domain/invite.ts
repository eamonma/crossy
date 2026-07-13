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
 * The dedicated host for short invite links (PROTOCOL.md §12 "Invite links"). Hardcoded, like the
 * iOS client's equivalent (ShareInvite), so the two emit byte-identical links. It points at the
 * invite host, which resolves the code and hands a browser to the game (a 302) or an unfurler an
 * OpenGraph card, and which iOS claims as a universal link.
 */
const INVITE_ORIGIN = "https://crossy.ing";

/**
 * Build the shareable invite link: the short `https://crossy.ing/<code>` form (PROTOCOL.md §12).
 * It carries only the invite code, the capability a new visitor needs to self-join; no gameId and no
 * name (the receiver resolves those after arriving). A null code means there is nothing to share yet
 * and the popover shows its fallback message. The copy row, the QR, and the system share sheet all
 * encode this one value, byte-identical to the iOS client's ShareInvite. This changes only what the
 * client EMITS: incoming links still arrive as `/game/<id>?code=...` (the invite host redirects to
 * that), which the router and `resolveInviteField` handle unchanged, so old links keep working.
 */
export function buildShareUrl(args: { code: string | null }): string | null {
  const { code } = args;
  if (code === null) return null;
  return `${INVITE_ORIGIN}/${code}`;
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
