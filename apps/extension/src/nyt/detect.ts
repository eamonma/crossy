// NYT crossword-page detection and puzzle-source location.
//
// Where the v6 puzzle JSON lives (probed 2026-07-11 against the free mini,
// www.nytimes.com/crosswords/game/mini, served HTML only): it is NOT in the served
// page or any page-state wrapper. The served HTML carries only a small config global
// (window.gameData = {filename, stream, assetBasePath}); no cells, clues, or grid are
// embedded. The crossword bundle fetches the puzzle at runtime from the same-origin
// endpoint /svc/crosswords/v6/puzzle/{filename}.json, where {filename} is the stream
// (mini, daily, ...) from the page URL. So the document PROTOCOL section 12 pins for
// the `nyt` format is the response of that endpoint, the bare v6 object {body:[...], ...}
// (the page's own response handler destructures `body`/`assets` straight off it, with
// no transport wrapper), fetched with the tab's own session (D21: the user exercises
// the NYT access they already hold).
//
// DAILY UNVERIFIED: only the free mini was probed. The daily sits behind a
// subscription, so its endpoint response could not be confirmed here; the mechanism
// (same endpoint pattern, filename from the URL) is coded identically for it.

/** True when `url` is an NYT crossword game page (mini, daily, ...). */
export function isNytCrosswordGamePage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "www.nytimes.com") return false;
  return /^\/crosswords\/game\/[a-z]/.test(parsed.pathname);
}

const V6_PUZZLE_PREFIX = "/svc/crosswords/v6/puzzle/";

/**
 * The same-origin path of the v6 puzzle JSON for a game page, or null when the URL is
 * not a plain /crosswords/game/{stream} page (archive/date subpaths are out of scope:
 * the by-stream endpoint does not address a specific dated puzzle).
 */
export function nytPuzzleEndpoint(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = /^\/crosswords\/game\/([a-z][a-z0-9-]*)\/?$/.exec(
    parsed.pathname,
  );
  if (match === null) return null;
  return `${V6_PUZZLE_PREFIX}${match[1]}.json`;
}
