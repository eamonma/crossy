import Foundation

// Conformance vector runner (PROTOCOL.md §13; conventions in vectors/README.md), the
// Swift twin of packages/engine/src/vectors.test.ts. Read that file's header for the
// reasoning; the shape is the same here.
//
// CrossyEngine is unimplemented until the Wave 3 Swift port, so case execution is gated
// by a checked skip manifest (apps/ios/vectors.skip.json): every discovered family is
// either bound to CrossyEngine (EngineBindings.bound) or listed in the manifest, and
// guard tests fail the build if the manifest goes stale. Discovery and shape validation
// are hard pass/fail; only execution is skipped, and only under the guarded manifest,
// so skipped cases surface as XCTSkip in the output rather than masquerading as passes.

/// The vector families (= directory names under vectors/v1). A closed set on purpose:
/// discovery fails on any directory not listed here, mirroring the TS `FAMILIES` const.
/// The remaining PROTOCOL.md §13 family (client store) registers a case here when its
/// wave lands.
enum VectorFamily: String, CaseIterable, Sendable {
    case reducer
    case comparator
    case navigation
    case completion
}

/// Locates the shared vector tree and this package's skip manifest from the compiled-in
/// source path. This file lives at apps/ios/Tests/VectorRunnerTests/VectorRunner.swift,
/// so the repo root is four directories up and vectors/ sits beside apps/.
enum RepoLayout {
    static let appsIOS: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // VectorRunnerTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
    static let repoRoot: URL = appsIOS
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repo root
    static let vectorsV1: URL = repoRoot.appendingPathComponent("vectors/v1", isDirectory: true)
    static let skipManifest: URL = appsIOS.appendingPathComponent("vectors.skip.json")
}

/// Failures that stop the run loudly, never silently. Discovery and manifest problems
/// throw these; the honest-failure guard asserts `.noEngineBinding` specifically.
enum VectorError: Error, CustomStringConvertible {
    case strayEntry(String)
    case unknownFamily(String)
    case strayFile(family: String, file: String)
    case notCaseArray(path: String)
    case badManifest(String)
    case unknownManifestFamily(String)
    case noEngineBinding(VectorFamily)

    var description: String {
        switch self {
        case .strayEntry(let name):
            return "vectors/v1 must contain only family directories, found \"\(name)\""
        case .unknownFamily(let name):
            return "unrecognized vector family \"\(name)\"; update vectors/README.md and this runner"
        case .strayFile(let family, let file):
            return "vectors/v1/\(family) must contain only .json files, found \"\(file)\""
        case .notCaseArray(let path):
            return "vectors/v1/\(path) must be a non-empty JSON array of case objects"
        case .badManifest(let message):
            return message
        case .unknownManifestFamily(let value):
            return "vectors.skip.json lists unknown family \"\(value)\""
        case .noEngineBinding(let family):
            return "no engine binding for vector family \"\(family.rawValue)\": "
                + "CrossyEngine is unimplemented until the Wave 3 Swift port (ROADMAP.md)"
        }
    }
}

/// ASCII-only decimal cell index, matching the TS `/^\d+$/` key check (INV-1: no
/// locale-aware digit shaping). This is one of the byte-parity pins: JS `\d` is ASCII
/// digits, so the Swift check is too, and never falls back to Unicode `isNumber`.
func isDecimalKey(_ key: String) -> Bool {
    !key.isEmpty && key.utf8.allSatisfy { $0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "9") }
}
