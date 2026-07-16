# Solver titles

Status: plan of record. Date: 2026-07-16 (amended same day after adversarial review;
owner rulings inline).
Companion: `ANALYSIS.md` owns the post-game surface this extends; `FIRST-CORRECT.md` owns
the attribution projection everything stands on. This document owns the titles: the
per-solver superlatives that replace the person moment cards, their projection system, the
v1 ladder, and the build order.

## Purpose

When a room finishes, every solver gets one title: the saboteur, the ice breaker, the
workhorse. The grammar is the end-of-match superlative (CS2 titles, Mario Party awards):
playful, singular, and personal. It replaces the person moment cards (First square, Last
square), which named people without saying anything memorable about them. Clue-layer and
room-layer moments (the stubborn word, the floodgate) are a separate, later concern; after
this lands, moments describe the puzzle and the room, titles describe the people.

## The law, amended (owner ruling 2026-07-16)

The original law stands: **no leaderboard, no rating, no shared axis where people are
listed against each other.** Three amendments extend it for titles:

1. **Titles count, they don't interpret.** A title is an argmax over something literally
   countable in the event log: fills, overwrites, timing, geometry. It is never an
   inferred causal story. "Overwrote 7 correct squares" is a fact; "unlocked the corner
   for you" is a guess wearing a fact's clothes. This clause is why the unlock moment is
   dead (below).
2. **One title per solver, at most.** A title is an identity, not a stat listing. Two
   titles reopen the ranking door, because three cards visibly beat one.
3. **A title may cite its own evidence number.** "The saboteur, 7 overwrites" is allowed.
   What remains forbidden is the shared axis: no table, no ordering, no two people's
   numbers rendered against each other.

## The unlock is dead

The planned fourth moment (the fill that structurally opened the grid) is killed, not
deferred. An assist is a story: B was stuck, A's letter freed them. The log records gaps
and adjacency, never "stuck" or "freed", so any detector narrates coincidences with
confidence, and one false card poisons trust in the whole surface. Amendment 1 is the
general form of this ruling. `ANALYSIS.md` carries the matching edit.

## The system: a stat sheet and a ladder

Two engine layers, both pure, both vector-pinned.

**Layer 1, the stat sheet.** One pass over the events, the trace, and the slot geometry
produces a per-solver row of counts, plus a small room header (below). No judgment, only
numbers. Every current and future title shops here, so a new title is a ladder edit,
never a new walk.

**Layer 2, the award ladder.** A fixed, ordered list of titles. Each rung declares three
things, and nothing else, so every future title debate is a data edit:

- **Gate**: the minimum signal below which the rung never awards. This is the whole
  always/sometimes distinction: it is per-rung data, not two kinds of title. A gate
  exists so no title awards on noise ("the sprinter, 2 squares" is worse than no card).
- **Claim**: argmax (or argmin, stated per rung) of one stat-sheet column among the
  not-yet-titled solvers who pass the gate.
- **Evidence**: which stat-sheet number rides the card, or none.

Award walks the ladder top to bottom. Each rung awards at most once; each solver receives
at most one title; a rung whose argmax winner is already titled falls to the next eligible
solver, which maximizes coverage.

The ladder has two tiers, and the split is what makes "everyone gets a superlative" a
theorem instead of a hope:

- **Specialty tier** (gated): the memorable rungs. A gate is the minimum signal below
  which the rung never awards, so no specialty title lands on noise. A gated rung may
  award nobody; that is the gate working. A specialty rung's copy may claim a room-wide
  fact because its gate certifies it.
- **Floor tier** (ordinal): the guarantee. A floor rung's only gate is `fills >= 1`, and
  its claim is an argmax over a stat that exists for every solver with a fill. An
  ordinal claim over a non-empty set always has a winner (ties break by the universal
  rule below), so **a floor rung can never refuse to award while an untitled solver with
  a fill remains**. Coverage is therefore arithmetic: every solver with at least one
  fill gets a title in any room with at most as many such solvers as the floor has rungs
  (six in v1: specialist, long-hauler, wanderer, scribbler, collector, workhorse).
  Specialty awards only widen the margin. Because a floor rung can be reached by
  fall-through, **a floor title's key and copy must state a personal fact that stays
  true for whoever receives it** (a count, a span, a territory), never a room-wide rank;
  the two temporal ranks (`quick-starter`, `closer`) therefore live in the specialty
  tier, where their gates keep them honest. A larger room can leave its
  least-distinguished solvers untitled until the ladder grows, which is a vector diff,
  not a design change; an untitled solver renders nothing, never a placeholder.

