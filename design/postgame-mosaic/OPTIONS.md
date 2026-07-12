# Web post-game mosaic: design options

Review artifact. Two beats, three directions, one recommendation. The mosaic is the
solved grid rendered as a per-cell attribution map: who filled what, each solver a color.
This document covers both the completion moment (the seconds after the last correct cell)
and the settled surface (what the room is when you reopen it later).

## Where web stands today

iOS already has the grammar (EXPERIENCE.md §7, `CompletionMoment.swift`): on the store's
transition to completed, every letter tints to its writer's color, holds a breath, and
settles back to ink. Tint, hold, settle. The web has none of it. The web completion today
(`Completion.tsx`) is a roster-colored confetti drift plus a summary card (Time, Solvers,
Entries). The board underneath stays plain ink. There is no mosaic and no distinct settled
state.

Worse for the nonephemeral ask: `dismissedCompletion` is local `useState`, not persisted.
Reopen a completed room and `status === "completed"` is true with `dismissedCompletion`
false, so **the whole celebration replays, confetti and all, every time you return.** The
moment and the revisit are the same object today, and the revisit re-celebrates a solve
that finished weeks ago. That is the real gap these directions close.

## What the wire actually carries (verified)

The web store already knows per-cell attribution. `GameStore.cellsValue` is a
`Map<number, Cell>` where `Cell = { v: string | null, by: string }`. The `by` is the
userId of the cell's last writer or clearer (PROTOCOL.md §4, §6). It arrives two ways:

- **In every board snapshot** (`welcome`, `sync`): `cells: [{v, by}, ...]`, one entry per
  cell (PROTOCOL.md §4). A reconnect into a completed room gets the full attributed board.
- **In every live `cellSet`**: `{cell, value, by, ...}` (PROTOCOL.md §6).

Participants carry `color`, `displayName`, `role`, `avatarUrl`. Completion `stats` carry
`solveTimeSeconds`, `totalEvents`, `participantCount`. Roster colors are the real palette
already on the wire and mirrored in the demo: indigo `#3e63dd` (self), red `#e5484d`, teal
`#12a594`, amber `#ffb224`, violet `#8e4ec6`.

**So the attribution mosaic ships on today's data.** The same `by` iOS mosaics from is
already in the web store, populated on the completion snapshot and on reconnect.

**What is NOT on the wire today:**

- **Fill order and per-cell timestamps.** The snapshot is last-writer-per-cell only. There
  is no "cell A before cell B" and no per-cell `at`. An _ordered replay_ (Direction C)
  needs the event log exposed to the client, an Archive read model (DESIGN.md §9, D16).
- **A completed room's mosaic on the home list.** `GET /games` carries `mask` (the
  black-square silhouette), `completedAt`, `memberCount`, `puzzle.title`, and no board.
  A **home-card thumbnail** painted with attribution would need a new INV-6-safe
  projection (attribution is not solution content, so it is addable, but it is wire work).
  Reopening the room does not need this: the WS snapshot rebuilds the mosaic in full.

Everything below is designed within today's data unless tagged **NEEDS PROTOCOL WORK**.

---

## Direction A: the board becomes the mosaic

The web parity beat, evolved. This is the closest sibling to iOS and the lowest-risk path.

**The moment** (`A-moment.png`). On the last correct cell the timer freezes and the board
holds at full attribution tint: every letter washed in its writer's roster color, the
same wash iOS uses (a tint under the glyph, never a slab). The existing confetti drift
plays over it in the room's colors. The summary card morphs up from the frozen timer and
speaks the panel language it already speaks, now with one addition: a **"Who filled what"**
ledger under the stat row, the roster ordered by contribution with a color bar each. The
mosaic answers the question the confetti raises (who did this?) instead of just cheering.

