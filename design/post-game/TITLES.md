# Solver titles

Status: plan of record. Date: 2026-07-16.
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
produces a per-solver row of counts. No judgment, only numbers. Every current and future
title shops here, so a new title is a ladder edit, never a new walk.

**Layer 2, the award ladder.** A fixed, ordered list of titles. Each rung declares three
things, and nothing else, so every future title debate is a data edit:

- **Gate**: the minimum signal below which the rung never awards. This is the whole
  always/sometimes distinction: it is per-rung data, not two kinds of title. A gate
  exists so no title awards on noise ("the sprinter, 2 squares" is worse than no card).
- **Claim**: argmax of one stat-sheet column among the not-yet-titled solvers who pass
  the gate.
- **Evidence**: which number rides the card, or none.

Award walks the ladder top to bottom. Each rung awards at most once; each solver receives
at most one title; a rung whose argmax winner is already titled falls to the next eligible
solver, which maximizes coverage.

The ladder has two tiers, and the split is what makes "everyone gets a superlative" a
theorem instead of a hope:

- **Specialty tier** (gated): the memorable rungs. A gate is the minimum signal below
  which the rung never awards, so no specialty title lands on noise. A gated rung may
  award nobody; that is the gate working.
- **Floor tier** (ordinal): the guarantee. A floor rung's only gate is `fills >= 1`, and
  its claim is an argmax or argmin over a stat that exists for every solver with a fill
  (earliest first fill, most fills, widest spread). An ordinal claim over a non-empty set
  always has a winner (ties break by the universal rule below), so **a floor rung can
  never refuse to award while an untitled solver remains**. Coverage is therefore
  arithmetic: every solver with at least one fill gets a title in any room with at most
  as many such solvers as the floor has rungs (six in v1). Specialty awards only widen
  the margin. A larger room can leave its least-distinguished solvers untitled until the
  ladder grows, which is a vector diff, not a design change; an untitled solver renders
  nothing, never a placeholder.

**Outside the promise**: a member with zero fills. There is nothing to count (reactions
are ephemeral by D24 and are recorded nowhere), and a title over nothing would have to
interpret. The promise is exact: everyone who solved gets a superlative.

**Determinism** (INV-9, INV-1): no randomness anywhere. Every argmax tie breaks by the
earlier first fill, ordered by `(at, seq)`, then by ascending ASCII `userId`. Title keys
are lowercase ASCII kebab-case.

**Solo rule**: a completed game with fewer than two solvers in the trace has `titles: []`.
A superlative is social; a solo solve has no one to be "the" anything against.

## The stat sheet (pinned semantics)

Inputs: the solve events (with values, server-side only), the solution, the trace
(`ANALYSIS.md`), and the slot list (each slot: its ordered cell indices and a `starred`
flag; geometry as data, INV-9). Let `T` be the trace length and the trace be ordered by
`(at, seq)`. Per solver `u` appearing in the events:

- **fills**: trace entries owned by `u`.
- **openingFills / closingFills**: owned entries among the first / last
  `ceil(OPENING_SHARE * T)` trace entries. Ordinal, not temporal, so an overnight gap
  cannot smear the stretch (and sittings, when they land, change nothing here).
- **burst**: the max count of `u`'s own fills inside any `BURST_WINDOW_MS` window.
- **wrongWrites**: events by `u` writing a non-null value that differs from the solution
  at that cell.
- **overwrites**: events by `u` (write or clear) on a cell whose current board value was
  correct, replacing it with anything else. Computed by replaying the events in `seq`
  order with a running board. The victimless typo on an empty cell is a wrongWrite, not
  an overwrite; the overwrite is destroying something that was right.
- **slotsStarted / slotsFinished**: slots whose first / last trace entry (among the
  slot's cells, by `(at, seq)`) is owned by `u`.
- **meddles**: slots finished by `u` but started by someone else.
- **marqueeLeads**: marquee slots (below) where `u` owns strictly more of the slot's
  first-correct cells than every other solver. A tied slot has no leader.
- **spread**: distinct rows touched plus distinct columns touched, over owned entries.
- **focus**: the share of `u`'s fills falling in their busiest quadrant (the grid split
  at `ceil(rows/2)`, `ceil(cols/2)`).
- **span**: whole seconds between `u`'s first and last owned trace entries (0 for a
  single fill).
