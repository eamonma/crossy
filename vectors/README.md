---
status: normative
---

# Conformance vectors

Normative test vectors for the engine, protocol behaviors, and client stores
(PROTOCOL.md §13). Two runners consume every file in CI, vitest for TypeScript and
XCTest for the Swift port. A divergence between runners, or between a runner and
PROTOCOL.md, is a build failure.

Precedence when sources disagree: these vectors, then PROTOCOL.md, then any
implementation. Changes here are small, focused PRs reviewed against PROTOCOL.md.
Vectors are written before implementations.

## Layout

```
vectors/
  v1/            live suite for protocol version 1
    reducer/
    comparator/
    navigation/
    completion/
    check/
    client-store/
    clue-runs/
```

- One JSON file per behavior cluster, kebab-case basename, `.json` extension. Each
  file is a bare JSON array of cases, UTF-8, prettier-formatted.
- The directory name is the family. Runners MUST fail on a family they do not
  recognize; skipping silently is forbidden. The six families from PROTOCOL.md §13
  plus `clue-runs` (PROTOCOL.md §12) are registered. `client-store` and `clue-runs`
  are _foreign_ families (see below): the engine runner discovers and shape-validates
  them but never executes them.
- On a protocol version bump the outgoing suite is frozen under `frozen/vN-1/` and
  stays in CI (PROTOCOL.md §14).

## Assertion rule

An expected object constrains exactly the fields it lists; an absent field is
unasserted. Expected arrays match in length and order, each element under the same
rule. Sparse cell maps key by decimal cell index (row-major, 0-based); unlisted
playable cells are empty.

## Reducer cases

Shape, verbatim from PROTOCOL.md §13:

```json
{
  "name": "overwrite flips value and attribution",
  "given": {
    "cols": 5,
    "rows": 4,
    "blocks": [2, 6, 13],
    "status": "ongoing",
    "seq": 7,
    "cells": { "0": { "v": "A", "by": "u1" } }
  },
  "when": [
    {
      "type": "placeLetter",
      "commandId": "c9",
      "cell": 0,
      "value": "B",
      "by": "u2",
      "at": "2026-07-07T00:00:01Z"
    }
  ],
  "then": {
    "events": [
      {
        "type": "cellSet",
        "seq": 8,
        "cell": 0,
        "value": "B",
        "by": "u2",
        "commandId": "c9"
      }
    ],
    "state": {
      "cells": { "0": { "v": "B", "by": "u2" } },
      "filledCount": 1,
      "seq": 8
    }
  }
}
```

- `given` MUST carry `cols`, `rows`, `blocks`, `status`, `seq`. `cells` is optional
  (default empty). `firstFillAt` MAY appear (default null) in cases that assert it.
- `when` entries are the wire command plus the server-side meta (`by`, `at`); the
  engine receives both as plain data (INV-9).
- `then.events` and `then.state` follow the assertion rule. The shape above omits
  the event's `at` deliberately, so runners do not assert it.
- No-op vectors are required (PROTOCOL.md §13).
- A rejected command produces no sequenced event and no state change. Its case sets
  `then.events` to `[]`, `then.state` to the unchanged state (`seq` included, since a
  rejection consumes no `seq`; INV-2), and `then.error` to the PROTOCOL.md §11 code
  the rejection maps to (`GAME_NOT_ONGOING`, `INVALID_VALUE`, ...). This distinguishes
  a rejection from an accepted no-op, which always emits one `cellSet` (PROTOCOL.md
  §6). `then.error` extends the §13 reducer shape, which lists only `events` and
  `state`; it is unasserted when absent (the assertion rule).

## Comparator cases

Shape, verbatim from PROTOCOL.md §13:

```json
{
  "solution": "XRAY",
  "accept": ["XRAY", "xray", "X", "x"],
  "reject": ["XR", "RAY", "Y", ""]
}
```

Cases carry no `name`; runners label them by `solution`. Casing is ASCII-only
(INV-1); the suite pins Turkish dotted and dotless i (PROTOCOL.md §13).

## Navigation cases

PROTOCOL.md §13 gives navigation as a table, not JSON. This encoding is defined
here and is normative. The seed cluster (`single-cell-advance.json`) pins one
`getNextCell` step:

