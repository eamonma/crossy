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

**The board is full-bleed** (owner ruling 2026-07-10). The canvas fills the solve
screen from the screen's top edge to the key deck's top edge; the room bar and the
clue bar float over it as glass. The deck is the one hard boundary: the board never
runs under it (ID-4, the deck sits over solid canvas). Because the bars float, the
camera, not the layout, keeps content readable: the clamp treats the room bar and
the one-line clue bar plus feather as standing insets (a fitting board centers
between the bars; a panned board rests its first row just below the room bar and
its last just above the feather, the scroll-inset grammar), and a wrapped clue's
taller bar rescues only the selected cell, panning it clear on the chrome spring,
never during a live pinch or drag. The standing insets are built from constants, so
clue length can never move the board: that is the point of the whole arrangement.
Amended 2026-07-11 (the toolbar-adoption ruling, §4): full-bleed is a
TRANSPARENT item-bearing system bar floating over the board, not "no bar". The
board still bleeds to the top edge; the room bar's pieces ride the system nav
bar's items now. Constant-built still: clue length never moves the board.
Amended 2026-07-12 (owner device regression on the real backend, and its
correction): the board's standing top inset is the SYSTEM BAR'S HEIGHT, read as a
CONSTANT off the room's OWN container (its top safe-area inset, the band the
full-bleed board bleeds under), NEVER a reported bar-item frame. The first two
cuts derived the inset from a roomBar rect synthesized from the bar items' own
frames (first anchored on the pill, then on the back button). Both were wrong for
the BOARD: a live room mounts the board BEFORE any bar item's onGeometryChange
fires, so the reported-frame inset landed late, the grid sat high and DROPPED as
the frame arrived, the board moving, exactly what the law forbids. (The sim rig
missed it because it held the welcome while the frames already reported, so it
read 0 there.) Reading the inset off the container is layout truth, reported
before the first paint: the grid's top edge is at its final position on frame one
and never moves when the pill arrives (GridOcclusion.standing takes the constant
topInset; ConstantBoardInsetTests pins it; -pillArrivalLab proves it on delayed
timing). The synthesized roomBar rect (BarItemFrames.synthesizedRoomBar, back-
button-anchored) survives for the FACTS CARD's span and the CLUE-BAR MELT only,
both post-welcome when their own reported frames are live; the BOARD no longer
reads it at all.

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
| room bar     | frosted  | a cluster: a back button (circular standing glass), time (weather dot, reconnect countdown, the ambient clock; always tappable; sealed with a quiet check at completion, the bare frozen clock after an abandonment), players (pucks, overflow count) |
| clue bar     | frosted  | active clue, direction chip, prev/next; wraps long clues to three lines and the bar breathes (owner ruling 2026-07-10, the ClueFitLab verdict); floats over the full-bleed board on a feather, a wash of the ground's canvas fading up from beneath the glass so live cells never meet a hard edge (both grounds by token, ID-3) |
| sheets       | frosted  | clue browser; a custom overlay panel (SP-i1), a morph target below. The roster and the share pill ride system menus instead; the facts card rides the system metaball on 26+ |
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
hands off for the card's life (PanelEclipse). Amended 2026-07-11 (the
toolbar-adoption ruling, §4): on the Rooms→room seam the hand-drawn cluster
retires and this piece set becomes the system nav bar's items (back leading, the
time pill then the players and share Menus trailing, a ToolbarSpacer between the
pill and the Menus). The register above holds unchanged; only the host changes,
from an overlay VStack to `ToolbarItem`s, so the push can goo them in place.

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