**The pool (owner ruling 2026-07-16): event membership.** A solver is in the titles
system if they appear in the solve events at all (any write or clear), not only if they
own a first-correct cell. The racer who typed all game but always lost the fill by a
beat is real and logged; they are eligible for any rung whose gate they pass. In
practice a zero-fill solver can only ever be `saboteur` (every other gate consumes
fills, trace entries, or slots), which is exactly right. The floor guarantee covers
solvers with `fills >= 1`; a zero-fill solver who passes no specialty gate gets nothing.
The promise, stated exactly: **everyone who landed a square gets a superlative; everyone
who typed at all is in the pool.**

**Solo rule (same ruling)**: a completed game with fewer than two event-member solvers
has `titles: []`. A superlative is social; a solo solve has no one to be "the" anything
against. (This is event membership, not trace membership: a two-person room where one
raced and never landed a fill still titles, and can title the racer.)

**Determinism** (INV-9, INV-1): no randomness anywhere. Every tie breaks by the earlier
`firstFill`, ordered by `(at, seq)`; a solver with no fills sorts after every solver with
one; the final tie is ascending ASCII `userId`. Where a rung says "tie by fills", more
fills wins first, then the universal rule. Title keys are lowercase ASCII kebab-case.

## The stat sheet (pinned semantics)

Inputs: the solve events (with values, server-side only), the solution, the trace
(`ANALYSIS.md`), and the slot list (each slot: its ordered cell indices and a `starred`
flag; geometry as data, INV-9). **Correctness is everywhere the engine comparator
`matches`, never string equality** (the FIRST-CORRECT.md rule; rebus first-char
acceptance must not fork the stats). Let `T` be the trace length and the trace be
ordered by `(at, seq)`. All "whole seconds" are `floor()`. Per solver `u` appearing in
the events:

- **fills**: trace entries owned by `u`.
- **firstFill / lastFill**: the `(at, seq)` of `u`'s earliest and latest trace entries;
  absent for a zero-fill solver.
- **openingFills / closingFills**: owned entries among the first / last
  `ceil(T / 5)` trace entries (`OPENING_SHARE` is the readable name for that fifth; the
  window is computed from the exact rational, never a `0.2 * T` float multiply that could
  round a boundary T up by one). Ordinal, not temporal, so an overnight gap cannot smear
  the stretch (and sittings, when they land, change nothing here).
