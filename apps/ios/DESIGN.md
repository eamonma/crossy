# Crossy iOS Design Language

Status: draft 1, for owner review. Date: 2026-07-09.
Companion: `apps/ios/EXPERIENCE.md` (product vision, flows, screens, copy).

**Scope and precedence.** This document owns the look and feel of the iPhone app:
visual identity, materials, motion, haptics. It owns no semantics. Wire behavior,
navigation, and store reconciliation are owned by `PROTOCOL.md` and `vectors/`;
architecture and the cell-module rules by the root `DESIGN.md` (sections 10, 12).
Where this document cites those rules it links, never restates. The web client is a
sibling implementation and not a visual reference (owner decision, 2026-07-09).

## 1. Thesis

Crossword apps inherit the newspaper: ivory page, ink grid, a hush. Crossy's product
bet is the room, so the iPhone app is built like an instrument in that room. The
instrument, grid, type, chrome, is precise and nearly colorless. The color is the
people. Every saturated pixel on screen is somebody: a cursor, a flash, an avatar, a
finished grid revealed as a mosaic of who wrote what. An empty room is quiet. A full
room glows.

The law, stated once and enforced everywhere: **paper below, glass above, people
between.**

- **Paper** is the board: solid, matte, high-contrast. Every fact lives on paper.
- **Glass** is everything you hold: bars, sheets, keys, the Dynamic Island. One
  continuous material that morphs instead of transitioning.
- **People** are the only color in the system. Paper records their letters; glass
  borrows their light; neither ever owns a hue of its own.

## 2. Paper: the board

The grid is a `Canvas` renderer, solid and high-contrast on both grounds; Liquid
Glass never touches it (root DESIGN.md D06). Cell-module geometry is already
normative: clue number top-left, teammate presence anchored bottom-right, direction
arrow top-right, count-badge collapse, background precedence (root DESIGN.md
section 10, Wave 2.1d). This document adds no geometry, only surface treatment.

Paper holds: letters, clue numbers, circles and shading, check marks,
cross-reference highlights, conflict flashes, the completion mosaic. Grids up to the
25x25 ingestion cap must render legibly; past comfortable glyph size the grid pans
and zooms under the standing chrome.

**Attribution at rest (ID-1, adopted 2026-07-10).** Letters are always ink; the
only person-marker on the board at rest is the presence puck in the cell corner. A
writer's color appears in motion (the flash, a cursor) and at completion (the
mosaic), both kept for now and each muteable by a single constant, pending the
owner seeing them on device. Scarcity is what makes the mosaic land.

## 3. People: the only color

Identity color is a deterministic FNV-1a hash of `user_id` (root DESIGN.md
section 8). The hash is fixed; the palette it indexes is ours to curate, and that
roster is the brand. Twelve colors, tuned to hold on bone and on void, distinct at
12 px in the corner of a cell:

| name   | light ground | dark ground |
| ------ | ------------ | ----------- |
| violet | #6F66D4      | #9D95FF     |
| poppy  | #DE5722      | #FF7A50     |
| teal   | #17917F      | #3BC7B4     |
| magenta| #C2497D      | #E06B9E     |
| ochre  | #C98A1B      | #E0A93E     |
| cobalt | #3D6BD6      | #6E93E8     |
| moss   | #6B8F3C      | #90B45E     |
| rust   | #B0503C      | #D97862     |
| plum   | #8A4E9E      | #B278C6     |
| cyan   | #2596A8      | #4FBCCE     |
| coral  | #E06A5A      | #F4917F     |
| slate  | #5E6B8C      | #8C99BA     |

Values are a starting set; a contrast validation pass on device may adjust them, the
structure (12, paired per ground, hash-indexed) does not move. One constraint from
the root DESIGN.md section 8: identity color is stable across devices, sessions,
and clients, so the same user must resolve to the same roster slot on web and iOS.
This roster is therefore a cross-client contract: proposed here, to be ratified with
the web workstream and then owned by shared ground, not by either client. The violet is lifted
from PROTOCOL.md section 4's example participant and is the owner's default self
color in mocks, nothing more; your color is whatever the hash says.

