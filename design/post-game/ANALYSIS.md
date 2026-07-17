---
status: normative
---

# Post-game analysis

Status: plan of record. Date: 2026-07-12.
Companion: `FIRST-CORRECT.md` owns the first-correct attribution projection this builds on.
This document owns the wider post-game surface: the Analysis tab, its projections, its one
wire endpoint, and its build order.

## Purpose

When a room finishes, the clue panel gains a second tab that reads the solve back. Three
projections, in one place a player returns to:

- **Mosaic**: the solved board painted by who first got each square right (FIRST-CORRECT.md).
- **Momentum**: the room's tempo over the solve, its stalls and its breaks.
- **Moments**: a few named beats, the opening, the closing, the turning point.

One law governs all of it: **moments may be judged, people are never scored against each
other.** No leaderboard, no rating, no fastest-solver. A name appears only as the incidental
author of a moment. Momentum is the room's tempo, not one player's rate against another's.

Amended 2026-07-16 (owner ruling) for solver titles, the per-person superlatives that
replace the person moment cards: titles count, they never interpret (an argmax over a
countable fact, never an inferred causal story); one title per solver, at most; a title may
cite its own evidence number, but the shared axis stays forbidden (no table or ordering
rendering two people's numbers against each other). `TITLES.md` is the plan of record.

## What it stands on: the solve trace

All three projections read one thing. The **solve trace** is, for each cell, the
first-correct event's `{ cell, userId, seq, at }`. It is exactly `firstCorrect` plus the
timestamp `firstCorrect` ignores. Drop the timing and it is the mosaic's owner map. Bucket
the timing and it is momentum. Take its extremes and it is moments. One `seq`-ordered replay
of `cell_events`, three readings, the "one reducer, many projections" note FIRST-CORRECT.md
left for later.

The trace carries user ids, cell indices, and timestamps. **No letters.** So the whole
analysis bundle is INV-6-safe by construction, the tier-1 profile FIRST-CORRECT.md defines:
no field can hold a solution value, so a leak is a compile error, not a missed runtime strip.
This is tier 1.5, timing on top of attribution. The tier-2 value replay (the letter-by-letter
time-lapse) stays a separate, later, harder-gated endpoint; nothing here carries a value.

## The projections

### Mosaic (owner map)

`firstCorrect` over the trace, unchanged (FIRST-CORRECT.md). Cell index to owning userId,
userIds only. Folded into the analysis bundle so the board and the tab are one fetch.

#### The settled record is a blurred field (owner ruling 2026-07-17)

The reveal arc's peak (the crisp, letterless FIELD) and the share plate are unchanged. What
changed is where the arc lands: the settled on-screen record is no longer a crisp per-cell
tint. The owner tints render at full saturation into a color layer that is gaussian-blurred
and composited under the crisp ink letters and clue numbers, so contribution reads as
territory flowing behind the grid, not a checkerboard.

Tokens, ratified from the wash-blur-study prototype and shared cross-platform as
cell-relative values (iOS and Android adopt the same numbers in parallel):

- **Blur radius**: stdDeviation = 20/36 of the cell module (`MOSAIC_BLUR_RADIUS_RATIO`,
  exactly 20 at the web's 36-unit cell).
- **Settled weight**: the blurred layer composites at 0.5 (`SETTLED_WASH_ALPHA`).
- **Replay unchanged**: the time-gated replay keeps the crisp per-cell tint at
  `WASH_ALPHA` 0.3, and small static "wash" thumbnails stay crisp. The blur is the
  full-size settled record only.

Construction rules:

- **Blocks above the blur.** Block cells are redrawn crisp on top of the blurred layer, so
  the color flows behind the block grid instead of smearing over it.
- **Edge saturation.** Tint rects on board-edge cells extend outward past the frame by at
  least 1.5x the blur radius before blurring, and the blurred layer clips to the board
  rect, so the field stays saturated at the frame instead of fading to ground.

The settle beat is a melt: INK to FIELD is untouched, timings included. At the settle the
crisp field cells fade to 0 per cell on the existing settle diagonal (`SETTLE_SPREAD_MS`),
letters fade back per cell as before, and the blurred layer fades in from 0 to 0.5 over
900ms on cubic-bezier(0.22, 0.61, 0.36, 1) with a 120ms delay. prefers-reduced-motion
crosses straight to the settled blurred frame, no sweep.

Isolation stays crisp: a blurred single hue has no shape to read, so isolating a solver
from the legend hides the blurred layer and returns the crisp per-cell tints, the isolated
owner at 0.5 and everyone else at 0.5 x `ISOLATION_DIM` (0.2) = 0.1, with a ~250ms ease-out
crossfade both ways. Clearing isolation returns the blurred field. The isolation contract
(`isolationAlpha`, `nextIsolation`, `ISOLATION_DIM`) is unchanged.

### Momentum (the room's tempo)

The solve's rhythm across its own duration: where it stalled, where it broke open. A
**fixed-length array of normalized intensity samples**, server-computed, so web and iOS
render the identical curve. Fixed granularity is a deliberate v1 choice: the ribbon is a
smoothed shape, not an interactive series, so the server ships the shape and both surfaces
draw it. If richer client-side interaction is wanted later, the raw trace can be exposed
then; it is not needed now.

### Moments (the beats)

Three, all derived from **timing alone**, no geometry:

- **firstToFall**: the opening. The first-correct event with the earliest `at`.
- **lastSquare**: the closing. The first-correct event with the latest `at`, the square that
  completed the board, and who placed it.
- **turningPoint**: the stall and the break. The longest pause between consecutive
  first-correct fills, and the burst that followed it.

The fourth moment, **the unlock** (the fill that structurally opened the grid), was planned
as a fast-follow and is now **killed** (owner ruling 2026-07-16). It is a causal claim: B was
stuck, A's letter freed them. The log records gaps and adjacency, never "stuck" or "freed",
so any detector narrates coincidences with confidence, and one false card poisons trust in
the surface. The general form of the ruling is the titles law (`TITLES.md`): count, don't
interpret. The energy it was meant to carry lands as titles instead.

## Pinned semantics (vectors freeze these)

The projections are frozen by conformance vectors before the engine exists, so their exact
shape is fixed here. Times are **relative seconds from the solve's start**: `t0 = min(at)`
over the first-correct events, and every reported time is `at - t0`. The engine takes the
timestamps as data and subtracts (INV-9, no clock in the engine).

Let the trace be the first-correct events, ordered by `(at, seq)`, and `N = 40` the sample
count, `BURST_WINDOW = 30s`.

- **momentum.samples** (`number[]`, length `N`): bucket each trace entry by
  `idx = tEnd > t0 ? floor((at - t0) / (tEnd - t0) * (N - 1)) : 0`, where `tEnd = max(at)`.
  `count[i]` is the number of entries in bucket `i`; `samples[i] = count[i] / max(count)`,
  normalized to the peak bucket (all-zero when there are no fills). A single-instant solve
  (`tEnd == t0`) puts every fill in bucket 0.
- **momentum.durationSeconds**: `tEnd - t0` (0 for an empty or single-instant solve).
- **firstToFall / lastSquare** (`{ cell, userId, atSeconds } | null`): the trace entries with
  the minimum and maximum `at` (ties broken by min and max `seq`). Both `null` when the trace
  is empty.
- **turningPoint** (`{ stallSeconds, breakSeconds, burst } | null`): over consecutive trace
  entries, `stallSeconds` is the largest gap `at[i+1] - at[i]` (ties to the earliest, min
  `seq`); `breakSeconds` is the relative `at` of the entry that ended it; `burst` is the
  count of trace entries with `at` in `[breakAt, breakAt + BURST_WINDOW]`. `null` when the
  trace has fewer than two entries (no gap to measure).

`N` and `BURST_WINDOW` are named engine constants so a vector cites them, not a magic number.

## Where it lives (mirror first-correct)

Pure engine reducers over the trace, IO in the `apps/api` Archive module, the bundle on the
wire. Same split, same discipline as `firstCorrect`.

**Engine** (`packages/engine`, imports nothing, INV-9; deterministic across TS and Swift,
INV-1; vectors-first):

```
solveTrace(events, solution) -> trace         // firstCorrect plus at; owner map falls out of it
momentum(trace)              -> { durationSeconds, samples }
moments(trace)               -> { firstToFall, lastSquare, turningPoint }
```

`solveTrace` needs `at` added to the engine's `WriteEvent` (today `{ seq, cell, userId,
value }`). `firstCorrect` stays as-is for now; it is `solveTrace` collapsed to owners, and can
be re-expressed on top of it later. The reducer output types carry userIds, cells, and
numbers only, so INV-6 rides the type.

**API** (`apps/api` Archive module, the read-model home, DESIGN section 7): reads
`cell_events` ordered by `seq` (now also selecting the `at` column the owner-map read
ignores), lifts the `Solution` from `games.puzzle_snapshot` via `serverPuzzleToSolution`
(the same extraction the session and the attribution read use, so one cell index space), runs
the reducers, gates, and shapes the bundle. Layering points inward only.

## The wire

```
GET /games/:id/analysis        completed-only + participants-only
->
{
  "owners":   { "<cell>": "<userId>" },
  "momentum": { "durationSeconds": number, "samples": number[] },
  "moments":  {
    "firstToFall":  { "cell": number, "userId": string, "atSeconds": number } | null,
    "lastSquare":   { "cell": number, "userId": string, "atSeconds": number } | null,
    "turningPoint": { "stallSeconds": number, "breakSeconds": number, "burst": number } | null
  }
}
```

**This replaces `GET /games/:id/attribution`.** A breaking replace is acceptable: the
attribution endpoint is unshipped (the interim mount that consumes it is not released), so
there is no expand/contract obligation. `/analysis` lands, the board mosaic migrates to read
`owners` from it, and `/attribution` and its `AttributionView` are removed in the same
change. One fetch then serves the whole completed surface, the board's mosaic and the tab's
readings together.

The response stays tier 1.5: userIds, cells, and times, never a letter.

## Gating and safety

Identical to attribution's gate, for the same reasons.

- **Completed only**, via `game_state.completed_at`; anything else (ongoing, abandoned,
  never-connected) is a 404. The trace for an ongoing game leaks progress (a heat map of what
  the room has finished), so it ships only for a game that is done.
- **Participants only**; a non-member is `NOT_PARTICIPANT`.
- A completed game is frozen (INV-4): the log is terminal, the input can never change, so the
  bundle can never change. The gate and the immutability are the same fact.

## Performance and caching

Compute is one O(events) `seq`-ordered pass (the walk `firstCorrect` already does) plus two
cheap linear reductions (one bucketing, one min/max/gap scan). Microseconds to low
milliseconds per game. The DB read is the `(game_id, seq)` index range scan, now also
selecting `at`. It MUST stay off the `GET /games` list path, which keeps its cheap `MAX(at)`
aggregate (PROTOCOL section 12); this is a per-game, on-demand read.

Where attribution deferred caching as premature, `/analysis` earns it: it runs three reducers
over the stream, and the result is write-once, never-invalidate (INV-4). Cache the bundle on
first read, keyed by `game_id`, as an API-owned in-memory artifact. The API is the single
writer of its own state (INV-7), so this adds no cross-writer coupling, no new column, and no
invalidation path.

## Build sequence

- **PR1** this doc.
- **PR2** `vectors/analysis/` for `solveTrace`, `momentum`, `moments` (data only, ahead of the
  engine, the house rule that the spec is the failing test). A top-level family off the `v1/`
  runner, like `vectors/first-correct/`.
- **PR3** the engine reducers (`solveTrace`, `momentum`, `moments`; `at` on `WriteEvent`),
  greened against PR2.
- **PR4** the `/analysis` endpoint: the Archive module reads `cell_events` including `at`, runs
  the reducers, gates to completed participants, shapes the bundle; replaces `/attribution`;
  PROTOCOL section 12 updated. The interim mount's fetch migrates to `/analysis`.
- **PR5** the web Analysis tab: the clue panel becomes a two-tab panel (Clues, Analysis), the
  board paints into the mosaic under Analysis, momentum and moments render from `/analysis`.
  The transition from clue rail to tabbed panel is the thing to get smooth; the Clues tab does
  not change.
- **Fast-follow** ~~the unlock moment~~ killed 2026-07-16; solver titles supersede it
  (`TITLES.md`, its own build sequence).
