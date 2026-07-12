# SP-i6: the goo across the room-open seam

Ran 2026-07-11 against Xcode 26.5 (iOS 26.5 SDK), iPhone 17 simulator (iOS 26.5),
and installed on the owner's iPhone 17 Pro Max as `com.eamonma.Crossy`. Lab lives
on branch `ios/goo-lab` (never merges, the ClueFitLab pattern). Five variants
route off `-gooLab A|B|C|D|E`, wired like `-morphLab` in `ContentView`. The lab
touches no production screen: five new files (`GooLab*.swift`) plus the one
launch-arg route and the analytics-quiet list.

## The question, and the owner's clarified grammar

The original ask: gooey Liquid Glass morphing of the Rooms screen's Join capsule
melting into the room header's pills when a room opens. The goo is Apple's glass
shader blending two shapes' fields (the Mail-menu finding, DESIGN.md §4), which
only happens between SIBLINGS of ONE `GlassEffectContainer` in ONE hierarchy. A
room open is a NavigationStack push, so the production screens cannot goo today.

Clarified the same evening, and it reframes the spike. The owner's reference is
MAIL'S TOOLBAR TRANSITION: home has Edit top-right; pushing into a mailbox, the
top-right becomes Select + "..." as two separate pills, and Edit goos into those
two SAME SIDE, IN PLACE. One shape splitting into shapes where it stands, no
cross-screen travel. Two consequences:

- Variant B's screen-width flight is moot for the ask (kept in the lab for the
  record).
- The load-bearing observation: Mail achieves this ACROSS A PUSH because
  Edit/Select/"..." are system toolbar items in the navigation bar, chrome that
  persists across the push, whose items the system morphs on iOS 26. Crossy
  hides the system nav bar on every screen and hand-draws its top chrome, which
  is why we never see this for free. That suggests a far cheaper route than the
  hand-built persistent chrome layer: adopt real ToolbarItems for top chrome and
  let NavigationStack do the morph. Variant E proves or kills that route.

## The five variants

- **A, the in-place trailing split** (rebuilt, see the device finding below).
  Join top-trailing; a tap swaps the paper underneath while the arriving TIME
  PILL + CIRCULAR GLYPH (the Select + "..." analog) stand WHERE THE CAPSULE
  STOOD, footprints overlapping (the Mail-button rule). Built on the production
  metaball recipe already ratified on device for the facts card
  (PillInflation.swift / MetaballPanelSurface): one `GlassEffectContainer` at
  MetaballRecipe's fuse spacing (40), unique `glassEffectID`s in one namespace,
  conditional children swapped inside `withAnimation(.smooth)` at Mail's timing
  (0.35 open / 0.18 close), NO `glassEffectTransition` modifier. Ribbon toggles:
  production recipe vs `+ .materialize`, spacing 40 vs 6. The back button
  appears separately at leading, outside the goo.
- **B, the traveling melt.** The capsule travels a screen-width while the time
  pill materializes mid-flight; persistent single surface vs `glassEffectID`
  matched swap. Moot for the clarified ask; recorded for the distance law.
- **C, the distance law.** Two glass shapes, swept edge-gap (0..220 pt slider)
  and container spacing (6/12/24/40/80), a "melt near" animator. Where does the
  metaball stop bridging?
- **D, the real-seam rehearsal.** The hand-built persistent chrome layer over an
  actual NavigationStack push, swap keyed on the path commit,
  `navigationTransition(.zoom)` ON/OFF, back-swipe against the commit-driven
  swap.
- **E, the system-toolbar route.** A real NavigationStack with the system bar
  VISIBLE (this variant only). Screen 1: one trailing ToolbarItem carrying a
  Join-like item (the Edit analog). Screen 2 (pushed): two trailing items, a
  time-pill and a circular ellipsis glyph, split by `ToolbarSpacer(.fixed)` so
  they read as separate glass pills like Mail's. A "match" toggle adds
  `matchedTransitionSource` on the Join item + `navigationTransition(.zoom)` on
  the destination for the recorded contrast. `-gooLabAutoPush` scripts the push
  for capture.

## Findings

### Variant A, round one: the device killed the screen-width swap

