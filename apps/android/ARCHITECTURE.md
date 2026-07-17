---
status: descriptive
---

# Crossy Android Architecture

Status: draft 1, written during the overnight port (2026-07-13). Owner review pending.
This is a **delta document**: `apps/ios/ARCHITECTURE.md` is the base spec. Everything
there holds here unless a section below says otherwise. Decision numbers continue the
iOS log as AAD-n (Android Architecture Decision).

## What carries over unchanged

- The shape (§1): modular monolith, CRUD shell as plain per-screen view models, one
  stateful store per connected game mirroring the server actor.
- The GameStore formalism (§3, AD-1): one inbound consumption loop as the client-side
  mailbox, sequenced state plus optimistic overlay (INV-10), engine called
  synchronously, render models out, effects behind ports. No TCA-equivalent
  (no Redux/MVI framework); the vectors are the formalism.
- Ports and adapters (§4, AD-6): ports defined in `:store`, adapters outward,
  reconnect logic is store code, adapters only sleep, jitter, and dial.
- Persistence (§6, AD-4): none beyond the secure token store in v1.
- Replay (§7): the store is pure over an injected transport; previews and tests feed
  it scripted frames or real `cell_events`.
- Testing (§9): client-store vectors against `:store`, contract snapshots against
  `packages/protocol` fixtures, integration harness against the local stack.

## Module graph (AAD-1, mirrors AD-2)

Gradle modules; arrows point inward only. An undeclared module dependency is an
unresolved import at compile time, so `settings.gradle.kts` plus each module's
dependency block is the dependency-cruiser, exactly as `Package.swift` is on iOS.

| module      | ring             | imports          | iOS twin         | JVM-pure |
| ----------- | ---------------- | ---------------- | ---------------- | -------- |
| `:engine`   | domain           | nothing          | `CrossyEngine`   | yes      |
| `:protocol` | domain edge      | kotlinx.ser      | `CrossyProtocol` | yes      |
| `:store`    | application      | engine, protocol | `CrossyStore`    | yes      |
| `:api`      | adapter          | protocol         | `CrossyAPI`      | yes      |
| `:session`  | adapter          | store, protocol  | `CrossySession`  | yes      |
| `:design`   | adapter          | nothing          | `CrossyDesign`   | yes      |
| `:ui`       | adapter          | store, design    | `CrossyUI`       | no       |
| `:app`      | composition root | everything       | app target       | no       |

JVM-pure modules build and test with no Android SDK: the whole domain core runs
headless on any CI box, and the integration round trip against the local stack is a
plain JVM test. Only `:ui` and `:app` need the Android toolchain.

`:design` stays JVM-pure by holding values, not framework types: ARGB ints, dp/sp
scalars, millisecond durations. `:ui` maps values to Compose types at the edge. This
is what lets token twins be snapshot-tested against the iOS/web values headlessly.

## Language and framework mapping

| iOS                             | Android                                          |
| ------------------------------- | ------------------------------------------------ |
| Swift 6 / SwiftPM               | Kotlin 2.2 / Gradle version catalog              |
| SwiftUI                         | Jetpack Compose (Material3 shell, custom canvas) |
| `@Observable` + `@MainActor`    | main-dispatcher-confined store, `StateFlow`      |
| `AsyncStream` of inbound frames | `Flow`/`Channel` of inbound frames               |
| `Codable` twins                 | `kotlinx.serialization` twins                    |
| `URLSessionWebSocketTask`       | OkHttp WebSocket                                 |
| Keychain                        | Android Keystore via EncryptedSharedPreferences  |
| XCTest vector runner            | JUnit 5 vector runner (dynamic tests per case)   |
| Canvas grid                     | Compose `Canvas` grid                            |

## Concurrency (AAD-2, mirrors AD-3)

The GameStore is confined to `Dispatchers.Main.immediate` and publishes a render
model via `StateFlow`. Compose reads it with `collectAsStateWithLifecycle`. The
transport adapter parses JSON off-main and delivers typed messages across the flow;
the main thread sees only cheap state transitions. Same rationale, same revisit
trigger (profiling on a 25x25 with a full room) as AD-3.

In JVM tests the store runs on a test dispatcher; nothing in `:store` names an
Android main looper (it is JVM-pure), so confinement is the composition root's job.

## Divergences from iOS, recorded

- **AAD-3 Auth v0 is dev-token/email.** Native Google Sign-In needs owner console
  work (the Android analog of the Apple Developer owner-held actions) and lands as
  its own track. The PKCE flow in `CrossyAPI` ports as-is when that happens.
- **AAD-4 No Live Activity analog in v1.** Android 16 Live Updates are the closest
  cousin and much weaker; recorded as post-v1, not scaffolded.
- **AAD-5 Identity placeholders.** `applicationId` is `dev.crossy.android` until the
  owner mints the Play identity; signing stays debug-only until then (first-time
  provisioning exception).
- **AAD-6 Widget/Glance deferred.** The iOS widget extension has no Android twin yet.

## Engine purity on this side of the fence (INV-9)

`:engine`'s main source set declares zero dependencies — no workspace modules, no
libraries. The vector runner's JSON parsing lives in the test source set only. A
guard test greps the build file so the empty dependency surface is CI-visible, the
same greppable-invariant pattern the repo uses everywhere (`INV-n` in test names).

## CI

`android.yml` mirrors `ios.yml`: a separate path-filtered workflow (`apps/android/**`,
`vectors/**`), ubuntu runner, JVM tests only — the vector families, contract
snapshots, and store suite all run without an emulator. App assembly on CI and
device tests are added when they earn their runtime cost.
