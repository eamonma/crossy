---
status: descriptive
verified: 133db08
---

# Crossy iOS Architecture

Status: draft 1, for owner review. Date: 2026-07-10.
Companions: `apps/ios/DESIGN.md` (look and feel), `apps/ios/EXPERIENCE.md` (product
and UX), `apps/ios/ROADMAP.md` (execution).

**Scope and precedence.** This document owns the app-internal architecture of
`apps/ios`: module graph, state formalism, concurrency, ports, persistence, and the
testing strategy that pins it all. It realizes the client contract the root
`DESIGN.md` section 4 already sets (protocol codec / store / views, three rings,
dependencies inward); it owns no semantics, which stay with `PROTOCOL.md` and
`vectors/`. Decisions carry AD numbers; **proposed** means adopted as the working
default, ratified by the owner merging this document.

## 1. The shape

The app is a modular monolith with one stateful core, the api/session fault line
replayed in miniature. Shell screens (Rooms, create, join, account) are plain CRUD
over REST: per-screen `@Observable` view models, boring on purpose. The room is a
stateful realtime core: one store per connected game, built as the client mirror of
the server's per-game actor. Pattern follows the nature of the context, not a
uniform ideology.

## 2. Module graph (AD-2)

SwiftPM targets; arrows point inward only; an undeclared import is a compile error,
so the target graph is the dependency-cruiser and the layering ceremony is one
`Package.swift`. Guard tests keep the hard rules greppable, as the vector runner
already does for engine purity.

| target           | ring             | imports          | contents                                                                                      |
| ---------------- | ---------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `CrossyEngine`   | domain           | nothing          | exists; reducer, navigation, comparator twin; frozen and pure (INV-9)                         |
| `CrossyProtocol` | domain edge      | Foundation       | Codable twins of every wire and REST payload, pinned by contract snapshots                    |
| `CrossyStore`    | application      | Engine, Protocol | GameStore, overlay, reconciliation, connection state machine; ports defined here as protocols |
| `CrossyAPI`      | adapter          | Protocol         | REST client, auth session, Keychain, the issuer-pinned token handling                         |
| `CrossySession`  | adapter          | Store, Protocol  | `URLSessionWebSocketTask` transport implementing the store's port                             |
| `CrossyDesign`   | adapter          | Foundation       | tokens: grounds, roster, type scale, motion constants; shared with the widget extension       |
| `CrossyUI`       | adapter          | Store, Design    | SwiftUI views, Canvas grid, key deck, haptics                                                 |
| app target       | composition root | everything       | wiring, navigation shell, scenePhase, universal links, Live Activity                          |

The Live Activity ships as a widget extension importing `CrossyDesign` plus a small
shared attributes type; its exact home is formalized at Phase I5, recorded here so
the graph has no surprise edge.

## 3. The GameStore (AD-1)

The session service's core insight was that the Game aggregate needs a runtime: one
mailbox, single writer, total order. The client has the same need in miniature.

One `GameStore` per connected game. It consumes a single `AsyncStream` of inbound
messages from the transport port; that one consumption loop is the client-side
mailbox, so event application and local intents interleave in one total order. The
store owns sequenced state, the optimistic overlay, the connection state machine,
presence, and the derived timer origin; it applies the reconciliation rules the
client-store vectors pin (INV-10: sequenced state plus overlay, nothing else); it
calls the engine synchronously for navigation and optimistic echo; and it publishes
a render model that views are pure functions of. Intents flow in, render models
flow out, effects live behind ports.

**Rejected: TCA.** It would put a third-party framework at the app's spine
(major-version churn, macros, its own idioms) to provide a reducer formalism we
already have: the vectors are our formalism, and the domain core is already pure
and pinned. The repo's ethos is no framework until it hurts, and TCA also makes
every subagent diff harder to review, because correctness hides behind library
idioms instead of sitting in plain Swift.

**Rejected: MVVM everywhere.** Game state is one shared, sequenced truth.
Fragmenting it across per-screen view models is how double sources of truth and
INV-10 violations creep in. MVVM survives exactly where its cohesion is right: the
CRUD shell.

**The honest cost** of owning the formalism: no community documentation, and
badly reinventing TCA is a real failure mode. Bounded three ways: the store's
behavior is pinned by shared vectors that fail CI on drift, the scope is one store
rather than a framework, and the server actor is the working precedent for the
shape.

## 4. Ports and adapters

Ports are protocols defined in `CrossyStore` (the inner ring names what it needs);
adapters implement them outward.

- **Transport**: connect, an `AsyncStream` of inbound frames, async send, close.
  `CrossySession` implements it. The reconnect _logic_ (which state, which attempt,
  what the backoff schedule says) is pure store code where the vectors can pin it;
  the adapter only sleeps, jitters, and dials.
- **TokenProvider**: an async current-token accessor. `CrossyAPI` implements it
  over the Keychain session, honoring the pinned ref-domain issuer
  (deploy/README.md).
