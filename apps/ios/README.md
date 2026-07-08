# apps/ios

A SwiftPM package (no Xcode project). Two targets:

- **`CrossyEngine`** (`Sources/CrossyEngine`): the pure crossword domain, the Swift twin
  of `packages/engine` (DESIGN.md §5, INV-9: imports nothing, takes timestamps and user
  ids as data). It exports nothing today. The Wave 3 port lands here, driven red-to-green
  by the shared vectors under `vectors/` (ROADMAP.md Phase 3, Track C).
- **`VectorRunnerTests`** (`Tests/VectorRunnerTests`): the XCTest conformance vector
  runner, mirroring `packages/engine/src/vectors.test.ts`. It discovers every family
  directory under `vectors/v1`, decodes every case with Codable structs matching the
  three shapes in `vectors/README.md`, and gates execution on a checked skip manifest.

## Run

```
swift test --package-path apps/ios   # from the repo root
# or: cd apps/ios && swift test
```

Ten tests today: discovery and shape validation are hard pass/fail; the skip manifest is
checked, not trusted; one guard runs a real case against the unimplemented engine and
asserts it throws `no engine binding`, so CI stays green while proving red is real. The
`reducer` and `navigation` execution suites report as `XCTSkip` with their case lists
until Wave 3 binds the engine.

## Skip manifest

`vectors.skip.json` mirrors `packages/engine/vectors.skip.json`: every discovered family
is either bound to `CrossyEngine` (`EngineBindings.bound`) or listed here, and guard
tests fail the build if a listed family gains a binding or loses its vector files. Wave 3
adds each implemented family to `EngineBindings.bound` (plus a `case` in
`EngineBindings.run`) and removes it here.

## CI

`.github/workflows/ios.yml` runs `swift test` on `macos-latest`, path-filtered to
`apps/ios/**` and `vectors/**`. See that file for why the Swift port runs on macOS rather
than piggybacking on the Ubuntu JS job.

## Later (Phase 4, M5)

The SwiftUI app itself: Canvas grid renderer, `URLSessionWebSocketTask` with the shared
reconnect state machine, native Sign in with Apple, universal links. It builds on the
green engine and the same vectors. See ROADMAP.md.
