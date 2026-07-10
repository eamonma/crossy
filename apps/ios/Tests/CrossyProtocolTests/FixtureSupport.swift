import Foundation
import XCTest

import CrossyProtocol

// Contract snapshot plumbing (the D04 hand-kept-twin pattern; ARCHITECTURE.md §9).
// Fixtures are checked-in JSON under Tests/CrossyProtocolTests/Fixtures, located from
// the compiled-in source path exactly as VectorRunnerTests/RepoLayout locates vectors/,
// so `swift test` needs no bundle resources. Wire fixtures are the literal PROTOCOL.md
// examples with placeholders made concrete byte-for-byte as
// packages/protocol/src/codec.test.ts makes them, so the TS codec tests and these pin
// the two twins against the same normative samples; REST fixtures follow PROTOCOL.md
// §12's field lists (shapes per the API's own contract, which §12 defers to).

/// Fixture groups (= directory names under Fixtures/). A closed set on purpose, like
/// the vector runner's family enum: discovery of an unknown directory is a hard failure
/// in FixtureCoverageTests, never a silent skip.
enum FixtureGroup: String, CaseIterable {
    case wire
    case rest
}

/// Locates the checked-in fixtures from this file's compiled-in path (the
/// VectorRunnerTests/RepoLayout pattern).
enum FixtureLayout {
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyProtocolTests
        .appendingPathComponent("Fixtures", isDirectory: true)

    static func url(_ group: FixtureGroup, _ name: String) -> URL {
        root
            .appendingPathComponent(group.rawValue, isDirectory: true)
            .appendingPathComponent("\(name).json")
    }

    /// The fixture basenames on disk for a group. Strict: a non-.json entry throws, so
    /// a stray file cannot sit in the fixture tree unnoticed.
    static func namesOnDisk(_ group: FixtureGroup) throws -> Set<String> {
        let directory = root.appendingPathComponent(group.rawValue, isDirectory: true)
        let entries = try FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil)
        var names: Set<String> = []
        for entry in entries {
            guard entry.lastPathComponent.hasSuffix(".json") else {
                throw FixtureError.strayFile(group: group.rawValue, file: entry.lastPathComponent)
            }
            names.insert(String(entry.lastPathComponent.dropLast(".json".count)))
        }
        return names
    }
}

enum FixtureError: Error, CustomStringConvertible {
    case strayFile(group: String, file: String)

    var description: String {
        switch self {
        case .strayFile(let group, let file):
            return "Fixtures/\(group) must contain only .json files, found \"\(file)\""
        }
    }
}

func fixtureData(_ group: FixtureGroup, _ name: String) throws -> Data {
    try Data(contentsOf: FixtureLayout.url(group, name))
}

/// Parse JSON to its Foundation object graph for order-insensitive comparison
/// (NSDictionary/NSArray isEqual compares values deeply; JSON key order is not part of
/// the contract, PROTOCOL.md §2 frames are objects).
func jsonObject(_ data: Data) throws -> NSObject {
    // Force-cast is fine in test plumbing: every fixture is a JSON object or array.
    try JSONSerialization.jsonObject(with: data) as! NSObject
}

/// The core snapshot assertion: decode the fixture into the Swift twin, re-encode, and
/// require the result to reproduce the fixture's JSON exactly (explicit nulls kept,
/// absent optionals kept absent, no field lost, none invented). Also requires the
/// re-encoded bytes to decode back to an equal value, closing the loop.
@discardableResult
func assertLosslessRoundTrip<T: Codable & Equatable>(
    _ type: T.Type,
    _ group: FixtureGroup,
    _ name: String,
    file: StaticString = #filePath,
    line: UInt = #line
) throws -> T {
    let data = try fixtureData(group, name)
    let decoded = try JSONDecoder().decode(T.self, from: data)
    let reencoded = try JSONEncoder().encode(decoded)
    XCTAssertEqual(
        try jsonObject(reencoded), try jsonObject(data),
        "decode → re-encode of Fixtures/\(group.rawValue)/\(name).json must reproduce the fixture",
        file: file, line: line)
    XCTAssertEqual(
        try JSONDecoder().decode(T.self, from: reencoded), decoded,
        "re-decoding the re-encoded \(name) frame must be lossless",
        file: file, line: line)
    return decoded
}

/// Wire-frame pinning: the concrete message round-trips, and the `ClientMessage` union
/// routes the same frame to the same shape (the codec.ts decode switch, twinned).
@discardableResult
func pinClientFrame<T: Codable & Equatable>(
    _ type: T.Type,
    _ name: String,
    file: StaticString = #filePath,
    line: UInt = #line
) throws -> T {
    let decoded = try assertLosslessRoundTrip(type, .wire, name, file: file, line: line)
    let data = try fixtureData(.wire, name)
    let union = try JSONDecoder().decode(ClientMessage.self, from: data)
    let reencoded = try JSONEncoder().encode(union)
    XCTAssertEqual(
        try jsonObject(reencoded), try jsonObject(data),
        "ClientMessage union must round-trip Fixtures/wire/\(name).json",
        file: file, line: line)
    return decoded
}

/// Wire-frame pinning for the server direction, via the `ServerMessage` union.
@discardableResult
func pinServerFrame<T: Codable & Equatable>(
    _ type: T.Type,
    _ name: String,
    file: StaticString = #filePath,
    line: UInt = #line
) throws -> T {
    let decoded = try assertLosslessRoundTrip(type, .wire, name, file: file, line: line)
    let data = try fixtureData(.wire, name)
    let union = try JSONDecoder().decode(ServerMessage.self, from: data)
    let reencoded = try JSONEncoder().encode(union)
    XCTAssertEqual(
        try jsonObject(reencoded), try jsonObject(data),
        "ServerMessage union must round-trip Fixtures/wire/\(name).json",
        file: file, line: line)
    return decoded
}

/// Every JSON object key in a parsed document, recursively. Used by the INV-6 sweep.
func allJSONKeys(in value: Any) -> [String] {
    var keys: [String] = []
    if let dictionary = value as? [String: Any] {
        for (key, nested) in dictionary {
            keys.append(key)
            keys.append(contentsOf: allJSONKeys(in: nested))
        }
    } else if let array = value as? [Any] {
        for element in array {
            keys.append(contentsOf: allJSONKeys(in: element))
        }
    }
    return keys
}

/// Every stored-property label reachable from a value, recursively, via reflection.
/// Used by the INV-6 sweep: the property names of the Swift twins themselves.
func allStoredPropertyLabels(of value: Any) -> [String] {
    var labels: [String] = []
    func walk(_ current: Any) {
        for child in Mirror(reflecting: current).children {
            if let label = child.label {
                labels.append(label)
            }
            walk(child.value)
        }
    }
    walk(value)
    return labels
}
