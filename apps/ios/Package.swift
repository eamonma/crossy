// swift-tools-version:6.0
import PackageDescription

// The AD-2 module graph (apps/ios/ARCHITECTURE.md §2). Arrows point inward only and an
// undeclared import is a compile error, so this manifest is the app's dependency-cruiser
// and the layering ceremony is this one file. `CrossyEngine` predates the graph (Wave
// 0.2b/3): the pure domain twin, INV-9, imports nothing; `VectorRunnerTests` is its
// XCTest vector runner mirroring packages/engine/src/vectors.test.ts. The app-facing
// targets scaffold empty in Phase I0 and fill per apps/ios/ROADMAP.md; the app target
// and the widget extension live in the thin Xcode project (AD-5), never here. All test
// targets are declared up front so build waves add sources without editing this file.
let package = Package(
    name: "Crossy",
    // The app's decided floor (iOS 18, owner ruling 2026-07-10: glass needs 26, so
    // 18 through 25 renders chrome as one simple blur material fallback) and the
    // macOS the test host actually needs (@Observable wants 14). Without this, an iOS
    // build of the package assumes SwiftPM's oldest default and async protocol
    // requirements fail with "concurrency is only available in iOS 13.0.0 or newer".
    platforms: [
        .iOS("18.0"),
        .macOS(.v14),
    ],
    products: [
        .library(name: "CrossyEngine", targets: ["CrossyEngine"]),
        .library(name: "CrossyProtocol", targets: ["CrossyProtocol"]),
        .library(name: "CrossyStore", targets: ["CrossyStore"]),
        .library(name: "CrossyAPI", targets: ["CrossyAPI"]),
        .library(name: "CrossySession", targets: ["CrossySession"]),
        .library(name: "CrossyDesign", targets: ["CrossyDesign"]),
        .library(name: "CrossyUI", targets: ["CrossyUI"]),
    ],
    targets: [
        // domain: reducer, navigation, comparator twin; frozen and pure (INV-9)
        .target(name: "CrossyEngine"),
        // domain edge: Codable twins of every wire and REST payload (PROTOCOL.md §2–12)
        .target(name: "CrossyProtocol"),
        // application: GameStore, overlay, reconciliation, connection state machine (AD-1)
        .target(name: "CrossyStore", dependencies: ["CrossyEngine", "CrossyProtocol"]),
        // adapter: REST client, auth session, Keychain, issuer-pinned token handling
        .target(name: "CrossyAPI", dependencies: ["CrossyProtocol"]),
        // adapter: URLSessionWebSocketTask transport implementing the store's port
        .target(name: "CrossySession", dependencies: ["CrossyStore", "CrossyProtocol"]),
        // adapter: tokens (grounds, roster, type scale, motion); shared with the widget
        .target(name: "CrossyDesign"),
        // adapter: SwiftUI views, Canvas grid, key deck, haptics
        .target(name: "CrossyUI", dependencies: ["CrossyStore", "CrossyDesign"]),
        .testTarget(name: "VectorRunnerTests", dependencies: ["CrossyEngine"]),
        // Fixtures/ holds the contract-snapshot JSON, read from the checkout via
        // #filePath (the VectorRunnerTests pattern), so it is excluded, not bundled.
        .testTarget(
            name: "CrossyProtocolTests", dependencies: ["CrossyProtocol"],
            exclude: ["Fixtures"]),
        .testTarget(name: "CrossyStoreTests", dependencies: ["CrossyStore"]),
        .testTarget(name: "CrossyAPITests", dependencies: ["CrossyAPI"]),
        .testTarget(name: "CrossySessionTests", dependencies: ["CrossySession"]),
        .testTarget(name: "CrossyDesignTests", dependencies: ["CrossyDesign"]),
        // CrossyEngine appears here for parity pinning only (GridPuzzle's restated
        // word-run rule held against the engine's wordBounds, the vector-runner
        // pattern); the shipping CrossyUI target still may not import it (AD-2).
        .testTarget(name: "CrossyUITests", dependencies: ["CrossyUI", "CrossyEngine"]),
    ]
)