```json
{
  "name": "seed 5: skips a block across",
  "given": { "cols": 5, "rows": 4, "blocks": [2, 6, 13] },
  "when": { "direction": "across", "from": 1, "toward": "forward" },
  "then": { "cell": 3 }
}
```

- `when.direction` is `"across"` or `"down"`; `when.toward` is `"forward"` or
  `"backward"`.
- `when.canEscapeWord` is optional. Omitted means the default, escape enabled,
  which the seed table pins (case 5 equals case 8; case 6 crosses a block down
  with no flag).
- `given.fills` (sparse map, cell index to string) supplies board fill state;
  omitted means every playable cell is empty.
- The empty grid (seed case 9) is `"cols": 0, "rows": 0, "blocks": []`.
- Seed case names keep the PROTOCOL.md table numbering: `seed N: <scenario>`.

### Operations (`when.op`)

The planned additions (PROTOCOL.md §13) need clue traversal and fill state, which
one single-cell step cannot express. Rather than a second family, the navigation
`when` carries an optional `op` discriminator naming which navigation operation the
case pins. Absent `op` means `"advance"`, the seed's single-cell `getNextCell`, so
the 12 seed cases are unchanged. Each op fixes its own `when` inputs and `then`
outputs:

| op                  | when                                    | then            | given.fills           |
| ------------------- | --------------------------------------- | --------------- | --------------------- |
| `advance` (default) | direction, from, toward, canEscapeWord? | cell            | ignored               |
| `wordBounds`        | direction, from                         | start, end      | ignored               |
| `tab`               | direction, from, toward                 | cell, direction | current board         |
| `typing`            | direction, from                         | cell            | board after keystroke |
| `backspace`         | direction, from                         | cell            | current board         |

- `advance`: one block-skip step governed by `canEscapeWord` (the seed semantics).
  Fill-agnostic.
- `wordBounds`: the word's extent along `direction` from `from`, scanning to a block
  or grid edge each way (DESIGN §5). `then.start` and `then.end` are the inclusive
  bounds.
- `tab`: Tab (`toward: "forward"`) and Shift+Tab (`toward: "backward"`). Traverses the
  Tab cycle, every across clue in clue order then every down clue in clue order,
  circular (owner decision 2026-07-10). Lands on the first clue after the current one
  that has an empty cell, at that clue's first empty cell scanning from its start;
  `then.direction` is the landing clue's axis, so Tab skips full clues and crosses from
  across into down. The current clue re-enters only after a full cycle. With nothing
  empty anywhere it steps to the adjacent clue (first cell on Tab, last on Shift+Tab),
  axis crossing included. `then.direction` is pinned alongside `then.cell`. This
  supersedes audit Verdict 1's same-axis, no-cross wrap (DESIGN §5).
- `typing`: the cursor move after a letter is placed at `from`. `given.fills` is the
  board after that keystroke, so `from` is filled. Advances forward with filled-skip
  inside the word to the next empty cell; at the word's end it wraps to the word's
  first empty cell if the word is incomplete, or stays on the last cell if the word
  is full (DESIGN §5).
- `backspace`: the cursor move on Backspace. `then.cell` is where the cursor lands,
  which is also the cell cleared. On a non-empty `from` it stays (clears in place);
  on an already-empty `from` it steps back one cell with block-skip, crossing word
  boundaries into the previous word, and clears wherever it lands (DESIGN §5).

`then.direction` is asserted only where an op can change direction (`tab`); the other
ops never leave their axis and omit it (the assertion rule leaves it unasserted).

### Filled-skip is an operation property, not a shared flag

Track-d decision (a Wave 1.1h finding delegated here): **filled-skip lives inside the
named operations that need it (`tab`'s first-empty scan, `typing`'s advance), each
pinned end to end by its own `op` with `given.fills` and a single landing cell. It is
not a flag on the single-cell `advance` primitive, and not a composition the client
callers assemble from raw single steps.** Rationale:

