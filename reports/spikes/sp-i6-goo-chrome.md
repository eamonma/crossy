# SP-i6: the persistent-chrome-layer goo

Ran 2026-07-11 against Xcode 26.5 (iOS 26.5 SDK), iPhone 17 simulator (iOS 26.5),
and installed on the owner's iPhone 17 Pro Max as `com.eamonma.Crossy`. Lab lives
on branch `ios/goo-lab` (never merges, the ClueFitLab pattern). Four variants
route off `-gooLab A|B|C|D`, wired like `-morphLab` in `ContentView`. The lab
touches no production screen: four new files (`GooLab*.swift`) plus the one
launch-arg route and the analytics-quiet list.

## The question

The owner's goal, verbatim intent: gooey Liquid Glass morphing of the Rooms
screen's Join capsule melting into the room header's pill cluster (back button +
time pill) when a room opens. The goo is Apple's glass shader blending two
shapes' fields (the Mail-menu finding, DESIGN.md §4), which only happens between
SIBLINGS of ONE `GlassEffectContainer` in ONE hierarchy. A room open is a
NavigationStack push, so the two production screens live in two hierarchies and
cannot goo today.

The candidate this spike tests: a PERSISTENT CHROME LAYER mounted ABOVE the
screen swap, owning both endpoint shapes in one container, swapping its children
when the route changes so the system melts one into the other. This is the
ratified tap-open exception (DESIGN.md §4, 2026-07-11): the facts card already
rides the system's metaball materialize on 26+; SP-i1's `glassEffectID` ban is
scoped to DRAG-scrubbed morphs, and a navigation tap is not a scrub.

## The four variants

