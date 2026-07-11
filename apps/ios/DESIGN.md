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
| room bar     | frosted  | a cluster: a back button (circular standing glass), time (weather dot, reconnect countdown, the ambient clock; always tappable), players (pucks, overflow count) |
| clue bar     | frosted  | active clue, direction chip, prev/next                           |
| sheets       | frosted  | clue browser, share card; custom overlay panels (SP-i1), morph targets below. The roster rides a system menu instead |
| key deck     | clear    | interactive pucks over solid canvas, never over the grid (ID-4)  |
| rebus bubble | clear    | momentary, exhaled by the cell (root DESIGN.md D12)              |
| island       | system   | the room condensed; shares capsule geometry with the room bar    |

**The room bar is a cluster** (owner ruling 2026-07-10). Three small standing
pieces in the compact-toolbar register, not one bar: a back button leading
(circular standing glass, the room's way out), the time pill, and the players
pill. The leading pill retired the same day (owner ruling 2026-07-10): the
room name lives in the facts card now, and the weather moved into the time
pill, which carries the room's vital signs in one place, status dot, reconnect
countdown, ambient clock. The time pill is always tappable, because the time
pill is the room's facts: mid-solve it opens the room-facts card, at
completion the same surface is the stats card (ID-2 unchanged). On iOS 26+ the
back button and the time pill share one GlassEffectContainer with spacing held
below the metaball threshold (SP-i1, section 10: container spacing fuses
adjacent glass), so the pieces stay separate objects at rest; the players pill
stands outside the container, because a Menu inside one breaks its morph on
26.1; below 26 the same layout renders as separate blur-material capsules, the
one-fallback rule below. The players pill shows only the people who are playing,
host or solver (owner ruling 2026-07-10): guests always seat as spectators
(PROTOCOL.md section 12), so a puck in the pill means solving, and guests leave
the top bar without a wire change. The menu behind the pill still lists
everyone, spectators with their quiet Watching word. A host's menu behind the
players pill offers to remove any other person from the room, one confirm
(`DELETE /games/{id}/members/{userId}`, the server enforcing host-only and
self-target refusal). The point is honest morphs: a morph-bearing pill is
its own rest surface, so a panel is always the pill reshaped, never a capsule
conjured out of standing glass. And the panel grows over the pill's own
footprint, top and trailing edges shared (the Mail-button rule, owner ruling
2026-07-10): the open surface covers the spot it grew from, it never hangs
beside a still-visible opener. The facts card grows leftward from the time
pill and can reach the back button on narrow layouts; an eclipsed back button
hands off for the card's life (PanelEclipse).

**Morph grammar.** Glass morphs; it never transitions. No modals, no new surfaces,
one piece of glass reshaped. SP-i1 pinned the implementation
(reports/spikes/sp-i1-glass.md): a morph is one persistent glass surface whose
frame and corner radius interpolate with gesture progress. The two-view
glassEffectID swap snaps instead of scrubbing (device recheck rides I2c), and a
system sheet presentation cannot morph at all, so every sheet below is a custom
overlay panel living in the room's own hierarchy. SP-i5 ratified this by owner
feel test on device (reports/spikes/sp-i5-detent-browser.md): the system detent
sheet is grow-then-swap, not the melt, and fuses the clue bar and the deck into
one surface; the ruling is the clue bar as its own glass over a separate deck.

Amended 2026-07-10, evening: the law above governs drag-scrubbed morphs, where
a finger owns progress. A tap-opened pill panel rides the system's own
presentation instead (the Mail mechanism). Frame study of Mail's menu at 60 fps
showed its goo is the glass shader blending two shapes' fields, soft-edged
mid-flight, unreachable by tweening one crisp surface; menus and popovers flow
out of the glass controls that present them (WWDC25 session 323). So the roster
is a Menu flowing out of the players pill, ruled on device against the Mail
reference, and the system owns its placement, stacking, and dismissal. SP-i5's
finding stands for sheets: a detent sheet still cannot melt.

Amended again 2026-07-10 (owner ruling): the MID-SOLVE facts card is a system
popover too, not a custom morph. A tap on the time pill while the room runs
presents a popover flowing out of the pill (the MorphLab variant C mechanism,
`.presentationCompactAdaptation(.popover)`), which hosts arbitrary content: the
facts, then a divider, then operations the API already supports (copy the
invite code, and the host's end-game, one confirm). The COMPLETION path does
not change: at completion the tap still summons the clock-rider morph stats
card (ID-2, the frozen clock inflating to the headline, content riding the
surface); the popover is the running room's surface only. The morph machinery
stays for that one surface, and the `timeHandedOff` yield now applies only on
the completion path. Container finding, proven on the Air sim before wiring
(MorphLab variant D): unlike a Menu, a `.popover` does NOT break inside a
GlassEffectContainer on 26.1. A popover presents on its own system layer above
the hierarchy and never morphs its glass through the presenter's container, so
its presentation is indistinguishable from an out-of-container reference and
the presenting cluster stays whole. The time pill therefore stays inside the
cluster's container (the roster's Menu still stands outside, because a Menu
does break there).

Content rides the morph (owner device finding, 2026-07-10). A morphing surface
is never empty glass: the elements alive at both ends, the clue bar's pinned
row, the stats card's clock, travel with the surface and hand off from the
chrome they left, so nothing inflates hollow and nobody renders twice. Only
content new at the open end (lists, names) fades in late. The morph targets:

- Pull the clue bar up: it melts into the clue browser. Release below threshold and
  it pours back.
- Tap the players pill: the roster menu flows out of it, the system's morph
  (rows carry rendered pucks, names, and the quiet state word; the spectator's
  Join in is a real menu action, and a host's row for anyone else nests a
  destructive Remove from room with one confirm).
- Tap the time pill: the room's facts arrive (owner ruling 2026-07-10: the time
  pill is the room's facts), by one of two mechanisms depending on the moment.
  Mid-solve a popover flows out of the pill (the system's presentation), carrying
  the room's name and the crossword's facts with the live clock as the headline,
  then a divider and the §12 operations. At completion the same tap keeps the
  custom morph: the frozen clock inflates into the stats card (ID-2: the timer
  becomes the headline, so the headline comes from the timer, and the clock
  rides the surface from the pill). The mid-solve popover dismisses the system's
  way (the outside touch swallowed, Mail's manners); the completion morph pours
  back on a touch and the frozen pill summons it again.
- The invite capsule is the share card, condensed.
- A rebus-capable entry summons the bubble from the cell; commit condenses it back.
- Backgrounding the app condenses the room bar into the island.
- On the home screen, New game and Join ride as a cluster and merge to one pill on
  scroll.
- On a panning 25x25, standing bars thin while you travel and return at rest.

**Transient panels yield to intent** (owner ruling 2026-07-10). A touch outside
an open custom panel (the completion stats card, the clue browser) dismisses it
and still lands where it fell: no dead tap-catchers, the room never eats a
touch. Panels are mutually exclusive, opening any one pours back the others, and
a status transition to completed or abandoned pours back the melt (the stats
card then owns the completion stage) and the mid-solve facts popover (that
surface is the running room's only). The one exception is a live finger: a melt
being scrubbed is never force-closed, because the finger owns progress (SP-i1).
The system transients, the roster menu and the mid-solve facts popover, keep the
system's own manners: the outside touch that dismisses them is swallowed,
exactly as Mail's is.

**Presence glints.** Chrome stays achromatic until a person passes beneath it: a
cursor sliding under the clue bar throws a brief specular in that player's color
across its edge. Glass borrows color from the room; this is the only color glass
ever carries, with one scripted exception at completion (section 8).

**What glass never does:**

- Tint with brand color.
- Touch the board. The rebus bubble floats above a cell and never sits between the
  eye and a filled cell.
- Stack on itself. One glass layer, ever; a sheet replaces a bar. Sheets here are
  custom overlay panels: a system sheet presentation hard-cuts and stacks glass on
  glass (SP-i1), so it never appears in the room.
- Survive Reduce Transparency as-is. Every glass surface has a considered solid
  fallback.

**Below iOS 26.** The floor is iOS 18 (owner ruling 2026-07-10, amending root
DESIGN.md D06). Glass APIs need 26, so on 18 through 25 every glass surface
renders as one simple blur material: same geometry, same layout, same motion,
the system's regular material in place of glass. One fallback for all chrome,
never a second design system, and no per-piece fallback decisions. Degraded is
accepted.

**Arrival notes: the join sheet** (owner device report 2026-07-10). Join with a
code was a full push, and it jolted: the screen focused its field in onAppear, so
the keyboard animated up while the push was still mid-flight, the slideover racing
the keyboard. The owner ruled for a glass sheet that flows out of the button. Two
honest mechanisms on 26 were weighed by motion quality:

- **The zoom push** (`.navigationTransition(.zoom(sourceID:in:))` with
  `.matchedTransitionSource` on the button) keeps every navigation semantic
  untouched, but it stays a full-screen push: the whole page zooms in, the interior
  is still a plain canvas, and it never reads as a sheet growing out of the control.
  It solves the source but not the surface. Rejected on feel.
- **The glass sheet** (a system sheet presentation, one small detent for the field
  plus the button) is the surface the owner asked for. On 26 the sheet wears the
  material treatment; paired with the button as its zoom source, it grows out of the
  capsule instead of sliding over the page. This is the Mail mechanism the roster
  already rides (a system presentation flowing out of the glass control that
  presents it, §4 amendment): the arrival sheet is that grammar reused. SP-i5
  rejected system detent sheets for in-room panels because a detent sheet cannot
  melt into the clue browser; arrival has no melt law, so that finding does not bind
  here, and the owner explicitly asked for a sheet. Adopted.

The keyboard rises WITH the presentation, not after it (amended the same evening:
deferring focus one presentation-length let the sheet settle at its detent and
then jump, the system's keyboard avoidance shoving the whole container up with the
content following, owner device report). In a sheet the keyboard is part of the
rise: the field focuses as the sheet appears and the system lifts sheet and
keyboard as one motion from the bottom. The focus task still cancels with the
sheet, so a fast dismiss never fights a pending focus. Below iOS 26 (and the macOS test host, floor 14) the sheet slides in as a
plain material sheet and the zoom is skipped: no glass required, the §4 one-fallback
rule. Semantics are unchanged from the push: success dismisses the sheet and sets
the path to the room alone, so back from the room and the kicked exit both land on
Rooms, never a stale code field.

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
- **Haptics**: a light tick when the cursor travels to another word — a block
  crossed, a line changed, a swipe between words, the axis toggled (owner ruling
  2026-07-10, broadening the block-cross tick; steps within a word stay silent); a
  soft thud when a word completes; a double tick when a word you were mid-typing is
  finished by someone else; a distinct completion pattern for `gameCompleted`.
  Never a haptic for a teammate's routine letters (that would buzz constantly in a
  lively room).
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
  The weather lives in the time pill (owner ruling 2026-07-10): the dot and the
  countdown sit beside the ambient clock, one pill for the room's vital signs.
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
  (adopted 2026-07-10; reaffirmed the same day). The owner briefly considered
  shipping one ground, then ruled both stay for v1 once the two renders were
  side by side: the app follows system light/dark. Nothing may hard-code either
  ground's values past the token layer.
- **ID-4 The key deck is clear glass pucks** (adopted 2026-07-10, hardware-gated).
  Build the acrylic deck per SP-i2; if it proves too much in hand, revert to
  Studio-quiet keys, the named alternate. **Hardware-confirmed 2026-07-10: the
  owner ran the SP-i2 rig on device and ruled for the glass.** Below iOS 26 the
  pucks render as the section 4 blur-material fallback.
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

- Glass APIs verified by SP-i1 (2026-07-10, reports/spikes/sp-i1-glass.md), closing
  the root DESIGN.md section 15 item: glassEffect, GlassEffectContainer, and
  interactive glass are real and compose; the melt is a single persistent surface
  interpolating frame and corner radius; glassEffectID matched-geometry swaps snap
  in the simulator (device recheck 2026-07-10: irrelevant for tap-opened pill
  panels, which now ride system presentations per section 4's amended morph
  grammar; the swap remains unbuilt-on for scrubbed morphs); system sheets never
  morph, so panels are custom overlays. The fallback stands: crossfade, never a
  modal. One caution
  for the deck: container spacing metaball-fuses adjacent keys, so the deck uses
  tight spacing or its own container. Reduce Transparency could not be driven
  headlessly in the simulator; the solid fallback is built and verifies on device.
- Device tuning pass: roster contrast on both grounds, glyph weights, flash curve,
  haptic strengths, deck feel (ID-4).
- Exploration artifacts (direction board, glass plan, 2026-07-09) are linked from
  the PR that introduced this document; they are exploratory, this document is
  normative once merged.
