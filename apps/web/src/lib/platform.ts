// Platform detection for surfaces that only make sense on one OS. Kept pure (userAgent and
// maxTouchPoints arrive as arguments, never read off `navigator` here) so the branch is unit
// tested rather than guessed at. The one caller today is the invite gate, which offers a
// `crossy://` app handoff only where the iOS app can exist (domain/invite buildAppLink).

/**
 * True on iPhone, iPad, or iPod. iPadOS 13+ defaults to a desktop user agent that says
 * "Macintosh", so a Mac-looking agent with a touch screen (maxTouchPoints > 1) is an iPad, not a
 * trackpad Mac (which reports 0). This is the standard, and only reliable, way to tell them apart
 * from the client.
 */
export function isAppleMobile(
  userAgent: string,
  maxTouchPoints: number,
): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}