The first cut placed the Join capsule top-trailing and the arriving cluster
top-leading, siblings a screen-width apart in one container. Owner device
report: "literally no effect", the swap snaps. Diagnosis: at that distance the
two shapes' fields can never overlap, so there is nothing for the shader to
blend and the ID swap just pops (SP-i1's snap, reproduced by hand). This is the
distance law's field confirmation: goo needs overlapping or near-overlapping
footprints, and no container spacing rescues a screen-width gap. It also
contradicted the clarified grammar outright. The rebuild is the in-place
trailing split above.

### Variant A, rebuilt: the metaball works in place (sim evidence)

With overlapping footprints on the production recipe, the iPhone 17 sim
captured the blend mid-swap at x8 slow motion (`-gooLabSlow`, capture-only):
the time pill and the ellipsis glyph bridged by a visible FUSED NECK, one wavy
surface mid-flight, while the paper crossfades underneath (`sim-A3-mid20.png`).
This is the first time this lab series has seen the metaball render mid-swap in
the simulator at all; the felt quality still needs the owner's fingers (the sim
renders the blend linearly), but structurally the in-place split goos.

One more finding with production consequence: AT REST the arriving pair stays
fused. At container spacing 40 with the production 8 pt pill gap, the time pill
and glyph stand as one blob with a neck after the swap settles
(`sim-A3-post.png`), exactly SP-i1's standing-fuse caution (spacing 24 fused
the deck keys). The swap wants the fuse spacing; the rest state wants the
cluster blend (6). A production wiring would have to settle the container's
spacing down after the transition (or re-parent the pills to the standing
cluster's container once the swap lands), or accept the union at rest. The
ribbon's spacing toggle shows both states.

### Variant E: the system does the Mail grammar for free (structurally)

The rig renders and pushes on the sim. The settled pushed state is exactly the
target grammar (`sim-E-post.png`): the system back button as a circular glass
pill top-leading, the inline title, and TWO separate trailing glass items (time
pill + ellipsis circle) split by `ToolbarSpacer(.fixed)`.

The mid-push frame (`sim-E2-mid16.png`) is the load-bearing evidence: while the
two screens slide underneath, the toolbar items DO NOT slide with them. They
live in the bar's own persistent layer and transition IN PLACE: the back
button's glass circle materializes at leading with its chevron not yet
resolved, and the trailing item's glyph dissolves through blur at its spot
(Mail's signature from the frame study: content gone through blur while the
glass anchors). The system runs the same persistent-chrome-layer architecture
variants A-D hand-build, natively, keyed to the push. No matching API was
needed for this: the DEFAULT transition does it. The `matchedTransitionSource`
+ zoom toggle exists for the recorded contrast; the expectation (it zooms the
whole screen out of the item, not item-to-item) matches the arrival-notes
finding and is the owner's to confirm on device.

Two implementation notes recorded from the sim run:

- A `Label` in a 26 nav-bar item renders ICON-ONLY, even with
  `.labelStyle(.titleAndIcon)`. Mail's Edit is a text-only item. A Join item
  that should read as a text pill must be `Text` (or accept the glyph circle,
  which is arguably the better Join anyway, the camera glyph).
- Whether the item transition is the full metaball (fields fusing) or a
  blur-dissolve-in-place is a device call: the sim's linear rendering cannot
  distinguish them. What is settled structurally: same side, in place, in the
  bar's persistent layer, across a real push.

The back-swipe question (does the system scrub the item morph under the
finger?) cannot be exercised in the sim (no touch injection); the ribbon
prompts the owner to swipe back slowly on device. If the system scrubs the goo,
that beats anything hand-built and decides the architecture.

### The distance law (variant C, prediction + the A confirmation)

SP-i1 / §10 pinned the STANDING fuse (spacing 24 fused the deck keys; the
cluster's 6 keeps pills separate). Variant C sweeps edge-gap vs spacing for a
traveling pair; variant A's round one confirmed the far end by hand (a
screen-width gap cannot goo at any sane spacing) and round two the near end
(overlapping footprints goo at 40, and stay fused at rest at an 8 pt gap). The
exact break point between is C's slider, the owner's to read on device.

### The hand-built chrome layer (variant D) still stands, now as the fallback

D proved the overlay architecture composes with a real push (the chrome layer
sits outside the stack, observes `path`, never pushes with the screen; the
commit-driven swap should hold through an interactive back-swipe and pour back
on the pop commit). With E on the table, D is the fallback if the system
toolbar's constraints prove unacceptable, not the first choice.

## Verdict (owner's, on his fingers)

Walk these two first; B stays only for the record:

1. `-gooLab A`. Tap the paper. The in-place trailing split on the shipping
   recipe. Flip `production (shipping)` vs `materialize`, `spacing 40` vs `6`
   (6 shows the discrete rest state, 40 the fused one).
2. `-gooLab E`. Tap a room card (real push), watch the trailing items morph in
   the bar, then SWIPE BACK SLOWLY: if the system scrubs the item goo under the
   finger, the architecture question is answered. Flip `match` for the zoom
   contrast.
3. `-gooLab C` for the fuse-break number; `-gooLab D` for the hand-built
   fallback's feel; `-gooLab B` only for the record.

## Cost, by route

**Route 1, the system toolbar (E; the cheap one if it goos).** Un-hide the nav
bar and move the top chrome into ToolbarItems: Join top-trailing on Rooms, the
room's pills as the room screen's items. What it collides with:

- The screens draw their own large titles today (Rooms' hand-set 32 pt bold;
  the room has no title at all). Adopting the bar means adopting
  `navigationTitle` / letting the system own that strip, or hiding the title
  while keeping items, and the hand-drawn look must survive the trade.
- The full-bleed ruling (§2): the board runs to the screen's top edge and the
  room bar FLOATS over it. A system nav bar wants to own the top strip; on 26
  the bar's glass items float over content with `scrollEdgeEffectStyle`, so
  full-bleed may survive, but the camera's standing insets
  (`GridOcclusion.standing`) would have to read the bar's height instead of the
  reported RoomBar frame.
- The RoomBar cluster rules: the players and share pills are Menu labels that
  must stand OUTSIDE any GlassEffectContainer (the 26.1 break). As ToolbarItems
  they'd live in the system's container instead; whether a Menu-bearing item
  breaks the system bar's own morph on 26.1 is an unanswered question this lab
  did not reach, and it gates the route.
- The time pill's facts-card morph (PillInflation) rests on the pill's reported
  frame; a toolbar item's frame is the system's, so the metaball facts card
  would need its rest geometry from the item (readable via onGeometryChange,
  but it is new plumbing).

**Route 2, the hand-built persistent chrome layer (A + D; the expensive one).**
Hoist RoomBar out of both screens into a shell-level overlay owning both
endpoint shapes, swapping on `path`: a real restructure (every RoomBar input
threads up to the shell), the frame plumbing crosses the shell/room boundary,
and per-room closures must rebind on every push/pop (the sharpest correctness
risk: a persistent surface holding a closure into a popped room). Plus the
rest-state fusion finding: the swap container's 40 must settle to the cluster's
6 after landing.

The honest read: E's structural result says the system already runs the
persistent-chrome architecture natively, so if its goo passes the owner's
fingers on device, Route 1 wins on cost and on grammar (it is literally Mail's
mechanism). Route 2 stays viable if the toolbar's constraints (titles,
full-bleed insets, the Menu question) refuse the trade.

