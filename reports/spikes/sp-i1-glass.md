---
status: archive
---

# SP-i1: Liquid Glass against the real SDK

Ran 2026-07-10 against Xcode 26.5 (iOS 26.5 SDK), iPhone 17 Pro simulator (iOS 26.3),
and a connected iPhone 17 Pro Max. Prototype lives on branch `spike/sp-i1-glass`
(never merges); it is also installed on the owner's iPhone as `com.eamonma.Crossy`
for by-hand checks. Verified API names, from the SDK's swiftinterface: `glassEffect(_:in:)`
with `Glass` (`.regular`, `.clear`, `.identity`, `.tint(_:)`, `.interactive(_:)`),
`GlassEffectContainer(spacing:content:)`, `glassEffectID(_:in:)`,
`glassEffectTransition(.matchedGeometry | .materialize | .identity)`,
`glassEffectUnion(id:namespace:)`, and button styles `.glass` / `.glassProminent`.

## 1. The melt

Yes, but not with the API the name suggests. The `glassEffectID` route (two views,
bar swapped for browser inside one `GlassEffectContainer`) does not scrub geometry
with the driving animation in the simulator: under `withAnimation(.linear(duration: 8))`
the bar is gone and the browser is at final size within one 100 ms frame, while view
content crossfades over the full 8 s. Same result at Apple-sample scale (72 pt circle
to 240 pt pill) and with `.glassEffectTransition(.matchedGeometry)` set explicitly,
so it is not a scale or configuration issue. Apple documents simulator glass as
reduced fidelity, so the device may render the ID morph properly; the installed
build's Melt and Ctl scenarios settle that by hand. The genuine melt that works
everywhere: one persistent view carrying `.glassEffect`, whose height, width, and
corner radius interpolate with a progress value. That renders live glass at every
intermediate geometry (frame strips and stills at p = 0.25 / 0.5 / 0.75), scrubs
under a finger, and pours back below a release threshold. Recommended pattern for
I2c: the clue bar and clue browser are a single glass surface whose shape is a
function of drag progress, content crossfading inside; reserve `glassEffectID`
swaps for same-scale pieces (roster pucks, invite capsule) pending the device check.

## 2. Sheets

No. Glass morphs do not compose with `.sheet`. With the bar's `glassEffectID` and
the sheet content sharing one namespace, presentation is a hard cut: the bar
vanishes on the first frame and the sheet slides in on the standard curve. There is
no glass continuity across a presentation boundary. A real sheet also dims the board
behind it and supplies its own surface, so glass inside a sheet is glass on glass,
which section 4's never-list forbids. Decision: the clue browser (and roster, and
share card) must be custom overlays in the same view hierarchy as the bars they
replace, not `.sheet` presentations. DESIGN.md's "a sheet replaces a bar" holds only
if "sheet" means our own glass panel; the system sheet cannot play that role.

## 3. Interactive glass

Composes. Key-deck buttons at 32x46 pt with `.glassEffect(.clear.interactive(),
in: .rect(cornerRadius: 8))` render inside the same `GlassEffectContainer` as the
morphing clue bar, alongside `.buttonStyle(.glass)` and `.glassProminent` pucks; no
conflicts, no layout surprises. One real finding: container `spacing` blends
neighboring glass shapes into a single melted blob (the metaball union), which at
spacing 24 fuses adjacent keys into wavy rows. For a deck of discrete keys, use a
tight spacing, a separate container, or explicit `glassEffectUnion` groups where
fusion is wanted. Press latency and specular pop could not be exercised headlessly
(no touch injection into the simulator without assistive access), so the felt
response is a by-hand check on the installed build; SP-i2 owns deck feel on device
regardless.

## 4. Reduce Transparency

Could not be driven headlessly on this runtime, so the free fallback is unverified
in captures. `simctl spawn <udid> defaults write com.apple.Accessibility
ReduceTransparencyEnabled -bool true` persists and reads back 1, but the iOS 26.3
simulator's accessibility server ignores it across app relaunch, device reboot, and
SpringBoard respring; Xcode 26.5's `simctl ui` exposes only appearance,
increase_contrast, and content_size, and there is no `simctl accessibility`
subcommand. Two minutes in Settings on the owner's phone closes this: the harness
ribbon prints the live RT state. What we did capture: Increase Contrast
(`simctl ui <udid> increase_contrast enabled`) hardens glass for free, rendering
the bar near-opaque with the lattice barely visible, which suggests the system
gives a usable automatic densification in accessibility modes. Per the never-list
we do not rely on it: the harness includes the considered solid fallback (opaque
paper surface, hairline rule, soft shadow) behind an environment flag, applied by
a single `chrome()` modifier that swaps `glassEffect` for the solid surface
app-wide. That modifier shape is the production pattern; the free system fallback
is not a substitute for the designed one.

## Amendments needed

- DESIGN.md section 4: in the standing-pieces table and the morph grammar, "sheets"
  must mean our own glass panels in the main hierarchy. Add a line to the never-list
  or the morph grammar: the clue browser, roster, and share card are custom overlay
  panels; system `.sheet` cannot morph and stacks glass.
- DESIGN.md section 10: the open item can close as follows. The melt is expressible
  as single-surface geometry interpolation (no crossfade fallback needed for the
  clue bar); `glassEffectID` swaps crossfade-and-snap in the simulator and are
  pending a device check before any same-scale morph (roster cluster, island)
  depends on them. If the device also snaps, those morphs take the recorded
  crossfade fallback, never a modal.
- ROADMAP I2c: specify the chrome as one drag-scrubbed glass surface for
  bar-to-browser plus custom overlays for the other panels; add the device
  verification of `glassEffectID` (and RT rendering) as the first I2c task since
  the spike app is already installed.

## Device install

Succeeded. The spike harness (bundle id `com.eamonma.Crossy`, replacing the shell
install) is on the iPhone 17 Pro Max and launches to an in-app picker: Melt
(tap or fling the bar), Drag (finger-scrubbed melt), Sheet, Deck (interactive
keys), Ctl (small-scale ID morph), plus a solid-fallback toggle for comparing
chrome treatments against Settings > Accessibility > Reduce Transparency.

## Evidence (scratchpad, never committed)

All under `/private/tmp/claude-501/-Users-eamonma-Documents-crossy-v4/1debdc75-4deb-46ba-9957-ff8c546e9382/scratchpad/sp-i1/`:

- `01-melt-bar.png`, `02-melt-browser.png` end states of the glassEffectID melt
- `03-melt-mid-a.png`, `03-melt-id-swap-next-frame.png` the snap: full geometry one frame after toggle
- `04-melt-filmstrip.png`, `05-melt-transition-strip.png` linear 8 s ID swap, 2 and 10 fps
- `06-control-morph-strip.png`, `07-control-morph-explicit.png` small-scale control, default and explicit matchedGeometry
- `08-drag-melt-strip.png`, `09-drag-p0.25/0.5/0.75.png` single-surface melt, animated and static
- `10-sheet-presented.png`, `11-sheet-transition-strip.png` sheet cut, no morph
- `12-deck.png` interactive keys, container fusion visible
- `16-ic-bar.png`, `17-ic-browser.png` Increase Contrast system hardening
- `18-solid-bar.png`, `19-solid-browser.png` built solid fallback
- `melt.mov`, `control.mov`, `control2.mov`, `drag.mov`, `sheet.mov` source recordings
