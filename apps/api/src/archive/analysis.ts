// The Archive read model: the post-game analysis bundle, computed on read from the event log
// (DESIGN.md §7 Archive context, §9 the cell_events read expand; design/post-game/ANALYSIS.md
// "Where it lives"). This is the IO half of the projection: the pure math lives in the engine
// (`solveTrace`, `momentum`, `moments`), and this module only adapts the wire/db world into the
// engine's plain-data shapes and back.
//
// The whole correctness of the join is that the events' `cell` index space and the solution's
// cell index space are ONE space. Both come from the same stored `games.puzzle_snapshot`: the
// events were written against it while the game was live (the session hydrated its comparator
// from it, apps/session/src/hydrate.ts), and the solution is lifted from it here through the same
// `serverPuzzleToSolution` extraction the session uses. So a first-correct owner is exactly a
// writer the live game would have counted correct, with no second definition to drift.
//
// INV-6: this module reads the solution-bearing snapshot and the raw event `value`s server-side,
// but its output is the AnalysisView bundle, which carries userIds, cells, and numbers only. No
// solution value and no raw event ever reaches the returned type, so a caller structurally cannot
// serialize one (the tier-1.5 profile ANALYSIS.md pins: timing on top of attribution, never a
// letter). Layering: apps/api imports packages/engine and packages/protocol, never the reverse.
import { asc, eq } from "drizzle-orm";
import { schema } from "@crossy/db";
import { momentum, moments, solveTrace } from "@crossy/engine";
import type { SolveEvent } from "@crossy/engine";
import { serverPuzzleToSolution } from "@crossy/protocol";
import type { ServerPuzzle } from "@crossy/protocol";
import type { Db } from "../db/client";

/**
 * The post-game analysis wire payload (design/post-game/ANALYSIS.md "The wire"): the whole
 * completed surface in one fetch. `owners` is the mosaic's owner map (cell index -> owning
 * userId), the momentum ribbon is the room's tempo (a fixed-length peak-normalized curve plus
 * the solve's duration), and the moments are the three named beats. Every field carries userIds,
 * cells, and numbers only, so it is INV-6-safe by construction: there is no field that can hold a
 * solution value or a raw event, so a leak is a compile error, not a missed runtime strip. The
 * client already holds the roster (names, colors) from the game view's member data, so this never
 * duplicates identity display.
 */
export interface AnalysisView {
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
}

/**
 * The write-once analysis cache (ANALYSIS.md "Performance and caching"). A completed game is
 * frozen: the log is terminal and the input can never change (INV-4), so the computed bundle is
 * write-once, never-invalidate. This is an API-owned in-memory artifact keyed by gameId; the API
 * is the single writer of its own state (INV-7), so it adds no cross-writer coupling, no new
 * column, and no invalidation path. It is only ever reached after the endpoint's completed-only
 * gate, so it never holds an ongoing game's map.
 */
const analysisCache = new Map<string, AnalysisView>();

/**
 * Compute the analysis bundle for a game, on read. Reads the full `cell_events` stream ordered by
 * `seq` under the API's SELECT-only grant (migration 0008), projects each row to the engine's
 * `SolveEvent` (`user_id` -> `userId`, the timestamp `at` -> epoch ms), lifts the `Solution` from
 * the game's `puzzle_snapshot`, runs the three engine reducers over one trace, and shapes the
 * bundle. Returns `null` when the game does not exist (an unknown gameId).
 *
 * This is a pure READ: it never writes a table, so single-writer (INV-7) is untouched. It reads
 * the whole event log for one game, so the caller MUST keep it off the `GET /games` list path
 * (that list keeps its cheap `MAX(at)` aggregate); this is a per-game, on-demand read.
 *
 * Gating (completed-only) is the caller's, not this function's: computing the bundle for any game
 * is safe as pure math, but SERVING it for an ongoing game leaks solving progress. The endpoint
 * gates before it calls here.
 */
export async function gameAnalysis(
  db: Db,
  gameId: string,
): Promise<AnalysisView | null> {
  const cached = analysisCache.get(gameId);
  if (cached !== undefined) return cached;

  const snapshot = await db
    .select({ puzzleSnapshot: schema.games.puzzleSnapshot })
    .from(schema.games)
    .where(eq(schema.games.gameId, gameId))
    .limit(1);
  if (snapshot.length === 0) return null;

  // The events, in the actor's write order. `(game_id, seq)` is the composite primary key, so this
  // is an index range scan, not a sort. Projected to the engine's raw write shape: the persisted
  // `{ seq, cell, user_id, value, at }`, with `user_id` renamed to the engine's `userId`. `value`
  // is read here only to feed the comparator inside `solveTrace`; it never rides the return type.
  const rows = await db
    .select({
      seq: schema.cellEvents.seq,
      cell: schema.cellEvents.cell,
      userId: schema.cellEvents.userId,
      value: schema.cellEvents.value,
      at: schema.cellEvents.at,
    })
    .from(schema.cellEvents)
    .where(eq(schema.cellEvents.gameId, gameId))
    .orderBy(asc(schema.cellEvents.seq));

  // The engine's `SolveEvent.at` is epoch ms as plain data (INV-9, no clock in the engine). The
  // `at` column is `timestamp with time zone`, which drizzle hands back as a JS `Date`;
  // `new Date(row.at).getTime()` yields epoch ms whether the driver returns a Date or an ISO
  // string, so the conversion is robust to either.
  const events: SolveEvent[] = rows.map((r) => ({
    seq: r.seq,
    cell: r.cell,
    userId: r.userId,
    value: r.value,
    at: new Date(r.at).getTime(),
  }));

  // One extraction of the snapshot into the comparator's solution map, shared with the session's
  // live hydration (packages/protocol), so this join reads the exact cell index space the events
  // were written against.
  const solution = serverPuzzleToSolution(
    snapshot[0]!.puzzleSnapshot as ServerPuzzle,
  );

  // One seq-ordered replay, three readings (ANALYSIS.md "What it stands on"). The owner map falls
  // out of the trace (drop the timing), momentum buckets it, moments takes its extremes.
  const trace = solveTrace(events, solution);
  const owners = Object.fromEntries(trace.map((e) => [e.cell, e.userId]));

  const view: AnalysisView = {
    owners,
    momentum: momentum(trace),
    moments: moments(trace),
  };

  // Cache the frozen bundle (INV-4). Write-once: a completed game's input can never change, so
  // this entry is never stale and never needs invalidation (INV-7, API owns its own state).
  analysisCache.set(gameId, view);
  return view;
}