Amended 2026-07-11 (the timer-pill redesign; the owner disliked the popover's
callout and the terminal treatment on device). The mid-solve popover retires:
its arrow read as a balloon pointing at the pill, not the pill reshaped, which
breaks the morph grammar's one promise. The facts card is ONE morph for both
moments now: a tap on the time pill, mid-solve or terminal, inflates the pill
into the card on the chrome spring's walk (RoomChromeModel's settle; no drag
scrubs this surface, and nothing implicit animates it, SP-i1 untouched; the
walk is the below-26 path, the 26+ metaball ruling below). Mid-solve the card
carries the host's end-game under a one-point hairline, one confirm (copying
the invite code moved to the share menu, 2026-07-11); a terminal card carries
none: it is the record, not a control surface. The clock-rider retires with
the popover (the glyphs flying and rescaling from the pill to the headline
read as theater): the pill hands off whole, the surface grows clean, and the
card's content fades in late as one block, the browser-list rule, out early on
the pour-back. The `timeHandedOff` yield applies to every open card again. The
MorphLab popover findings stay recorded above for history; no surface rides
them now. The pill itself changes register at a terminal status: the weather
stands down (a finished room's connection is not a vital sign), completion
seals the pill with a quiet achromatic check beside the frozen clock, and an
abandoned room keeps the bare frozen clock. The swap is a crossfade on the
chrome spring, the pill's width settling with it, no overshoot (§7); Reduce
Motion cuts it.

Amended 2026-07-11 (two owner rulings on the chrome morphs, judged on device).
First, share ships as the native menu. The dedicated share pill's own morph
card was explored and dropped: the frame study's verdict held on the pill too,
the native menu's goo is Apple's shader blending the departing pill into the
arriving surface, unreachable by tweening one crisp surface. So the share pill
is a Menu label like the players pill (standing outside the cluster container,
the 26.1 rule), and the system owns its melt. The card's invite-code copy moved
onto the share surface with it: the menu's titled section carries the code, and
its Copy link row carries the URL, so the mid-solve facts card no longer copies
the code (a host mid-solve keeps only the end-game there). Second, the tap-open
exception to the single-surface grammar is ratified for the facts card: on iOS
26+ the tap-opened facts card uses the system's metaball materialize (the same
Menu-melt mechanism, a GlassEffectContainer swapping the pill glass for the open
panel, Mail's timing), because a tap has no scrub and the frame study proved the
goo unreachable by hand. This is scoped tightly: the drag-scrubbed melt keeps
frame interpolation (SP-i1 unchanged, a finger owns progress raw and a two-view
swap snaps under it), and below iOS 26 the facts card falls back to the same
frame-interpolation walk. Only the tap-opened facts card, only on 26+, rides the
system swap.

Amended 2026-07-11 (the toolbar-adoption ruling, judged on device; SP-i6, Route
1). The Rooms→room seam's TOP CHROME becomes the system navigation bar's own
items. SP-i6 variant E proved on the 26.5 sim that the system morphs nav-bar
items IN PLACE across a push (Mail's Edit → Select + "..." grammar), the items
living in the bar's persistent layer while the two screens slide beneath them.
The owner's decisive device fact: with the #132 zoom driving the push ("match
on") the back-swipe SCRUBS the item goo under the finger; without it, it does
not. So the zoom push and the system-toolbar top chrome are ONE package, not two
choices. Production adopts real `ToolbarItem`s for the top chrome on this seam:
the Join capsule becomes a trailing item on Rooms and goos into the room's
trailing cluster (the time pill, then the players and share Menus, split by a
`ToolbarSpacer` so they read as separate pills, Mail's "..." grammar). This
supersedes the hand-drawn top-chrome cluster on this seam: the RoomBar's pieces
retire as hand-positioned overlay glass and re-home as bar items, and the
occlusion clamp reads the system bar's height instead of a reported RoomBar
frame (the standing insets stay constant-built, DESIGN.md §2, so clue length
still can never move the board). The RoomBar cluster law (below) is amended: on
this seam the cluster IS the system bar's item set, keeping our own back button
as a leading item (onBack/kicked-exit semantics preserved, never the system
back), the TimePillRegister and every accessibility label intact. Two findings
carried into production from the SP-i6 sim run. First, a `Label` in a 26 nav-bar
item renders ICON-ONLY (even with `.labelStyle(.titleAndIcon)`), so a bar item
that must read as a word builds its content as an explicit HStack (glyph + Text)
or Text alone; the Join item takes the HStack, matching the retired capsule's
register, flagged for the owner's device eye. Second, the 26.1 Menu-in-container
break gains a bar corollary: a Menu-bearing item lives in the SYSTEM bar's own
container (not ours), and the gate proved the players and share Menus host as
glass labels, fuse into the "..." cluster, and morph in place across the push
without collapsing the bar layout; the menu's own presentation animation on the
tap stays the owner's device call (the same Menu+`.buttonStyle(.glass)`
mechanism RosterMenu already ships and the owner ratified). The full-bleed ruling
(§2) gains a one-line amendment: the board still bleeds to the top edge, but a
TRANSPARENT item-bearing system bar floats over it (never "no bar"), so the
board reads under the bar's glass items exactly as it read under the hand-drawn
cluster. Scope: the Rooms tab and the room only; the Puzzles tab keeps its hidden
bar and hand-set title for now (a follow-up moves it to the same grammar). Below
26 the bar items render as the system's plain material (the one-fallback rule),
and the macOS test host (14) gates the 26-only API exactly as RoomBar/KeyDeck do.
Width finding (device rig-check 2026-07-11): a bar item HARD-SNAPS its width when
its content changes size (a joiner's puck, the reconnect label, the terminal
seal), because the nav bar lays out its item slots in its own UIKit pass and never
joins our SwiftUI transaction, so `withAnimation(.crossyChrome)` around a
width-driving value does not make the bar breathe; the room seeds its true roster
and keeps the first-connect pill terse so the open frame carries no snap, and the
residual snaps are honest, each marking a real change. Arrival finding (device
2026-07-11, refined then settled 2026-07-12): ONE ARRIVAL BEAT. The whole trailing
cluster (share, players, timer) arrives together when the room is live, so
pre-welcome the bar is back-only and the welcome inserts every trailing item on
the same beat, each true at once (solver-filtered members, invite payload, ticking
clock). ClusterPresence keys on the store's sync state (share keeps its own payload
gate on top, never a dead control); a terminal room's sealed cluster arrives the
same way. The earlier cut gated only the timer on the welcome and stood share and
players from REST-mount, so on live data they arrived on different beats, a
staggered ugly sequence (owner device 2026-07-12); gating the whole cluster on one
rule retired it. The insert carries NO animation: the nav bar's slot pass is
UIKit's own and joins no SwiftUI transaction, so the items just appear (device
2026-07-12, same pass as the width snap). A content-only fade-in was weighed and
rejected, because the system draws a bar item's glass capsule from the item's
mere PRESENCE, not its content (rig 2026-07-12: a `ToolbarItem` whose content is
opacity 0 still stands a full glass capsule), so fading the content in would
reveal it inside an already-standing EMPTY capsule, exactly what glass never does.
The bare insert is the honest arrival; Reduce Motion changes nothing, the insert
never animated. Empty-capsule finding and fix (rig + device 2026-07-12): the same
presence-not-content rule broke the yield. When the facts card opens the time
pill hands off (content to opacity 0), but the system capsule stood on regardless,
so an empty glass capsule floated in the bar where the pill was (visible in the
open-card capture, and a contributor to the metaball reading as broken). Fixed by
hiding the handed-off item's shared background (`sharedBackgroundVisibility(.hidden)`
while `timeHandedOff`), which suppresses the capsule while the item stays present
so its frame keeps reporting live (the card's pour-back reads it, no stale value,
no removed slot); the eclipsed back button takes the same treatment. Recorded,
not fixed (device 2026-07-11): the facts-card metaball from the bar-hosted pill is
still broken, the departing stub lives in our GlassEffectContainer and the pill's
glass in the system bar's, and two containers cannot blend, so the goo departs
orphaned; the facts-card presentation awaits an owner redesign and the morph code
is untouched (the empty-capsule fix above removes the hollow capsule that made the
break read worse, but the two-container blend remains the owner's redesign).

Amended 2026-07-12 (the live-data birth rule; owner device finding on the real
backend). On live data the top chrome POPPED: share and players did not animate
with the #132 zoom push (they did on the fixture), and the timer arrived
unceremoniously. The diagnosis, confirmed: RealRoomView WITHHOLDS SolveScreen
until the REST view lands (the I3f rule, the RoomOpening quiet canvas), and
RoomOpening carried NO toolbar items, so during the push there was nothing to goo
into on live data; every item popped at REST-mount. DemoRoom mounts SolveScreen
instantly, which is why the fixture looked right. The rule: THE BAR IS BORN WITH
THE PUSH. The withholding room carries its chrome even before the board
(RoomOpeningToolbarHost over the RoomOpening and RoomOpenFailure branches), so
OUR back button stands from the push's first frame (a way out on the failure
branch too). The whole trailing cluster (timer, share, players) arrives together
on the welcome's beat once SolveScreen mounts (one arrival beat, above); nothing
trailing stands pre-welcome.