**The settled surface** (`A-settled.png`). Reopen the room later and there is no confetti
and no card thrown at you. The board sits calm but keeps a **quiet memory of the mosaic**:
the attribution wash at about a third strength, so the board reads as a normal solved board
first and an attribution map second. A standing gold rail carries the masthead ("Solved
together", the room name), the frozen facts, the full ledger, and one honest line: _Your
shared record. It stays._ The rail has deliberate room at the bottom. **That room is where
the retrospective grows** (a timeline, a clue heatmap, a rematch button), which is the
whole point of anchoring it here.

- **Solo solve:** degrades gracefully. One solver means one color, so the tinted board is a
  single-hue wash, quiet and correct. The ledger is one row. Nothing looks broken or
  lonely; it reads as "you solved this," a private record. The moment keeps its confetti in
  the house golds (the existing empty-roster fallback).
- **Group solve:** shines. Five hands make five regions, the board becomes a legible map of
  the collaboration, and the ledger names the shares. The more people, the better it reads.
- **Data:** available today. Per-cell `by` from the completion snapshot and reconnect;
  stats and roster already carried. No wire work.
- **Cost:** low-to-moderate. A tint layer in `CrosswordGrid` keyed off a `Map<cell, color>`
  the store can already build; a settled-state branch in `LiveApp` that stops replaying the
  overlay and paints the rail; persist the "already celebrated" bit (localStorage keyed by
  gameId, or derive it: celebrate only on the live ongoing to completed transition, exactly
  as iOS's `CelebrationGate` does, so a reconnect into a completed room settles without
  re-celebrating). The rail is standard panel primitives.
- **Risk:** low. It reuses the confetti, the card, the tokens, and the board renderer. The
  one real decision is the settled tint strength (a mosaic that never fully fades vs one
  that settles to ink with the attribution revealed on hover or a toggle).

## Direction B: the plate

Treat completion as a made thing. The solve settles into a color-field print.

**The object** (`B-plate.png`). The board becomes a poster: every cell filled solid in its
writer's color at full strength, the letters knocked out white, framed in a thin gold rule
like a plate in a mount. It reads like a Panton print of your solve. Beside it, a masthead,
the frozen facts as a dashed-rule ledger, and a **"Signed"** block: the room, ordered by
contribution, host marked. The caption line states the rule plainly: _The color of each
square is the hand that placed it._ This is the strongest keepsake statement of the three;
the artifact has weight, it wants to be shared and framed, and a retrospective grows around
an object that already feels finished.

The moment is the same plate arriving: at completion the ink flips to color square by
square (a wipe, not a fade), landing on the poster. Confetti optional and probably omitted;
the plate is the event.

- **Solo solve:** the plate is a single-color field, which is a weaker poster (one hue) but
  still a clean keepsake. This is B's soft spot: solo, the plate is monochrome and the "made
  thing" reads as decoration more than record. Mitigation: solo could fall back to A's ink
  board with a light wash rather than the full poster.
- **Group solve:** the strongest single image of any direction. The color field is
  genuinely striking and unmistakably yours.
- **Data:** available today. Same per-cell `by`.
- **Cost:** moderate. A distinct solid-fill render mode for the board (letters knock out,
  contrast handling for the lighter roster colors like amber), the mat/mount layout, the
  wipe transition for the moment. More new pixels than A, but no new data.
- **Risk:** moderate. Contrast: white letters on amber (`#ffb224`) run low; the plate needs
  a per-color luminance check to flip letters to ink on light swatches, or the palette
  needs a floor. The poster look is a strong aesthetic commitment that may fight the rest
  of the app's restraint; it wins as a shareable export more than as the in-app resting
  state. Best case, B is A's settled board plus an **"export as plate"** action, not the
  default surface.

## Direction C: the replay seed (NEEDS PROTOCOL WORK)

Make the mosaic a time-lapse and plant the retrospective's root in one move.

**The moment and the surface** (`C-replay.png`). At completion the board paints itself on
cell by cell in the order it was actually solved, each cell arriving in its writer's color:
forty minutes of five people compressed into a few seconds. The settled surface keeps a
**scrubber** under the board, frozen at the end, with a colored transport bar that is a
first sketch of a who-was-writing-when timeline. The still shows the replay paused near the
end (about 78% filled) so the in-progress fill reads as live. This is the visual stub the
chess.com / Lichess retrospective grows directly out of: the timeline is already the
control, and analytics later just hang facts off it (fastest word, the stall at 3-down, who
broke the northeast corner).

- **Solo solve:** still works and is arguably charming (watch your own solve unspool), but
  the payoff is smaller without multiple colors moving.
- **Group solve:** the most emotionally resonant of the three. Seeing the corners fill in
  parallel, in different hands, is the collaboration made visible in time, not just space.
- **Data:** **NEEDS PROTOCOL WORK.** The snapshot is last-writer-per-cell only; there is no
  fill order and no per-cell timestamp. Ordered replay needs the event log (`cell_events`
  with `seq`/`at`) projected to the client through an Archive read model (DESIGN.md §9,
  D16), the same read-grant machinery `completedAt` and `lastActivityAt` already use. The
  mockup is honest about this: it carries a **"Needs the event log"** tag and the still is
  what the seed looks like once the order data lands.
- **Cost:** high. Backend read model plus migration plus a new client-side player. This is
  a wave, not a slice.
- **Risk:** high but bounded. It is the most ambitious and the only one gated on the wire.
  It also over-commits the retrospective before the retrospective is designed. Better as
  the _destination_ A and B point toward than as the thing built first.

---

## Recommendation

**Ship Direction A now. Keep B as an export. Treat C as the destination.**

A is the honest web-parity move: it lands the mosaic iOS already has, on data the web
store already holds, with the lowest risk, and it fixes the real bug (the revisit
re-celebrating). Its settled rail is the correct anchor for the retrospective, with
deliberate empty room where that surface will grow. It degrades cleanly to a solo record
and shines for a group.

B is a beautiful object but a strong aesthetic commitment that reads best as a shareable
export, not the resting state, and it is weak solo. Fold it in as **"Save as plate"** from
A's settled surface once A ships. The plate render mode is small once A's attribution layer
exists.

C is where this is all heading and it is the emotional peak, but it is gated on wire work
and it front-runs a retrospective that is still being ideated in parallel. Build A's
settled rail as the socket C plugs into; do not build C first.

Sequence: **A (moment + settled, today's data) -> B as export -> C when the event-log read
model lands.**

## Decision points for the owner

1. **Settled tint: memory or ink?** Does the reopened board keep the attribution wash
   permanently (A-settled, tint ~0.42), or settle fully back to ink with attribution
   revealed only on hover / a toggle? The mockup keeps the memory; the quieter alternative
   is a one-line change.
2. **Is the plate (B) the default settled surface, or an export?** Recommendation: export.
   Confirm you do not want the poster as the in-app resting state.
3. **Home-card mosaic?** Should the room card on the home list show a mosaic thumbnail (not
   just the silhouette mask)? This is the one home-surface item that **needs wire work** (an
   INV-6-safe attribution projection on `GET /games`). Reopening the room never needs it.
4. **Confetti in the moment: keep, or let the mosaic carry it?** A keeps the existing drift.
   B and C lean on the paint-on and arguably do not need confetti at all.
5. **How much of C's timeline to stub now?** Even without the event log, A's settled rail
   can reserve the exact slot the scrubber will fill, so C is a drop-in later. Confirm you
   want that slot designed in from A.

## File inventory

- `OPTIONS.md` — this document.
- `A-moment.html` / `A-moment.png` — Direction A, the completion moment.
- `A-settled.html` / `A-settled.png` — Direction A, the settled revisit (the nonephemeral
  anchor).
- `B-plate.html` / `B-plate.png` — Direction B, the plate keepsake.
- `C-replay.html` / `C-replay.png` — Direction C, the replay seed (needs protocol work).
- `mosaic-lib.js` — shared board renderer (exact `CrosswordGrid.tsx` conventions: 36-unit
  cells, letter fontSize 24 at y+32, clue numbers, `--cell-block` / `--stroke`, 2-unit
  frame) with the attribution wash and ledger.
- `tokens.css` — Crossy tokens lifted verbatim from `apps/web/src/styles.css` (light theme).
- `grid.json` / `grid-inline.js` — a plausible solved 15×15 (symmetric block layout,
  space-age across fill, 68 clue numbers) with per-cell attribution across five solvers
  (Mara 55, Sena 35, Ivo 33, Lux 33, Dario 30). No real puzzle solution is committed
  (INV-6 spirit); the fill is synthesized for the mockup.
- `gridgen.mjs` — the generator that produced the grid (kept for reproducibility).