## Device install

The first install run did not stick (the owner walked the variants and got the
real app; the orchestrator reinstalled from the branch and it routes fine now).
Installs are the orchestrator's after review. Launch:
`xcrun devicectl device process launch --terminate-existing --device
83D7B168-D3E8-5666-963E-AA4C6763EB54 com.eamonma.Crossy -- -gooLab A` (the `--`
before the app arg; A|B|C|D|E swap the letter; `-gooLabAutoPush`,
`-gooLabAutoFire`, `-gooLabSlow` are capture-only scripting).

## Evidence (scratchpad, never committed)

Under the session scratchpad `goo-shots/`:

- `sim-A3-pre.png` / `sim-A3-mid20.png` / `sim-A3-post.png`: the rebuilt
  in-place split at rest, MID-SWAP WITH THE FUSED NECK (x8 slow motion), and
  the settled state showing the rest fusion at spacing 40.
- `sim-E2-pre.png` / `sim-E2-mid16.png` / `sim-E-post.png`: the system-toolbar
  rig at rest (the icon-only Label finding visible), MID-PUSH with the bar
  items transitioning in place while the screens slide, and the settled pushed
  grammar (back circle + title + two trailing pills).
- `sim-B2.png`, `sim-C2.png`, `sim-D2.png`: render confirmations for the other
  variants.
