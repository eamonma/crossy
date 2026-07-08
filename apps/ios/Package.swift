// swift-tools-version:6.0
import PackageDescription

// Wave 0.2b: the Swift half of the M0 vector proof. `CrossyEngine` is the empty target
// the Wave 3 port lands in (DESIGN.md §5, INV-9: pure domain, imports nothing).
// `VectorRunnerTests` is the XCTest runner that consumes the shared JSON under
// vectors/, mirroring packages/engine/src/vectors.test.ts. No Xcode project: SwiftPM
// only, so `swift test` is the whole story on macOS and Linux alike.
let package = Package(
    name: "CrossyEngine",
    products: [
        .library(name: "CrossyEngine", targets: ["CrossyEngine"])
    ],
    targets: [
        .target(name: "CrossyEngine"),
        .testTarget(
            name: "VectorRunnerTests",
            dependencies: ["CrossyEngine"]
        ),
    ]
)
