---
status: descriptive
---

# The share surface

Status: SHIPPED as the native menu (owner ruling 2026-07-11). Date: 2026-07-11.
Scope: the dedicated share pill on iOS, presenting a system Menu, and the
mirrored web share popover. Supersedes PR #92's placement (a Share row inside
the facts card); lifts its ShareInvite port, vectors, and ShareSheet wrapper
unchanged.

The custom morph card for share was explored and dropped: the native menu goo
won. Apple's iOS 26 menu melt is the shader blending the departing pill into
the arriving surface, the exact effect the frame study proved unreachable by
tweening one crisp surface, and the owner ruled it the best feel on the bar
(the same verdict the players pill's roster menu earned). The morph card, its
PillInflation goo prototypes for share, and its `-i2fShare` fixture are gone.
The information-hierarchy exploration below is kept for rationale (why the
menu's tradeoffs are acceptable), marked as the SUPERSEDED card design.

## What it is (shipped)

A round share pill stands in the room bar's cluster, between the time pill and
the players pill, standing OUTSIDE the GlassEffectContainer like the players
pill (a Menu inside a container breaks its morph on 26.1). Tapping it presents
a system Menu, so the open rides Apple's native menu melt. The menu's rows:
Copy link (primary; the pasteboard), Share… (the system share sheet), and Show
QR code (a small system sheet carrying the QR tile, since a menu cannot render
a scannable code inline). The menu's titled section carries the invite code:
the read-aloud channel, and where copying the bare invite code lives now (it
moved off the facts card). Row order is Copy link / Share… / Show QR for now, a
one-line change in `ShareMenuList.rows` if the owner later swaps QR to second.

The web share popover keeps its own hierarchy (the web's grammar is a popover,
not a menu; that surface is unchanged).

Placement reasoning: the bar reads left to right as the way out (back), the
room's vitals (time), and the room's people (players). The invite is the door
between the facts and the people, so the pill stands between them. The pill
stands only when the room holds an invite code; there is never a dead share
control.

## SUPERSEDED: the morph card's information hierarchy (kept for rationale)

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

## The rulings (2026-07-11)

The owner judged the candidates on device and ruled:

1. **Share ships as the native menu.** The custom morph card and its goo
   prototypes for share are dropped. The native menu's melt (Apple's shader
   blending the departing pill into the arriving surface, WWDC25 session 323)
   is the best feel on the bar, the same verdict the players pill's roster
   menu earned. Copying the bare invite code moves onto the share surface (the
   menu's titled section carries the code; Copy link carries the URL).
2. **The facts card adopts the metaball morph as its shipping default** on iOS
   26+ (the system's materialize swap inside a GlassEffectContainer, the
   `-gooMetaball` recipe: unique glassEffectIDs, spacing 40, Mail's timing).
   Below 26 it falls back to the clean frame-interpolation walk. `-gooClean`
   and `-gooOvershoot` stay reachable as launch-argument overrides for
   reference and regression. The tap-open exception to the single-surface
   grammar is ratified in DESIGN.md §4 (drag-scrubbed morphs keep frame
   interpolation regardless, SP-i1 unchanged).

The metaball close-deflate gap that the first run flagged (an empty
pill-shaped glass standing for ~0.25 s after the system's 0.18 s deflate
finished but before the walk's clock ran out) is addressed in code: the pill
stub is now the OPEN's materialize source only, and the close collapses toward
nothing instead of back to the stub, so no empty glass lingers. A device pass
should confirm the close reads clean.

**What still needs a device pass:**

- Whether the metaball swap reads as Mail's pour on the owner's device (the
  simulator renders the blend linearly and lies about goo).
- The close-deflate fix: confirm no empty-glass flash on the facts card close.
- QR quiet zone: the tile pads 12 pt (~2.5 modules; the spec's ideal is 4).
  Simulator decode passes on both grounds; confirm a real camera scan off the
  device screen at arm's length off the QR sheet, and widen the pad if it
  hesitates.

## Placement of truth

- iOS share surface: `apps/ios/Sources/CrossyUI/ShareMenu.swift` (the Menu
  label, the rows, the QR tile and QR sheet), `RoomBar.swift` (the pill's
  placement outside the cluster container).
- iOS facts-card morph: `PillInflation.swift` (the metaball surface, the
  default character, the close-deflate fix), `RoomFactsCard.swift`,
  `RoomChromeModel.swift` (the facts walk), `GlassMorph.swift`.
- Fixture: `-demoRoom` for live taps on the share menu and the facts card;
  `-gooClean` / `-gooOvershoot` override the facts card's default metaball
  (share is a system Menu now, so it cannot be scripted open).
- Tests: `ShareMenuTests` (row set, words, QR sheet arithmetic, tile
  geometry), `InviteQRTests` (uqr parity), `ShareInviteTests` (buildShareUrl
  parity), `PillInflationTests` (the overshoot curve).
- Web: `apps/web/src/ui/GameToolbar.tsx` (SharePopover: link, code, QR,
  native share, end game) — unchanged by these rulings.

DESIGN.md §4 carries the ratified amendments (share = native menu, facts card
= metaball on 26+); this note is history and pointers, DESIGN.md stays
normative.
