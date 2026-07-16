# Post-game analysis vectors

Status: the four trace projections (`solveTrace`, `momentum`, `moments`, `solveSequence`)
are implemented and bound (`packages/engine/src/analysis.test.ts`, a narrow per-file
reader; no directory glob). `titles.json` is the family's **data-only, ahead-of-the-engine**
member: it pins the two solver-titles reducers (ROADMAP Phase 10, Wave 10.2) before they
exist. Vectors are written before implementations (CLAUDE.md, PROTOCOL.md section 13); the
Wave 10.3 engine PR adopts `titles.json` with the same reader. `sittings.json` is the
second data-only member: it pins the sittings partition and the active-time remap
(DESIGN.md D29, `design/post-game/SITTINGS.md`; ROADMAP Phase 11) ahead of the Wave 11.2
engine PR, which adopts it the same way.

Precedence when sources disagree: these vectors, then PROTOCOL.md, then any implementation.
Companion design: `design/post-game/ANALYSIS.md`; for titles, `design/post-game/TITLES.md`.

## The projections

All read one thing, the **solve trace**: for each cell, the first-correct event's
`{ cell, userId, seq, at }`. `solveTrace` builds it; `momentum`, `moments`, and `solveSequence`
read it. They are tested independently, so the reader projections take a trace directly as
`given.trace` rather than recomputing it from events.

```
solveTrace(events, solution) -> trace                         // ordered by seq ascending
momentum(trace)              -> { durationSeconds, samples }  // samples length N = 40
moments(trace)               -> { firstToFall, lastSquare, turningPoint }
solveSequence(trace)         -> [{ cell, atSeconds }]         // sorted by (at, seq) ascending
```

### Time and constants

`at` is **epoch milliseconds** (a number), the shape `cell_events.at` carries as data into the
pure engine (INV-9: the engine takes timestamps as data, it never reads a clock). Every reported
time is **relative seconds** from the solve's start: `t0 = min(at)` over the trace, and a
reported time is `(at - t0) / 1000`, exact division, never rounded (the engine subtracts and
divides, it does not round). Three named engine constants: `N = 40` (momentum sample count),
`BURST_WINDOW = 30s` (the turning-point burst window), and `SITTING_GAP_MS = 1_800_000` (30
minutes, the sitting boundary; DESIGN.md D29). A vector cites these, never a magic number.

### solveTrace

- `events`: ordered by `seq` ascending. Each is `{ seq, cell, userId, value, at }`. `value` is
  an uppercase ASCII token matching `^[A-Z0-9]{1,10}$`, or `null` for a clear. `at` is epoch ms.
- `solution`: `[cell, expected]` pairs, the engine's `Solution` as data. Block cells absent.
- Correctness is the engine comparator `matches(solution[cell], value)`
  (`packages/engine/src/comparator.ts`): ASCII-case-insensitive (INV-1), rebus first-char
  accepting (D12). The vectors never invent equality.
- `trace`: one entry per cell that ever went correct, the FIRST (min `seq`) matching event, as
  `{ cell, userId, seq, at }`, **ordered by `seq` ascending**. Scheme 1, first-ever-correct
  (FIRST-CORRECT.md): once a cell is in the trace, no later clear, overwrite, or re-correction
  moves its entry, and its `at` stays the first correct's timestamp. A cell only ever wrong, or
  cleared, is absent.

### momentum

- `given.trace`: the solve trace (seq-ordered), each `{ cell, userId, seq, at }`. No `value`
  field: the trace is post-correctness, so it never carries a letter (INV-6).
- `durationSeconds`: `(tEnd - t0) / 1000`, where `tEnd = max(at)`, `t0 = min(at)`; `0` for an
  empty or single-instant trace.
- `samples`: length `N = 40`. Bucket each entry by
  `idx = tEnd > t0 ? floor((at - t0) / (tEnd - t0) * (N - 1)) : 0`. `count[i]` is the entries in
  bucket `i`; `samples[i] = count[i] / max(count)`, normalized to the busiest bucket. All zeros
  when the trace is empty (no division by zero).

### moments

- `given.trace`: the solve trace (seq-ordered), each `{ cell, userId, seq, at }`.
- `firstToFall` / `lastSquare` (`{ cell, userId, atSeconds } | null`): the entries with the
  minimum and maximum `at` (ties broken by min and max `seq`). Both `null` for an empty trace.