Color appears at: cursors, direction arrows, avatar pucks, conflict flashes,
presence glints (section 4), count badges, the mosaic. Nowhere else. Chrome
interactive states are achromatic (weight, size, and specularity carry emphasis).

## 4. Glass: the chrome

One continuous material with two registers, used semantically:

- **Frosted, standing**: chrome that persists over the busy lattice and must stay
  legible. The room bar, the clue bar, sheets.
- **Clear, momentary**: glass for events. The rebus bubble; the completion beat when
  all chrome clarifies for one breath while the mosaic tints the paper.

The standing pieces:

| piece        | register | notes                                                            |
| ------------ | -------- | ---------------------------------------------------------------- |
| room bar     | frosted  | name, shared clock, roster pucks, weather dot                    |
| clue bar     | frosted  | active clue, direction chip, prev/next                           |
| sheets       | frosted  | clue browser, roster, share card; each is a morph target, below  |
| key deck     | clear    | interactive pucks over solid canvas, never over the grid (ID-4)  |
| rebus bubble | clear    | momentary, exhaled by the cell (root DESIGN.md D12)              |
| island       | system   | the room condensed; shares capsule geometry with the room bar    |

**Morph grammar.** Glass morphs; it never transitions. No modals, no new surfaces,
one piece of glass reshaped (maps to the iOS 26 glass-container morphing APIs):

- Pull the clue bar up: it melts into the clue browser. Release below threshold and
  it pours back.
- Tap the roster pucks: the cluster inflates into the roster sheet.
- The invite capsule is the share card, condensed.
- A rebus-capable entry summons the bubble from the cell; commit condenses it back.
- Backgrounding the app condenses the room bar into the island.
- On the home screen, New game and Join ride as a cluster and merge to one pill on
  scroll.
- On a panning 25x25, standing bars thin while you travel and return at rest.

**Presence glints.** Chrome stays achromatic until a person passes beneath it: a
cursor sliding under the clue bar throws a brief specular in that player's color
across its edge. Glass borrows color from the room; this is the only color glass
ever carries, with one scripted exception at completion (section 8).

**What glass never does:**

- Tint with brand color.
- Touch the board. The rebus bubble floats above a cell and never sits between the
  eye and a filled cell.
- Stack on itself. One glass layer, ever; a sheet replaces a bar.
- Survive Reduce Transparency as-is. Every glass surface has a considered solid
  fallback.

## 5. Two grounds, one app

One identity with a light ground and a dark ground, not two directions. Studio is
the chassis, Panton is the blood, Observatory is the night.

**Studio (light).** Bone paper, ink glyphs, chrome that barely exists.

| token     | value   |
| --------- | ------- |
| canvas    | #F2F1EC |
| cell      | #FFFFFF |
| ink       | #1D1B18 |
| block     | #1B1A17 |
| grid line | #D9D6CD |
| number    | #8B877D |

**Observatory (dark).** The grid as an illuminated instrument panel: blocks recessed
darker than the canvas, letters as bone light, teammates as indicator lamps. Cursors
and pucks carry a faint bloom; motion stays small and glow does the amplification.

| token     | value   |
| --------- | ------- |
| canvas    | #121118 |
| cell      | #201F27 |
| ink       | #EDEAE2 |
| block     | #0A0910 |
| grid line | #2C2B34 |
| number    | #77747F |

**Panton contributions**, alive on both grounds: the saturated roster, the courage
of the celebration, the sculpted key deck, capsule geometry on chrome. Panton's
continuous molded forms are also the argument for the morph grammar in section 4.

**Ground selection (ID-3, proposed).** The app follows system appearance. Marketing
and App Store screenshots lead with Observatory, because the honest use case is an
evening call.

## 6. Type

SF Pro everywhere; New York appears nowhere. Grid glyphs are SF Pro at weight 600 on
the light ground and 500 on the dark (dark grounds fatten type), sized to the cell
module, never below legibility at the 25x25 zoom floor. Clue text is SF Pro at
regular weight, sized for arm's length. Timers, invite codes, seq-like values: SF
Mono or SF Pro with tabular numerals; the shared clock never jitters in width.
Uppercase labels (clue numbers, chips) take a touch of tracking. No display face; the
crossword is the display face.