- v2 proved the caller-composition path is where drift and bugs live. Shift+Tab's two
  bugs (`reports/v2-navigation-audit.md`, Verdict 1) sat in the client's hand-rolled
  `while`-loop scan built from raw `canEscapeWord=false` steps, not in `getNextCell`.
  Pinning the whole operation as one engine function makes both ports land
  identically and forecloses that class of divergence (INV-1).
- v2 already carried two filled-skip mechanisms: a parameter inside `getNextCell` for
  typing, and the raw-step loop for Tab. Collapsing them into named operations removes
  the "which mechanism" ambiguity; a generic filled-skip flag would reintroduce it.
- The 12 seed cases show single-cell advance is deliberately fill-agnostic: none
  supply `fills`, and `canEscapeWord` governs only block-crossing at a word boundary.
  Overloading `advance` with a filled-skip flag would blur a clean primitive.
- Filled-skip is not a universal modifier. Arrows and Backspace use block-skip with no
  filled-skip; typing is filled-skip plus a wrap-or-stay clamp; Tab is a first-empty
  scan. Modeling filled-skip per operation matches where it actually applies and keeps
  the others honest.

The new clusters (`word-bounds`, `next-word`, `previous-word`, `typing-advance`,
`full-word-asymmetry`, `backspace-step-back`) reuse the PROTOCOL.md §13 fixture (5 by
4, blocks 2, 6, 13) and cite the sentence each case pins. The engine is unimplemented,
so these are discovered and shape-validated as hard passes but execution-skipped via
the navigation entry in both `vectors.skip.json` manifests.

## Completion cases

Completion is its own family because the two-phase check needs the cell solutions,
which the reducer shape does not carry, and it asserts `gameCompleted`, which the
reducer never emits (PROTOCOL.md §10, §13; DESIGN.md §3). Shape:

```json
{
  "name": "full but wrong board corrected in place completes (same filledCount)",
  "given": {
    "cols": 2,
    "rows": 1,
    "blocks": [],
    "status": "ongoing",
    "seq": 6,
    "solution": { "0": "A", "1": "B" },
    "cells": { "0": { "v": "A", "by": "u1" }, "1": { "v": "Z", "by": "u2" } }
  },
  "when": [
    {
      "type": "placeLetter",
      "commandId": "c1",
      "cell": 1,
      "value": "B",
      "by": "u2",
      "at": "2026-07-07T00:00:05Z"
    }
  ],
  "then": {
    "events": [
      {
        "type": "cellSet",
        "seq": 7,
        "cell": 1,
        "value": "B",
        "by": "u2",
        "commandId": "c1"
      },
      { "type": "gameCompleted", "seq": 8 }
    ],
    "state": { "status": "completed", "filledCount": 2, "seq": 8 }
  }
}
```

- `given` carries the reducer fields plus `solution`, a sparse map of cell index to
  the cell's solution string. Every playable cell must have a `solution` entry; the
  comparator runs over all of them.
- `when` is the command sequence applied in mailbox order. Concurrency collapses to
  this total order (PROTOCOL.md §10): two writers filling the last two cells are two
  ordered commands, and only the second completes.
- `then.events` lists the full sequenced stream. `gameCompleted` follows the
  triggering `cellSet` at the next `seq`; a filled-but-wrong case or a terminal-state
  case lists no `gameCompleted`. The event's `stats` are omitted: `participantCount`
  is not board-derivable (PROTOCOL.md §4) and `solveTimeSeconds` needs the server
  clock, so stats are pinned at the actor-integration layer, not here.
- The check is level-triggered (PROTOCOL.md §10; DESIGN.md §3): a same-`filledCount`
  overwrite re-runs the comparator, so a full-but-wrong board corrected in place
  completes. Exactly one `gameCompleted` ever (INV-3); a terminal board freezes and
  rejects further mutations, yielding no second completion (INV-4).

## Check cases

The room check (PROTOCOL.md §10) shares the completion shape: it needs
`given.solution` for the comparator and asserts events the reducer never emits. Since
D32 the check passes through an attributed majority vote, so the family carries the vote
envelope. Three additions in `given`, all optional and following the assertion rule in
`then.state`: `checkedWrong`, an ascending int array of standing marks (default none);
`checkCount`, the permanent count (default 0); and `checkVote`, the open vote (default
`null`). `then.state.checkVote` asserts the same shape.

