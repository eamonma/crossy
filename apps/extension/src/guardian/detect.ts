// Guardian puzzle-page detection. The manifest already scopes the content script to
// theguardian.com/crosswords/*, but that pattern also matches series pages and the
// crosswords front; this predicate narrows to an actual puzzle page, which is always
// /crosswords/{type}/{number} (confirmed against live pages, 2026-07-11).

const PUZZLE_PATH = /^\/crosswords\/[a-z][a-z-]*\/\d+$/;

/** True when `url` is a Guardian crossword puzzle page. */
export function isGuardianCrosswordPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (host !== "www.theguardian.com" && host !== "theguardian.com") {
    return false;
  }
  return PUZZLE_PATH.test(parsed.pathname);
}
