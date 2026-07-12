# Puzzle-digest vectors (skeleton, pending D23 ratification)

Status: **skeleton only, pending owner ratification of DESIGN.md D23.** These fixtures
are shape drafts for the puzzle-identity digest that duplicate detection on `POST /puzzles`
depends on (DESIGN.md D23). They are registered nowhere, run by no CI runner, and pin no
behavior yet. They exist so the follow-up implementation PR adopts a canon that was written
before the code, the house rule (CLAUDE.md, PROTOCOL.md section 13). Do not treat a value
here as normative until D23 is adopted and a runner is wired.

Precedence when sources disagree, once these are live: these vectors, then PROTOCOL.md,
then any implementation.

## Why a separate family, not under `v1/`

`vectors/v1/` is the protocol-version-1 engine and client-store suite, a closed registry
whose runners throw on an unrecognized family. The puzzle digest is not an engine or
client-store behavior: it is a server-only canonicalization the API computes at ingest, and
its input (the solution grid) never crosses the wire (INV-6). It gets its own top-level
family so it never touches the `v1/` runners and so a server-side runner can adopt it
without editing the `v1/` enum. This mirrors `vectors/live-activity/`.

**INV-6 note.** The digest is derived from the solution and is itself an oracle: two inputs
hashing equal reveals the puzzles are the same. The digest, and every solution-bearing field
in these fixtures, is server-only. A vector here MAY carry a `solution` grid because the
vectors tree is repo-and-server-only and never shipped to a client; nothing in this family
is ever placed on a client-facing payload. The wire-visible surface of dedup is only the
`POST /puzzles` response (PROTOCOL.md section 12), which carries no digest.

## Layout (planned)

```
vectors/
  puzzle-digest/
    canon.json        the canonical byte-string a ServerPuzzle reduces to, per case
    digest.json       the canonical string plus its expected digest (hash), per case
    equivalence.json  pairs of ServerPuzzles that MUST or MUST NOT share a digest
```

One JSON file per cluster, kebab-case, a bare array of cases, UTF-8, prettier-formatted
(matches `v1/` and `live-activity/`).

## What the digest is over (draft, D23 owns the final list)

The canon is a deterministic byte-string built from the **stable, solution-bearing identity**
of a puzzle and nothing that varies with the source outlet or a later ingest-pipeline change:

- `rows`, `cols`
- `blocks`: the sorted black-square cell-index set
- `solution`: the per-cell answer array, each cell ASCII-uppercased (INV-1), a black square
  encoded as a fixed sentinel, in row-major cell order

Deliberately **excluded** from the canon, each with a reason:

- **clue text / `runs`**: entity and markup variance across outlets, and the landing
  clue-runs wave (which reprojects `text` from structured `runs`), would split two ingests of
  the same daily puzzle. Numbering is grid-derived, never trusted from the document
  (`nyt.ts`, `guardian.ts`), so it adds no identity the geometry does not already carry.
- **circles / shadedCircles**: a visual overlay, not the solve. Two ingests of one puzzle
  that disagree on circle detection are still the same puzzle; excluding circles keeps them
  one row. (Open for D23: whether a circle-bearing variant is a distinct enough artifact to
  key on. The draft says no.)
- **title / author**: display metadata, outlet-specific, not identity.
- **source.format**: the whole point is that the same puzzle via `nyt` and via a later `.puz`
  upload collapses to one digest.

## Case shapes (draft)

`canon.json`, a case pins the canonical string a ServerPuzzle reduces to:

```json
{
  "name": "3x3 open grid, no rebus",
  "puzzle": {
    "rows": 3,
    "cols": 3,
    "blocks": [],
    "solution": ["C", "A", "T", "A", "R", "E", "T", "E", "A"]
  },
  "canon": "3x3|blocks:|sol:CAT|ARE|TEA"
}
```

The `canon` string here is illustrative, not the pinned format; D23 and the first
implementation fix the exact separator grammar, and this file becomes its golden.

`digest.json`, the canonical string plus its digest:

```json
{
  "name": "3x3 open grid digest is stable",
  "canon": "3x3|blocks:|sol:CAT|ARE|TEA",
  "algorithm": "sha256",
  "digest": "<hex, filled at implementation>"
}
```

`equivalence.json`, pairs that MUST or MUST NOT collapse:

```json
{
  "name": "same grid, different clue prose, one digest",
  "a": {
    "rows": 3,
    "cols": 3,
    "blocks": [],
    "solution": ["C", "A", "T", "A", "R", "E", "T", "E", "A"],
    "clues": {
      "across": [{ "number": 1, "text": "Feline", "cellIndices": [0, 1, 2] }]
    }
  },
  "b": {
    "rows": 3,
    "cols": 3,
    "blocks": [],
    "solution": ["C", "A", "T", "A", "R", "E", "T", "E", "A"],
    "clues": {
      "across": [
        {
          "number": 1,
          "text": "House pet, informally",
          "cellIndices": [0, 1, 2]
        }
      ]
    }
  },
  "sameDigest": true
}
```

```json
{
  "name": "one letter differs, distinct digest",
  "a": {
    "rows": 3,
    "cols": 3,
    "blocks": [],
    "solution": ["C", "A", "T", "A", "R", "E", "T", "E", "A"]
  },
  "b": {
    "rows": 3,
    "cols": 3,
    "blocks": [],
    "solution": ["B", "A", "T", "A", "R", "E", "T", "E", "A"]
  },
  "sameDigest": false
}
```

Cases to cover once live: rebus cells (a multi-character solution), lowercase input folding
to the same digest (INV-1, ASCII-only, so `İ`/`ı` never fold), a block-set reorder producing
an identical digest (blocks are a sorted set), and a transposed grid producing a distinct
digest (`rows`/`cols` are in the canon).