- **writes**: all events by `u`, writes and clears. (`writes >= fills` always, since a
  fill is `u`'s event.)
- **burst**: the max count of `u`'s own fills inside any closed window
  `[t, t + BURST_WINDOW_MS]` (the same inclusivity as momentum's burst).
- **wrongWrites**: events by `u` writing a non-null value that does not `match` the
  solution at that cell.
- **overwrites**: events by `u` (write or clear) on a cell whose current board value
  `match`ed the solution **and whose trace owner is not `u`** (owner ruling 2026-07-16:
  destroying your own correct square is second-guessing, not sabotage), replacing it
  with a value that does not `match` (or clearing it). Computed by replaying the events
  in `seq` order with a running board. Boundaries this pins: a correct-to-correct
  rewrite (the rebus first-char upgraded to the full string) is NOT an overwrite; a
  wrong write to an empty cell is a wrongWrite, not an overwrite.
- **slotsStarted / slotsFinished**: slots whose first / last trace entry (among the
  slot's cells, by `(at, seq)`) is owned by `u`.
- **meddles**: slots finished by `u` but started by someone else.
- **slotsTouched**: distinct slots containing at least one of `u`'s fills.
- **marqueeLeads**: marquee slots (below) where `u` owns strictly more of the slot's
  first-correct cells than every other solver. A tied slot has no leader.
- **spread**: distinct rows touched plus distinct columns touched, over owned entries.
- **focus / homeQuadrantFills**: quadrants split the grid at row `ceil(rows/2)` and
  column `ceil(cols/2)` (0-indexed; a cell is in the top half when
  `row < ceil(rows/2)`, the left half when `col < ceil(cols/2)`). `homeQuadrantFills`
  is `u`'s fill count in their busiest quadrant (ties to the earliest-reached by
  `(at, seq)`); `focus` is `homeQuadrantFills / fills`.
- **span**: whole seconds between `firstFill.at` and `lastFill.at` (0 for a single
  fill).
- **brokeStall**: 1 if `u` owns the break entry of `moments().turningPoint`, else 0.
  **Pinned byte-identical to the shipped `moments()` projection** (its ordering, its
  tie-breaks), so the ribbon's marker and the ice-breaker card can never name different
  people. The room header carries `stallSeconds` (whole seconds) from the same
  projection; when `turningPoint` is null (fewer than two trace entries),
  `stallSeconds` is 0 and nobody `brokeStall`.

Pinned corner conventions (vectors cite these): a zero-fill solver's row is all zeros
(`focus` 0, never NaN; `span` 0; `spread` 0) with `firstFill`/`lastFill` null. A wrong
write that destroys another solver's correct cell counts as BOTH a wrongWrite and an
overwrite; the two definitions read independently. `geometry` is `{rows, cols}` passed
as data (spread and quadrants need it; slots do not carry it).

**Marquee slots** (the theme tier, two signals, best first):

1. If any slot is `starred`, the marquee set is exactly the starred slots. The flag is
   computed by the API from the clue's leading literal `*` using the same predicate the
   D26 revealer highlight ships (optional leading whitespace, then `*`, as in
   `clueRefs.ts`), so the marquee tier and the board tint can never disagree on what is
   starred; ingestion carries the `*` through verbatim (PROTOCOL section 12 law 11), so
   the signal is the constructor's own marking.
2. Otherwise, the marquee set is every slot whose length is within the top two distinct
   lengths in the puzzle, gated to length >= `MARQUEE_MIN_LENGTH`. Themers are almost
   always the longest answers; the fallback stays honest by never claiming "theme" in
   copy, only "long answers". A mini has no marquee tier and the headliner never awards.

Constants, cited by vectors, never inlined: `OPENING_SHARE = 0.2` (also the closing
share), `BURST_WINDOW_MS = 30_000` (shared with momentum), `STALL_FLOOR_SECONDS = 120`,
`SABOTEUR_MIN = 3`, `BULLSEYE_MIN_FILLS = 5`, `SPRINTER_MIN_BURST = 4`, `MEDDLER_MIN = 2`,
`MARQUEE_MIN_LENGTH = 7`.

## The v1 ladder (pinned)

Order is rank; the walk is top to bottom. Display copy belongs to the clients; the wire
carries the key and the evidence.

| #   | key              | gate                                                      | claim                           | evidence                    |
| --- | ---------------- | --------------------------------------------------------- | ------------------------------- | --------------------------- |
| 1   | `saboteur`       | overwrites >= `SABOTEUR_MIN`                              | max overwrites                  | overwrites                  |
| 2   | `one-hit-wonder` | fills == 1 and wrongWrites == 0 and room's max fills >= 3 | latest firstFill by `(at, seq)` | none                        |
| 3   | `ice-breaker`    | brokeStall and stallSeconds >= `STALL_FLOOR_SECONDS`      | brokeStall (the break's owner)  | stallSeconds, whole seconds |
| 4   | `bullseye`       | wrongWrites == 0 and fills >= `BULLSEYE_MIN_FILLS`        | max fills                       | fills                       |
| 5   | `headliner`      | marqueeLeads >= 1                                         | max marqueeLeads                | marqueeLeads                |
| 6   | `sprinter`       | burst >= `SPRINTER_MIN_BURST`                             | max burst                       | burst                       |
| 7   | `meddler`        | meddles >= `MEDDLER_MIN`                                  | max meddles                     | meddles                     |
| 8   | `quick-starter`  | openingFills >= 1                                         | max openingFills                | openingFills                |
| 9   | `closer`         | closingFills >= 1                                         | max closingFills                | closingFills                |
| 10  | `specialist`     | fills >= 1 (floor)                                        | max focus, tie by fills         | homeQuadrantFills           |
| 11  | `long-hauler`    | fills >= 1 (floor)                                        | max span, tie by fills          | span, whole seconds         |
| 12  | `wanderer`       | fills >= 1 (floor)                                        | max spread, tie by fills        | none                        |
| 13  | `scribbler`      | fills >= 1 (floor)                                        | max writes                      | writes                      |
| 14  | `collector`      | fills >= 1 (floor)                                        | max slotsTouched, tie by fills  | slotsTouched                |
| 15  | `workhorse`      | fills >= 1 (floor)                                        | max fills                       | fills                       |

Reading the order: rungs 1 through 9 are the specialty tier. The roast (`saboteur`) and
the cameo (`one-hit-wonder`) are the most memorable and claim first; each specialty rung
tells a story a volume count cannot, and each may award nobody. The two temporal ranks
(`quick-starter`, `closer`) sit at the tier's bottom with gates that keep their copy
honest: they can only ever name someone who actually filled in the opening or closing
stretch. Rungs 10 through 15 are the floor: every claim is ordinal over solvers with a
fill, so each awards unconditionally while an untitled filler remains, six guaranteed
rungs deep, and every floor title states a personal fact (a territory, a span, a count)
that stays true on fall-through. The tie-breaks make even an all-equal room resolve.

Suggested copy, to set the register (clients own the final words): the saboteur
"overwrote 7 correct squares", the ice breaker "ended the room's 4-minute silence", the
one hit wonder "one square, flawlessly chosen", the headliner "led 3 of the long ones",
the specialist "kept to their corner, 11 squares", the long-hauler "on the case for 26
minutes", the scribbler "busiest pencil, 61 letters down", the collector "had a hand in
17 words", the workhorse "42 squares".

**Known wrinkle, accepted for v1**: in a multi-sitting room the longest gap is usually
overnight, so the ice breaker is often "whoever opened the app the next morning". The
count is honest (amendment 1 holds); the copy will read odd until the sittings
projection lands, at which point the stall should be measured within sittings and this
rung revisited alongside `marathoner`.

**Deferred rungs.** `marathoner` (present in every sitting) waits on the sittings
projection and joins the specialty tier when it lands. The ladder grows by a vector diff
plus a rung entry here; clients ignore unknown keys, so the server may grow the ladder
(or deepen the floor for bigger rooms) without client lockstep.

## The wire

One additive field on the analysis bundle (PROTOCOL section 12, `GET /games/:id/analysis`):

```
"titles": [ { "userId": string, "title": string, "evidence": number | null } ]
```

Ordered by ladder rank. At most one entry per solver, at most one per key. Keys are the
pinned lowercase-kebab set; a client MUST ignore an unknown key (forward compatibility is
how the ladder grows). userIds, keys, and counts only, never a letter (INV-6). Additive,
so no expand/contract obligation and older clients render the bundle as before. Empty
when fewer than two solvers wrote (the solo rule; note this is about writers, not
members, so a four-member room where one person did everything is also empty).

## Where it lives (mirror the analysis reducers)

**Engine** (`packages/engine`, imports nothing, INV-9; vectors-first):

```
titleStats(events, solution, slots, geometry) -> { solvers: per-solver stat sheet, room: { stallSeconds } }
awardTitles(titleStats result)                -> [{ userId, title, evidence }]
```

The ladder is a fixed engine constant, not a parameter: two clients or two services must
never disagree on who the saboteur was. `slots` arrive as data (ordered cell indices plus
`starred`), computed by the API as the union of the snapshot's `clues.across` and
`clues.down` `cellIndices` (`packages/protocol/src/puzzle.ts`); there is no other slot
model anywhere and none is added to the engine. The `starred` flag is the D26 predicate
applied to the clue `text`. Titles are computed server-side and shipped on the wire, so
no Swift reducer twin exists; web and iOS render the same array and cannot disagree.

**API** (`apps/api` Archive module): lifts the slot list and the starred flags from
`games.puzzle_snapshot`, runs the two reducers beside the existing three, appends
`titles` to the bundle. The gate, the cache, and the INV-4 write-once reasoning in
`ANALYSIS.md` apply unchanged.

**Clients**: the Analysis tab's Moments section becomes the Titles section: one card per
solver, dot, name, title copy, evidence. First square and Last square retire; their
stories live on as `quick-starter` and `closer`. The turning point stays on the ribbon.
(A solo room, which today shows two degenerate self-naming moment cards, will show no
Titles section at all; deliberate, the cards were silly.)

## Build sequence

- **PR1** this doc, the `ANALYSIS.md` amendment, the PROTOCOL section 12 row, the
  roadmap phase.
- **PR2** `vectors/analysis/titles.json`: stat-sheet cases (each stat exercised; the
  overwrite-vs-wrongWrite boundary; the rebus comparator boundary, where a first-char
  correct write is not a wrongWrite and a correct-to-correct upgrade is not an
  overwrite; the self-overwrite exclusion; clock skew, where `at` order and `seq` order
  disagree, pinning openingFills, brokeStall, and the universal tie-break; the burst
  window endpoint at exactly `t + BURST_WINDOW_MS`; the quadrant boundary on an odd
  grid; whole-second flooring; marquee via starred and via length tier) and award cases
  (gate refusals, the already-titled fall-through, both tie-breaks, the zero-fill
  saboteur, the event-membership solo rule, the coverage theorem: a room where every
  specialty gate fails still titles all six fillers off the floor, and a seventh is the
  documented untitled remainder). Data ahead of the engine, the house rule.
- **PR3** the engine reducers, greened against PR2.
- **PR4** the API: slot lift, bundle field.
- **PR5** web: the Titles section replaces the person moment cards.
- **PR6** iOS: the same swap in the analysis sheet.
