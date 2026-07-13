// The shared post-game mosaic mount, used by BOTH LiveApp's completed branch and DemoApp's twin,
// so the `?demo=1` flow is a faithful, screenshottable preview of the live behavior. In the
// completed state this renders the ContributionMosaic AS the board treatment, in place of the
// interactive grid (the mosaic renders the solved board itself); the CompletionOverlay layers on
// top exactly as before. The bloom is a treatment of the same solved board, painted by attribution.
//
// Two things this file owns that the pure core (completionAttribution.ts) cannot:
//   - useAttributionOwnerMap: the owner-map source. It paints instantly from LAST-WRITER
//     (store.writerOf), then, live only, fetches GET /games/{id}/analysis (reading its owner map)
//     first-correct map when it resolves (a re-render; the board is already the mosaic, colors just
//     correct to the true attribution). It handles the completion race by retrying a few times.
//   - the edge-trigger: the bloom plays ONCE, on the ongoing -> completed transition observed in
//     THIS session. A reload/revisit into an already-completed game lands on the settled WASH with
//     no re-bloom. prefers-reduced-motion jumps straight to the wash (the ContributionMosaic reveal
//     already honors it; the static wash path also skips motion entirely).
import { useEffect, useRef, useState } from "react";
import type { Puzzle } from "../domain/types";
import { ContributionMosaic } from "./ContributionMosaic";
import type { StackMember } from "./primitives";
import type { OwnerMap, Roster } from "./mosaicReveal";
import {
  fetchAttributionOnce,
  fetchAttributionWithRetry,
  lastWriterOwnerMap,
  rosterOf,
  shouldBloomOnCompletion,
  type BearerSource,
  type WriterSource,
} from "./completionAttribution";

/** The live attribution source, present only in LiveApp (the demo has no backend). */
export interface AttributionSource {
  readonly apiBase: string;
  readonly gameId: string;
  readonly getToken: BearerSource;
}

/**
 * The owner map for the completed board, and whether it is still the instant last-writer paint or
 * has been corrected to first-correct. Both callers derive the map through here so the two flows
 * cannot drift.
 *
 * Instant: the last-writer map is computed synchronously from store.writerOf over every cell, so
 * the bloom starts with zero network wait (the seam App.tsx's comment describes). Live only: an
 * attribution fetch runs on mount and, when it resolves, swaps the map to first-correct; the board
 * is already the mosaic, so this is just a re-render that corrects the colors. `source` omitted (the
 * demo) skips the fetch and keeps last-writer, exactly as the brief requires.
 */
export function useAttributionOwnerMap({
  store,
  cellCount,
  source,
}: {
  store: WriterSource;
  cellCount: number;
  // `| undefined` explicit under exactOptionalPropertyTypes: a caller may pass `source={undefined}`
  // (the demo threads it through), which the bare optional would reject.
  source?: AttributionSource | undefined;
}): OwnerMap {
  // The instant paint. Computed once for this completed mount; the board's letters and writers are
  // frozen at completion (INV-4 terminal), so there is nothing to recompute per render.
  const [ownerMap, setOwnerMap] = useState<OwnerMap>(() =>
    lastWriterOwnerMap(store, cellCount),
  );

  useEffect(() => {
    if (source === undefined) return; // the demo: last-writer only, no endpoint call.
    const signal = { aborted: false };
    void fetchAttributionWithRetry(
      () =>
        fetchAttributionOnce(source.apiBase, source.gameId, source.getToken),
      { signal },
    ).then((firstCorrect) => {
      // Swap to first-correct only on success and only while still mounted. On a 404-forever race
      // or any failure this stays null, and the last-writer paint stands, silently (never an error
      // to a player who just finished). Empty-but-present maps are legitimate and still swap.
      if (!signal.aborted && firstCorrect !== null) setOwnerMap(firstCorrect);
    });
    return () => {
      signal.aborted = true;
    };
    // Keyed on the game and its api/token source, not the store: the map is recomputed instantly on
    // mount from writerOf via useState's initializer, and the fetch re-runs if the game changes.
  }, [source?.apiBase, source?.gameId, source?.getToken, source]);

  return ownerMap;
}

