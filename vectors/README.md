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
```

- One JSON file per behavior cluster, kebab-case basename, `.json` extension. Each
  file is a bare JSON array of cases, UTF-8, prettier-formatted.
- The directory name is the family. Runners MUST fail on a family they do not
  recognize; skipping silently is forbidden. The remaining families from
  PROTOCOL.md §13 (completion matrix, client store) register here when their waves
  land.
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
