---
status: normative
verified: 133db08
---

# First-correct attribution

Status: plan of record. Date: 2026-07-12.
Companion: `ANALYSIS.md` (the wider post-game surface) references this projection; this
document owns the first-correct attribution model, its home, its wire, and its build order.

## Purpose

The post-game mosaic paints each solved cell in the color of the player who contributed
it. The contribution needs an owner per cell, and today the only per-cell attribution the
web store carries is last-writer: the board's `by` field, whoever wrote the cell last
(PROTOCOL section 4). Last-writer over-credits the closer. A player who runs a cleanup
pass, or who types the last letters of an already-solved word, ends up owning cells they
did not solve. It flatters the person at the keyboard when the grid completes and quietly
erases whoever placed the answer first.

First-correct attribution is truer. It credits whoever FIRST placed the correct value in a
cell, and it holds that credit immune to later churn: an overwrite, a clear, a re-correct
by someone else never moves the owner. The mosaic reads first-correct so the picture
matches what people did, not who happened to be typing at the freeze.

## The scheme

Ratified: scheme 1, "first-ever-correct." For each cell, the owner is the writer of the
earliest event (minimum `seq`) whose value satisfies the comparator for that cell. Once
assigned, the owner never changes. It survives the cell being cleared, overwritten, or
re-corrected by another player later in the log. The first correct placement is the whole
claim; everything after it is churn the projection ignores.

The rejected alternative was scheme 2, "first-correct-that-stuck": credit whoever began
the final unbroken correct run, the earliest correct write that is never later disturbed.
It was rejected because it quietly reintroduces last-writer's bias toward the closer. If a
cell is solved, cleared in a cleanup sweep, and re-solved by the sweeper, scheme 2 hands
the credit to the sweeper, which is exactly the distortion first-correct exists to remove.
Scheme 1 is the one that means what it says.