- **Haptics and celebration** effects: thin ports so the store can request a tick
  without importing UIKit, and tests can assert the request without a device.
- The app target is the composition root: it wires adapters into stores and owns
  nothing else of substance.

## 5. Concurrency (AD-3)

The GameStore is `@MainActor` and `@Observable`. Rationale: SwiftUI reads it
synchronously with no hop; worst-case event rates (a lively room is tens of frames
a second) are trivial for the main thread; and apply is O(1) per event by
construction. The transport adapter runs off-main (its own task/actor), parses
JSON there, and delivers typed messages across the stream, so the main thread sees
only cheap state transitions. The named alternative, an isolated store actor with a
published snapshot, buys thread independence the event rates do not justify and
pays an await on every view read; it is rejected for v1 and revisited only if
profiling on a 25x25 with a full room disagrees.

## 6. Persistence (AD-4)

No game-state database in v1: no SwiftData, no CoreData, no local model of sequenced
board state. The server is the system of record, a full resync costs about 3 KB
compressed (PROTOCOL.md section 1), and persisting game state would quietly reinvent
the offline posture D19 deliberately deferred.

What does persist is narrow, client-local, and never a shadow of the shared truth:

- **`NavigationSettingsStore`** (CrossyUI): per-device typing preferences in
  UserDefaults, off the wire entirely (INV-6 untouched; nothing here is a game mutation).
- **`ReactionSetStore`** (CrossyUI): a UserDefaults mirror of the account's reaction set
  from `GET /me`, cached so a cold start offline still shows the last-known five. A
  mirror, never a writer; `PATCH /me` is the single write path (D25).
- **`IslandAvatarStore`** (Crossy/Shared): downscaled avatar PNGs written to the App
  Group container via FileManager, so the widget renders island pucks with no network
  and no async load. The colored initial is always the floor.

Each is a lightweight preference or cache entering behind its own seam, not a schema
the GameStore knows about. Cache further when it hurts, still as an adapter behind a port.

## 7. Replay is the superpower

Because the store is pure over an injected transport, the room runs anywhere. Tests
feed it the client-store vectors. Xcode previews feed it a scripted transport, so
the full solve screen renders live fixtures with no server. And because replay is
deterministic (INV-1), any real game's `cell_events` can be replayed through the
store as a preview fixture: cursors, flashes, completion, the mosaic, all exactly
as they happened. Taste iteration on the grid and motion happens against real
solves at zero infrastructure cost. This property is worth more than any framework
and is defended by the same vectors that create it.

## 8. Project shell (AD-5)

A thin, committed `.xcodeproj` whose sources live in the SwiftPM package; the
project file exists to hold the app target, entitlements, and the widget extension,
and it changes rarely. It is created once by the owner in Xcode (the first-time
provisioning exception in `CLAUDE.md`), then maintained as config. No project
generators until it hurts, mirroring the root's no-orchestrator rule.

## 9. Testing

- **Client-store vectors** run in XCTest against `CrossyStore`: overlay clear on
  echo and on non-fatal error, gap to sync, crash rollback, reconciliation against
  `recentCommandIds` with `agedOut` as case input. This drains the `client-store`
  foreign family from `vectors.skip.json` into a bound consumer, per that
  manifest's own rules. This is the drift fence between the web and iOS stores.
- **Contract snapshots** pin `CrossyProtocol` against the schemas in
  `packages/protocol` (the D04 hand-kept-twin pattern).
- **Integration** (roadmap I1e): the local stack, an injected token, a real socket
  round trip; teardown and orphan sweep are part of the harness.
- **Canvas goldens** for the grid's module rules are deferred and named here so
  the gap is visible; the web grid carries the same rules with no image goldens
  either, and the rules themselves live in root DESIGN.md section 10.

## 10. Decision log

- **AD-1 The room runs on our own store formalism, not TCA** (proposed). The
  client mirror of the server actor: one mailbox, one writer, vector-pinned.
  Rejected: TCA, MVVM-everywhere (section 3).
- **AD-2 Module graph as tabled in section 2** (proposed). The compiler is the
  boundary lint.
- **AD-3 The GameStore is MainActor** (proposed). Revisit only on profiling
  evidence; the dedicated-actor alternative is named in section 5.
- **AD-4 No game-state database in v1** (amended). No SwiftData/CoreData model of
  sequenced state; the Keychain session plus three lightweight client-local stores
  (typing prefs, the reaction-set mirror, the island avatar cache; section 6). Cache
  further when it hurts, behind a port.
- **AD-5 Thin committed Xcode project over SwiftPM sources; no generators**
  (proposed). Created once by the owner; provisioning exception.
- **AD-6 Reconnect logic is store code; adapters only sleep, jitter, and dial**
  (proposed). Keeps the state machine under the vectors.
- **AD-7 Pattern per context: MVVM shell, single-store room** (proposed). The
  api/session fault line in miniature.
