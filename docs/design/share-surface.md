# The share surface

Status: built, awaiting owner rulings (device feel). Date: 2026-07-11.
Scope: the dedicated share pill and its card on iOS, the mirrored web share
popover, and the gooey-morph prototype for the tap-opened pill panels (share
and facts). Supersedes PR #92's placement (a Share row inside the facts card);
lifts its ShareInvite port, vectors, and ShareSheet wrapper unchanged.

## What it is

A round share pill stands in the room bar's cluster, between the time pill and
the players pill. Tapping it inflates the pill into the share card on the same
one-surface melt the facts card rides (the Mail-button rule: the panel is the
pill reshaped, top and trailing edges shared, growing leftward over its own
footprint). Not a sheet, not a popover, not a Menu. The card offers copy link,
the QR, and the system share; the web share popover mirrors the same hierarchy
with the same generator.

Placement reasoning: the bar reads left to right as the way out (back), the
room's vitals (time), and the room's people (players). The invite is the door
between the facts and the people, so the pill stands between them, inside the
GlassEffectContainer (its panel is a custom morph, not a Menu, so the 26.1
container break does not apply). The players pill keeps the trailing corner:
the pucks are the bar's color and the island's lead, and an achromatic control
should not push them inward. The pill stands only when the room holds an
invite code; there is never a dead share control.

## Information hierarchy (the decision)

Three channels, ranked by what a person is actually doing when they open the
card:

1. **Copy link, primary.** The group chat is the product's honest social space
   (EXPERIENCE.md: the invite unfurls in the group chat). Copying to paste is
   the most frequent act and the cheapest: one tap, inline "Link copied"
   feedback, and the card stays open, because it may still have work to do
   (the QR moment below). It is the first action row.
2. **The QR, secondary.** The in-person channel. It ranks below copy on
   frequency but it is the card's visual body, and that is not a
   contradiction: a scannable code has a size floor (164 pt tile here), and
   for the QR, OPENING THE CARD IS THE ACT. You show your phone; no further
   tap exists to rank. Zero-tap beats one-tap, so the QR earns the body
   without being the primary control. Dark modules on a white paper tile in
   both grounds (a scannable code is dark on light, the projector's rule);
   the QR is content, ink on paper, and the chrome around it stays
   achromatic.
3. **Share…, tertiary.** The system's catch-all (AirDrop, Messages, mail,
   everything else). Real but least frequent; the last row. Tapping it closes
   the card, because the system sheet takes the stage and two share surfaces
   standing at once is one too many.

Plus one ambient element: **the invite code as the card's headline.** The
code's alphabet was designed to be read aloud on a call, and the call is a
real invite channel that needs no button, just the words on screen, large.
Copying the bare code stays on the facts card (the §12 operations row), so
nothing is duplicated: the facts card copies the code, the share card copies
the link.

The card reuses the facts card's typographic grammar (quiet label, big
headline, quiet detail, hairline, operation rows), so the two sibling panels
read as one family. The detail line is the lexicon's own: "Anyone with this
code can join."

