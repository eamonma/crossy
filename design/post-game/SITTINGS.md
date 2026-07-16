# Sittings (active time over the event log)

Status: plan of record. Date: 2026-07-16 (owner rulings same day, all final).
Companion: `ANALYSIS.md` owns the analysis bundle this re-bases; `REPLAY.md` owns the
replay that sweeps its axis; `TITLES.md` owns the titles this wave deliberately does not
touch. This document owns **sittings**: the retroactive sessionization of a game's event
log, the active-time re-base of the whole post-game surface, the wire amendment, and the
stats amendment. DESIGN.md D29 is the registry entry.

## Purpose

Three lies, one cause. A room solves a Sunday over two evenings and the completion card
says "Time: 26:41:07", a number nobody experienced; the wall clock measured the night,
not the solve. The momentum ribbon and the replay stretch the same night across their
axis, so a two-evening solve renders as two thin spikes at the ends of a dead band, and
an n-evening solve is n blots on a flatline. And the turning point dutifully reports the
overnight gap as the room's longest stall, which makes the ice breaker "whoever opened
the app the next morning" (the known wrinkle TITLES.md accepted).

The cause is one modeling gap: the log records when the room was present, but every
reading measures wall clock as if presence were continuous. There is no pause and there
will be none (DESIGN.md section 2; a pause command is state, ceremony, and a lie the
moment someone forgets it). Presence is instead **derived, retroactively, from data**:
the log already knows when the room sat down and when it stood up.

## The definition

A **sitting** is a maximal run of the game's cell events in which consecutive events are
less than `SITTING_GAP_MS` apart.

- `SITTING_GAP_MS = 1_800_000` (30 minutes), a frozen engine constant with the same
  status as `BURST_WINDOW_MS`: named, cited by vectors, never inlined.
- **Activity is any cell event**: a write, a wrong write, a clear. A solver struggling is
  still present, so the partition runs over the **full seq-ordered event log**, never
  over the first-correct trace (a solver typing wrong answers for twenty minutes must
  not read as absent). The vectors pin the case where a lone wrong write bridges what
  the trace alone would call a gap.
- Gaps are measured between consecutive events in **seq order**: `gap = at[i+1] - at[i]`.
  A gap of **exactly** `SITTING_GAP_MS` is a boundary (`>=` threshold splits; the vectors
  pin the exact-threshold and one-millisecond-under edges). A negative gap (clock skew
  across writers puts a later-seq event at an earlier `at`) is below the threshold, so
  skew never splits a sitting.
- Cell events only. A `checkPuzzle` lives in `check_events` and is not activity here;
  the full-grid gate makes a check mid-idle a non-case in practice, and the analysis
  pipeline reads one log, not two.
- An empty log has zero sittings; any non-empty log has at least one.

No pause command, no new game state, no schema change beyond two additive stats fields.
A sitting is a pure projection: computable for every game ever played, including every
game already completed.

## Active time

The whole analysis bundle re-bases from wall clock to **concatenated active time**: idle
gaps collapse to exactly zero, and the sittings butt against each other on one axis.

Formally, walk the events in seq order and let a **collapsed gap** be any
`at[i+1] - at[i] >= SITTING_GAP_MS`. Each event's active timestamp is its wall timestamp
minus every collapsed gap before it:

```
activeAt[i] = at[i] - sum(collapsed gaps at indices < i)
```

Two properties fall out, both load-bearing:

- **The seam.** A collapsed gap is subtracted **in full**, so the last event of sitting
  `k` and the first event of sitting `k+1` land on the same active instant. Sitting
  `k+1` starts exactly where sitting `k` ends; the axis has no holes and no overlaps.
- **The identity.** A game with no gap of `SITTING_GAP_MS` or more collapses nothing:
  `activeAt == at` for every event, the mapping is the identity, and every downstream
  number is byte-identical to today's. This is the stated compat proof: **every
  pre-sittings analysis vector case is single-sitting, so the re-base leaves all of them
  byte-identical**, and a single-sitting game (the overwhelmingly common case) renders
  exactly as it always has, on every surface.

Worked example. Fills at wall 0:00, 0:05, then the room sleeps eight hours, then fills
at 8:05 and 8:06:

| event | wall `at` (ms) | gap before | collapsed? | `activeAt` (ms) |
| ----- | -------------- | ---------- | ---------- | --------------- |
| e1    | 0              |            |            | 0               |
| e2    | 300,000        | 300,000    | no         | 300,000         |
| e3    | 29,100,000     | 28,800,000 | yes        | 300,000         |
| e4    | 29,160,000     | 60,000     | no         | 360,000         |

