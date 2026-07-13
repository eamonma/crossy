# Post-game analysis vectors

Status: **data-only, ahead of the engine.** These fixtures pin four NEW engine projections,
`solveTrace`, `momentum`, `moments`, and `solveSequence`, before they are implemented. Vectors
are written before implementations (CLAUDE.md, PROTOCOL.md section 13). The consuming test and
the engine functions land in a later PR; nothing globs this directory yet.

Precedence when sources disagree: these vectors, then PROTOCOL.md, then any implementation.
Companion design: `design/post-game/ANALYSIS.md`.

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
reported time is `(at - t0) / 1000`. Two named engine constants: `N = 40` (momentum sample
count) and `BURST_WINDOW = 30s` (the turning-point burst window). A vector cites these, never a
magic number.

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
cells and times only.

## Layout

```
vectors/
  analysis/
    solve-trace.json   first-correct events retained with timing; scheme-1 immunity keeps first at
    momentum.json      bucketing and peak-normalization of the tempo samples (N = 40)
    moments.json       first / last by at (seq tie-break), and the largest-gap turning point
    sequence.json      the ordered who-fell-when: each cell with atSeconds, sorted by (at, seq)
```

One JSON file per projection, a bare array of cases, UTF-8, prettier-formatted (matches `v1/`,
`first-correct/`).

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
`moments.json`, and `sequence.json` cases carry `given.trace`. All times in `given` are epoch ms;
all reported times in `then` are relative seconds.