**The `checkVote` object** (in `given` and `then.state`) is
`{openedSeq, by, electorate, approvals, rejections}`, or `null` when no vote is open.
`openedSeq` is the `seq` of the vote's `checkVoteOpened` (its identity, the `voteSeq` a
ballot names); `by` is the proposer; `electorate` is the frozen ascending userId array;
`approvals` and `rejections` are the ascending userIds voted each way, `approvals`
opening as `[by]`. `needed` is **not** in the state, it derives as
`floor(electorate.length / 2) + 1`; the emitted `checkVoteOpened` carries it explicitly.

**The `when` command shapes** (the session supplies the server-side data, INV-9):

- `checkPuzzle`: `{ "type": "checkPuzzle", "commandId": "c1", "by": "u1", "electorate": ["u1", "u2", "u3"] }`.
  The proposer proposes; `electorate` is the frozen ascending set of eligible voters.
- `castCheckVote`: `{ "type": "castCheckVote", "commandId": "c2", "by": "u2", "voteSeq": 31, "approve": true }`.
  One ballot; `voteSeq` names the open vote's `openedSeq`.
- `expireCheckVote`: `{ "type": "expireCheckVote" }`, the actor's timeout tick, no
  `commandId` (the session drives expiry as an input when its timer fires).
- Mutations (`placeLetter`, `clearCell`) keep their reducer/completion shape.

