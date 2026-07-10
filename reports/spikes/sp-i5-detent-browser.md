# SP-i5: the clue browser as a non-modal detent sheet

Ran 2026-07-10 against Xcode 26.5 (iOS 26.5 SDK), iPhone 17 Pro Max simulator
(iOS 26.5), and the owner's iPhone 17 Pro Max. Prototype lives on branch
`spike/sp-i5-detent-browser` (never merges) and is installed on the owner's phone
as `com.eamonma.Crossy`, replacing the SP-i1 harness. The harness is a fake Studio
or Observatory solve screen (room bar, 9x9 board with CrossyDesign tokens, cursor
and word highlight in roster violet) under a permanently presented sheet:
`.sheet(isPresented: .constant(true))`, detents `[.height(246), .large]` with a
selection binding, `.interactiveDismissDisabled()`,
`.presentationBackgroundInteraction(.enabled(upThrough: .height(246)))`, and
`.presentationContentInteraction` switchable in-app. Small detent holds the clue
bar (direction chip, prev and next, tap bar to expand) over a quiet key deck;
large holds the clue browser per EXPERIENCE.md section 3: both directions, current
word pinned by the bar, filled words de-emphasized, every clue tappable.

## 1. Drag feel

The system owns everything and it cannot spasm. No layout in the harness reads
drag state; the only motions we author are the programmatic collapse through the
selection binding and a 160 ms content crossfade when the settled detent changes.
SP-i1's failure mode (implicit animations fighting a drag) is structurally absent.

The cost is the melt. The sheet's geometry tracks the finger continuously, but the
content does not morph with it: during a pull the bar and deck stay pinned at the
top while empty sheet grows beneath them (02, 06), and the browser appears only
when the gesture settles at large. The selection binding updates on settle, not
per frame, so drag-scrubbed content is impossible by design. What you feel is a
panel that stretches and then switches, not one thing becoming another. Whether
that reads as honest or as a flattened melt is the owner's call by hand.

## 2. Background interactivity at the small detent

The API composes as promised. With `.enabled(upThrough: .height(246))` the grid
accepts taps at the small detent (cursor and clue bar sync both ways), and beyond
that height the system dims the room and makes it inert: visible in the mid and
large captures on both grounds. Simulator touch injection is still unavailable
headlessly (same wall as SP-i1), so tap liveness is asserted from API behavior
plus the on-device check; the dimming beyond the threshold is in the captures.
Note the consequence: at the large detent the room stops being a room. A custom
panel could keep the board alive behind the browser; the system sheet cannot.

## 3. Tap-to-jump and the pour back

Works, and it is the best moment of the pattern. Tapping a clue row jumps the
model (cursor, word highlight, clue bar) and sets the selection binding back to
`.height(246)`; the system animates the collapse on its own curve, the grid is
already updated behind as the sheet falls away (04, 08). One code path drives
both the finger tap and the headless capture. No custom animation anywhere.

## 4. Bar and deck at small, browser at large

They fit. `.height(246)` holds grabber, clue bar, and three key rows; measured
against renders, the height detent is counted above the bottom safe area (290
requested rendered about 320 pt on a Pro Max), so tune numbers accordingly. The
pinned clue bar carries the continuity between detents: at small it captions the
deck, at large it becomes the pinned current word above the browser list, which
is exactly the EXPERIENCE spec. The deck-to-browser swap is a crossfade at
settle; coherent, but a swap, not a morph.

One design consequence surfaced: the sheet is itself glass, so ID-4's clear glass
key pucks inside it would stack glass on glass, which the DESIGN.md section 4
never-list forbids. The harness uses the named alternate (Studio-quiet solid
keys). Adopting the sheet pattern means the deck goes quiet or leaves the sheet.

## 5. Styling limits

What the system granted and refused, iOS 26.5:

- Glass: the sheet wears system glass by default. Over the bone canvas it reads
  as a frosted, near-opaque surface with visible edge lensing where it overlaps
  the grid (02). It adapts to both grounds on its own.
