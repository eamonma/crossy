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

Governing principle (owner ruling 2026-07-12): **a false positive costs far more than a false
negative.** A duplicate copy is harmless clutter; wrongly collapsing two different puzzles is a
lost puzzle. So the canon is the **strict** end of the dial: it hashes the whole translated
`ServerPuzzle` object, and only an every-field match dedups. The cost is accepted false
negatives (the same puzzle from two outlets, or across a normalization change, may hash apart
into two rows).

The canon is a deterministic byte-string over every field the object carries:

- `rows`, `cols`
- `blocks`: the sorted black-square cell-index set
- `circles`, `shadedCircles`: sorted cell-index sets (included: a circle overlay is part of
  what the puzzle is; two ingests that disagree on it are, by the strict principle, two rows)
- `solution`: the per-cell answer array, each cell ASCII-uppercased (INV-1), a black square
  encoded as a fixed sentinel, in row-major cell order
- `clues`: in grid-derived order, each clue's normalized plain `text`. Text is the canonical
  projection and is stable across the clue-runs wave (adding `runs` never changes `text`), so
  `runs` never enters the hash. Numbering is grid-derived, never trusted from the document
  (`nyt.ts`, `guardian.ts`).

Deliberately **excluded**, each with a reason:

- **`runs`**: a derived restyling of `text`; hashing `text` already captures the clue prose,
  and hashing `runs` would make the digest depend on a representation detail.
- **title / author**: display metadata, outlet-specific, not the puzzle itself. (Open for
  D23: a strict reading could include them; the draft leaves them out because a byline is not
  content and two outlets of one puzzle disagree on it constantly.)
- **source.format**: the whole point is that the same puzzle via `nyt` and via a later `.puz`
  upload can still collapse to one digest.

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
  "name": "same grid, DIFFERENT clue prose, distinct digest (strict: clue text is in the hash)",
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
  "sameDigest": false
}
```

A `MUST` collapse pair (`sameDigest: true`) is now a re-ingest of the identical document:
same geometry, same solution, and byte-identical normalized clue text. The `runs` field may
differ between the two (one carries styling, one does not) yet they still collapse, because
`runs` is excluded and only the plain `text` projection is hashed.

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