Two sittings; e2 and e3 share the active instant 300s (the seam); the solve's active
duration is 360s (six minutes of presence), while the wall span stays 29,160s for flavor.

## What re-bases and what does not

**The bundle re-bases.** The analysis pipeline (ANALYSIS.md) becomes: collapse first,
then trace, then the unchanged reducers.

```
active = collapseIdle(events)                      // at moved onto the active axis
trace  = solveTrace(active, solution)              // first-correct, unchanged semantics
owners, momentum, moments, sequence over trace     // reducers untouched
```

So `momentum.durationSeconds` is total active seconds and the ribbon's axis is active
time; every `sequence[].atSeconds` is active seconds, so the replay sweep spends its ~8s
on presence, not on the night; and `moments.turningPoint`'s stall scan runs on active
times, where every cross-sitting gap is exactly zero, which by construction makes the
stall **within-sitting**. The overnight gap can never again be the turning point.

**Field names and wire shapes do not change.** This is a semantic re-base pinned by
vectors, not a wire break: clients render whatever arrives and the bundle is
self-consistent (spans, ribbon, sequence, and moments all share one axis). `wallSeconds`
(below) carries the old wall number for flavor.

**Titles are untouched this wave** (owner ruling: defer). `titleStats` and `awardTitles`
keep their current wall-clock basis exactly as shipped: `span`, `burst`, `brokeStall`,
and `room.stallSeconds` still read wall-clock inputs, and the ice-breaker keeps its odd
overnight copy for now. Do not "helpfully" rebase them; the revisit is a named
fast-follow (Deferred, below). The one cross-effect that already exists stays as
TITLES.md pinned it: `openingFills`/`closingFills` are ordinal, so sittings change
nothing there.

**Rounding keeps both house idioms.** Bundle numbers keep the reducers' exact-division
idiom: `(ms) / 1000`, unrounded (the engine subtracts and divides, it does not round;
`sequence.json` pins 27.5). The identity properties force this: a single sitting's span
must equal `[0, durationSeconds]` and `wallSeconds` must equal `durationSeconds`
byte-for-byte, and `durationSeconds` is unrounded. The two stats fields keep the stats
idiom instead: whole seconds via the same `Math.round` that `solveTimeSeconds` uses.

## The wire

One additive field on the analysis bundle (PROTOCOL.md section 12,
`GET /games/:id/analysis`), numbers only, INV-6-trivially-safe:

```
"sittings": {
  "count": 2,
  "spans": [
    { "startSeconds": 0, "endSeconds": 300 },
    { "startSeconds": 300, "endSeconds": 360 }
  ],
  "wallSeconds": 29160
}
```

- `count`: the number of sittings in the partition (0 only for an empty log, which a
  completed game never has).
- `spans`: one per sitting, **on the active axis**, the same axis as
  `momentum.durationSeconds` and `sequence[].atSeconds`, so a client places ribbon seam
  ticks by lookup. Contiguous by construction: `spans[k+1].startSeconds ==
spans[k].endSeconds`, `spans[0].startSeconds == 0`,
  `spans[count-1].endSeconds == momentum.durationSeconds`. A single-sitting game is one
  span `[0, durationSeconds]`.
- `wallSeconds`: the wall-clock trace span, `(max at - min at) / 1000` over the
  **unremapped** trace: exactly the number `momentum.durationSeconds` reported before
  the re-base, kept for flavor copy ("over two days"). Single-sitting games:
  `wallSeconds == durationSeconds`.
- Span placement, precisely: the boundary between sittings `j` and `j+1` sits at the
  seam's active instant, expressed in seconds relative to the trace's `t0` and clamped
  to `[0, durationSeconds]` (non-decreasing across boundaries). The clamp covers the
  corner where a sitting holds no trace entry (a wrong-writes-only first sitting): its
  span degenerates to a zero-width span at the axis edge, the count stays honest, and a
  zero-width seam tick draws nothing. The vectors pin this corner.
- Clients MUST tolerate the field's absence (an older cached bundle) and degrade to
  today's rendering. Because the bundle is computed on read from `cell_events` (INV-4,
  write-once cache), every completed game ever played gains `sittings` and the active
  re-base retroactively the moment the API ships; only `game_state.stats` rows are
  frozen history.

## The stats

`game_state.stats` gains two additive fields, computed by the session actor at
completion beside the existing ones (PROTOCOL.md sections 4 and 6):