- **A, near swap.** One `GlassEffectContainer`; a tap swaps a fake rooms list
  for a fake room underneath while, inside the container, the Join child is
  removed and the back-pill + time-pill children are inserted. Two toggles:
  `matchedGeometry` vs `materialize`, and container spacing 6 (the cluster's
  real blend) vs 40 (MetaballRecipe's fuse spacing). Does a swap between two
  shapes near each other goo, or crossfade?
- **B, traveling melt.** The capsule TRAVELS a screen-width, from Join's
  top-trailing spot to the back button's top-leading spot, while the time pill
  materializes out of it mid-flight. Two mechanisms A/B'd: a persistent single
  glass surface whose frame+radius interpolate (the SP-i1 law extended to a tap,
  using CrossyUI's `GlassMorph`), vs a `glassEffectID` matched swap across the
  same travel (allowed here: tap-driven, never scrubbed). Which reads as
  Mail-quality goo?
- **C, distance law.** Two glass shapes in one container; the right shape's
  edge-gap is a slider (0..220 pt) and the container spacing is a stepper
  (6/12/24/40/80). A "melt near" button animates the pair together so the fuse
  forms/breaks in motion. Where does the metaball stop bridging and degrade to a
  crossfade?
- **D, real-seam rehearsal.** The same chrome layer mounted OVER an ACTUAL
  NavigationStack push (a fixture list pushing a fixture room). The chrome swap
  is keyed on the real navigation state (`path` empty vs not) and animates on the
  chrome spring, so a back-swipe commit (which fires outside a tap transaction)
  still animates. `navigationTransition(.zoom)` (PR #132's mechanism) toggles ON
  and OFF underneath.

## What rendered (simulator + device install)

All four render on the iPhone 17 sim (iOS 26.5) with no crash, and all four
install and launch on the owner's phone. The sim renders the glass field-blend
LINEARLY and lies about goo (the standing MorphLab/MeltLab caveat), so the sim
confirms only geometry and lifecycle:

- A: the fake Rooms list on paper with the production Join capsule
  (qrcode.viewfinder + "Join", height 40, corner 20) standing top-trailing; the
  HUD ribbon reads the live mechanism and its toggles.
- B: same Rooms endpoint; ribbon carries the mechanism (persistent / matched-ID)
  and the swept spacing.
- C: two glass circles at the swept gap, the gap slider and spacing steppers
  live. At gap 40 / spacing 40 the sim shows two discrete pills (no neck), as
  expected: the metaball bridge is a device-only render.
- D: the "Rooms (real push)" NavigationStack list with the persistent
  chrome-layer Join capsule floating ABOVE it (proving the layer sits outside
  the stack and does not push with the screen), plus the zoom toggle.

## Findings

### The architecture holds (mechanism)

The persistent-chrome-layer idea is sound as SwiftUI: a `GlassEffectContainer`
mounted as an overlay above the screen swap does own both endpoint shapes in one
hierarchy, and its children can be swapped on a route change while the paper
below cuts hard. In variant D this composes with a real `NavigationStack`: the
chrome layer lives outside the stack, observes `path`, and never pushes with the
pushed screen. This is the whole trick, and it works structurally. The remaining
question is purely felt: does the SYSTEM blend the fields into Mail-quality goo,
or does it crossfade-and-jump? That is device-only and the owner's to rule.

### The distance law (what to expect, device-confirmed by the owner)

SP-i1 / §10 pinned the STANDING fuse: container spacing 24 fused adjacent deck
keys into wavy rows; the cluster's 6 keeps three pills separate at rest. The
mechanism is a metaball field: two glass shapes bridge when the gap between their
edges is within roughly the container's `spacing`, and the bridge thins to
nothing past it. Variant C sweeps exactly this for a TRAVELING pair. The
prediction the owner confirms or corrects on device: fusion is a function of
edge-gap vs spacing; when edge-gap exceeds ~spacing the field cannot span and the
pair reads as two objects (a crossfade, not a melt). If that holds, the
Join-to-cluster travel (a full screen-width, ~250 pt) is FAR past any sane
container spacing, so the traveling melt (B) can only goo at its ENDS (Join
departing, cluster arriving) and must cross the middle as a moving crisp surface
(persistent) or a crossfade (matched-ID) — the metaball cannot bridge the whole
trip. This is the load-bearing finding for the production decision.

### The back-swipe (variant D, expected behavior)

The chrome swap is COMMIT-driven: it fires when `path` actually changes, which for
a swipe-to-pop is at the gesture's release/cancel, not continuously under the
finger. So the cluster should HOLD through the interactive scrub and pour back to
Join only when the pop commits, riding the pop like the tab bar rather than
scrubbing with the finger. A cancelled back-swipe should leave the cluster
untouched (the path never changed). The owner records on device whether it reads
clean or flickers mid-scrub; the animation is on the chrome spring so a
commit outside a tap transaction still animates rather than snapping.

## Verdict (owner's, on his fingers)

The goo quality is device-only and the owner rules it. Walk the variants in this
order:

1. `-gooLab A` (live on the phone now). Tap the paper. Toggle `matched` vs
   `materialize` and `spacing 6` vs `40`. This is the gentlest, most
   production-shaped test: two shapes a screen-width apart in one container. If
   THIS gooes at spacing 40 / matchedGeometry, the near-swap architecture is
   enough and B's travel is unnecessary theater.
2. `-gooLab C`. Sweep the gap slider with each spacing. Find the exact point the
   neck breaks. That number is the law that decides whether B can ever goo across
   the room-open distance.
3. `-gooLab B`. Feel persistent vs matched-ID across the full travel. If C says
   the fuse cannot span the distance, B's honest best is a clean traveling
   surface (persistent) with goo only at the ends, which may or may not beat A.
4. `-gooLab D`. The real seam. Tap a card (real push), swipe back, toggle zoom.
   Watch whether the chrome swap composes with the zoom or fights it, and whether
   the back-swipe holds-then-commits as designed.

## Cost, if the persistent-chrome-layer wins

Wiring this into production is not free. What it would take:

- **RoomBar ownership moves up.** Today `RoomBar` (the cluster) lives inside the
  room's own hierarchy (SolveScreen), and `RoomsScreen` owns the Join capsule
  independently. For them to share one container the chrome must be hoisted OUT of
  both screens into a persistent layer above the NavigationStack (a shell-level
  overlay owning both endpoint shapes, swapping on `path`). That is a real
  restructure of who renders the room bar: the room no longer draws its own top
  chrome, the shell does, and the room reads the chrome's state instead of owning
  it. Every RoomBar input (weather, clock, members, handoffs) has to thread up to
  the shell.
- **The full-bleed ruling still binds.** DESIGN.md §2: the board is full-bleed
  and the room bar floats over it. A shell-level chrome layer floating over the
  board is compatible with that, but the camera's standing insets
  (`GridOcclusion.standing`) are computed from the room bar's reported frame; if
  the bar moves to the shell, the frame plumbing (`reportChromeFrame`,
  `ChromeFramesKey`) has to cross the shell/room boundary, which today it does not.
- **Per-room closures.** The cluster's live intents (onBack, onTapTimePill,
  onKick, onGoTo, share) are per-room and rebind on every room open. A persistent
  chrome layer that outlives the room has to re-point those closures at the
  current room on each push and clear them on pop, or it fires stale intents. This
  is the sharpest correctness risk of the whole architecture: a persistent surface
  holding a closure into a room that has been popped.
- **The players/share pills stay outside.** The cluster in the container is back
  button + time pill only (a Menu breaks a container morph on 26.1, the RosterMenu
  discipline). The traveling/near morph therefore only ever fuses those two; the
  Menu-bearing pills materialize beside the arrived cluster, never through the
  goo. The lab already models this (endpoint = back + time).

The honest read: the mechanism is real and composes with the real push, but the
production wiring is a shell-level chrome hoist with live per-room closure
rebinding, which is a meaningful restructure of RoomBar ownership. Worth it only
if the owner's fingers say the goo is materially better than the current hard
push, and only for the near-swap (A) or end-gooed-travel (B) that the distance
law actually permits. If A gooes at spacing 40, that is the cheapest win; if
nothing gooes across the distance, the current push stands and this spike closes
the question by ruling the goo out, not in.

## Device install

Succeeded. `com.eamonma.Crossy` is on the iPhone 17 Pro Max, launched on
`-gooLab A` for the owner. Relaunch other variants with
`xcrun devicectl device process launch --terminate-existing --device
83D7B168-D3E8-5666-963E-AA4C6763EB54 com.eamonma.Crossy -- -gooLab B` (note the
`--` before the app arg; B|C|D swap the letter).

## Evidence (scratchpad, never committed)

Simulator render confirmations under the session scratchpad `goo-shots/`:
`sim-A2.png` (Rooms + Join, ribbon), `sim-B2.png` (traveling-melt ribbon),
`sim-C2.png` (two glass circles + gap/spacing controls), `sim-D2.png`
(real-push list + floating chrome-layer Join + zoom toggle). The goo itself does
not photograph from the sim (it renders linearly there); the felt verdict is the
owner's on device.
