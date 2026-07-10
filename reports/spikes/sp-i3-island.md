# SP-i3: Live Activity solve timer from a fixed `firstFillAt`

**Question.** Does a Live Activity with `Text(timerInterval:)` anchored at a fixed
past date give us the shared solve timer for free: native ticking with zero
ActivityKit updates, surviving app death, correct in the Dynamic Island (compact
and expanded) and on the lock screen? (Root DESIGN.md D15; blocks I5a.)

**Answer: yes, completely.** One `Activity.request` with an empty `ContentState`
and `firstFillAt` in the attributes is the whole mechanism. The system renders and
ticks the timer; the app sends zero updates and can die. Measured on an iPhone 17
Pro Max simulator (iOS 26.5): with the app process confirmed absent (`ps` checked
at both ends of the window), the island timer advanced 6:53 to 8:12 across a 78
second gap, exactly wall clock. Compact island, expanded island, and the lock
screen presentation all render. The same build runs on the owner's physical
iPhone 17 Pro Max: activity started, app SIGKILLed via devicectl, widget renderer
processes stayed alive, so the island is ticking on the phone with the app dead.

Spike code lives on `spike/sp-i3-island` and never merges. This report is the
merged artifact.

## The mechanism

- `SolveActivityAttributes` has `firstFillAt: Date` in the attributes (immutable at
  request time) and an empty `ContentState`. Nothing to update, nothing to push.
- The widget renders
  `Text(timerInterval: firstFillAt...firstFillAt + 24h, countsDown: false)` with
  `.monospacedDigit()`. The end bound is an arbitrary horizon; the timer freezes if
  the range ends, so the real app should pick a horizon past the 8 hour system cap.
- The timer text is greedy in the compact island; cap it with
  `.frame(maxWidth:)` and trailing alignment or it shoves the leading region.
- Starting with `firstFillAt` a few minutes in the past renders the correct
  nonzero elapsed time from the first frame. Joining an in-progress solve is free.

## Fidelity

- Compact: pucks leading, timer trailing, black glass. Reads like the room bar
  condensed, per apps/ios/DESIGN.md section 8.
- Expanded (long press): leading region takes the pucks, trailing takes the
  timer, bottom region available for the room line. Geometry is system-owned;
  capsule continuity with the room bar is credible.
- Lock screen and the pull-down cover sheet render the same banner:
  `.activityBackgroundTint(.black)` gives the black glass capsule.
- System caps to know for I5a: an activity without pushes runs at most 8 hours in
  the island (12 on the lock screen), then the system ends it. Fine for evening
  puzzles; the away-completion moment needs the push track regardless.

## Extension target: hand-authored pbxproj worked

First try, no Xcode clicks. The recipe, all in
`apps/ios/Crossy/Crossy.xcodeproj/project.pbxproj`:

- `PBXNativeTarget` of type `com.apple.product-type.app-extension`, product
  `CrossyWidgets.appex`, bundle id `com.eamonma.Crossy.CrossyWidgets`, same team,
  iOS 26.0, `SKIP_INSTALL = YES`.
- Extension point via a four-line `CrossyWidgets/Info.plist`
  (`NSExtension > NSExtensionPointIdentifier = com.apple.widgetkit-extension`)
  with `GENERATE_INFOPLIST_FILE = YES` and `INFOPLIST_FILE` both set, plus a
  `PBXFileSystemSynchronizedBuildFileExceptionSet` excluding Info.plist from the
  synchronized folder membership (otherwise it double-builds as a resource).
- `PBXFileSystemSynchronizedRootGroup` per folder. A `Shared/` folder listed in
  both targets' `fileSystemSynchronizedGroups` is the cheapest way to compile one
  attributes file into app and extension. I5a should decide between this and the
  CrossyDesign package import named in ARCHITECTURE.md; the package route needs
  platform guards around `import ActivityKit`.
- App target: `Embed Foundation Extensions` copy phase (`dstSubfolderSpec = 13`,
  `RemoveHeadersOnCopy`), a target dependency via container proxy, and
  `INFOPLIST_KEY_NSSupportsLiveActivities = YES`.
- Empty Frameworks phase suffices; Swift autolinks WidgetKit and ActivityKit.

A throwaway `CrossyUITests` target was also hand-added (same pattern, product type
`com.apple.product-type.bundle.ui-testing`) because simctl cannot send gestures:
the test long-presses the island for the expanded view and pulls down the cover
sheet for the lock screen presentation, writing PNGs from `XCUIScreen`. simctl
also cannot lock the sim, and osascript keystrokes need an Accessibility grant.

Simulator quirk worth remembering: with several booted simulators, another
session's `simctl <cmd> booted` picks one arbitrarily and can relaunch your app,
which is why the kill proof re-verifies process absence at both ends.

## What I5a needs from the real app

- The attributes type with `firstFillAt` (and probably room code and roster
  colors, all immutable); `ContentState` stays empty until the push track.
- Start on backgrounding an ongoing room, per EXPERIENCE.md section 4. Request
  during the scenePhase transition (`.inactive`), not after `.background`;
  ActivityKit requires effective foreground at request time. The spike started
  from foreground only; verify the transition timing in I5a.
- No activity before the first fill (there is no anchor yet; ID-2 keeps the
  pre-fill timer a quiet 0:00 in the room bar, not on the island).
- End on completion or leave: `activity.end(nil, dismissalPolicy:)`; also end any
  stale activities for the room on foreground reconnect.
- `ActivityAuthorizationInfo().areActivitiesEnabled` gate; the user can disable
  Live Activities per app.

## Reproduce

Simulator: build scheme `Crossy` for any island simulator, launch with
`--autostart`, `simctl terminate` the app, watch the island tick.

Device (bundle id is shared across spikes; last install wins, accepted):

```
cd apps/ios/Crossy
xcodebuild -scheme Crossy -destination 'platform=iOS,id=83D7B168-D3E8-5666-963E-AA4C6763EB54' \
  -derivedDataPath /tmp/crossy-sp-i3 -allowProvisioningUpdates build
xcrun devicectl device install app --device 83D7B168-D3E8-5666-963E-AA4C6763EB54 \
  /tmp/crossy-sp-i3/Build/Products/Debug-iphoneos/Crossy.app
xcrun devicectl device process launch --device 83D7B168-D3E8-5666-963E-AA4C6763EB54 \
  com.eamonma.Crossy --autostart
```

Signing was automatic (team MTF6T25BP8); `-allowProvisioningUpdates` minted the
extension's profile without owner action.

## Evidence (session scratchpad, never committed)

`/private/tmp/claude-501/-Users-eamonma-Documents-crossy-v4/1debdc75-4deb-46ba-9957-ff8c546e9382/scratchpad/sp-i3/`

- `01-app-started.png` app foreground, activity requested, anchor now - 3:47
- `02-island-after-kill.png` compact island 4:27 after `simctl terminate`
- `03-island-65s-later.png` 5:56, no relaunch, no updates
- `04-kill-proof-t0.png` 6:53 with zero app processes (ps verified)
- `05-kill-proof-t65.png` 8:12, 78 s later, still zero app processes
- `06-home-compact.png` compact island, pucks leading, timer trailing
- `07-island-expanded.png` expanded island via long press
- `08-notification-center-lock-presentation.png` lock screen presentation,
  black glass capsule, timer 13:07
