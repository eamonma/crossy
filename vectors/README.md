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
    client-store/
```

- One JSON file per behavior cluster, kebab-case basename, `.json` extension. Each
  file is a bare JSON array of cases, UTF-8, prettier-formatted.
- The directory name is the family. Runners MUST fail on a family they do not
  recognize; skipping silently is forbidden. All five families from PROTOCOL.md §13
  are registered. `client-store` is a _foreign_ family (see below): the engine runner
  discovers and shape-validates it but never executes it.
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
here and is normative:

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
- `given.fills` (sparse map, cell index to string) is reserved for the planned
  additions that depend on fill state; omitted means every playable cell is empty.
- The empty grid (seed case 9) is `"cols": 0, "rows": 0, "blocks": []`.
- Seed case names keep the PROTOCOL.md table numbering: `seed N: <scenario>`.

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

## Foreign families

Most families bind to `packages/engine`. `client-store` does not: its consumer is the
web client's store (Wave 2.1d) and later the iOS store, never the engine. So the
engine runner treats it as _foreign_ — it discovers and shape-validates the cases
(hard passes, no silent skip, no unknown-family failure) but never executes them.
Execution lives in `apps/web`'s and the iOS suites, which import the same JSON files.

The mechanism is `packages/engine/vectors.skip.json`. It has two disjoint buckets:

- `families`: skipped-until-engine. Wave 2.1a binds each to an engine entry point and
  removes it from the list; the runner's coarse "engine has exports while families are
  skipped" guard fails the moment the engine ships, forcing the rebind.
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
  sparse `cells` map, and `recentCommandIds`.
- `then` is the store state after: `seq`, `sync`, the resulting `overlay` (send order),
  `render` (sparse map of cell index to the displayed value, string or `null` — the
  composite the user sees: sequenced `cells` painted with the overlay, most recently
  sent winning per cell), and `send`, the ordered outbound frames the store emitted
  (`requestSync`; a re-sent command; `[]` when none). A re-sent command reconstructs
  from the overlay entry's `value`: a string re-sends `placeLetter`, `null` re-sends
  `clearCell`.
- Overlay lifecycle (INV-10, PROTOCOL.md §8): a local command adds an entry and sends
  it; a `cellSet` echo (`commandId` match) clears it; a non-fatal `error` for that
  `commandId` clears it (the immortal-overlay case — the cell's true value is never
  masked); an unrelated echo or error leaves it untouched; a fatal `error` clears
  nothing but goes `reconnecting`, preserving the overlay so §8 can re-send it.
- Snapshot reconciliation runs identically for `sync`, `welcome`, and a crash-rollback
  snapshot (PROTOCOL.md §7, §8). Per still-pending command: if its `commandId` is in
  the snapshot's `recentCommandIds` it is confirmed and dropped (no re-send); else if
  live it is re-added and re-sent; else if `agedOut` it is dropped without re-send. A
  crash-rollback snapshot has `board.seq` lower than `given.seq`; the store MUST accept
  it and roll back (PROTOCOL.md §7, INV-5), never refuse.

Findings, unresolved and deliberately not baked in:

- `agedOut` is supplied as case input, not derived. PROTOCOL.md §8 and DESIGN.md §15
  say a pending command is re-sent if "still within the recent-command window (K)"
  and dropped if aged out, but they do not pin _how the client measures a pending
  command's age against K_ (by send-`seq`, by count, by wall clock — all unspecified).
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