The placeholder seed experiment, RETIRED 2026-07-12 (owner device finding). The
first cut threaded a RoomArrivalSeed beside the path (the tapped card's member
count and name) and stood that many PLACEHOLDER pucks pre-REST, so the players
pill would show at true width from frame one. It was WRONG BY CONSTRUCTION: the
pill cluster is solvers-only (owner ruling 2026-07-10, guests seat as spectators
and leave the top bar), but a card's `memberCount` counts EVERYONE including
spectators and guests, so the placeholder count never matched the solver-filtered
pill that lands. And the achromatic hollow placeholder pucks read as an ugly empty
pill on device. So the whole seed vocabulary died: RoomArrivalSeed, the
count-driven placeholder roster, the RosterMember placeholder flag, and the
hollow-puck branch. The REST-roster seed (GameStore.seedRoster from `GET
/games/{id}`) SURVIVES: it is identity-true (the real member ids, gated to
`connecting`, overwritten by the welcome's live roster), so the pill lands at its
right width when the board mounts, no count guessed from a list row.

The timer's self-owned glass carve-out, REVERTED 2026-07-12 (owner device finding:
the wrap). A brief experiment gave the time pill its OWN glass inside the bar item
(its own horizontal padding 12, pillHeight frame, ChromeGlassSurface, a scale
settle) and permanently suppressed the item's system capsule, so its arrival could
ride the chrome spring as a materialize. Inside a WIDTH-CONSTRAINED bar item that
own-padding wrapped the clock to two lines where the system capsule never did (the
longest content, the reconnect "Back in Ns" label plus clock, was the tell). So the
pill goes back to the bare SYSTEM CAPSULE: the plain button carries the content and
the nav bar draws the glass and sizes the capsule on its own pass, no wrap. Its
arrival is the bare insert on the welcome beat, one beat alongside share and players
(above). The handoff suppression is the real fix and STAYS: when the facts card
opens (or an eclipse) the pill's content goes to opacity 0 and its shared background
hides in lockstep (`sharedBackgroundVisibility(.hidden)` while handed off,
BarItemGlass.backgroundHidden), so no hollow capsule floats where the pill stood.
Every glass bar item (the pill, the back button, the Menus) now rides that ONE rule:
system glass, visible at rest, suppressed only on the yield.