Web mirrors the hierarchy inside the existing SharePopover (its popover is the
web's grammar; the melt is iOS's): invite-link copy row first, the bare-code
row beside it, then the QR (uqr, ECC M, the party projector's exact register),
then a feature-detected navigator.share button that is simply absent where the
platform lacks it. The host's end-game row stays where it was, below its
hairline.

## One QR across clients

CrossyUI gains a pure QR encoder (`InviteQR`: data in, bool matrix out, no
UIKit, AD-2 intact), a faithful port of uqr, the generator the web projector
already ships. Five conformance vectors pin the Swift matrices byte-for-byte
against uqr's output (version, mask, and every module), so the code an iPhone
shows is module-for-module the code the projector shows. The panel draws the
matrix in a Canvas with pixel-snapped modules; simulator screenshots of both
grounds decode back to the exact share URL via CIDetector (verified in this
build). ShareInvite.url stays byte-matched to the web's buildShareUrl (the
five PR #92 vectors, lifted unchanged).

## The gooey prototype (owner rulings needed)

The ask: make the tap-opened pill morphs (share pill, and the timer pill's
facts card) feel gooier, without touching the law. Everything ships behind ONE
switch, `PillInflation.character`, default `.clean` (the shipped law), flipped
by launch argument so candidates compare on device without rebuilds:

- `-gooOvershoot`: the same single-surface walk on a separate underdamped
  curve (damping 0.72, ~3.8% peak, same response as the chrome spring), open
  only; every pour-back stays critically damped. Geometry rides an unclamped
  blend where anchored edges are exact fixed points, so the panel never
  detaches from the pill's shared edges; only the traveling edges breathe
  past and settle. ChromeSettleCurve, the melt, and the camera pan are
  untouched (the shared-curve constraint honored: this is a NEW curve used
  only by the two pill panels' open walk).
- `-gooMetaball` (iOS 26 only): the system's materialize swap inside a
  GlassEffectContainer, the MorphLab variant-A recipe exactly (unique
  glassEffectIDs, spacing 40, Mail's 0.35/0.18 timing). This is the only
  mechanism that can produce Mail's actual goo, the shader blending two
  shapes' fields; one crisp surface tweened by hand cannot (the §4 frame
  study). SP-i1's rejection of the ID swap was for scrubbed morphs (it snaps
  under a finger); a tap has no scrub, so the question is legitimately open
  again. Below 26 it falls back to `.clean`.

Both apply to the share card AND the facts card as one treatment, so the owner
judges the two pills together and accepts or rejects wholesale. The facts
card's content and open geometry are untouched; only the glass's travel
changes.

**What only a device can judge** (the simulator renders the glass blend
linearly and lies about goo, the MorphLab caveat):

- Whether the metaball swap reads as Mail's pour or as a cheap crossfade.
  The simulator run already shows the right ingredients mid-flight (the
  panel materializing with content resolving through blur, edges soft), but
  the sim renders the blend slowly and linearly, so tempo and goo are the
  device's verdict. Known honest costs to weigh: the pill stub is empty
  glass during flight (Mail's egg drops its content too), and on the close
  the system's 0.18 s deflate ends before the walk's lifecycle clock,
  leaving a still, empty pill-shaped glass for roughly a quarter second
  before the real pill returns. If it cannot be made to feel right, the
  recommendation is to keep the frame interpolation: it is the law, and it
  already reads as one object reshaping.
- Whether ~4% overshoot on the open earns its keep or reads as wobble on
  glass. It deliberately borrows from §7's reserved register (overshoot
  belongs to people and celebration); adopting it means amending that line
  for tap-opened pill inflations specifically.

## The system-Menu candidate (-shareMenu)

A third variant beside the card and the goo prototypes, behind its own switch
(`ShareSurface.mechanism`, default the card, flipped by the `-shareMenu`
launch argument; composes with `-demoRoom`). The share pill becomes a system
`Menu` label on the RosterMenu mechanism, so the open inherits the
presentation system's own melt, the one Mail actually has and the owner
already blessed on the players pill. The pill stands OUTSIDE the cluster's
GlassEffectContainer (the 26.1 container break), between the time pill and
the players pill as before.

The menu trades the card's hierarchy for the system's feel: Copy link stays
primary (no inline "Link copied"; a menu cannot restyle a row live), Share…
hands to the system sheet, and Show QR code stages the card's exact tile
(ink on paper, quiet zone intact) in a small SwiftUI sheet, because a menu
cannot render a scannable code inline. The titled section carries the invite
code, so the read-aloud channel survives the form. The honest costs to judge
on device: the QR is no longer zero-tap (the card's strongest argument for
itself), and the code as a section header reads quieter than the card's
headline. Row set, words, and the sheet's arithmetic are pinned in
`ShareMenuTests`.

**Owner rulings requested:**

1. Morph character for the two pill panels: clean (law), overshoot, or
   metaball. One ruling for both pills.
2. If overshoot: bless the §7 amendment (a hair of overshoot for pill
   inflations only, pour-backs stay critically damped).
3. If metaball: bless the tap-open exception to the §4 single-surface grammar
   (drag-scrubbed morphs keep the law regardless).
4. The share pill's standing placement (between time and players, in the
   container) and the card's hierarchy above, on device.
5. QR quiet zone: the tile pads 12 pt (~2.5 modules; the spec's ideal is 4).
   Simulator decode passes on both grounds; confirm a real camera scan off
   the device screen at arm's length, and widen the pad if it hesitates.

## Placement of truth

- iOS morph grammar and geometry: `apps/ios/Sources/CrossyUI/ShareCard.swift`,
  `GlassMorph.swift` (unclamped blend), `PillInflation.swift` (the switch, the
  curve, the metaball surface), `RoomChromeModel.swift` (share walk).
- Fixture: `-i2fShare` lands the card open (the presentFacts pattern);
  `-gooOvershoot` / `-gooMetaball` compose with `-demoRoom` for live taps;
  `-shareMenu` swaps the pill for the system-Menu variant
  (`apps/ios/Sources/CrossyUI/ShareMenu.swift`), also composing with
  `-demoRoom`.
- Vectors: `InviteQRTests` (uqr parity), `ShareInviteTests` (buildShareUrl
  parity), `ShareCardTests` (slot arithmetic, lexicon words, the strict
  Mail-button width rule).
- Web: `apps/web/src/ui/GameToolbar.tsx` (SharePopover: link, code, QR,
  native share, end game).

If the rulings adopt this surface, DESIGN.md §4's morph-target list should
gain the share pill line and the §7/§4 amendments above; this note is the
proposal, DESIGN.md stays normative.