- `presentationBackground(.regularMaterial)` swaps the glass for a material (09,
  10, slightly more translucent at large). It replaces; it cannot tint the glass,
  pick a register, or reshape it.
- Grabber: visible or hidden. No color, size, or position control.
- Corner radius: the system's concentric radius. `presentationCornerRadius` can
  override the number (not exercised here); the shape stays a bottom-anchored
  rounded slab.
- Margins: none. The sheet is full-width and bottom-anchored, ever. The floating
  glass panel the morph grammar imagines is not expressible; neither is a morph
  from another piece of chrome (SP-i1 already showed presentation is a hard cut).
- Non-modality is capped at the threshold detent: full-screen room plus fully
  live background plus large browser is not a combination the system offers.

## 6. Scroll versus resize

`.presentationContentInteraction` composes with the browser's ScrollView and the
detent set without conflict; the harness carries a quiet three-way picker at the
bottom of the browser (automatic, scrolls, resizes) so each can be felt on
device. Automatic gives the expected list behavior: pulling down from the top of
the browser collapses the sheet, scrolling within the list scrolls. `.scrolls`
reserves resizing for the grabber, which protects long browsing on a 25x25 clue
list from accidental collapse; `.resizes` makes any content drag a detent change.
The felt verdict is the owner's; nothing in the API fought the pattern.

## 7. Recommendation for I2c

Hybrid. The evidence splits cleanly by piece:

- The clue browser is a list, and the detent sheet is the system's native shape
  for a list that grows out of a bar: free physics, free discipline, tap-to-jump
  with a system collapse, background taps at the small detent. If the owner's
  hand accepts grow-then-swap in place of the melt, take the sheet for the
  bar-deck-browser stack and spend the saved effort elsewhere. The deck then
  drops ID-4 glass pucks in favor of quiet keys while it lives in the sheet.
- If the melt is the point, SP-i1's single-surface drag-scrubbed morph remains
  the only pattern that delivers it, with the gesture discipline it demands.
- Roster and share card stay custom overlay panels regardless (DESIGN.md section
  4 as amended). They are small, floating, and morph from chrome; the sheet can
  be none of those things.

DESIGN.md section 4 should record the verdict once the owner has felt this build:
either the clue browser is the one sanctioned non-modal system sheet, with the
glass-on-glass and dim-at-large costs written down, or the sheet is rejected and
I2c builds the custom panel with SP-i1's discipline rules.

## Device install

Succeeded, no lock prompt. Bundle `com.eamonma.Crossy` on the iPhone 17 Pro Max,
launched clean. Small detent up on launch; drag the sheet, tap clues, type on the
deck, tap the grid, moon-sun button in the room bar flips grounds.

## Evidence (scratchpad, never committed)

All under `/private/tmp/claude-501/-Users-eamonma-Documents-crossy-v4/1debdc75-4deb-46ba-9957-ff8c546e9382/scratchpad/sp-i5/`:

- `01-studio-small.png`, `05-obs-small.png` small detent, grid live behind
- `02-studio-mid.png`, `06-obs-mid.png` mid-drag geometry (intermediate height
  detent stands in for a finger; no headless touch injection), room dimmed,
  content pinned, edge lensing visible
- `03-studio-large.png`, `07-obs-large.png` the browser: sections, pinned bar,
  filled clues de-emphasized, current clue in violet
- `04-studio-postjump.png`, `08-obs-postjump.png` after the programmatic
  tap-to-jump: cursor on 24-Across, sheet poured back to small
- `09-studio-large-materialbg.png`, `10-studio-small-materialbg.png` the
  presentationBackground probe
- `dd-device/Build/Products/Debug-iphoneos/Crossy.app` the installed device build

Reinstall:

```
xcrun devicectl device install app --device 83D7B168-D3E8-5666-963E-AA4C6763EB54 "/private/tmp/claude-501/-Users-eamonma-Documents-crossy-v4/1debdc75-4deb-46ba-9957-ff8c546e9382/scratchpad/sp-i5/dd-device/Build/Products/Debug-iphoneos/Crossy.app"
```
