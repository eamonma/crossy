// AmuseLabs (PuzzleMe) crossword-frame detection. PuzzleMe renders in an iframe served
// from amuselabs.com CDN origins (cdn.amuselabs.com, cdn2/3/4...), on a /crossword path
// (canonically /pmm/crossword, or a customer-prefixed /{customer}/crossword). The
// manifest registers the content script for those origins with all_frames:true, so this
// predicate confirms the frame is an actual crossword renderer, not a picker or error
// page (confirmed against a public embed, cdn3.amuselabs.com/pmm/crossword, 2026-07-11).

/** True when `url` is an AmuseLabs PuzzleMe crossword frame. */
export function isAmuseLabsCrosswordFrame(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (host !== "amuselabs.com" && !host.endsWith(".amuselabs.com")) {
    return false;
  }
  return parsed.pathname.endsWith("/crossword");
}