Amended 2026-07-12 (the seeded-birth rule; the goo on live data). The #132 zoom push
goos the Rooms Join item into the room's trailing cluster, but the goo needs the
cluster to EXIST during the push. The one-beat rule above (whole cluster on the
welcome) left the withholding bar back-only, so on live data nothing goos: the pills
pop at the welcome, after the push. The fix is TRUE DATA, not the retired placeholder:
the list row now carries every member's full identity (`{userId, name, avatarUrl,
role}`) and the member-only invite code (the §12 row expand, wired ahead of this seam),
so a CARD-TAP arrival is born with players + share STANDING, identity-true from the
row's member stack. The tap records the card's members and code beside the path (the
`roomZoomSourceID` precedent, keyed by gameId, cleared on sign-out); RealRoom seeds the
store's roster from them at construction (each member not-yet-heard-from at `connected:
false`, name/avatarUrl/role TRUE from the wire; GameStore.seedRoster stays gated to
`connecting`, the welcome stays the authority) and takes the seeded invite code so the
share payload exists pre-REST (REST overwrites both when it lands). The withholding bar
(RoomOpeningToolbarHost) and the full bar (RoomToolbar) both stand the seeded players
and share pills in the SAME placements, so the nav bar keeps their identity across the
withheld→ready swap and nothing re-inserts; the goo therefore plays on live data with
ZERO placeholders. The players pill renders the seeded members through the exact same
RosterMenu → RosterList.cluster path the live pill uses, so the solvers-only display
rule applies identically: a seeded spectator seeds the store but never widens the pill.
The one-beat rule remains the UNSEEDED fallback (deep links, code-joins, which have no
card and record no seed): their whole trailing cluster still arrives together on the
welcome. And the TIMER stays a welcome arrival on BOTH paths: its clock genuinely needs
the welcome, so ClusterPresence gates the timer on the sync state alone (`showsTimer`)
while the players and share pills gate on `seeded || live` (`showsPlayers`/`showsShare`),
one pure seam, no view-inline branch (ClusterPresenceTests / SeededRosterFilterTests pin
it). This SUPERSEDES the placeholder seed experiment above, which died because its data
was false (count-only, guests miscounted, hollow pucks); this is true data, roles
included, which is the difference. The board still does not move at any beat (the §2
constant inset is untouched; -pillArrivalLab holds at 0.00 pt drift through the seeded
sequence). The seeded withholding frame is offline-judgeable through -seededBirthLab
(evidence only).

Content rides the morph (owner device finding, 2026-07-10; scoped 2026-07-11).
A drag-scrubbed morph is never empty glass: the clue bar's pinned row travels
with the surface and hands off from the chrome it left, so the melt never
inflates hollow under a finger and nobody renders twice. Content new at the
open end (lists, names) fades in late. The facts card, tap-opened and fast on
the chrome spring, takes the fade-in-late rule for ALL its content since the
timer-pill redesign: its clock-rider read as theater, so the surface grows
clean instead. The morph targets:

- Pull the clue bar up: it melts into the clue browser. Release below threshold and
  it pours back. With the browser open, a downward drag scrubs the melt back under
  the finger (SP-i1 unchanged: the finger owns progress raw; release settles by
  position and velocity, the sheet grammar). The drag resolves against the
  scrolling clue list the way system sheets resolve it: it takes the surface only
  while the list rests at its top, otherwise the list scrolls, and a pull that
  runs the list into its top hands the surface over mid-gesture (PanelDismiss
  pins the arbitration). The pinned row keeps its own bidirectional drag.
  The bar itself breathes with the clue (owner ruling 2026-07-10, the ClueFitLab
  verdict): a long clue wraps to at most three lines and the bar's slot sizes to
  the same words (ClueBarSizer, the row's invisible twin). Since the full-bleed
  ruling the slot floats over the board, bottom edge pinned above the deck, so the
  bar grows upward over live cells on the chrome spring and NOTHING else re-lays
  out; the board never moves with clue length (the camera rescues an occluded
  selected cell, section 2). The capsule keeps radius = height/2 as it grows. One
  line floors at the standing 52, so short clues are untouched. Past three lines
  the ellipsis returns (the pathological clue on the narrowest phone). Reduce
  Motion cuts the height change.
- Tap the players pill: the roster menu flows out of it, the system's morph
  (rows carry rendered pucks, names, and the quiet state word; the spectator's
  Join in is a real menu action, and a host's row for anyone else nests a
  destructive Remove from room with one confirm).
- Tap the time pill: the room's facts arrive (owner ruling 2026-07-10: the time
  pill is the room's facts), by one mechanism in every moment (the 2026-07-11
  redesign): the pill inflates into the facts card. On iOS 26+ the inflation is
  the system's metaball materialize (ruled 2026-07-11); below 26 it is the
  chrome spring's frame-interpolation walk. Mid-solve the card carries the
  room's name and the crossword's facts with the live clock as the headline,
  then a hairline and, for the host, the end-game (copying the invite code moved
  to the share menu, 2026-07-11). At completion the same tap summons the same
  surface as the stats card (ID-2: the timer becomes the headline, frozen),
  operations gone. Content fades in late as one block (the browser-list rule);
  an outside touch pours the card back and the pill, sealed or ticking, summons
  it again.
- Tap the share pill: the share menu flows out of it, the system's morph (the
  RosterMenu mechanism, ruled 2026-07-11). Copy link, Share…, and Show QR code
  (a small system sheet, since a menu cannot render a scannable code inline);
  the titled section carries the invite code, the read-aloud channel.
- A rebus-capable entry summons the bubble from the cell; commit condenses it back.
- Backgrounding the app condenses the room bar into the island.
- On the home screen, New game and Join ride as a cluster and merge to one pill on
  scroll.
- On a panning 25x25, standing bars thin while you travel and return at rest.

**Transient panels yield to intent** (owner ruling 2026-07-10). A touch outside
an open custom panel (the facts card, the clue browser) dismisses it and still
lands where it fell: no dead tap-catchers, the room never eats a touch. Panels
are mutually exclusive, opening any one pours back the others, and a status
transition to completed or abandoned pours back the melt and an open mid-solve
facts card (its operations just died with the room; completion re-summons the
card as the stats card from fresh geometry). The one exception is a live
finger: a melt being scrubbed is never force-closed, because the finger owns
progress (SP-i1). The one system transient, the roster menu, keeps the
system's own manners: the outside touch that dismisses it is swallowed,
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

**Arrival notes: the tab bar** (owner ruling 2026-07-10 late). The signed-in
shell is the system tab bar carrying the three stable places, mirroring the web's
destinations: Rooms, Puzzles, Settings. The bar is adopted, never imitated: on 26
it is the system's Liquid Glass; on 18 through 25 it is the plain material tab
bar, the same one-fallback rule as all chrome. The selected tab wears ink, not
the system blue (chrome stays achromatic; people and the destructive tone are the
only color). Only Rooms navigates: a room pushes inside that tab and hides the
bar, because the board and deck own the whole screen (the full-bleed ruling), and
the bar returns on pop. Settings is a tab now, so the account puck that stood
top-trailing on Rooms is retired. New game is not a tab: an action is not a
place, and it rides the create-flow slice, inheriting the standing bottom slot
Join vacated (the cluster-merge moment is amended: Join stands top-trailing
now, ruled the same night). Puzzles is browse-only until then: paper cards, no
tap targets, no promise the flow can't keep. Welcome stays bar-less; there is
no shell before there is a person.

**Arrival notes: the join panel** (owner ruling 2026-07-10 late, "code or QR").
Join is a small glass capsule top-trailing on Rooms — the corner the account
puck vacated — and its sheet is camera-first: a dark viewport (a camera is a
window, not paper) scanning for any invite QR, the typed path always standing
beneath it. A scan is the same act as typing: the digested code (InviteScan:
the share link, the /g/ unfurl link, or a bare code) fills the field and
submits, so the person sees what the camera read, and DENIED's finality binds
scans exactly as keys. One attempt per scanned code; a QR lingering in frame
never becomes a retry loop. The keyboard law bends here, deliberately: this
sheet does NOT autofocus (the keyboard would bury the viewport); the field
focuses on tap. The camera then stays LIVE under the keyboard (owner ruling
2026-07-11, superseding the earlier "viewport folds on focus"): a person can
type a code and keep scanning at once, so the viewport does not fold to
nothing, it shrinks to a compact live strip (~130 pt) riding above the keyboard
while the resting window is ~300 pt, and the sheet raises its detent from the
resting camera-first fraction to a taller focused fraction so the strip and the
field both clear the keys. The change rides the chrome spring, both heights at
once, and the camera session never tears down (the strip only resizes, so a
scan still fills and submits mid-type). The screen owns the detent, because it
owns the field's focus; the sheet keeps swipe-down dismissal and its drag
indicator. Camera refused or absent (the simulator has none): one plain
sentence in the viewport, which shrinks the same way on focus so the focused
layout never collapses in the denied state either; the field is untouched —
never a dead end. The camera itself is the app target's (AVFoundation behind a
scanner slot and a verdict enum, AD-2); CrossyUI renders chrome and digests
payloads, and the digest is pure and pinned (InviteScanTests).

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
  the celebration's centerpiece. A restrained confetti drift rides the same instant
  (owner ask 2026-07-11, amending this section's original no-confetti rule):
  roster-colored flecks between paper and glass, deliberately quieter than the
  web's, skipped whole under Reduce Motion, muteable by one constant (the ID-1
  pattern, `AttributionSwitches.completionConfettiEnabled`).
- **The clarity beat.** During the mosaic, all standing glass momentarily clears,
  then refrosts as the stats arrive.
- **Honest weather.** Three connection states, three registers (PROTOCOL.md
  section 7): live is a calm dot, resyncing is a breathing dot, reconnecting dims
  the room with a quiet countdown. Never a modal, never a spinner over the grid.
  The weather lives in the time pill (owner ruling 2026-07-10): the dot and the
  countdown sit beside the ambient clock, one pill for the room's vital signs.
  At a terminal status the weather stands down (a finished room's connection is
  not a vital sign): completion seals the pill with a quiet check beside the
  frozen clock; an abandoned room keeps the bare frozen clock. The swap rides
  the chrome spring; Reduce Motion cuts it.
- **The island.** The room condensed: pucks leading, the derived timer trailing,
  black glass. The room bar and the island share capsule geometry so backgrounding
  reads as the same object changing state. The timer ticks natively from
  `firstFillAt` with zero updates (root DESIGN.md D15). Push updates dress the
  same object (owner rulings 2026-07-11): chrome stays achromatic, color stays
  with the pucks, and the roster colors arrive render-ready in the content-state.
  Compact carries a thin progress ring beside the clock. Minimal is the ringed
  puck, one person inside the same arc at the slot's edge. Expanded grows the
  cluster to the crew reading, away members at the 0.38 register, counts trailing
  the room line in quiet white, and under the whole row a ticked meter: a hairline
  with nine ticks at the tenths, so quantized advances land as detents. The lock
  screen banner takes the same meter as a baseline rule under its line. The island
  is born live: it starts carrying the room's real state at the moment of
  backgrounding (the resolved cluster, the confirmed fill counts, live presence),
  so it renders live data at zero seconds and the server takes over over APNs from
  there. The attributes snapshot is the fallback the system falls back to when it
  has no content-state to render; that fallback hides progress, no meter, no ring.
  Completion flips terminal: every puck at full, the
  meter sealed, the ring closed, the room line reads "Solved together", and the
  timer freezes at `completedAt` minus `firstFillAt`, a static string, MM:SS under
  an hour and H:MM past it, never three sections. An abandoned room freezes where
  it stood, no celebration. Stale is law: a stale content-state drops everything
  push-fed to the away register while the timer stays full white, computed on
  device, unable to lie.

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