**Engine-emitted events omit `at` and `expiresAt`** (like every family's events), which
the session adapter stamps. The three vote events are `checkVoteOpened`
`{type, seq, by, electorate, needed, commandId}`, `checkVoteCast`
`{type, seq, voteSeq, by, approve, commandId}`, and `checkVoteClosed`
`{type, seq, voteSeq, outcome, reason?}` (`outcome` `passed` | `failed` | `cancelled`,
`reason` absent when passed, else `REJECTED` | `EXPIRED` | `GRID_BROKEN` | `TERMINAL`).
`puzzleChecked` now carries `by` (the proposer) and fires only as the immediate
successor of a `passed` close. Rejections follow the reducer convention: `then.events`
`[]` (or the events up to the rejected command), unchanged `then.state`, and
`then.error` (`VOTE_PENDING`, `NO_VOTE_OPEN`, `NOT_ELECTOR`, `ALREADY_VOTED`,
`GRID_NOT_FULL`, `GAME_NOT_ONGOING`).

```json
{
  "name": "§10/D32: a decisive approval in E=3 closes the vote passed; puzzleChecked carries the proposer",
  "given": {
    "cols": 3,
    "rows": 1,
    "blocks": [],
    "status": "ongoing",
    "seq": 30,
    "solution": { "0": "A", "1": "B", "2": "C" },
    "cells": {
      "0": { "v": "X", "by": "u1" },
      "1": { "v": "B", "by": "u2" },
      "2": { "v": "Z", "by": "u3" }
    },
    "checkVote": null
  },
  "when": [
    {
      "type": "checkPuzzle",
      "commandId": "c1",
      "by": "u1",
      "electorate": ["u1", "u2", "u3"]
    },
    {
      "type": "castCheckVote",
      "commandId": "c2",
      "by": "u2",
      "voteSeq": 31,
      "approve": true
    }
  ],
  "then": {
    "events": [
      {
        "type": "checkVoteOpened",
        "seq": 31,
        "by": "u1",
        "electorate": ["u1", "u2", "u3"],
        "needed": 2,
        "commandId": "c1"
      },
      {
        "type": "checkVoteCast",
        "seq": 32,
        "voteSeq": 31,
        "by": "u2",
        "approve": true,
        "commandId": "c2"
      },
      {
        "type": "checkVoteClosed",
        "seq": 33,
        "voteSeq": 31,
        "outcome": "passed"
      },
      {
        "type": "puzzleChecked",
        "seq": 34,
        "wrongCells": [0, 2],
        "checkCount": 1,
        "by": "u1",
        "commandId": "c1"
      }
    ],
    "state": {
      "status": "ongoing",
      "seq": 34,
      "checkedWrong": [0, 2],
      "checkCount": 1,
      "checkVote": null
    }
  }
}
```

- `then.state.checkedWrong` serializes as an ascending int array; `then.events`
  `wrongCells` likewise, and every userId array (`electorate`, `approvals`,
  `rejections`) is ascending ASCII byte order (INV-1). Marks, count, and `checkVote` are
  asserted only where listed (the assertion rule), so reducer and completion cases
  predating the check stay untouched.
- **The migrated clusters** (`room-check`, `gates`, `recheck`, `completion-interplay`)
  keep their pre-vote assertions verbatim in meaning. Every accepted `checkPuzzle` is
  now a **solo-electorate** proposal (`by` one user, `electorate` that user), whose
  events become the auto-pass triple `checkVoteOpened` (`needed` 1), `checkVoteClosed`
  (`passed`), `puzzleChecked` (now with `by`), seqs shifted, and `then.state` gaining
  `checkVote: null`. `mark-clearing` is untouched: its pure `cellSet` cases carry no
  vote, and partial state assertion leaves `checkVote` unlisted.
- **The vote-lifecycle clusters:** `vote-open` (opening at E=3 and E=2, the strict
  majority, `VOTE_PENDING` on a second proposal, the solo instant pass); `vote-ballots`
  (a decisive approval passes and attributes `puzzleChecked` to the proposer, a
  non-decisive rejection records only, decisive and unreachable-majority rejections
  close `failed` `REJECTED`, and the `ALREADY_VOTED` / `NOT_ELECTOR` / `NO_VOTE_OPEN`
  gates including a stale `voteSeq`); `vote-expiry` (`EXPIRED` short of majority, a
  silent no-op tick with no vote, a ballot after expiry); `vote-cancellation` (a clear
  closes `cancelled` `GRID_BROKEN`, an overwrite rides and the later pass computes
  `wrongCells` on the board at close time, an in-place correction closes `cancelled`
  `TERMINAL` before `gameCompleted`).
- Mark clearing is reducer semantics (a marked cell's mark clears exactly when its
  value changes; PROTOCOL.md §10), but its cases live here, not in the reducer
  family, because a meaningful starting state carries marks that only a check can
  mint.
- The vote flow is unimplemented in the engine until Wave 15.2, so the family is
  discovered and shape-validated as hard passes but execution-skipped via the `check`
  entry in `vectors.skip.json` `families` (skipped-until-engine); Wave 15.2 rebinds it.

## Foreign families

Most families bind to `packages/engine`. Two do not. `client-store`'s consumer is the
web client's store (Wave 2.1d) and later the iOS store; `clue-runs`' consumer is the
clue-run parser and renderer in `apps/web` and iOS (PROTOCOL.md §12). Neither's consumer
is the engine, so the engine runner treats both as _foreign_: it discovers and
shape-validates the cases (hard passes, no silent skip, no unknown-family failure) but
never executes them. Execution lives in `apps/web`'s and the iOS suites, which import
the same JSON files.

The mechanism is `packages/engine/vectors.skip.json`. It has two disjoint buckets:

- `families`: skipped-until-engine. Wave 2.1a bound each to an engine entry point and
  removed it from the list; the per-family guard (Wave 2.1a's replacement for the coarse
  export guard) then holds a family bound iff it is absent here. A family re-enters this
  bucket when its contract is rewritten ahead of the engine: Wave 15.1 put `check` back
  (the vote flow, D32), unbinding it in the runner, and Wave 15.2 rebinds and drains it.
- `foreign.families`: a foreign consumer. Never bound to the engine, never removed.
  The coarse guard ignores this bucket, so the Wave 2.1a rebind that drains `families`
  and installs per-family checks never has to reason about the foreign set.

A family may appear in exactly one bucket; the runner rejects overlap. In the engine
runner's vitest summary, foreign cases show under a `[foreign: apps/web + iOS store]`
describe as explicit skips, so they stay visible rather than silently absent.

## Client-store cases

PROTOCOL.md §13 gives the client-store shape as prose, not JSON: "given sequenced
state plus an overlay plus an incoming message, assert the resulting overlay and
rendered cells." This encoding is defined here and is normative (as with navigation).
A case pins one transition of the store's reconciliation logic (PROTOCOL.md §6-§8;
DESIGN.md §10, INV-10), the duplicated web + iOS surface where drift is most expensive.