- `turningPoint` (`{ stallSeconds, breakSeconds, burst } | null`): over consecutive entries,
  `stallSeconds` is the largest gap `(at[i+1] - at[i]) / 1000` (ties to the earliest, min `seq`);
  `breakSeconds` is the relative time of the entry that ended it; `burst` is the count of entries
  with `at` in `[breakAt, breakAt + BURST_WINDOW]`. `null` when the trace has fewer than two
  entries.

### solveSequence

The replay's foundation: the ordered "who fell when," each cell with the relative second it went
correct. Read by the engine's `solveSequence` (arriving next), consumed by the post-game solve
replay (`design/post-game/REPLAY.md`).

- `given.trace`: the solve trace (seq-ordered), each `{ cell, userId, seq, at }`.
- `sequence` (`{ cell, atSeconds }[]`): every trace entry as `{ cell, atSeconds }`, sorted
  **ascending by `(at, seq)`**: primarily by `at`, ties broken by `seq`. `atSeconds = (at - t0) /
1000`, `t0 = min(at)`, so the first entry is `0`. The order is `at`-driven, the same clock
  `momentum` and `moments` use: it re-sorts on `at` and does not merely echo the trace's seq
  order, since clock skew across writers can put a later-seq fill at an earlier `at`. `[]` for an
  empty trace. INV-6-safe by shape: cells and times only, no `userId` (the client reads the owner
  from the bundle's `owners` map).

## The sittings reducers (`sittings.json`)

`sittings.json` pins the sittings projection from `design/post-game/SITTINGS.md` (DESIGN.md
D29): the partition of the event log into sittings and the active-time re-base of the whole
bundle. Like `titles.json`, the file holds two keyed case clusters, one per function,
`{ "collapseIdle": [...], "sittings": [...] }`, each cluster a case array in the house shape.

```
collapseIdle(events)        -> events'                          // at moved onto the active axis
sittings(events, solution)  -> { count, spans, wallSeconds }    // the wire projection
```

- **The partition**: a sitting is a maximal run of events whose consecutive gaps (seq order,
  `at[i+1] - at[i]`) are all under `SITTING_GAP_MS`. A gap of **exactly** `SITTING_GAP_MS`
  is a boundary (`>=` splits; both edges are vector-pinned). A negative gap (clock skew) is
  under the threshold, so skew never splits. Activity is **any** event, writes, wrong writes,
  and clears alike: the partition runs over the full event log, never the first-correct trace
  (the bridge case and its contrast pin this).
- **collapseIdle**: `given.events` (the `solve-trace.json` event shape) to `then.events`,
  the same events with each `at` replaced by `at - (sum of collapsed gaps before it)`. A
  collapsed gap is subtracted in full, so the boundary events share one active instant (the
  seam). A log with no boundary is the **identity mapping**: every analysis case predating
  sittings is single-sitting, which is why the re-base leaves them all byte-identical (the
  compat proof; the D29 amendment only appended cases to this family).
- **sittings**: `given.events` plus `given.solution` (repo-and-server-only ground, as in
  `solve-trace.json`) to the wire field: `count` sittings; `spans`, one per sitting on the
  **active axis of the remapped trace** (the ribbon's axis), contiguous
  (`spans[k+1].startSeconds == spans[k].endSeconds`, first start `0`, last end
  `momentum.durationSeconds`), each boundary clamped to `[0, durationSeconds]` and
  non-decreasing, so a sitting with no trace entry degenerates to a zero-width span at the
  axis edge while the count stays honest; and `wallSeconds`, `(max at - min at) / 1000` over
  the **unremapped** trace, the number `durationSeconds` reported before the re-base, flavor
  only. All numbers exact division, unrounded (the identity `wallSeconds == durationSeconds`
  for a single sitting demands it; the one-ms-under case pins 1799.999).

### Composed cases in the trace-projection files (D29)

Production feeds the reducers the remapped trace: the pipeline is
`solveTrace(collapseIdle(events), solution)`, then `momentum`/`moments`/`solveSequence`
unchanged. To pin that composition end to end, `momentum.json`, `moments.json`, and
`sequence.json` each carry one **composed case**, named `COMPOSED (D29): ...`, whose `given`
holds `events` and `solution` **beside** the usual `trace`, with the pinned equality that
`given.trace` is exactly `solveTrace(collapseIdle(given.events), given.solution)`. The
shipped reader keeps running `f(given.trace)` and stays green with no engine change; the
Wave 11.2 reader additionally asserts the equality, closing the pipeline. The cases pin the
active basis (compact `durationSeconds` and `atSeconds`, the within-sitting turning point,
the seam sharing one active instant and bucket). Every pre-existing case is untouched and
byte-identical; the reducers themselves did not change.

## The titles reducers (`titles.json`)

`titles.json` pins the two solver-titles reducers from `design/post-game/TITLES.md` (the
law for every semantic below; constants and rules are cited by name, never re-derived):

```
titleStats(events, solution, slots, geometry) -> { solvers: per-solver stat sheet, room: { stallSeconds } }
awardTitles(titleStats result)                -> [{ userId, title, evidence }]
```

Two functions share one file, so the file is a keyed object of two case clusters,
`{ "titleStats": [...], "awardTitles": [...] }`, each cluster a case array in the house
shape (`name`, `intent`, `given`, `then`) — the one deliberate departure from the
bare-array convention, documented here so the Wave 10.3 reader binds each cluster to its
function.

### titleStats cases

- `given`: `rows`, `cols` (grid geometry as data, INV-9: quadrants and spread need it;
  the reader passes them as the reducer's `geometry` argument, `{ rows, cols }`),
  `solution` (`[cell, expected]` pairs, as `solve-trace.json`), `events` (the
  `solve-trace.json` event shape: `{ seq, cell, userId, value, at }`, `at` epoch ms,
  `value` null for a clear), and `slots`: each `{ cells, starred }`, ordered cell indices
  plus the starred flag, exactly as TITLES.md pins (slots are data; no slot model enters
  the engine).
- `then.solvers`: one row per solver appearing in the events (the pool is event
  membership), keyed by userId. Rows follow the top-level assertion rule
  (`vectors/README.md`): a row constrains exactly the fields it lists, an absent field is
  unasserted, and an asserted absence is an explicit `null`. `then.room.stallSeconds` is
  the floored whole-second stall from the same `moments()` projection the ribbon ships.
- **Correctness is everywhere the engine comparator `matches`, never string equality**
  (ASCII-case-insensitive, rebus first-char accepting; INV-1, D12). The rebus case pins
  that a first-char-correct write is not a wrongWrite and a correct-to-correct rewrite is
  not an overwrite.
- Time conventions: `at` in `given` is epoch ms. `firstFill`/`lastFill` in the sheet are
  raw `{ at, seq }` ordering keys, NOT relative seconds — they feed the award tie-breaks
  and never render; `span` and `stallSeconds` are the display numbers, whole seconds,
  `floor()`. The stat sheet is engine-internal (only `titles` ships on the wire), so the
  relative-seconds rule of the trace projections does not apply to it.
- Ordering: openingFills/closingFills slice the first/last `ceil(OPENING_SHARE * T)` of
  the `(at, seq)`-ordered trace; `brokeStall` is pinned **byte-identical to the shipped
  `moments()`** (`packages/engine/src/analysis.ts`), whose gap scan walks consecutive
  trace entries in seq order — the skew case pins that where the two orderings disagree,
  the `moments()` behavior wins.
- Readings pinned where TITLES.md is silent, chosen for consistency with the sibling
  projections: a zero-fill solver's row exists with `firstFill`/`lastFill` null and
  `focus`, `span`, `spread` all `0` (never NaN); a trace of fewer than two entries has no
  turning point, so nobody `brokeStall` and `room.stallSeconds` is `0`. The
  home-quadrant tie ("earliest-reached") is unobservable in the output
  (`homeQuadrantFills` is equal either way and the quadrant's identity never surfaces),
  so no vector pins it.

### awardTitles cases

- `given` is a `titleStats` result verbatim: `solvers` (rows carry at least the columns
  the ladder reads: fills, firstFill, openingFills, closingFills, writes, burst,
  wrongWrites, overwrites, meddles, slotsTouched, marqueeLeads, spread, focus,
  homeQuadrantFills, span, brokeStall; extra columns are ignored) and
  `room.stallSeconds`.
- `then.titles` is the full award array, ordered by ladder rank, at most one entry per
  solver and per key, `evidence` a number or `null`. The ladder is the fixed TITLES.md
  v1 table (a future engine constant, never a parameter); the walk, the gates, the two
  tiers, the solo rule, "tie by fills", and the universal tie-break (earlier `firstFill`
  by `(at, seq)`, zero-fill sorts last, final tie ascending ASCII userId, INV-1) are all
  exercised by name in the case intents, so coverage is greppable.
- Constants cited by the cases, never inlined (TITLES.md): `OPENING_SHARE = 0.2`,
  `BURST_WINDOW_MS = 30000` (shared with momentum), `STALL_FLOOR_SECONDS = 120`,
  `SABOTEUR_MIN = 3`, `BULLSEYE_MIN_FILLS = 5`, `SPRINTER_MIN_BURST = 4`,
  `MEDDLER_MIN = 2`, `MARQUEE_MIN_LENGTH = 7`.
- The reference pair: the last `titleStats` case (the 5x5 reference solve) and the last
  `awardTitles` case (the reference walk) share one sheet byte for byte, so an
  implementer can debug the whole pipeline end to end against a single narrative.

## Why a separate family, not under `v1/`

`vectors/v1/` is a closed registry whose runner throws on an unrecognized family. These pin
not-yet-implemented engine projections, so this family sits at the top level where the `v1/`
runner never globs it, exactly as `vectors/first-correct/` does. A future PR adopts these files
with a narrow reader (`resolve(here, "../../../vectors/analysis")`). `sequence.json` is adopted
the same way the other three are, a fourth `describe` block over `solveSequence` in that reader.

## INV-6

Every output carries userIds, cell indices, and numbers only, never a solution value.
`given.solution` in `solve-trace.json` MAY carry the answer grid because the vectors tree is
repo-and-server-only and never shipped to a client (as `vectors/first-correct/README.md` notes
for its own grids). `momentum`, `moments`, and `solveSequence` take a valueless trace, so their
fixtures never even name a solution, and `solveSequence` drops the `userId` too: its output is
cells and times only. The titles reducers keep the same discipline: the stat sheet and the
award array carry userIds, keys, and counts only, never a letter (`titles.json`'s
`given.solution` is repo-and-server-only ground, like `solve-trace.json`'s). `sittings.json`
follows suit: the wire projection outputs counts and seconds only, and its fixtures
(`collapseIdle` events carry values, `sittings` carries a solution) are the same
repo-and-server-only ground, server-side inputs that never ship (the remap happens before
the trace drops the values).

## Layout

```
vectors/
  analysis/
    solve-trace.json   first-correct events retained with timing; scheme-1 immunity keeps first at
    momentum.json      bucketing and peak-normalization of the tempo samples (N = 40)
    moments.json       first / last by at (seq tie-break), and the largest-gap turning point
    sequence.json      the ordered who-fell-when: each cell with atSeconds, sorted by (at, seq)
    titles.json        the solver-titles stat sheet and award ladder (two clusters, one per reducer)
    sittings.json      the sitting partition and active-time remap, plus the wire projection (two clusters)
```

One JSON file per projection, a bare array of cases, UTF-8, prettier-formatted (matches `v1/`,
`first-correct/`). `titles.json` and `sittings.json` hold two clusters keyed by reducer (above).

## Case shape

```json
{
  "name": "short identifier of the case",
  "intent": "the rule it pins, and the invariant it defends",
  "given": { "trace": [{ "cell": 0, "userId": "u1", "seq": 1, "at": 0 }] },
  "then": { "durationSeconds": 0, "samples": [] }
}
```

`solve-trace.json` cases carry `given.solution` and `given.events`; `momentum.json`,
`moments.json`, and `sequence.json` cases carry `given.trace`, and each file's one composed
D29 case carries `given.events` and `given.solution` beside it (its section above). All times in
`given` are epoch ms; all reported times in `then` are relative seconds. `titles.json` differs
as its section documents: its stat-sheet `then` carries raw `{ at, seq }` ordering keys plus
floored whole-second spans, never relative fractional seconds. `sittings.json`'s `collapseIdle`
cluster differs the other way: its `then.events` stay epoch-anchored ms, since the remap moves
timestamps, it does not report seconds.
