// The play intent's mechanics (D22: the extension ingests, the web app plays). After an ingest
// the extension opens `/puzzles?play=<puzzleId>`; the puzzles panel consumes that intent once,
// preselects the named puzzle for room creation, and strips the param so a refresh does not
// re-fire it. Everything here is pure: resolution reads the library that is already fetched and
// never calls the server, so landing on the URL can never mint a game. The one POST /games stays
// behind the panel's explicit New game click.
import type { PuzzleSummary } from "./homeData";
import type { Resource } from "./useResource";

/**
 * What the panel shows for a pending intent. `none` is the plain library (no intent). `pending`
 * defers to the panel's own loading/error frame while the library read is in flight. `found`
 * preselects the puzzle. `unknown` is an id this account does not have (foreign, deleted, or a
 * stale link): a calm inline message, never a blank screen.
 */
export type PlayIntentResolution =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "found"; puzzle: PuzzleSummary }
  | { kind: "unknown" };

/** Resolve the intent against the library read. Pure: no fetch, no navigation, no creation. */
export function resolvePlayIntent(
  intent: string | null,
  puzzles: Resource<PuzzleSummary[]>,
): PlayIntentResolution {
  if (intent === null) return { kind: "none" };
  if (puzzles.phase !== "ready") return { kind: "pending" };
  const puzzle = puzzles.data.find((p) => p.puzzleId === intent);
  return puzzle !== undefined ? { kind: "found", puzzle } : { kind: "unknown" };
}

/**
 * The search string with the consumed `play` param removed (every other param kept), or null
 * when there is nothing to strip. The panel replaceStates the result once on mount, so the
 * intent lives in component state from then on and a refresh or a shared address does not
 * reopen the flow. Null on a clean URL keeps the consumption idempotent (StrictMode double
 * effects, plain library visits).
 */
export function strippedPlaySearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("play") === null) return null;
  params.delete("play");
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}