```json
{
  "name": "§6/§8: a cellSet carrying your commandId clears that overlay entry and applies the sequenced value (INV-10)",
  "given": {
    "seq": 12,
    "sync": "live",
    "cols": 5,
    "rows": 4,
    "blocks": [2, 6, 13],
    "cells": {},
    "overlay": [{ "commandId": "c9", "cell": 1, "value": "B" }]
  },
  "when": [
    {
      "source": "server",
      "type": "cellSet",
      "seq": 13,
      "cell": 1,
      "value": "B",
      "by": "u1",
      "commandId": "c9"
    }
  ],
  "then": {
    "seq": 13,
    "sync": "live",
    "overlay": [],
    "render": { "1": "B" },
    "send": []
  }
}
```

- `given` is the store state before the stimulus: `seq` (last applied sequence
  number), `sync` (below), the geometry (`cols`, `rows`, `blocks`), a sparse
  sequenced `cells` map (default empty), and `overlay`, an ordered array of pending
  `{ commandId, cell, value }`. Array order is send order (oldest first), so when
  several entries target one cell the last one is the most recently sent
  (PROTOCOL.md §8). `value` is `null` for a pending `clearCell`. An entry MAY carry
  `agedOut: true` (below).
- `sync` is the store's connection state, a token set defined here (PROTOCOL.md names
  the behaviors, not the states): `live` (applying events in order), `resyncing` (a
  gap was seen; `requestSync` sent; the next snapshot is applied wholesale and
  sequenced events are ignored until then, PROTOCOL.md §7), `reconnecting` (the socket
  closed after a fatal error or transport drop; backoff runs and the reconnect
  `welcome` snapshot reconciles, PROTOCOL.md §7, §11).
- `when` is the ordered stimulus. Each step is a flat object with `source: "local"`
  (the user acted, `type` is `placeLetter` or `clearCell`) or `source: "server"` (a
  frame arrived, `type` is `cellSet`, `error`, `sync`, or `welcome`); the wire message
  fields sit inline. A `sync`/`welcome` carries a `board` with `seq`, `status`, a
  sparse `cells` map, and `recentCommandIds`, and MAY carry `firstFillAt`. A `cellSet`
  step MAY carry `firstFillAt`, present only on the first fill (PROTOCOL.md §6).
- `then` is the store state after: `seq`, `sync`, the resulting `overlay` (send order),
  `render` (sparse map of cell index to the displayed value, string or `null`, the
  composite the user sees: sequenced `cells` painted with the overlay, most recently
  sent winning per cell), and `send`, the ordered outbound frames the store emitted
  (`requestSync`; a re-sent command; `[]` when none). A re-sent command reconstructs
  from the overlay entry's `value`: a string re-sends `placeLetter`, `null` re-sends
  `clearCell`. `then` MAY also carry `firstFillAt` (string or `null`), the store's
  derived timer origin; it is asserted only in cases that list it (the assertion rule).
- First-fill timing (PROTOCOL.md §6): the first fill's `cellSet` carries `firstFillAt`,
  so an already-connected store sets its timer origin from the delta, not only from a
  later snapshot. It is set once and a later `cellSet` without the field never moves it;
  a stale or redelivered frame does not re-apply it (the §7 seq gate); and a snapshot's
  `board.firstFillAt` agrees with the value the delta established.
- Overlay lifecycle (INV-10, PROTOCOL.md §8): a local command adds an entry and sends
  it; a `cellSet` echo (`commandId` match) clears it; a non-fatal `error` for that
  `commandId` clears it (the immortal-overlay case, the cell's true value is never
  masked); an unrelated echo or error leaves it untouched; a fatal `error` clears
  nothing but goes `reconnecting`, preserving the overlay so §8 can re-send it.
- Snapshot reconciliation runs identically for `sync`, `welcome`, and a crash-rollback
  snapshot (PROTOCOL.md §7, §8). Per still-pending command: if its `commandId` is in
  the snapshot's `recentCommandIds` it is confirmed and dropped (no re-send); else if
  live it is re-added and re-sent; else if `agedOut` it is dropped without re-send. A
  crash-rollback snapshot has `board.seq` lower than `given.seq`; the store MUST accept
  it and roll back (PROTOCOL.md §7, INV-5), never refuse.

