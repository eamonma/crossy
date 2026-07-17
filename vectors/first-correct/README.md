---
status: normative
---

# First-correct attribution vectors

Status: **data-only, ahead of the engine.** These fixtures pin a NEW engine projection,
`firstCorrect`, before it is implemented. Vectors are written before implementations
(CLAUDE.md, PROTOCOL.md section 13). The consuming test and the engine function land in a
later PR; nothing globs this directory yet.

Precedence when sources disagree: these vectors, then PROTOCOL.md, then any implementation.

## The projection

`firstCorrect(events, solution) -> ownerMap`

- `events`: ordered by `seq` ascending. Each is `{ seq, cell, userId, value }`. `value` is
  an uppercase ASCII token matching `^[A-Z0-9]{1,10}$`, or `null` for a clear.
- `solution`: the correct value per white cell, the engine's `Solution` shape as data
  (pairs of `[cell, expected]`). Block cells are absent.
- Correctness predicate: a cell's event is correct iff it satisfies the engine comparator
  `matches(solution[cell], value)` (`packages/engine/src/comparator.ts`). The comparator is
  ASCII-case-insensitive (INV-1) and accepts a rebus solution's FIRST CHARACTER, so
  `matches("STAR", "S")` is true. The vectors never invent equality; they are consistent
  with `matches`.
- `ownerMap`: for each cell that ever received a correct value, the `userId` of the writer
  of the FIRST (min `seq`) matching event. **Scheme 1, first-ever-correct**: once assigned,
  the owner NEVER changes, whatever later clears, overwrites, or re-corrections occur, by
  anyone. This is the case `cleanup-pass-immunity` pins against a scheme-2 (last-correct)
  reading.
- A cell that never receives a correct value is ABSENT from the map. A clear (`value: null`)
  is never correct. Block cells never appear.

## Why a separate family, not under `v1/`

`vectors/v1/` is the protocol-version-1 engine and client-store suite, a closed registry
whose runner throws on an unrecognized family. `firstCorrect` is a not-yet-implemented
engine projection: adding it to `v1/` today would make the runner try to execute it against
a function that does not exist. This family sits at the top level so the `v1/` runner never
globs it. A future PR that implements `firstCorrect` adopts these files with a narrow reader
(`resolve(here, "../../../vectors/first-correct")`), the same shape the puzzle-digest and
client-store readers already use. This mirrors `vectors/puzzle-digest/` and
`vectors/live-activity/`.

## INV-6

`then.owners` carries `userId`s only, never a solution value. The projection is defined so a
cell's expected letter never appears in its output; the map's values are attribution, not
answers. `given.solution` MAY carry the answer grid because the vectors tree is repo-and-
server-only and never shipped to a client (as `vectors/puzzle-digest/README.md` notes for
its own solution grids); nothing in this family is ever placed on a client-facing payload.

## Layout

```
vectors/
  first-correct/
    baseline.json               distinct writers, one correct write each
    cleanup-pass-immunity.json  scheme 1: A correct, B clears, C re-corrects; owner stays A
    wrong-then-right.json       a wrong guess earns no credit; the first CORRECT writer owns
    correct-overwritten.json    a same-correct overwrite never moves an assigned owner
    rebus-first-char.json       comparator first-char acceptance owns the cell (INV-1)
    never-correct.json          a cell only ever wrong is absent from the map
    empty.json                  no events yields an empty map
```

One JSON file per cluster, kebab-case, a bare array of cases, UTF-8, prettier-formatted
(matches `v1/`, `puzzle-digest/`, and `live-activity/`).

## Case shape

```json
{
  "name": "one correct write per cell, each by a distinct user, owns that cell",
  "intent": "Scheme 1 first-ever-correct: the FIRST matching writer owns the cell; owners are userIds only (INV-6).",
  "given": {
    "solution": [
      [0, "A"],
      [1, "B"]
    ],
    "events": [
      { "seq": 1, "cell": 0, "userId": "u1", "value": "A" },
      { "seq": 2, "cell": 1, "userId": "u2", "value": "B" }
    ]
  },
  "then": {
    "owners": { "0": "u1", "1": "u2" }
  }
}
```

- `given.solution` is an ordered array of `[cell, expected]` pairs, deserializing directly
  into the engine's `Solution` (`Map<number, string>`). Block cells are absent.
- `given.events` is ordered by `seq` ascending. `value` is an `^[A-Z0-9]{1,10}$` token or
  `null` for a clear.
- `then.owners` is a sparse map of decimal cell index to the owning `userId` (assertion rule,
  `vectors/README.md`). A cell that never went correct is absent. The values are `userId`s
  only, never a solution letter (INV-6).