Correctness is decided by REUSING the engine's existing comparator, `matches(solution,
value)` in `packages/engine/src/comparator.ts`, never a hand-rolled equality. This keeps
attribution's notion of "correct" byte-identical to the live game and the completion check
(both already route through `matches`, see `packages/engine/src/completion.ts`), so a cell
that counted as correct for completion is exactly a cell that can be owned. It also
inherits the comparator's rebus first-char acceptance rule (D12) for free: a rebus cell is
owned by the first writer whose value matched under the same either-accept rule the live
game used, with no separate definition to keep in sync.

## Where it lives

**The projection is a pure engine function.** A new function in `packages/engine`:

```
firstCorrect(events, solution) -> ownerMap   // per-cell userId
```

It is the sibling of `reduce` and `applyWithCompletion`: same package, same purity, same
discipline. It imports nothing (INV-9 holds), it is deterministic (INV-1: identical event
sequences produce identical owner maps, across the TypeScript and Swift worlds), and it is
driven red-to-green by conformance vectors in `vectors/` before the code exists, exactly
like every other engine behavior.

Its output type carries only userIds, never solution values. `ownerMap` is a map from cell
index to the owning userId and nothing else. So INV-6 is satisfied STRUCTURALLY, by the
type, the same discipline `ClientPuzzle` uses, not by a runtime strip of solution content
from a richer object. A leak would be a compile error, not a missed step.

**The IO lives in a new Archive module in `apps/api`.** The API is the home for read
models (DESIGN section 7, the Archive context). The module:

- reads `cell_events` for the game (the API already holds the SELECT grant on
  `cell_events` from migration 0008, DESIGN section 9; this reads the full event stream,
  the fuller replay read that section records as the Archive module's planned expand),
- lifts the `Solution` out of the game's server-side snapshot (`games.puzzle_snapshot`
  already carries solutions, because the completion comparator needs them; no new solution
  access is minted),
- calls the engine reducer function `firstCorrect`,
- gates (below),
- and shapes the wire payload.

Layering points inward only: `apps/api` imports `packages/engine`, never the reverse.

## The wire

Two tiers, two safety profiles.

**Tier 1, the attribution owner map:** `{ [cell]: userId }`. Who solved each cell, not
what the answer is. It carries userIds only, so it is INV-6-safe by construction and
shippable to any viewer who can see a completed room. This is all the mosaic needs, and it
is the only tier this document ships.

**Tier 2, the value-bearing replay:** the future time-lapse of letters appearing over time.
That is a reconstructed solution: the letters, in order, are the answer. So it is gated
harder, to completed games AND participants, and it is out of scope for the mosaic. It is
named here only to fix the boundary: tier 1 never carries a value, and anything that does
is tier 2 and gated as tier 2.

Tier 1 is gated to completed games, and the reason is not only immutability (below). The
owner map for an ONGOING game leaks progress: which cells are already locked in a correct
answer is a solving assist, a heat map of what the room has finished. So the owner map ships
only for a game that is already done, where there is nothing left to assist.

## Gating and safety

The projection is a post-completion read. A completed game receives no further events: the
log is append-only, its status is terminal, and INV-4 freezes the board. So a completed
game's owner map is immutable. Compute it once, at any later time, and get the same map.
The gate (completed only) and the immutability are the same fact seen twice: the game is
done, so the input can never change, so the output can never change.

## Performance

**Compute** is a single O(events) pass that reuses `matches`. Walk the events in `seq`
order; the first event whose value matches its cell's solution claims that cell, and later
events for an owned cell are skipped. A 15x15 logs a few hundred to low-thousands of
events, so this is microseconds to low-single-digit milliseconds per game. It is cheaper
than the completion check the game already ran many times while live.

**The DB read** is a `(game_id, seq)` index range scan over `cell_events`, tens to
low-hundreds of KB for a full game. It MUST stay off the `GET /games` list path. That list
keeps its cheap `MAX(cell_events.at)` aggregate for activity ordering (PROTOCOL section 12)
and must not grow a full-stream scan per row. The owner map is a per-game, on-demand read
for the post-game surface, fetched when a viewer opens the mosaic, never in a list.

**Caching** follows from immutability: the owner map is write-once, never-invalidate.
Launch computes it on read. No new column, no new writer, no cache to invalidate, because
the input never changes after completion. Do NOT pre-build the cache. If the read ever
shows up hot in production, materialize it once as an API-owned artifact, since the API is
the single writer of its own tables and adding an API-owned artifact keeps INV-7 clean.
That is a later optimization gated on a measurement, not a launch task.

One reducer, many projections. The same `seq`-ordered replay of the event stream is where
momentum, last-holdout, and who-closed-each-word come from later. First-correct is the
first projection over that replay; the others reuse the same ordered walk. Surface the
attribution projection first and let the rest follow the same shape.

## Launch de-risk

The mosaic UI reads an abstract owner-map prop: cell index to userId, source unspecified.
This decouples shipping the SURFACE from shipping the TRUTH. Wire the prop to last-writer
(the client-side `by` already in the store) today, for zero backend, and the mosaic paints
immediately. Swap the source to the first-correct endpoint later, and the UI does not
change: same prop shape, truer data behind it. The surface ships before the projection, and
the projection lands without touching the surface.

## Build sequence

- **PR1** this doc.
- **PR2** vectors in `vectors/` for `firstCorrect` (data only, no implementation; the house
  rule that the spec is the failing test).
- **PR3** the mosaic component, wired to last-writer (`by`) through the abstract owner-map
  prop. Ships the surface with zero backend.
- **PR4** the engine `firstCorrect`, greened against PR2's vectors.
- **PR5** the API Archive module and the owner-map endpoint (read `cell_events`, lift the
  `Solution` from the snapshot, call `firstCorrect`, gate to completed games, shape the
  tier-1 payload).
- **PR6** swap the mosaic source from last-writer to the first-correct endpoint. No UI
  change, truer data.