These cases pin store semantics, not literal wire bytes. The stimuli are sparse: a
`cellSet` step lists only the fields the transition turns on, and a `sync`/`welcome`
`board` carries a sparse `cells` map. A conforming suite MAY expand a sparse stimulus
into a full, schema-valid frame (padding the cells array to `rows * cols`, filling
defaults) before decoding it through the real protocol codec, as the `apps/web` suite
does. What the family asserts is the resulting `overlay`, `render`, and `send`, so the
expansion is an implementation convenience and changes nothing normative.

Findings, unresolved and deliberately not baked in:

- `agedOut` is supplied as case input, not derived. PROTOCOL.md §8 and DESIGN.md §15
  say a pending command is re-sent if "still within the recent-command window (K)"
  and dropped if aged out, but they do not pin _how the client measures a pending
  command's age against K_ (by send-`seq`, by count, by wall clock, all unspecified).
  The vectors pin the outcome (aged-out drops, not re-sends) via an explicit flag, and
  leave the measurement for a PROTOCOL.md amendment rather than inventing it here.
- PROTOCOL.md §13 lists the incoming message as "`cellSet`, `sync`, or a crash-rollback
  snapshot," omitting `error`, yet the same sentence requires covering the
  immortal-overlay case, which is triggered by a non-fatal `error`. These vectors treat
  `error` as an in-scope stimulus; §13's enumeration should be widened.
- The `sync` token set and the fatal-error transition are defined here because
  PROTOCOL.md specifies the wire behaviors (gap, resync, reconnect, close) but not the
  store's named states. The fatal-error case asserts only what §8's re-send requirement
  forces (overlay preserved, nothing cleared by `commandId`), not a backoff schedule.
- The ~300 ms conflict flash (PROTOCOL.md §8, D02) is out of scope: it is ephemeral
  view animation keyed off a rendered-value change, not store state, and has no
  deterministic value to assert. The store exposes the data; the view animates.
- `gameCompleted`/`gameAbandoned` are left to the completion family and actor
  integration; the store applies them as ordinary sequenced events, with no overlay or
  reconciliation subtlety to pin here.

## Clue-runs cases

The clue-runs family pins the vendor-HTML-to-`{text, runs}` normalization (PROTOCOL.md
§12): the plain projection and the structured runs a clue string produces at ingestion.
It is foreign to the engine (its consumer is the clue-run parser and renderer in
`apps/web` and iOS); the engine runner shape-validates it but never executes it. Shape:

```json
{
  "name": "law 7: <i> maps to style \"i\"",
  "given": { "raw": "See <i>Rocky</i> for one" },
  "then": {
    "text": "See Rocky for one",
    "runs": [{ "t": "See " }, { "t": "Rocky", "s": ["i"] }, { "t": " for one" }]
  }
}
```

- `given.raw` is the raw clue string as the outlet delivered it, markup and entities
  intact.
- `then.text` is the canonical plain projection (PROTOCOL.md §12 law 6): tags parsed
  out, entities decoded, Unicode whitespace collapsed to single ASCII spaces, trimmed.
- `then.runs` is the minimal structured form and is **omitted when the whole clue is
  plain** (law 2), so a case whose `then` has only `text` asserts an unstyled clue.
  Each run is `{ t, s? }`: `t` is non-empty (law 3); `s`, when present, is a non-empty,
  duplicate-free style array over `"i"`, `"b"`, `"sub"`, `"sup"`, ordered `b`, `i`,
  `sub`, `sup` (laws 3, 4). Adjacent runs with equal style sets are merged (law 5).
- Cases cite the PROTOCOL.md §12 law they defend in their `name`, so coverage of the
  canonical-form laws is greppable, the way the other families cite their invariant.

The malformed-tag rule these vectors pin (PROTOCOL.md §12 law 12) is forgiving and
deterministic: an unclosed whitelist tag styles through the end of the string, and a
stray closing tag with no matching opener is dropped. Both shapes appear in
`malformed.json`.
