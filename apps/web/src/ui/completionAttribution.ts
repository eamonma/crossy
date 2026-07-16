// The pure core of the live completion mosaic mount. The component and the hook
// (CompletedMosaic.tsx) own React and the fetch; this file owns the arithmetic so it is
// testable under the node vitest environment (vite.config.ts pins environment: "node",
// include: src/**/*.test.ts), the same split mosaicReveal.ts already keeps.
//
// Named completionAttribution.ts, not completedMosaic.ts: CompletedMosaic.tsx sits beside it, and on
// a case-insensitive filesystem (any macOS clone) TypeScript treats two basenames that differ only
// in case as the same file (TS1149). Module basenames here must differ in more than case, the same
// rule mosaicReveal.ts pins against ContributionMosaic.tsx.
//
// Three concerns live here:
//   - lastWriterOwnerMap: derive the instant owner map from the store's last-writer `by`
//     (store.writerOf(cell)) over every cell, the seam the App.tsx comment describes. This
//     paints the bloom with zero network wait.
//   - rosterOf: the id -> { color } roster the mosaic resolves through, built from the SAME
//     StackMember list the CompletionOverlay uses (store.participants), so the mosaic and the
//     overlay never derive two different colors for one player.
//   - fetchAttributionOnce / ...WithRetry: the GET /games/{id}/analysis read, typed to userIds
//     only (INV-6), with the completion-race retry the endpoint needs (the client can see
//     `completed` over the socket a beat before the session flushes completed_at to Postgres, so
//     the endpoint 404s briefly). It rides the authedFetch seam with the same Bearer the home
//     fetchers resolve, so a stale access token gets one refresh-and-retry (INV-11). The mosaic
//     reads only `owners` from the richer bundle; momentum/moments are typed but unused here
//     (the Analysis tab consumes them next).
import type { StackMember } from "./primitives";
import type { OwnerMap, Roster } from "./mosaicReveal";
import type { Bearer } from "../net/authedFetch";
import { authedFetch } from "../net/authedFetch";
import { identityColor } from "./identityRoster";

/** A minimal read surface over the store, so this stays testable without a real GameStore. */
export interface WriterSource {
  writerOf(cell: number): string | null;
}

/**
 * The instant owner map: cell index -> last-writer id, over every cell of the board. Read-only
 * over the store's confirmed `by` (the same field the conflict flash reads), so it introduces no
 * new data path and needs no network. A cell no one has written yields null from writerOf and is
 * simply omitted, so it stays uncolored. This is the fallback that removes any wait: the bloom can
 * start the instant the game completes, before (or without) the first-correct fetch resolves.
 */
/**
 * The edge-trigger decision, extracted pure so the invariant it defends is testable under node.
 * The bloom plays ONCE, on the ongoing -> completed transition seen in this session: it plays iff
 * the surface was NOT already completed when it mounted. A revisit/reload onto an already-completed
 * game mounts with `completedAtMount === true` and so does NOT re-bloom (it lands on the settled
 * wash). The hook (CompletedMosaic.tsx) latches `completedAtMount` on the first render and calls
 * this; the rule lives here so a test can assert both edges without a renderer.
 */
export function shouldBloomOnCompletion(completedAtMount: boolean): boolean {
  return completedAtMount === false;
}

export function lastWriterOwnerMap(
  store: WriterSource,
  cellCount: number,
): OwnerMap {
  const map: Record<number, string> = {};
  for (let cell = 0; cell < cellCount; cell += 1) {
    const by = store.writerOf(cell);
    if (by !== null) map[cell] = by;
  }
  return map;
}

/**
 * The roster the owner ids resolve through, built from the exact StackMember list the
 * CompletionOverlay renders (celebrationPalette reads the same array). Keyed by userId with only
 * the color, since color is all the mosaic is load-bearing on. Every writer id the store reports
 * resolves here to that player's identity color, so the mosaic and the overlay's avatar stack agree.
 *
 * The member's raw wire color (an FNV-1a hash, apps/session color.ts) is resolved through the shared
 * identity palette (DESIGN.md §8, identityRoster.ts) to the ground-matched hex the board paints, so
 * a player reads as the same curated color here that they wear on iOS. `isDark` picks the light or
 * dark variant; the caller reads it from the theme (useTheme) and rebuilds when it flips.
 */
