// The Archive read model: the post-game analysis bundle, computed on read from the event log
// (DESIGN.md §7 Archive context, §9 the cell_events read expand; design/post-game/ANALYSIS.md
// "Where it lives"). This is the IO half of the projection: the pure math lives in the engine
// (`solveTrace`, `momentum`, `moments`, `titleStats`, `awardTitles`), and this module only adapts
// the wire/db world into the engine's plain-data shapes and back.
//
// The whole correctness of the join is that the events' `cell` index space and the solution's
// cell index space are ONE space. Both come from the same stored `games.puzzle_snapshot`: the
// events were written against it while the game was live (the session hydrated its comparator
// from it, apps/session/src/hydrate.ts), and the solution is lifted from it here through the same
// `serverPuzzleToSolution` extraction the session uses. So a first-correct owner is exactly a
// writer the live game would have counted correct, with no second definition to drift.
//
// INV-6: this module reads the solution-bearing snapshot and the raw event `value`s server-side,
// but its output is the AnalysisView bundle, which carries userIds, cells, title keys, and
// numbers only. No solution value and no raw event ever reaches the returned type, so a caller
// structurally cannot
// serialize one (the tier-1.5 profile ANALYSIS.md pins: timing on top of attribution, never a
// letter). Layering: apps/api imports packages/engine and packages/protocol, never the reverse.
import { asc, eq } from "drizzle-orm";
import { schema } from "@crossy/db";
import {
  awardTitles,
  collapseIdle,
  momentum,
  moments,
  sittings,
  solveSequence,
  solveTrace,
  titleStats,
} from "@crossy/engine";
import type { SolveEvent, TitleAward, TitleSlot } from "@crossy/engine";
import { serverPuzzleToSolution } from "@crossy/protocol";
import type { ServerPuzzle } from "@crossy/protocol";
import type { Db } from "../db/client";

/**
 * The starred-clue mark: a literal `*` opening the clue text, leading whitespace tolerated. This
 * is the D26 predicate, byte-identical to the web revealer highlight's `STARRED_MARK` in
 * `apps/web/src/ui/clueRefs.ts` (apps never import each other, so the two-line regex is stated
 * twice rather than promoted; TITLES.md pins them to the same predicate so the marquee tier and
 * the board tint can never disagree on what is starred). Ingestion carries the constructor's `*`
 * through verbatim (PROTOCOL.md section 12 law 11), so plain `text` is the whole story.
 */
const STARRED_MARK = /^\s*\*/;

/**
 * The post-game analysis wire payload (design/post-game/ANALYSIS.md "The wire"): the whole
 * completed surface in one fetch. `owners` is the mosaic's owner map (cell index -> owning
 * userId), the momentum ribbon is the room's tempo (a fixed-length peak-normalized curve plus
 * the solve's duration), the moments are the three named beats, and `sequence` is the solve
 * replay's foundation (the ordered {cell, atSeconds}, ascending by (at, seq), each cell and the
 * relative second it first went correct; cells and times only, no userId), and `titles` is the
 * solver superlatives (design/post-game/TITLES.md; PROTOCOL.md section 12): ordered by ladder
 * rank, at most one per solver and one per key, empty when fewer than two solvers wrote (the
 * engine's solo rule), each entry a userId, a lowercase-kebab title key, and its evidence count
 * or null.
 *
 * All trace-projection times are ACTIVE seconds (DESIGN.md D29, design/post-game/SITTINGS.md):
 * the trace is built from the idle-collapsed log (`solveTrace(collapseIdle(events), solution)`),
 * so `momentum`, `moments`, and `sequence` measure concatenated active time on one shared axis;
 * a game with no 30-minute gap is the identity mapping, byte-identical to the pre-D29 bundle.
 * `sittings` describes the partition itself ({count, spans, wallSeconds}, spans contiguous on
 * the same active axis, for the ribbon's seam ticks; `wallSeconds` the wall-clock trace span,
 * flavor only). `titles` alone keep their wall-clock basis for now (D29 defers their re-base).
 *
 * Every field carries userIds, cells, keys, and numbers only, so it is INV-6-safe by
 * construction: there is no field that can hold a solution value or a raw event, so a leak is a
 * compile error, not a missed runtime strip. The client already holds the roster (names, colors)
 * from the game view's member data, so this never duplicates identity display.
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
  readonly sequence: { cell: number; atSeconds: number }[];
  readonly titles: TitleAward[];
  readonly sittings: {
    count: number;
    spans: { startSeconds: number; endSeconds: number }[];
    wallSeconds: number;
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
  const puzzle = snapshot[0]!.puzzleSnapshot as ServerPuzzle;
  const solution = serverPuzzleToSolution(puzzle);

  // The slot list as data for the titles reducers (TITLES.md "Where it lives"): the union of the
  // snapshot's across and down clues, each slot its ordered `cellIndices` plus the D26 starred
  // flag from the clue's own text. There is no other slot model anywhere and none enters the
  // engine; geometry rides beside it as plain `{rows, cols}` (INV-9, data not ambient).
  const slots: TitleSlot[] = [...puzzle.clues.across, ...puzzle.clues.down].map(
    (clue) => ({
      cells: clue.cellIndices,
      starred: STARRED_MARK.test(clue.text),
    }),
  );

  // One seq-ordered replay, three readings (ANALYSIS.md "What it stands on"), on the ACTIVE
  // axis (D29): `collapseIdle` moves every gap of SITTING_GAP_MS or more to zero before the
  // trace is built, so momentum buckets active time, moments' stall is within-sitting by
  // construction, and the sequence's atSeconds are compact. The owner map falls out of the
  // trace (drop the timing), and remapping never changes a cell or a userId, so owners are
  // byte-identical to the wall-clock reading.
  const trace = solveTrace(collapseIdle(events), solution);
  const owners = Object.fromEntries(trace.map((e) => [e.cell, e.userId]));

  // The titles, entirely the engine's (TITLES.md): titleStats counts, awardTitles walks the
  // ladder, and the solo rule (fewer than two writers -> []) lives inside awardTitles, never
  // here. This module only lifted the inputs; it reimplements no counting. The awards carry
  // userIds, title keys, and evidence numbers only (INV-6 by the TitleAward type).
  // DELIBERATELY the RAW events, not the collapsed ones: titles keep their wall-clock basis
  // this wave (D29 defers the ice-breaker re-base and marathoner to a named fast-follow).
  const titles = awardTitles(
    titleStats(events, solution, slots, {
      rows: puzzle.rows,
      cols: puzzle.cols,
    }),
  );

  const view: AnalysisView = {
    owners,
    momentum: momentum(trace),
    moments: moments(trace),
    sequence: solveSequence(trace),
    titles,
    // The partition itself (D29): computed from the RAW events (it does its own collapse and
    // anchors spans to the trace internally), one extra linear walk, no new DB read.
    sittings: sittings(events, solution),
  };

  // Cache the frozen bundle (INV-4). Write-once: a completed game's input can never change, so
  // this entry is never stale and never needs invalidation (INV-7, API owns its own state).
  analysisCache.set(gameId, view);
  return view;
}