## 7. Motion and haptics

Grammar: standing chrome uses small springs with no overshoot. Overshoot is reserved
for people and celebration (a puck arriving, the mosaic). Every animation has a
reduced-motion equivalent that crossfades instead of moving.

- **The flash** (PROTOCOL.md section 8): roughly 300 ms in the winner's color when a
  visible value changes under you. The loudest thing in the room; it gets a tuned
  curve (sharp attack, long decay), not a linear fade.
- **Haptics**: a light tick when the cursor crosses a block; a soft thud when a word
  completes; a double tick when a word you were mid-typing is finished by someone
  else; a distinct completion pattern for `gameCompleted`. Never a haptic for a
  teammate's routine letters (that would buzz constantly in a lively room).
- **The key deck**: specular pop plus haptic tick per press, sixty times a minute,
  tuned on hardware before anything else is (ID-4).

## 8. Signature moments

- **The mosaic.** On `gameCompleted`, every letter tints to its writer's color: the
  solve's fingerprint, who carried the theme, who cleaned the corners. It holds for
  a breath, then settles back to ink. Derived entirely from the event log. This is
  the celebration; there is no confetti.
- **The clarity beat.** During the mosaic, all standing glass momentarily clears,
  then refrosts as the stats arrive.
- **Honest weather.** Three connection states, three registers (PROTOCOL.md
  section 7): live is a calm dot, resyncing is a breathing dot, reconnecting dims
  the room with a quiet countdown. Never a modal, never a spinner over the grid.
- **The island.** The room condensed: pucks leading, the derived timer trailing,
  black glass. The room bar and the island share capsule geometry so backgrounding
  reads as the same object changing state. The timer ticks natively from
  `firstFillAt` with zero updates (root DESIGN.md D15).

## 9. Decision log

Format follows the root decision log. ID-1 through ID-5 were ruled by the owner on
2026-07-10.

- **ID-1 Attribution at rest is ink** (adopted 2026-07-10). Letters never carry
  color at rest; the only person-marker on the board at rest is the presence puck
  in the cell corner. Color in motion (the flash) and at completion (the mosaic)
  stay for now, each behind a single constant, cheap to mute: the owner reserves
  judgment until they are seen on device. Rejected: persistent per-writer letter
  tint (a lively room becomes noise, and the mosaic loses its reveal).
- **ID-2 The timer is ambient** (adopted 2026-07-10). Small, tabular, in the room
  bar; it becomes the headline only at completion. It is shared and social, not a
  whip. Before the first fill it reads 0:00 quietly (the timer starts at first
  fill, root DESIGN.md D15).
- **ID-3 Ground follows system appearance; screenshots lead Observatory**
  (adopted 2026-07-10).
- **ID-4 The key deck is clear glass pucks** (adopted 2026-07-10, hardware-gated).
  Build the acrylic deck per SP-i2; if it proves too much in hand, revert to
  Studio-quiet keys, the named alternate.
- **ID-5 Copy is plain and warm** (adopted 2026-07-10). Common words, controls that
  say what happens, no metaphors on controls, nothing precious. The spectator
  upgrade reads Join in. Lexicon in `apps/ios/EXPERIENCE.md` section 5.
- **ID-6 One app, two grounds** (adopted). Studio chassis, Panton blood, Observatory
  nights; no third identity.
- **ID-7 The game is a Live Activity** (adopted; staging in `EXPERIENCE.md`
  section 4).
- **ID-8 The roster is curated** (adopted). Twelve paired colors, hash-indexed;
  values tune on device, structure is fixed.

## 10. Open items

- Verify the iOS 26 glass APIs (glassEffect, glass-container morphing, interactive
  glass) at M5 kickoff; already registered in root DESIGN.md section 15. If a morph
  in section 4 is not expressible, the fallback is a crossfade, never a modal.
- Device tuning pass: roster contrast on both grounds, glyph weights, flash curve,
  haptic strengths, deck feel (ID-4).
- Exploration artifacts (direction board, glass plan, 2026-07-09) are linked from
  the PR that introduced this document; they are exploratory, this document is
  normative once merged.