export function rosterOf(
  members: readonly StackMember[],
  isDark: boolean,
): Roster {
  const roster: Record<string, { color: string }> = {};
  for (const m of members)
    roster[m.userId] = { color: identityColor(m.color, isDark) };
  return roster;
}

/** One solver superlative off the wire (PROTOCOL §12 titles row): the solver, a lowercase-kebab
 * title key from the pinned ladder, and the title's own count or null. `title` is a plain string,
 * NOT the engine's TitleKey: the ladder grows server-first, so a client MUST ignore a key it has
 * never heard of (the forward-compatibility rule); the type admits the unknown and the readout
 * (titlesReadout.ts) drops it. */
export interface WireTitle {
  readonly userId: string;
  readonly title: string;
  readonly evidence: number | null;
}

/** The analysis wire payload (apps/api archive/analysis.ts AnalysisView): the whole completed
 * surface in one fetch. `owners` is the mosaic's first-correct map (cell index, a string key since
 * JSON has no numeric keys, -> the owning userId); `momentum` and `moments` are the tab's readings;
 * `sequence` is the replay's ordered fills ({cell, atSeconds}, ascending by (at, seq)); `titles`
 * is the solver superlatives (TITLES.md, ordered by ladder rank, at most one per solver and one
 * per key; empty when fewer than two solvers wrote, the solo rule). Every field carries userIds,
 * cells, keys, and numbers only, so INV-6 rides the shape, not a runtime strip. This mount is
 * load-bearing on `owners` alone; the rest is typed here so the shape is complete, and the
 * Analysis tab and the replay are what consume it. */
export interface AnalysisResponse {
  readonly owners: Record<number, string>;
  readonly momentum: { durationSeconds: number; samples: number[] };
  readonly moments: {
    firstToFall: { cell: number; userId: string; atSeconds: number } | null;
    lastSquare: { cell: number; userId: string; atSeconds: number } | null;
    turningPoint: {
      stallSeconds: number;
      breakSeconds: number;
      burst: number;
    } | null;
  };
  readonly sequence: { cell: number; atSeconds: number }[];
  readonly titles: WireTitle[];
}

/**
 * One attempt at GET /games/{id}/analysis. Returns the owner map as an `OwnerMap` (cell ->
 * userId, numeric keys parsed back from the JSON string keys) on 200; null on any non-200 (the
 * 404 the completion race produces, or an auth blip). Rides the authedFetch seam with the same
 * Bearer the home fetchers use (INV-11): a stale access token 401s once, refreshes, and replays
 * before this resolves; a signed-out bearer throws in the seam before any call, caught below.
 * Never throws for a network error either: this is a best-effort enhancement over the
 * last-writer paint, so a failure is a silent null, never an error surfaced to a player who
 * just finished a puzzle.
 */
