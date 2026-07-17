// The shared post-game mosaic mount, used by BOTH LiveApp's completed branch and DemoApp's twin,
// so the `?demo=1` flow is a faithful, screenshottable preview of the live behavior. In the
// completed state this renders the ContributionMosaic AS the board treatment, in place of the
// interactive grid (the mosaic renders the solved board itself). The bloom is a treatment of the
// same solved board, painted by attribution.
//
// Two things this file owns that the pure core (completionAttribution.ts) cannot:
//   - useAttributionOwnerMap: the owner-map source. It paints instantly from LAST-WRITER
//     (store.writerOf), then, live only, fetches GET /games/{id}/analysis (reading its owner map)
//     first-correct map when it resolves (a re-render; the board is already the mosaic, colors just
//     correct to the true attribution). It handles the completion race by retrying a few times.
//   - the edge-trigger: the bloom plays ONCE, on the ongoing -> completed transition observed in
//     THIS session. A reload/revisit into an already-completed game lands on the settled record
//     (the blurred field) with no re-bloom. prefers-reduced-motion jumps straight to the settled
//     frame (the ContributionMosaic reveal already honors it; the static path skips motion too).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Puzzle } from "../domain/types";
import { ContributionMosaic } from "./ContributionMosaic";
import type { StackMember } from "./primitives";
import type { OwnerMap, Roster } from "./mosaicReveal";
import {
  type AttributionSwap,
  createAttributionSwap,
  fetchAttributionOnce,
  fetchAttributionWithRetry,
  lastWriterOwnerMap,
  rosterOf,
  shouldBloomOnCompletion,
  type WriterSource,
} from "./completionAttribution";
import type { Bearer } from "../net/authedFetch";
import { useTheme } from "./useTheme";

/** The live attribution source, present only in LiveApp (the demo has no backend). The bearer is
 * the REST Bearer the room already holds (LiveGame's useBearer), riding the authedFetch seam so a
 * stale token gets one refresh-and-retry (INV-11). */
