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
        .testTarget(name: "CrossyUITests", dependencies: ["CrossyUI"]),
    ]
)