export async function fetchAttributionOnce(
  apiBase: string,
  gameId: string,
  bearer: Bearer,
): Promise<OwnerMap | null> {
  try {
    const res = await authedFetch(
      bearer,
      `${apiBase}/games/${gameId}/analysis`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as AnalysisResponse;
    const owners = body.owners ?? {};
    const map: Record<number, string> = {};
    // JSON object keys are strings; the wire stringifies the numeric cell index, so read it back
    // with Number() to match the cell-index space the last-writer map and the grid both use.
    for (const [cell, userId] of Object.entries(owners)) {
      map[Number(cell)] = userId;
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * One attempt at GET /games/{id}/analysis, returning the WHOLE bundle (owners + momentum + moments),
 * for the Analysis tab. The mosaic's fetchAttributionOnce reads only `owners` from the same endpoint;
 * this reads the rest. The server caches the bundle per game (INV-4 frozen, ANALYSIS.md), so this
 * second fetch alongside the mosaic's is a cheap cache hit, not a recompute. Numeric owner keys are
 * parsed back from the JSON string keys (the wire stringifies the cell index), matching the cell
 * space the grid uses. Same seam as fetchAttributionOnce (authedFetch, one 401 refresh-and-retry,
 * INV-11). Null on any non-200 (the completion-race 404, an auth blip) and never throws, so a
 * player who just finished never sees an error surfaced from the tab's read.
 */
export async function fetchAnalysisOnce(
  apiBase: string,
  gameId: string,
  bearer: Bearer,
): Promise<AnalysisResponse | null> {
  try {
    const res = await authedFetch(
      bearer,
      `${apiBase}/games/${gameId}/analysis`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as AnalysisResponse;
    const owners: Record<number, string> = {};
    for (const [cell, userId] of Object.entries(body.owners ?? {})) {
      owners[Number(cell)] = userId;
    }
    return {
      owners,
      momentum: body.momentum ?? { durationSeconds: 0, samples: [] },
      moments: body.moments ?? {
        firstToFall: null,
        lastSquare: null,
        turningPoint: null,
      },
      sequence: Array.isArray(body.sequence) ? body.sequence : [],
      // Absent on an older API (the field is additive, PROTOCOL §12): read as empty, never crash,
      // so the Titles section simply does not render against a server that predates the ladder.
      titles: Array.isArray(body.titles) ? body.titles : [],
    };
  } catch {
    return null;
  }
}

/**
 * The completion-race retry knobs: the client can observe `completed` over the socket a beat before
 * the session has flushed `completed_at` to Postgres, so the endpoint may 404 for a short window
 * right after a live finish (the gate is completed-only, apps/api games/routes.ts). Retry a few
 * times over a short backoff; the first success wins, and if none succeed the caller silently keeps
 * the last-writer paint. `sleep` and `signal` are injected so a test drives the loop without real
 * timers, and the caller can abort it when the surface unmounts.
 */
export interface AttributionRetryOptions {
  /** Total attempts (default 3), spanning roughly `tries * delayMs` of wall time. */
  readonly tries?: number;
  /** Delay between attempts, ms (default ~700, so 3 tries span ~2s per the brief). */
  readonly delayMs?: number;
  /** Injected wait, so a test steps the loop without real time. Defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Aborts the loop (the surface unmounted); a set signal ends it after the current attempt. */
  readonly signal?: { readonly aborted: boolean };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Fetch the first-correct owner map, retrying across the completion race. Resolves with the owner
 * map on the first success, or null when every attempt fails (or the loop is aborted). Pure control
 * flow over the injected `fetchOnce`, so a test supplies a stub that 404s N times then succeeds and
 * asserts the loop swaps to first-correct exactly when it resolves.
 */
export async function fetchAttributionWithRetry(
  fetchOnce: () => Promise<OwnerMap | null>,
  options: AttributionRetryOptions = {},
): Promise<OwnerMap | null> {
  return fetchWithRetry(fetchOnce, options);
}

/**
 * The same completion-race retry, over any fetch-or-null, so the mosaic (owner map) and the Analysis
 * tab (the whole bundle) share one control-flow loop instead of two. Resolves with the first
 * non-null result, or null when every attempt fails or the loop is aborted.
 */
export async function fetchWithRetry<T>(
  fetchOnce: () => Promise<T | null>,
  options: AttributionRetryOptions = {},
): Promise<T | null> {
  const tries = options.tries ?? 3;
  const delayMs = options.delayMs ?? 700;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (options.signal?.aborted === true) return null;
    const result = await fetchOnce();
    if (result !== null) return result;
    // No wait after the final attempt: we are about to give up.
    if (attempt < tries - 1) await sleep(delayMs);
  }
  return null;
}

/**
 * Fetch the whole analysis bundle across the completion race, the tab's twin of
 * fetchAttributionWithRetry. Same loop, the full AnalysisResponse instead of just the owner map.
 */
export async function fetchAnalysisWithRetry(
  fetchOnce: () => Promise<AnalysisResponse | null>,
  options: AttributionRetryOptions = {},
): Promise<AnalysisResponse | null> {
  return fetchWithRetry(fetchOnce, options);
}