/**
 * Was this completion reached via the ongoing -> completed edge in THIS session, or was the game
 * already completed when the surface mounted (a reload/revisit)? The bloom plays only on the edge;
 * a revisit lands on the settled wash. The hook MUST live on the PARENT that persists across the
 * transition (LiveGame/DemoApp), not on the mosaic itself, which mounts only once completed: an
 * edge that fires inside a component born already-completed cannot be seen.
 *
 * `completedAtMount` latches on the first render (React runs the body before effects), so it holds
 * the status the surface first saw. Bloom iff the surface was NOT already completed at mount: then
 * reaching completed is a live edge. This never re-arms within a session, so a reload onto a
 * completed game (parent mounts already-completed) lands on the settled wash with no re-bloom.
 */
export function useCompletionBloomEdge(completed: boolean): boolean {
  const completedAtMountRef = useRef<boolean | null>(null);
  if (completedAtMountRef.current === null) {
    completedAtMountRef.current = completed;
  }
  return shouldBloomOnCompletion(completedAtMountRef.current);
}

/**
 * The board treatment for the completed state: the ContributionMosaic over the solved board, its
 * geometry and letters from board state (never a solution, INV-6), painted by `ownerMap` through
 * `roster`. `bloom` runs the reveal arc once (INK -> FIELD -> WASH); otherwise it renders the
 * settled wash straight, for a revisit or under reduced motion.
 *
 * This is a drop-in for the interactive board's slot: same square footprint, so the completed
 * screen swaps the grid for the mosaic without a layout jump, and the overlay keeps sitting on top.
 */
export function CompletedMosaicBoard({
  puzzle,
  letters,
  ownerMap,
  roster,
  bloom,
  replayKey,
  ariaLabel,
}: {
  puzzle: Puzzle;
  letters: ReadonlyMap<number, string>;
  ownerMap: OwnerMap;
  roster: Roster;
  /** True to play the reveal once (the live completion edge); false to render the settled wash. */
  bloom: boolean;
  /** A Replay nonce: a change re-arms the reveal arc even on a revisit that would otherwise settle
   * straight to the wash. 0 (or absent) means no replay has been requested yet. */
  replayKey?: number | undefined;
  ariaLabel?: string | undefined;
}) {
  // Play the reveal on the live completion edge OR whenever Replay has been asked for (replayKey > 0),
  // so the Replay control re-blooms the settled wash a revisit landed on. replayKey re-arms the arc
  // (ContributionMosaic keys its effect on it), so each Replay tap plays the sweep again.
  const play = bloom || (replayKey ?? 0) > 0;
  return (
    <ContributionMosaic
      puzzle={puzzle}
      letters={letters}
      ownerMap={ownerMap}
      roster={roster}
      behavior={
        play
          ? { kind: "reveal", replayKey: replayKey ?? 0 }
          : { kind: "static", state: "wash" }
      }
      ariaLabel={
        ariaLabel ?? "The solved board, painted by who solved each square"
      }
    />
  );
}

/**
 * The whole completed-state board treatment, wired for a caller that has a store, the solved
 * puzzle, its letters, and the room's members. Derives the roster from the same StackMember list
 * the CompletionOverlay uses (so colors agree) and sources the owner map (last-writer now, first-
 * correct when the fetch lands). LiveApp passes `source`; the demo omits it.
 *
 * `bloom` is decided by the PARENT via useCompletionBloomEdge and passed in, because this component
 * mounts only once completed and so cannot observe the transition itself. The parent keeps that
 * one bit stable across the completed mount, so the reveal plays exactly once on a live finish and
 * a revisit renders the settled wash.
 */
export function CompletedMosaic({
  store,
  puzzle,
  letters,
  members,
  bloom,
  replayKey,
  source,
  ariaLabel,
}: {
  store: WriterSource;
  puzzle: Puzzle;
  letters: ReadonlyMap<number, string>;
  members: readonly StackMember[];
  /** True to play the reveal once (the live completion edge); false for the settled wash. */
  bloom: boolean;
  /** A Replay nonce from the parent; a change re-blooms the board (the Analysis tab's Replay). */
  replayKey?: number | undefined;
  source?: AttributionSource | undefined;
  ariaLabel?: string | undefined;
}) {
  const cellCount = puzzle.cols * puzzle.rows;
  const ownerMap = useAttributionOwnerMap({ store, cellCount, source });
  const roster = rosterOf(members);
  return (
    <CompletedMosaicBoard
      puzzle={puzzle}
      letters={letters}
      ownerMap={ownerMap}
      roster={roster}
      bloom={bloom}
      replayKey={replayKey}
      ariaLabel={ariaLabel}
    />
  );
}
