---
status: normative
---

# Puzzle-digest vectors

Status: **ratified (DESIGN.md D23, owner 2026-07-12) and live.** These fixtures pin the
puzzle-identity digest that duplicate detection on `POST /puzzles` depends on. They are the
golden the API's one digest function (`apps/api/src/puzzles/digest.ts`) is run against
(`digest.test.ts`); they were written before that code, the house rule (CLAUDE.md,
PROTOCOL.md section 13).

Precedence when sources disagree: these vectors, then PROTOCOL.md, then any implementation.

## Why a separate family, not under `v1/`

`vectors/v1/` is the protocol-version-1 engine and client-store suite, a closed registry
whose runners throw on an unrecognized family. The puzzle digest is not an engine or
client-store behavior: it is a server-only canonicalization the API computes at ingest, and
its input (the solution grid) never crosses the wire (INV-6). It gets its own top-level
family so it never touches the `v1/` runners and a server-side runner adopts it without
editing the `v1/` enum. This mirrors `vectors/live-activity/`.

**INV-6 note.** The digest is derived from the solution and is itself an oracle: two inputs
hashing equal reveals the puzzles are the same. The digest, and every solution-bearing field
in these fixtures, is server-only. A vector here MAY carry a `solution` grid because the
vectors tree is repo-and-server-only and never shipped to a client; nothing in this family
is ever placed on a client-facing payload. The wire-visible surface of dedup is only the
`POST /puzzles` response (PROTOCOL.md section 12), which carries no digest.

## Layout

```
vectors/
  puzzle-digest/
    canon.json        the exact canonical string a ServerPuzzle reduces to, per case
    digest.json       a canonical string and its expected sha256 hex, per case
    equivalence.json  pairs of ServerPuzzles that MUST or MUST NOT share a digest
```

One JSON file per cluster, kebab-case, a bare array of cases, UTF-8, prettier-formatted
(matches `v1/` and `live-activity/`). The digest of a puzzle is `sha256hex(canon(puzzle))`,
so `canon.json` and `digest.json` compose to `equivalence.json`: each file pins one layer.

## What the digest is over

Governing principle (owner ruling 2026-07-12): **a false positive costs far more than a false
negative.** A duplicate copy is harmless clutter; wrongly collapsing two different puzzles is a
lost puzzle. So the canon is the **strict** end of the dial: it hashes the whole translated
`ServerPuzzle` object, and only an every-field match dedups. The cost is accepted false
negatives (the same puzzle from two outlets, or across a normalization change, may hash apart
into two rows), which the principle spends deliberately.

The canon is over every field the object carries:

- `rows`, `cols`
- `blocks`: the black-square cell-index set, sorted ascending
- `circles`, `shadedCircles`: cell-index sets, sorted ascending (included: a circle overlay is
  part of what the puzzle is; two ingests that disagree on it are, by the strict principle,
  two rows)
- `solution`: the per-cell answer array, each cell ASCII-uppercased (INV-1), a black square a
  fixed sentinel, in row-major cell order
- `clues`: across then down, each ascending by `number`, carrying each clue's normalized plain
  `text`. Text is the canonical projection and is stable across the clue-runs wave (adding
  `runs` never changes `text`), so `runs` never enters the hash. Numbering is grid-derived,
  never trusted from the document (`nyt.ts`, `guardian.ts`).

Deliberately **excluded**, each with a reason:

- **`runs`**: a derived restyling of `text`; hashing `text` already captures the clue prose,
  and hashing `runs` would make the digest depend on a representation detail.
- **title / author**: display metadata, outlet-specific, not the puzzle itself, and not a field
  of `ServerPuzzle`. Including them would also worsen false negatives (the NYT naming pass
  synthesizes a title at ingest, so the same daily can carry an empty vs a synthesized title).
- **source.format**: the whole point is that the same puzzle via `nyt` and via a later `.puz`
  upload still collapses to one digest.

## The canon grammar (`crossy-puzzle-digest/v1`)

A UTF-8 string, lines joined by `\n` (LF), **no trailing newline**. Line order is fixed:

```
crossy-puzzle-digest/v1
dims=<rows>x<cols>
blocks=<sorted-ascending, comma-separated cell indices; empty string when none>
circles=<same>
shaded=<same>
solution=<cell0>|<cell1>|...|<cellN-1>
clue=<A|D>:<number>:<text>          (zero or more lines; see below)
```

- The version tag `crossy-puzzle-digest/v1` is line 1, so a future grammar change is a new
  tag, not a silent digest shift.
- `solution` cells are joined by `|`. A black square (`null`) is the sentinel `#`. A cell's
  answer is ASCII-uppercased; a rebus keeps its whole multi-character string. The separators
  `|` and `#` are disjoint from the `A-Z0-9` solution charset, so no cell can forge one.
- Each clue is one line: `clue=`, then axis (`A` across, `D` down), `:`, the number, `:`, then
  the text. Across clues first (ascending `number`), then down (ascending `number`). Only the
  first two colons are structural, so a `:` inside the text is safe. Normalized clue text has
  no newline (whitespace is collapsed to single ASCII spaces at ingest), so a clue never spans
  two lines and never forges a header line.

The digest is `sha256` of the UTF-8 bytes of this string, lowercase hex.

## Case shapes

`canon.json`, a case pins the exact canonical string a ServerPuzzle reduces to:

```json
{
  "name": "3x3 open grid, no clues, reduces to its canonical string",
  "puzzle": {
    "rows": 3,
    "cols": 3,
    "blocks": [],
    "solution": ["C", "A", "T", "A", "R", "E", "T", "E", "A"]
  },
  "canon": "crossy-puzzle-digest/v1\ndims=3x3\nblocks=\ncircles=\nshaded=\nsolution=C|A|T|A|R|E|T|E|A"
}
```

`digest.json`, a canonical string and its sha256:

```json
{
  "name": "3x3 open grid canonical string hashes to a stable sha256",
  "canon": "crossy-puzzle-digest/v1\ndims=3x3\nblocks=\ncircles=\nshaded=\nsolution=C|A|T|A|R|E|T|E|A",
  "algorithm": "sha256",
  "digest": "19bee53524490ca260dc17c879ee7eaf423b917267c311755343e010474ae3ce"
}
```

`equivalence.json`, pairs and whether they MUST (`true`) or MUST NOT (`false`) collapse:

```json
{
  "name": "same grid, DIFFERENT clue prose, DISTINCT digest (clue text is in the hash)",
  "a": { "...": "solution C|A|T..., clue 'Feline'" },
  "b": { "...": "solution C|A|T..., clue 'House pet, informally'" },
  "sameDigest": false
}
```

The suite covers: clue prose difference (distinct, strict), circle difference (distinct),
a byte-identical re-ingest where only `runs` differs (same, `runs` excluded), lowercase
folding (same, INV-1 ASCII-only, so `İ`/`ı` never fold), a block-set reorder (same, sorted
set), a single-letter change (distinct), and a transposed grid (distinct, `rows`/`cols` in
the canon).
