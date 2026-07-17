---
status: descriptive
verified: 133db08
---

# apps/ios

A SwiftPM package plus a thin, committed Xcode project (`Crossy/Crossy.xcodeproj`,
ARCHITECTURE.md AD-5). The package holds seven library targets; the project holds the app
target and the `CrossyWidgets` extension (the Live Activity). This file is orientation
only; ARCHITECTURE.md §2 (AD-2) owns the module graph and the ring rules.

## Targets

`Package.swift` declares seven libraries, each with a matching test target:

- **`CrossyEngine`**: the pure crossword domain, the Swift twin of `packages/engine`
  (INV-9: imports nothing; timestamps and user ids arrive as data). Implemented, bound,
  and green.
- **`CrossyProtocol`**: Codable twins of every wire and REST payload, pinned by contract
  snapshots.
- **`CrossyStore`**: GameStore, optimistic overlay, reconciliation, the connection state
  machine; the store ports are protocols defined here.
- **`CrossyAPI`**: REST client, auth session, Keychain, issuer-pinned tokens.
- **`CrossySession`**: the `URLSessionWebSocketTask` transport implementing the store's port.
- **`CrossyDesign`**: tokens (grounds, roster, type scale, motion); shared with the widget.
- **`CrossyUI`**: SwiftUI views, the Canvas grid, the key deck, haptics.

`VectorRunnerTests` runs the conformance vectors; the other seven suites
(`CrossyProtocolTests` through `CrossyUITests`) pin their own targets.

## Run

```
swift test --package-path apps/ios          # vectors plus every unit suite
# app target (signing disabled, simulator):
xcodebuild build -project apps/ios/Crossy/Crossy.xcodeproj -scheme Crossy \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

## Vector runner

`VectorRunnerTests` mirrors `packages/engine/src/vectors.test.ts`: it discovers every
family under `vectors/v1`, decodes every case with Codable structs, and gates on a checked
skip manifest. Discovery and shape validation are hard pass/fail; the manifest is checked,
not trusted.

The engine is bound. `EngineBindings.bound` is `reducer`, `navigation`, `comparator`,
`completion`, `check` (EngineBindings.swift): five families, none skipped, each with a
`case` in `run` that parses the vector, calls `CrossyEngine`, and asserts the vector's
`then`. Binding a family is a compile-time act (a `case` cannot name a symbol that does not
exist yet), so `bound` is the checked mirror the guard tests read.

`vectors.skip.json` carries two disjoint buckets. `families` (skipped-until-engine) is now
empty: the Wave 3 port bound every engine family and drained it, and a per-family guard
fails the build if a bound family reappears there. `foreign.families` are `client-store`
and `clue-runs`: consumers that are never the engine (the store; the clue-run renderer),
shape-validated here but executed by their own suites. A family that reaches `run` with no
binding falls through to `.noEngineBinding`; that path is now the foreign honest-failure
guard only.

## CI

`.github/workflows/ios.yml` runs on `macos-26`, pinned (not `macos-latest`): the glass
chrome needs the iOS 26 SDK, and the `macos-latest` label is mid-migration, a lottery
between Xcode versions with and without the glass symbols. Two jobs run per iOS-touching
push, path-filtered to `apps/ios/**` and `vectors/**`: `swift test` (the vector runner plus
the unit suites) and a signing-disabled simulator build of the app target. See the file for
why the Swift port runs on macOS rather than piggybacking on the Ubuntu JS job.
