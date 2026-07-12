# The party-mode terminal moment

`PartyView` (apps/web/src/ui/PartyView.tsx) is the projector surface: a room on a TV
across the room, watched by a group, operated by no one. Today, when the puzzle completes,
nothing marks it. The timer freezes (it already reads `store.completedAt`) and the
progress bar reaches 100%, but there is no beat, no settling, no moment. The room fills
the last cell and the screen just sits there.

This document proposes three directions for that moment. They share a spine so any of
them rhymes with the family already shipped:

- **The solve-client grammar (#87).** Completion says "Solved together" in a gold caps
  eyebrow, the room's name in the display serif, the frozen time in mono, and the people
  as an avatar stack, under a brief roster-colored confetti drift. The retuned confetti
  (this branch, Part A) is fine warm texture in the gold scale, not clipart primaries.
- **The iOS mosaic (EXPERIENCE.md).** On the completion gate's one firing the board
  plays a mosaic (tint, hold, settle) under the same brief drift; the time pill seals and
  becomes a finished object you revisit.
- **The room becomes a finished object.** Completion is not an exit. The connection stays
  open, the room lingers, and it can be revisited. On a projector there is no "revisit,"
  so the settled state is simply what the screen holds until someone starts the next one.

Two constraints are specific to the projector and drive every choice below:

1. **Read from across a room.** Type is scaled off the viewport (the rail already uses an
   em base per PartyView). The terminal headline and the time must carry at 3 to 5 meters.
2. **Watched, not operated.** Nobody taps the screen. Whatever it settles into must be
   self-explanatory and must not wait for input. The one interaction is the QR: a phone
   scans it to join the next puzzle.

All three mocks use the real `styles.css` tokens (lifted into `tokens.css`) and the real
projector layout (board hero left, rail right, dashed divider). Screenshots are
1920x1080, the projector's native frame.

---

## Direction 1: The Seal

**Mock:** `party-1-seal.png` / `party-1-seal.html`

The most restrained direction, and the one closest to the shipped grammar. The board stays
the hero, untouched.

- **At the second of completion.** A single warm gold wash sweeps across the board once
  (the iOS mosaic's tint beat, projector-scaled), and the fine warm confetti from Part A
  drifts over the stage. The last cell lands and the whole board glows for a beat.
- **What it settles into.** The rail's live furniture (running timer, progress bar,
  "solving now" roster) collapses into a sealed lockup: the "Solved together" eyebrow, the
  puzzle name in the display serif, the frozen time huge in mono, one honest line ("Filled
  and correct. The room's puzzle is done."), the solvers/entries stats, the people as an
  avatar stack, and a QR relabeled "Scan to start the next one."
- **How long it lingers.** Indefinitely. The board is a finished object you admire; the
  confetti falls once (2 to 3 seconds) and is gone. Nothing times out.
- **Projector vs people.** The projector shows the finished grid and the seal. The people
  see their own solve reflected and can pull out a phone to start the next puzzle.

**Cost:** Low. Reuses the completion facts PartyView already derives (`completedAt`,
progress, roster) and the confetti retuned in Part A. The only new pieces are the
one-shot board wash and swapping the rail's live block for the sealed block on
`store.status === "completed"`. A day of work, no new data.

**Risk:** Low. Nothing here depends on data the wire does not carry. It cannot look wrong
because it says less. The only risk is that it is too quiet for a party: the moment is a
settle, not a spectacle.

---

## Direction 2: The Curtain (roll call)

**Mock:** `party-2-curtain.png` / `party-2-curtain.html`

Celebrates the collaboration. The board is still the hero, but the rail turns into an
end-of-film credits panel that names who did what.

- **At the second of completion.** A diagonal gold shimmer sweeps the whole grid corner to
  corner (a projector-scaled mosaic that reads as a curtain drawing across the board), then
  settles to a faint warm hold so the finished grid stays legible.
- **What it settles into.** The rail becomes credits: "Solved." in large display serif, the
  puzzle name and time beneath, then a **roll call**: each solver, their roster color as a
  filled bar, their name, and their share of the grid (cells they placed). The party reads
  the standings: who carried it, who chipped in.
- **How long it lingers.** Indefinitely, like a title card. A quiet QR at the foot invites
  the room to keep the group for the next puzzle.
- **Projector vs people.** The projector shows the finished grid plus the standings; the
  moment belongs to the whole room, and there is a small social charge in seeing the shares.
  Individuals see their own contribution named.

**Cost:** Medium. The headline, shimmer, and time are cheap. The roll call is the catch:
per-solver contribution (cells placed per user) is **not on the wire today**. DESIGN.md
records it as a deferred Archive read model (D16); `cell_events` holds `by` per cell, so the
number exists server-side, but surfacing it needs a new completion-stat field or an Archive
read. Until then the roll call is faked or degrades to the avatar stack.

**Risk:** Medium. It is the strongest _party_ moment of the three, but it leans on data
that is a roadmap item, not a shipped fact. Shipping it now means either a protocol
addition (a per-solver breakdown in `Stats`) or a placeholder that undercuts the whole
idea. The bar chart also invites a competitive read of a cooperative game, which may cut
against the "solved together" tone; worth a gut-check with the owner.

---

## Direction 3: The Takeover (full-bleed marquee)

**Mock:** `party-3-takeover.png` / `party-3-takeover.html`

Maximum spectacle and maximum readability. The board recedes; the whole 1920x1080 becomes
the celebration.

- **At the second of completion.** The finished board animates from hero size down to a
  small memento token in the top-left corner, and the vacated screen fills, on the
  feature-gold panel face, with an oversized "Solved" in display serif, the puzzle name,
  the time as a giant numeral, the avatar stack, and confetti across the full bleed.
- **What it settles into.** The marquee holds: "Solved" fills the screen, the facts sit
  beneath it, the finished grid is a keepsake in the corner, and a QR bottom-right invites
  the next solve.
- **How long it lingers.** Indefinitely. This is the loudest settle; a room walking past
  a TV reads "SOLVED" from the doorway.
- **Projector vs people.** The projector is a billboard. The finished grid is demoted to a
  memento, so the thing you _solved_ is no longer the thing you _admire_, a real tradeoff.
  People get the clearest across-the-room signal and the easiest QR to find.

**Cost:** Medium. No new data (same facts as Direction 1), but the most animation: a
board-to-memento shrink transition and a full-surface layout that only exists in this
state. More motion to get right, more to feel cheap if rushed.

**Risk:** Medium-high. It departs most from PartyView's thesis that the board is the hero,
and the biggest headline risks reading as generic "you win" spectacle rather than Crossy's
restrained voice. Owner taste (Panton, Eames, Apple; restraint beats spectacle) points
away from a full-bleed marquee. High reward if the room is a genuine party; high chance of
feeling like a slot machine if it is four friends on a couch.

---

## Recommendation

**Ship Direction 1 (The Seal) now; hold Direction 2 (The Curtain) as the follow-on once
the per-solver stat lands.**

The Seal is the honest terminal moment PartyView is missing, it costs a day, it carries no
data risk, and it is squarely in the house voice: the board stays the hero, the confetti is
the retuned warm texture, and the rail seals into the exact "Solved together" grammar the
solve client and iOS already speak. It gives the room a real beat and a clear next step
(the QR) without inventing anything.

The Curtain is the more memorable _party_ moment and the natural next step, but it is gated
on a per-solver contribution stat that DESIGN.md defers to the Archive module (D16). When
that read model lands (or a `Stats` breakdown field ships), the roll call becomes real and
the rail can graduate from the Seal's avatar stack to the Curtain's standings with no change
to the board beat. Building it before the data exists means faking the one thing that makes
it worth building.

The Takeover is the weakest fit for owner taste. Keep it on the shelf as the "loud room"
option if a future venue (a launch party, a booth) ever wants a billboard, but it is not
the default terminal moment for a shared-couch crossword.

**Sequencing:** Direction 1 is a small PR against PartyView, independent of any protocol
work. Direction 2 is a protocol + read-model track first (per-solver cells in the
completion stats), then a PartyView PR that reuses the Seal's scaffolding. The board beat
(wash or shimmer) and the confetti are shared across both, so the work compounds.
