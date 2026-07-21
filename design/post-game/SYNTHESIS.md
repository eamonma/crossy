# The post-game surface: one thing, not three

Status: design synthesis, for a forked conversation to own. Not a design doc, not for merge.
Written 2026-07-12 while three overnight review artifacts were open. Read this, then the three
PRs it ties together.

## The claim

Three open artifacts look like separate features and are not:

- **PR #162** post-game mosaic: the completion moment and the surface it settles into.
- **PR #168** party-mode terminal moment: what the projector does when the puzzle completes.
- **PR #161** post-game retrospective: the chess.com/Lichess-style idea space (51 ideas).

They are three views of a single surface: **the room after the last correct cell.** Designed
apart, they become three grammars that do not rhyme (a web moment, a projector moment, and a
stats page that each invented their own language). Designed together, they are one object seen
from three distances. The mosaic is the object; the rest is viewport and time-depth.

## The model: one surface, three viewports, three time-depths

**Viewports** (who is looking):

- **Solo web** — one person returns to a room they finished. Quiet, personal, revisitable.
- **Group web** — the room's members, each on their own screen, at completion.
- **Projector / party (#168)** — a crowd watching one shared screen, not operating it. Text
  must read across a room; nobody is holding a mouse.

**Time-depths** (how long after the last cell):

- **The moment** — the seconds after completion. Confetti (retuned, #167), a wash, the board
  settling. This is #168's whole scope and #162's first beat.
- **The settled artifact** — the room you reopen later. It is the mosaic: the solved grid
  tinted by who filled what. This is #162 direction A's "settled" state, and the trophy card
  (#162-B, the plate) is its shareable export.
- **The deep retrospective** — the replay, the stories, the stats. This is #161's idea space.
  It hangs off the settled artifact; the mosaic is its home screen.

**The spine that is constant across all nine cells of that matrix: the contribution mosaic.**
Every viewport and every depth shows the same object, the solved grid colored by attribution.
The moment is the mosaic arriving; the settled artifact is the mosaic at rest; the retrospective
is the mosaic you can scrub and interrogate. Confetti and the wash are a layer on the moment;
the ledger, the replay, and the stories are layers on the depth. Get the mosaic right once and
all three PRs inherit it.

## What each open PR becomes under this model

- **#162 (mosaic)** is the load-bearing one: it defines the settled artifact and the moment's
  board treatment. Direction A ("the board becomes the mosaic") is the home the other two plug
  into. Ship it first. Its found bug is the seam: `dismissedCompletion` is local `useState`, so
  reopening a completed room replays the whole celebration every visit. That bug is exactly the
  missing distinction between "the moment" (fires once) and "the settled artifact" (what you
  return to). Fixing it is step one of building the surface, not a side quest.
- **#168 (party)** is the projector viewport of the moment. "The Seal" (board stays hero, one
  gold wash, the rail seals into the shipped grammar) is the projector-scaled version of #162-A's
  moment. Build it on #162-A's scaffolding, not beside it. "The Curtain" (roll call of who solved
  which share) is a retrospective element (a team-dynamics stat) surfaced at the moment, so it is
  gated on the same per-solver data #161 needs.
- **#161 (retrospective)** is the deep time-depth. It is not a separate page to design from
  scratch; it is what grows inside #162-A's deliberately-reserved room. The mosaic is its home
  screen, the replay is its spine, the stories are cards that hang off it.

## The best of #161, cut editorially and mapped to the depths

The agent's raw top-8 is in #161. This is my sharper cut for _this_ product, whose whole
differentiator is that the room is a team (NYT gives solo stats; chess analyzes one player vs
another; cooperative crossword analytics is open ground).

**The spine (must-haves, all ship on today's data):**

- **The contribution mosaic** (#161 idea 8). The identity artifact and the trophy. It is
  already #162. Toggle last-writer vs first-correct: the closer vs the pioneer, two different
  stories from one object.
- **The last holdout** (idea 22). Every game has a final square: how long it stood, what framed
  it, who cracked it. A guaranteed story in 100% of games at trivial cost. The natural closing
  beat.
- **The mosaic-melt reveal** (idea 46). The recap does not open on a dashboard; the solved board
  flips cell by cell from letters to writer colors in solve order, with an accelerating haptic
  tick on iOS. This is the connective tissue: it is _how the moment becomes the artifact_, the
  single animation that unifies all three PRs.

**The differentiators (uniquely Crossy, worth the most):**

- **The assist graph** (idea 13). Who unblocked whom: A fills a crossing letter, B completes the
  stalled word, edge A to B. The one genuinely novel cooperative stat; chess and NYT cannot
  compute it. This is the reason the surface is worth building at all.
- **The time-lapse replay** (idea 1). The grid filling itself in each writer's color. The
  rewatchable substrate, and literally #162 direction C's "replay seed." Gated on the event-log
  read model (see data spine).

**The tasteful drama (with the guardrail):**

- **Badged moments** (idea 27), positive-first: the save (`!!`), the leap of faith (a long
  answer entered with few crossings). Handle the negative badge (the confident-wrong fill that
  poisoned crossings) with care or not at all at launch.
- **Archetype titles** (idea 10): one earned, all-positive title per player (The Pioneer, The
  Closer, The Fixer). Screenshot bait that compares nobody.

**Kill or defer:**

- **Solver rating, Glicko-style** (idea 35). Kill it, or make it room-vs-its-own-past or
  private-to-self only. A visible per-person skill rating turns a living room into a ladder and
  makes the weakest solver's contribution read as a cost. This is the toxicity line: **moments
  may be judged, people may not be scored against each other.**
- **Momentum graph** (idea 24). Fine, but the most cargo-culted-from-chess.com item on the list.
  Medium priority, not the soul.

## The shared data spine (the real gating dependency)

Everything above is a server-computed projection of `cell_events` (the full per-cell attribution
log: who wrote what, where, when, in server order; DESIGN §9, D16 kept it for exactly this). The
server holds the solution; clients never do (INV-6), so every correctness-derived stat (wrongness
over time, saves, poison fills) is computed server-side and shipped as derived data.

- **Ships on today's wire:** the contribution mosaic. The web store already carries last-writer
  per cell (`cellsValue` `{v, by}`, PROTOCOL §4/§6), rebuilt on any reconnect into a completed
  room. So #162-A's mosaic needs no protocol work.
- **Needs a new read model (the Archive, D16):** the ordered replay (#161 idea 1, #162-C), per-cell
  `seq`/`at`, and any per-solver contribution stat (#168's Curtain, the assist graph, the stat
  lines). This is the one dependency that gates the deep retrospective and the richer party moment.
- **Needs new capture (ephemeral today, D20):** cursor traces, the check-request log, presence
  log, spectator reactions. Persisting cursors especially is a real decision (it records where
  people looked, not just what they did).

An INV-6 subtlety that shapes scope: post-completion replay and wrongness masks leak nothing (the
members saw every event live, and the final board equals the solution). But any wrongness signal
on an _abandoned_ game leaks solution bits. So wrongness-bearing projections are completed-games-only
unless ruled otherwise.

## The decisions to make before this is a design doc

Merged from #161's five questions, #162's decision points, and #168's direction pick:

1. **The attribution law.** First-correct, last-writer, or both with a toggle? When a save
   happens, is the original (wrong) writer named or anonymous? This one ruling shapes the mosaic,
   every stat line, and every award.
2. **Where exactly is the negativity line?** Are per-person error counts ever shown, even inside
   the room, even for one game? Does a rating exist in any form? Rule once and every #161 idea
   passes or dies cleanly.
3. **Do abandoned games get a recap?** (The INV-6 constraint above forces a choice: none, a
   wrongness-free recap, or reveal-nothing-until-completed.)
4. **Is the surface a shared live moment or a private artifact?** Synchronized choreography (the
   melt landing on every screen at once) and self-paced solo scroll pull in different directions;
   the first design budget goes to one.
5. **The settled-state treatment (#162).** Permanent low-tint memory vs settle-to-ink; plate as
   default vs export; a mosaic thumbnail on the home list (the one home item needing wire work).
6. **The party direction (#168).** The Seal now (recommended, no data risk), the Curtain once the
   per-solver read model lands, the Takeover shelved.

## Suggested sequencing for the fork

1. Fix the `dismissedCompletion` bug by building the moment/settled split (#162-A). This is the
   surface's skeleton and is worth doing regardless of how far the retrospective goes.
2. Ship the mosaic as the settled artifact (today's data) + the retuned confetti (#167) as the
   moment.
3. Add the mosaic-melt reveal (#161 idea 46) as the moment-to-artifact transition. Now the web
   surface exists end to end on today's data.
4. Scale the moment to the projector: #168 The Seal.
5. Land the Archive read model (event log, per-cell seq/at, per-solver contribution). This unlocks
   the deep retrospective and the richer party moment together.
6. Grow the retrospective inside the reserved room: last holdout, then the assist graph, then the
   replay, then badges/titles. Answer decision 2 before any of the drama layer ships.

## Pointers

- #162 `design/postgame-mosaic/OPTIONS.md` — the mosaic directions and the `cellsValue` finding.
- #168 `design/celebration/PARTY-OPTIONS.md` — the three projector directions.
- #161 `design/postgame-retrospective/IDEAS.md` — the full 51, the toxicity section, the questions.
- #167 — the confetti retune (the moment layer's particle work).
- DESIGN §9 / D16 — `cell_events` and the planned Archive read model this all depends on.