- **brokeStall**: 1 if `u` owns the trace entry that ended the longest gap (the
  turning point's break, `ANALYSIS.md`), else 0.

**Marquee slots** (the theme tier, two signals, best first):

1. If any slot is `starred`, the marquee set is exactly the starred slots. The flag is
   computed by the API from the clue's leading literal `*`, the same convention D26 pins
   for the revealer highlight; ingestion carries the `*` through verbatim (PROTOCOL
   section 12 law 11), so the signal is the constructor's own marking.
2. Otherwise, the marquee set is every slot whose length is within the top two distinct
   lengths in the puzzle, gated to length >= `MARQUEE_MIN_LENGTH`. Themers are almost
   always the longest answers; the fallback stays honest by never claiming "theme" in
   copy, only "long answers". A mini has no marquee tier and the headliner never awards.

Constants, cited by vectors, never inlined: `OPENING_SHARE = 0.2` (also the closing
share), `BURST_WINDOW_MS = 30_000` (shared with momentum), `STALL_FLOOR_SECONDS = 120`,
`BULLSEYE_MIN_FILLS = 5`, `SPRINTER_MIN_BURST = 4`, `MEDDLER_MIN = 2`,
`MARQUEE_MIN_LENGTH = 7`.

## The v1 ladder (pinned)

Order is rank; the walk is top to bottom. Display copy belongs to the clients; the wire
carries the key and the evidence.

| #   | key              | gate                                                 | claim (argmax)                         | evidence                    |
| --- | ---------------- | ---------------------------------------------------- | -------------------------------------- | --------------------------- |
| 1   | `saboteur`       | overwrites >= 1                                      | overwrites                             | overwrites                  |
| 2   | `one-hit-wonder` | fills == 1 and the room's max fills >= 3             | latest single fill by `(at, seq)`      | none                        |
| 3   | `ice-breaker`    | brokeStall and stallSeconds >= `STALL_FLOOR_SECONDS` | brokeStall (the break's owner)         | stallSeconds, whole seconds |
| 4   | `bullseye`       | wrongWrites == 0 and fills >= `BULLSEYE_MIN_FILLS`   | fills                                  | fills                       |
| 5   | `headliner`      | marqueeLeads >= 1                                    | marqueeLeads                           | marqueeLeads                |
| 6   | `sprinter`       | burst >= `SPRINTER_MIN_BURST`                        | burst                                  | burst                       |
| 7   | `meddler`        | meddles >= `MEDDLER_MIN`                             | meddles                                | meddles                     |
| 8   | `specialist`     | fills >= 1 (floor)                                   | focus, tie by fills                    | fills in the home quadrant  |
| 9   | `long-hauler`    | fills >= 1 (floor)                                   | span, tie by fills                     | span, whole seconds         |
| 10  | `wanderer`       | fills >= 1 (floor)                                   | spread, tie by fills                   | none                        |
| 11  | `quick-starter`  | fills >= 1 (floor)                                   | earliest own first fill by `(at, seq)` | openingFills, null when 0   |
| 12  | `closer`         | fills >= 1 (floor)                                   | latest own last fill by `(at, seq)`    | closingFills, null when 0   |
| 13  | `workhorse`      | fills >= 1 (floor)                                   | fills                                  | fills                       |

Reading the order: rungs 1 through 7 are the specialty tier. The roast (`saboteur`) and
the cameo (`one-hit-wonder`) are the most memorable and claim first; each specialty rung
tells a story a volume count cannot, and each may award nobody. Rungs 8 through 13 are
the floor tier: every claim is ordinal over solvers with a fill, so each awards
unconditionally while an untitled solver remains, six guaranteed rungs deep. A floor
title's copy must survive its degenerate corner (a one-fill specialist is "kept to their
corner", which is true; the tie-breaks make even an all-equal room resolve).

Suggested copy, to set the register (clients own the final words): the saboteur
"overwrote 7 correct squares", the ice breaker "ended the room's 4-minute silence", the
one hit wonder "one square, flawlessly chosen", the headliner "led 3 of the long ones",
the long-hauler "on the case from start to finish", the workhorse "42 squares".

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
so no expand/contract obligation and older clients render the bundle as before.

## Where it lives (mirror the analysis reducers)

**Engine** (`packages/engine`, imports nothing, INV-9; vectors-first):

```
titleStats(events, solution, slots) -> per-solver stat sheet
awardTitles(statSheet)              -> [{ userId, title, evidence }]
```

The ladder is a fixed engine constant, not a parameter: two clients or two services must
never disagree on who the saboteur was. `slots` arrive as data (ordered cell indices plus
`starred`), computed by the API from the puzzle snapshot with the same slot walk the
session's completion check uses.

**API** (`apps/api` Archive module): lifts the slot list and the starred flags from
`games.puzzle_snapshot`, runs the two reducers beside the existing three, appends
`titles` to the bundle. The gate, the cache, and the INV-4 write-once reasoning in
`ANALYSIS.md` apply unchanged.

**Clients**: the Analysis tab's Moments section becomes the Titles section: one card per
solver, dot, name, title copy, evidence. First square and Last square retire; their
stories live on as `quick-starter` and `closer`. The turning point stays on the ribbon.

## Build sequence

- **PR1** this doc, the `ANALYSIS.md` amendment, the PROTOCOL section 12 row, the
  roadmap phase.
- **PR2** `vectors/analysis/titles.json`: stat-sheet cases (each stat exercised, the
  overwrite-vs-wrongWrite boundary, marquee via starred and via length tier) and award
  cases (gate refusals, the already-titled fall-through, both tie-breaks, the solo rule,
  the coverage theorem: a room where every specialty gate fails still titles all six
  solvers off the floor, and a seventh solver in that room is the documented untitled
  remainder). Data ahead of the engine, the house rule.
- **PR3** the engine reducers, greened against PR2.
- **PR4** the API: slot lift, bundle field.
- **PR5** web: the Titles section replaces the person moment cards.
- **PR6** iOS: the same swap in the analysis sheet.
