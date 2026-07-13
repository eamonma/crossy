// The Analysis tab's data hook: fetch GET /games/{id}/analysis once for the completed game and
// return the full bundle (owners + momentum + moments) with a small loading/absent state. The
// mosaic's mount (CompletedMosaic.tsx) already fetches the same endpoint for its owner map; because
// the server caches the bundle per game (INV-4 frozen, ANALYSIS.md "write-once, never-invalidate"),
// this second fetch is a cheap cache hit, so a separate hook stays low-risk rather than threading the
// mosaic's fetch through the whole tree. It reuses the same completion-race retry the mosaic uses
// (fetchAnalysisWithRetry), so a 404 in the beat after a live finish still resolves once the session
// flushes completed_at.
//
// The 404 for a never-completed game (the gate is completed-only) resolves to `status: "absent"`, so
// the tab renders a quiet empty state rather than an error. A failure is silent, never surfaced to a
// player who just finished.
import { useEffect, useState } from "react";
import {
  fetchAnalysisOnce,
  fetchAnalysisWithRetry,
  type AnalysisResponse,
  type BearerSource,
} from "./completionAttribution";

/** Where the tab is in its one fetch: still loading, the bundle in hand, or absent (a 404 / failure,
 * so the tab shows a quiet empty state). */
export type AnalysisState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly bundle: AnalysisResponse }
  | { readonly status: "absent" };

/** The live source for the fetch: the api base, the game, and the bearer resolver, the same three the
 * mosaic's AttributionSource carries. Omitted (the demo) short-circuits to a fixed bundle if one is
 * supplied, or stays absent. */
export interface AnalysisSource {
  readonly apiBase: string;
  readonly gameId: string;
  readonly getToken: BearerSource;
}

/**
 * Fetch the analysis bundle for a completed game. `enabled` gates the fetch so it runs only once the
 * game is completed (an ongoing game has no analysis, and its trace would leak progress, ANALYSIS.md
 * gating): while disabled the hook stays "loading" and never calls the endpoint. Re-keys on the game
 * so a new room refetches. Aborts on unmount so a late resolve never sets state on a dead component.
 */
export function useGameAnalysis({
  source,
  enabled,
}: {
  source?: AnalysisSource | undefined;
  enabled: boolean;
}): AnalysisState {
  const [state, setState] = useState<AnalysisState>({ status: "loading" });

  useEffect(() => {
    if (!enabled || source === undefined) {
      setState({ status: "loading" });
      return;
    }
    const signal = { aborted: false };
    setState({ status: "loading" });
    void fetchAnalysisWithRetry(
      () => fetchAnalysisOnce(source.apiBase, source.gameId, source.getToken),
      { signal },
    ).then((bundle) => {
      if (signal.aborted) return;
      setState(
        bundle === null ? { status: "absent" } : { status: "ready", bundle },
      );
    });
    return () => {
      signal.aborted = true;
    };
  }, [enabled, source, source?.apiBase, source?.gameId, source?.getToken]);

  return state;
}