- `activeSolveSeconds`: `solveTimeSeconds` with idle collapsed. Same endpoints
  (`firstFillAt` to `completedAt`), same `Math.round`, minus the total collapsed-gap
  milliseconds of the game's cell-event log, clamped at 0.
- `sittingCount`: the partition's sitting count, the same `SITTING_GAP_MS` and `>=`
  boundary rule as everywhere else.

`solveTimeSeconds` keeps its wall-clock semantics unchanged, forever: this is
expand/contract (DESIGN.md section 9), historic rows are frozen JSON and are never
rewritten, and clients MUST tolerate the new fields' absence, falling back to
`solveTimeSeconds`. The session may import the engine reducer to compute both (apps
import packages; the engine stays pure, timestamps as data, INV-9); like
`participantCount`, the inputs are read inside the terminal flush transaction, since the
actor's memory does not survive passivation.

## Presentation (owner ruling 2)

- **Active time is THE headline Time stat on every surface.** The completion card, the
  analysis tab, the facts sheet: wherever a solve time renders, it is the active one.
- **The sitting count is context, never a second stat**: "24:13 · 2 sittings". Rendered
  only when the count is 2 or more; a single-sitting game reads exactly as today, no
  suffix.
- **Wall clock survives only as flavor copy** ("over two days", from `wallSeconds`),
  never as a competing number beside the headline.
- A historic completed game whose frozen stats lack `activeSolveSeconds` falls back to
  `solveTimeSeconds`; where the analysis bundle is in hand, a client MAY prefer the
  bundle's active numbers (same projection, computed retroactively).

## Where it lives (mirror the analysis split)

**Engine** (`packages/engine`, imports nothing, INV-9; vectors-first):

```
SITTING_GAP_MS = 1_800_000                     // frozen, beside BURST_WINDOW_MS
collapseIdle(events) -> SolveEvent[]           // same events, at moved onto the active axis
sittings(events, solution) -> { count, spans, wallSeconds }   // the wire projection
```

`collapseIdle` is the one new moving part; the four shipped reducers are not edited, they
are fed the remapped events (`solveTrace(collapseIdle(events), solution)`). `sittings`
takes the solution because its spans and `wallSeconds` are trace-anchored (the ribbon's
axis is the trace's); it computes the partition, the remap, and both traces internally.
Every output is counts and seconds, so INV-6 rides the type.

**API** (`apps/api` Archive module): the analysis read inserts `collapseIdle` ahead of
the trace and appends `sittings` to the bundle. Same gate (completed participants), same
write-once cache keyed by `game_id` (INV-4); one extra linear walk, no new DB read.

**Session** (`apps/session`): the terminal flush computes `activeSolveSeconds` and
`sittingCount` from the flushed event log and freezes them into `stats`, exactly as
`participantCount` is computed today.

**Clients** (web, iOS): headline swap per the presentation rules; seam ticks on the
momentum ribbon from `spans`; flavor copy from `wallSeconds`. No new fetch.

## Deferred, explicitly

- **The titles revisit** (named fast-follow, owner ruling): re-base the ice breaker's
  stall onto within-sitting active time so it stops crowning the morning's first
  arrival, and add `marathoner` (present in every sitting), which needs this partition
  to exist. Both are TITLES.md ladder edits plus vectors, nothing here.
- **Per-sitting storytelling** (flavor like "the Tuesday sitting", per-sitting stats,
  a sittings list UI): the wire carries spans and a count; anything narrative waits for
  a product pull.
- **Abandoned-game recaps** stay deferred as before (ANALYSIS.md gate unchanged); when
  they land they inherit sittings for free, since the projection is gate-independent.
- **Tuning `SITTING_GAP_MS`**: 30 minutes is ratified and frozen. Re-tuning it is a
  vector diff plus a D-registry amendment, not a runtime knob.

## Build sequence (ROADMAP Phase 11)

- **Wave 11.1 (this PR)** the contract: this doc, DESIGN.md D29 and the section 2
  sentence, the PROTOCOL amendments, `vectors/analysis/sittings.json`, the composed
  multi-sitting cases in the three trace-projection vector files, the README.
- **Wave 11.2** the engine: `SITTING_GAP_MS`, `collapseIdle`, `sittings`, greened
  against the vectors; existing vector cases stay byte-identical.
- **Wave 11.3** the server: the API re-bases the bundle pipeline and appends `sittings`;
  the session freezes `activeSolveSeconds` and `sittingCount` at completion.
- **Wave 11.4** web: headline active time, the "· n sittings" context, ribbon seam
  ticks, wall flavor copy.
- **Wave 11.5** iOS: the same, matching web.
