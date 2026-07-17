---
status: normative
---

# Post-game replay (the solve, in time order)

Status: plan of record. Date: 2026-07-13.
Companion: `ANALYSIS.md` owns the Analysis tab this extends; `FIRST-CORRECT.md` owns the
attribution the mosaic paints by. This document owns **replay**: the solve scrubbed back as a
time-lapse of the board, driven from the momentum ribbon.

## Purpose

The Analysis tab already shows the solve three ways: the mosaic (who solved each square), the
momentum ribbon (the room's tempo), the moments (a few named beats). All three are still
pictures. Replay adds the fourth reading, **when**, and makes it playable.

The momentum ribbon is already a relative-time axis. Replay turns it into a transport: a
playhead you drag, and the board fills in solve order to match. Drag over a momentum peak and
squares flurry in; drag across the shaded stall and the board sits still. The graph explains
the board and the board explains the graph, on one shared clock. That coupling is the whole
feature.

## The idea: one clock, two views

Today the ribbon and the board sit side by side and do not talk. Replay couples them through a
single time value `T`. The ribbon draws a playhead at `T`; the board shows every square whose
solve time is `<= T` filled, the rest blank. Move `T` and both move together. Nothing else in
the tab changes.

## Product decisions (locked 2026-07-13)

The forks, with the ruling and the reason, so the iOS surface inherits the direction, not just
the shape.

- **Playback is compressed real time, not one-cell-per-tick.** The playhead sweeps `[0,
duration]` at constant speed, compressed to a short window (target ~8s). A square pops the
  instant the playhead passes its solve time. So a 90-second stall becomes a visible beat of
  dead air and a six-square burst becomes a flurry. Revealing one square per frame regardless
  of the real gaps would throw away exactly the pacing the feature exists to show. This is what
  makes it a **replay** and not a second bloom.
- **Fixed length plus manual scrub. No speed control.** One honest default (the ~8s sweep);
  drag the playhead for everything else. A speed selector is chrome the scrub already covers.
- **Owner tint throughout.** A revealed square wears its owner's color the moment it appears,
  not neutral ink that resolves to color at the end. Replay is the mosaic revealed in time
  order; it unifies _who_ and _when_ in one pass.
- **On-demand, never auto-play.** The completion bloom already fired once, on the finish edge.
  Opening or returning to the tab does not re-animate. Replay plays only when asked.
- **Resting state is the full settled mosaic.** Replay ends back on the full board. The
  finish-edge bloom (INK to FIELD to WASH) is untouched and stays reserved for the arrival
  moment; replay is a separate, calmer mode of the same board.
- **Unsolved squares render blank, not ghosted.** No faint preview of the letter to come. The
  tension of watching it fill is the point, and blank is still INV-6-safe (the letters are
  local, see below).
- **Per-square reveal is a quick calm fade** as the playhead passes, not the full bloom arc.

## Surfaces (web)

Replay needs the board and the ribbon visible at once, because scrubbing one drives the other.

- **Desktop rail** (board left, analysis right) and **ultra dock** (board top, analysis
  bottom) both keep them co-visible. Replay lives here.
- **Mobile browser is explicitly not a first-class surface for this.** The phone analysis panel
  is a 75dvh bottom sheet that covers the board, so a playhead there would drive a board you
  cannot see. v1 does not offer replay in the phone web sheet. A floating transport over a
  full-bleed board is a possible fast-follow, not planned. This is a **web** scoping call; see
  the cross-platform note below.

## What it stands on: the sequence

Replay reads one new thing. The solve trace (`ANALYSIS.md`) already carries each cell's
first-correct `at`. Replay needs exactly that, per cell, relative:

```
sequence: { cell: number, atSeconds: number }[]     // ascending by (at, seq)
```

- `atSeconds` is relative seconds from the solve start, `at - t0` with `t0 = min(at)`, the same
  clock momentum and moments already use. The engine subtracts; it never reads a clock (INV-9).
- **No userId.** The owner comes from `owners` in the same bundle, so color during replay is a
  lookup, not a repeated field.
- **The array order is authoritative.** Sorted by `(at, seq)`, so a client can gate by time and,
  if it wants, stagger a same-instant cluster by array position.
- Consistency is free: `sequence`, `owners`, `momentum`, `moments` are all projections of one
  `solveTrace` over one `t0`, so they cannot disagree about which cells fell when.
- **INV-6: cells and times only, no letters.** Tier 1.5, the same profile as the rest of the
  bundle; a leak would be a compile error, not a missed strip.

### Not tier 2: the client already holds the letters

`ANALYSIS.md` reserved a "value replay (the letter-by-letter time-lapse)" as a separate,
harder-gated, tier-2 endpoint that would ship letters. It refines to this: **it will not ship
letters.** A completed game's board is fully present on a participant's client already, the
same `fills` the mosaic draws from, on the live finish and on a later revisit alike. Replay
supplies each square's letter from those local fills and asks the wire only for _when_. So the
time-lapse is tier 1.5, not tier 2, and no solution value ever leaves the server for it. The
tier-2 gate `ANALYSIS.md` anticipated is not needed for this feature.

## The wire

Additive to `/analysis`, not a breaking change. The bundle gains one field:

```
GET /games/:id/analysis          completed-only + participants-only
->
{
  "owners":   { ... },
  "momentum": { ... },
  "moments":  { ... },
  "sequence": [ { "cell": number, "atSeconds": number }, ... ]   // ascending by (at, seq)
}
```

Same gate (completed participant), same write-once, never-invalidate cache keyed by `game_id`
(INV-4). `sequence` is another projection of the trace the module already computes, so it adds
no DB read, no compute of note, and no new cache key. PROTOCOL section 12 gains the field.

## Where it lives (mirror the analysis split)

- **Engine**: a thin projection of `solveTrace` to `{ cell, atSeconds }` ascending, named and
  vector-covered so it is greppable and frozen before it is drawn. No new input; `at` is already
  on `WriteEvent` from the analysis work. Output type carries cells and numbers only, so INV-6
  rides the type.
- **API** (`apps/api` Archive module): the analysis read shapes the field into the bundle from
  the trace it already walks.
- **Web**:
  - A single `replayTime | null` lifted to `LiveGame`. The ribbon (in `AnalysisPanel`) and the
    board (in `board-stage`) are different subtrees, so the shared clock lives at their common
    parent and feeds both. `null` means "not replaying," and the board rests on the full mosaic.
  - The momentum ribbon gains a draggable playhead and a play/pause control. Time-to-x reuses
    the ribbon's existing `sampleIndexToX` / `timeToSampleIndex` mapping, so the playhead is a
    lookup, not a re-derivation.
  - The mosaic gains a "reveal up to time `T`" input. It already sets per-rect and per-text
    opacity through refs for the bloom; replay reuses that path, gating each cell on
    `sequence`. Unsolved cells blank, revealed cells owner-tinted with a calm fade.
- **Vectors-first**: `vectors/analysis/sequence.json` and the PROTOCOL note land before the
  endpoint field, the house rule that the spec is the failing test.

## The two seams (so iOS can add replay without a rewrite)

Mobile _browser_ is not first-class, but iOS is a first-class native surface, and touch
scrubbing of a timeline is more native than a mouse drag. The wire is shared, so iOS gets
`sequence` for free the moment it ships. Two seams keep a later iOS build additive rather than a
redesign:

1. The board reveal is driven by a single settable "reveal up to time `T`," never a fixed final
   render.
2. The ribbon exposes its time-to-x mapping, so a playhead is a lookup on either client.

Note the scope: "mobile browser is not first-class" is a **web** decision. iOS owns its own call
on whether phone replay is first-class there. Being native, it very likely is, and this doc is
the reference for the interaction model and the decisions above when it does.

## The one law (unchanged)

Moments may be judged, people are never scored against each other. Replay shows who solved what,
and when, and never ranks or rates a player against another. It stays a keepsake of the solve,
not a stopwatch on the room.

## Build sequence

- **PR1** this doc.
- **PR2** `vectors/analysis/sequence.json`: the `{ cell, atSeconds }` projection frozen ahead of
  the engine.
- **PR3** the engine projection plus the `/analysis` field, greened against PR2; PROTOCOL
  section 12 updated. Small, since the trace already exists.
- **PR4** the web replay: the lifted `replayTime`, the ribbon playhead and transport, the
  time-gated mosaic reveal. Rail and dock only.
- **Deferred**: the phone web floating transport; syncing the moment cards and the momentum
  marker to light up as the playhead crosses them; loop playback.
