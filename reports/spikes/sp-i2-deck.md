# SP-i2: The deck in hand

**Question.** Does the clear-glass key deck hold up under real typing: press latency,
specular pop, haptic tick, sixty presses a minute? Rules ID-4 (apps/ios/DESIGN.md
section 9): clear interactive Liquid Glass pucks adopted, Studio-quiet solid keys the
named revert. Owner smoke test is the instrument.

**Verdict: OPEN, by design.** An agent cannot feel latency, specular pop, or a haptic
tick. Everything that can be proven from a keyboard is proven: the rig builds, runs on
an iOS 26.5 simulator with sane instrumentation on both variants and both grounds, and
is installed on the owner's iPhone 17 Pro Max. The ID-4 ruling waits on the owner's
hands. What to feel for: does variant A's pop plus tick survive sixty presses a minute
without visual noise over Studio bone and Observatory night, and does A ever smear or
lag where B stays crisp. If A proves too much in hand, B is the named revert.

## What was built

One screen in the Crossy app target (spike branch `spike/sp-i2-deck`, never merges):
an honest deck test rig in the real solve-stack position (EXPERIENCE.md section 3:
room bar / grid / clue bar / deck).

- A fake but honest context: frosted room bar with roster pucks and a calm weather
  dot, a 9x9 grid of solid cells with letters and blocks, a frosted clue bar. The
  deck sits over solid canvas, never over the grid (DESIGN.md section 4).
- The full deck: three rows of letters plus backspace. Typed letters land in a live
  entry row in the grid (cursor advances, wraps); backspace steps back.
- Two variants behind a segmented toggle on screen, identical geometry, only the
  material changes:
  - **A glass**: `glassEffect(.clear.interactive(), in: rounded rect)` inside a
    `GlassEffectContainer` (the ID-4 adopted register).
  - **B quiet**: flat cell-colored keys, ink glyphs, hairline gridLine border (the
    named revert).
- Ground toggle: Studio and Observatory, tokens straight from `CrossyDesign`
  (`Ground.studio` / `Ground.observatory`, roster colors, TypeScale glyph weights).
- Per press, both variants: a light `UIImpactFeedbackGenerator` tick plus a
  no-overshoot press spring (damping from `Motion.Springs`; response tightened to
  0.14 s so the pop reads at pace, flagged as a tuning candidate).

Code: `apps/ios/Crossy/Crossy/DeckSpikeView.swift` on the spike branch (commit
`d710eef`), wired into `ContentView`. Prototype code stays on the branch; this report
is the only merged artifact.

### How to drive it

Type on either variant and read the strip above the deck: variant, last press
latency, rolling average, presses per minute. Flip variant and ground mid-typing;
state persists. Launch arguments for scripted runs: `-deckVariant glass|quiet`,
`-deckGround studio|observatory`, `-deckAutoPress 1` (one synthetic press per
second, used for simulator evidence since `simctl` cannot synthesize touches).

## What the instrumentation shows

**What is measured.** Latency is the honest software share: from the touch-down
gesture callback to the `targetTimestamp` of the next `CADisplayLink` tick, the
expected on-glass time of the first frame that can carry the pressed state. It
excludes the hardware touch pipeline and compositor slack, so the felt number is
higher. First implementation used `link.timestamp` and read negative; the tick often
runs in the same runloop turn as the gesture handler, after it, carrying the vsync
already past. Closing against `targetTimestamp`, guarded to be after the press, fixed
it. PPM is a rolling 10 s window scaled to a minute.

**Simulator (iPhone 17 Pro, iOS 26.5, auto-press at 60 PPM):**

| variant, ground     | last ms | avg ms | ppm |
| ------------------- | ------- | ------ | --- |
| glass, Studio       | 9.0     | 11.4   | 60  |
| quiet, Studio       | 15.1    | 10.6   | 60  |
| glass, Observatory  | 11.3    | 10.2   | 60  |
| quiet, Observatory  | 5.5     | 8.4    | 60  |

Averages sit at 8 to 11 ms with no variant separation at this granularity. That is
expected: the simulator does not render glass at device fidelity and the measure is
frame scheduling, not material cost. The numbers prove the pipeline works and nothing
is pathologically slow; they do not rank the variants. Device numbers under real
thumbs are the ones that matter, and they render live in the readout strip.

**Device.** Built and installed on the owner's iPhone 17 Pro Max (automatic signing,
team MTF6T25BP8, no provisioning fight). Launch from the CLI failed only because the
phone was locked (`FBSOpenApplicationErrorDomain error 7, Locked`). Remedy: unlock
the phone and tap Crossy, or rerun the launch command below. No instrumented device
numbers yet for that reason.

## Honest limits

- The verdict stays open: latency feel, specular pop, and haptic character are
  owner-only observations, per the hardware-gated ruling.
- Measured latency is the software share only; add touch hardware and display
  pipeline on top.
- Simulator auto-press skips gesture recognition (state mutation to next tick), so
  simulator and device numbers are not directly comparable.
- The glass keys' interactive response (the system's own touch shimmer) is not
  captured by the metric at all; it is purely a felt thing.
- SP-i1 (glass SDK spike) shares bundle id `com.eamonma.Crossy`; whichever spike
  installs last is on the phone. Accepted; either reinstalls in one command.

## Reinstall

Built app: `/private/tmp/claude-501/-Users-eamonma-Documents-crossy-v4/1debdc75-4deb-46ba-9957-ff8c546e9382/scratchpad/sp-i2/dd-dev/Build/Products/Debug-iphoneos/Crossy.app`

```
xcrun devicectl device install app --device 83D7B168-D3E8-5666-963E-AA4C6763EB54 /private/tmp/claude-501/-Users-eamonma-Documents-crossy-v4/1debdc75-4deb-46ba-9957-ff8c546e9382/scratchpad/sp-i2/dd-dev/Build/Products/Debug-iphoneos/Crossy.app
xcrun devicectl device process launch --device 83D7B168-D3E8-5666-963E-AA4C6763EB54 com.eamonma.Crossy
```

If the scratchpad has been cleaned, rebuild from the spike branch first:

```
git checkout spike/sp-i2-deck
cd apps/ios/Crossy
xcodebuild -project Crossy.xcodeproj -scheme Crossy -destination 'platform=iOS,id=83D7B168-D3E8-5666-963E-AA4C6763EB54' -allowProvisioningUpdates build
```

## Screenshots (never committed)

In `/private/tmp/claude-501/-Users-eamonma-Documents-crossy-v4/1debdc75-4deb-46ba-9957-ff8c546e9382/scratchpad/sp-i2/`:

- `sim-glass-studio.png`, `sim-quiet-studio.png`
- `sim-glass-observatory.png`, `sim-quiet-observatory.png`