export interface AttributionSource {
  readonly apiBase: string;
  readonly gameId: string;
  readonly bearer: Bearer;
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
 *
 * The swap is PHASED with the reveal arc (shouldApplyAttribution): a map that resolves mid-bloom
 * or at the held peak is held aside and applied at the settle beat, where the correction rides
 * the settle repaint instead of popping cells at full saturation. `revealing` says a reveal arc
 * runs on this mount; `settled` says its settle beat has fired (the caller reads it off onBeat).
 * A non-reveal mount (revisit, replay) leaves `revealing` false and applies on arrival, as today.
 */
export function useAttributionOwnerMap({
  store,
  cellCount,
  source,
  revealing = false,
  settled = false,
}: {
  store: WriterSource;
  cellCount: number;
  // `| undefined` explicit under exactOptionalPropertyTypes: a caller may pass `source={undefined}`
  // (the demo threads it through), which the bare optional would reject.
  source?: AttributionSource | undefined;
  revealing?: boolean;
  settled?: boolean;
}): OwnerMap {
  // The instant paint. Computed once for this completed mount; the board's letters and writers are
  // frozen at completion (INV-4 terminal), so there is nothing to recompute per render.
  const [ownerMap, setOwnerMap] = useState<OwnerMap>(() =>
    lastWriterOwnerMap(store, cellCount),
  );

  // The phasing lives in a per-mount controller (pure control flow, completionAttribution.ts) so
  // the resolve-vs-phase race is testable under node. setState is stable across the mount.
  const swapRef = useRef<AttributionSwap | null>(null);
  if (swapRef.current === null) {
    swapRef.current = createAttributionSwap(setOwnerMap, revealing, settled);
  }
  useEffect(() => {
    // Applies a held map the moment holding ends (the settle beat); otherwise a no-op.
    swapRef.current?.setPhase(revealing, settled);
  }, [revealing, settled]);

  // Destructured so the fetch effect keys on the three primitives alone, never the `source`
  // object: LiveApp builds `source` inline, so an object dep would abort and restart the retry
  // loop on every unrelated re-render (and re-hit the endpoint). The primitives cover
  // correctness: the loop survives re-renders and still re-runs when the game or bearer changes.
  const apiBase = source?.apiBase;
  const gameId = source?.gameId;
  const bearer = source?.bearer;
  useEffect(() => {
    if (apiBase === undefined || gameId === undefined || bearer === undefined) {
      return; // the demo: last-writer only, no endpoint call.
    }
    const signal = { aborted: false };
    void fetchAttributionWithRetry(
      () => fetchAttributionOnce(apiBase, gameId, bearer),
      { signal },
    ).then((firstCorrect) => {
      // Swap to first-correct only on success and only while still mounted. On a 404-forever race
      // or any failure this stays null, and the last-writer paint stands, silently (never an error
      // to a player who just finished). Empty-but-present maps are legitimate and still swap.
      // The controller applies now or holds for the settle, per the arc's phase.
      if (!signal.aborted && firstCorrect !== null) {
        swapRef.current?.resolve(firstCorrect);
      }
    });
    return () => {
      signal.aborted = true;
    };
    // Keyed on the game and its api/bearer primitives, not the store: the map is recomputed
    // instantly on mount from writerOf via useState's initializer, and the fetch re-runs if the
    // game changes.
  }, [apiBase, gameId, bearer]);

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
 * `roster`. `bloom` runs the reveal arc once (INK -> FIELD -> the settled blurred record);
 * otherwise it renders the settled record straight, for a revisit or under reduced motion.
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
  replayTime,
  sequence,
  isolatedId,
  onBeat,
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
  /** The solve-replay playhead (relative seconds), or null when not replaying. When non-null the
   * board is the time-gated reveal; when null it is the bloom-or-wash logic, unchanged. */
  replayTime?: number | null | undefined;
  /** The solve order the replay gates on: cell index -> its solve time. INV-6: cells and times only,
   * never a letter (the letters come from the `letters` prop). */
  sequence?: readonly { cell: number; atSeconds: number }[] | undefined;
  /** The legend's isolated solver, or null for the full wash. A fill-opacity multiplier inside the
   * mosaic, so it composes with the bloom, the wash, and the replay without re-arming anything. */
  isolatedId?: string | null | undefined;
  /** The reveal arc's beat, forwarded from the mosaic (0 solved, 1 bloom, 2 settled). The caller
   * uses beat 2 to phase the attribution swap and to gate the word loupe; it rides plain React
   * state and never feeds the reveal effect's trigger (the #204 discipline). */
  onBeat?: ((beat: 0 | 1 | 2) => void) | undefined;
  ariaLabel?: string | undefined;
}) {
  // cell index -> its solve time, memoized on the sequence so a per-frame replayTime change never
  // rebuilds it. On a duplicate cell the earliest time wins (the sequence is ascending, so the first
  // entry for a cell is its first-correct fill).
  const revealedAt = useMemo(() => {
    const m = new Map<number, number>();
    for (const { cell, atSeconds } of sequence ?? []) {
      if (!m.has(cell)) m.set(cell, atSeconds);
    }
    return m;
  }, [sequence]);

  // Replaying takes precedence and NEVER re-fires the bloom: entering or leaving replay is a switch
  // between the time-gated reveal and the settled record, not a re-bloom. Otherwise the board is the
  // live completion bloom or a Replay-nonce re-bloom, exactly as before.
  const play = bloom || (replayKey ?? 0) > 0;
  const behavior =
    replayTime !== null && replayTime !== undefined
      ? ({ kind: "replay", revealedAt, timeSeconds: replayTime } as const)
      : play
        ? ({ kind: "reveal", replayKey: replayKey ?? 0 } as const)
        : ({ kind: "static", state: "settled" } as const);
  return (
    <ContributionMosaic
      puzzle={puzzle}
      letters={letters}
      ownerMap={ownerMap}
      roster={roster}
      behavior={behavior}
      isolatedId={isolatedId}
      onBeat={onBeat}
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
  replayTime,
  sequence,
  isolatedId,
  source,
  onSettledChange,
  ariaLabel,
}: {
  store: WriterSource;
  puzzle: Puzzle;
  letters: ReadonlyMap<number, string>;
  members: readonly StackMember[];
  /** True to play the reveal once (the live completion edge); false for the settled record. */
  bloom: boolean;
  /** A Replay nonce from the parent; a change re-blooms the board (the Analysis tab's Replay). */
  replayKey?: number | undefined;
  /** The solve-replay playhead (relative seconds), or null when not replaying (the full record). */
  replayTime?: number | null | undefined;
  /** The solve order the replay gates on ({cell, atSeconds}); INV-6: cells and times only. */
  sequence?: readonly { cell: number; atSeconds: number }[] | undefined;
  /** The legend's isolated solver (Analysis panel), or null for the full wash. */
  isolatedId?: string | null | undefined;
  source?: AttributionSource | undefined;
  /** Reports whether the board rests on the settled record (true on a non-bloom mount; false
   * while a reveal arc is in flight, true again at its settle beat). The caller gates the word
   * loupe on it (showsWordLoupe, the iOS/Android parity: the loupe belongs only to the settled
   * completed board). Plain React state, so it can never re-arm the reveal. */
  onSettledChange?: ((settled: boolean) => void) | undefined;
  ariaLabel?: string | undefined;
}) {
  const cellCount = puzzle.cols * puzzle.rows;
  // The arc's phase, read off the mosaic's beat callback: `revealing` says this mount runs a
  // reveal arc (the live edge, or a Replay-nonce re-bloom); `settleBeat` says the arc's settle
  // beat has fired. Beat 0 re-arms the gate when a Replay nonce restarts the arc. Together they
  // phase the attribution swap (below) and the caller's loupe gate. On a non-reveal mount the
  // arc never runs, so `settled` is simply true.
  const revealing = bloom || (replayKey ?? 0) > 0;
  const [settleBeat, setSettleBeat] = useState(false);
  const onBeat = useCallback((beat: 0 | 1 | 2) => {
    setSettleBeat(beat === 2);
  }, []);
  const settled = !revealing || settleBeat;
  useEffect(() => {
    onSettledChange?.(settled);
  }, [settled, onSettledChange]);

  const ownerMap = useAttributionOwnerMap({
    store,
    cellCount,
    source,
    revealing,
    settled,
  });
  // Memoized on members (and the ground) so a store-version bump (which rebuilds the members array)
  // does not hand the mosaic a fresh roster identity every render, which would rebuild its `cells`
  // memo needlessly. `isDark` picks the identity palette's ground variant so the board matches iOS.
  const isDark = useTheme().theme === "dark";
  const roster = useMemo(() => rosterOf(members, isDark), [members, isDark]);
  return (
    <CompletedMosaicBoard
      puzzle={puzzle}
      letters={letters}
      ownerMap={ownerMap}
      roster={roster}
      bloom={bloom}
      replayKey={replayKey}
      replayTime={replayTime}
      sequence={sequence}
      isolatedId={isolatedId}
      onBeat={onBeat}
      ariaLabel={ariaLabel}
    />
  );
}
