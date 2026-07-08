import Foundation

// Codable structs mirroring vectors/README.md's three case shapes, named with the
// shapes' own domain terms (DDD). Decoding is the first half of shape validation: a
// case that does not decode to its family's shape fails the run, straight from the
// bytes (no JSONSerialization round-trip, so number and boolean types are pinned
// exactly). `shapeProblems()` adds the semantic constraints Codable cannot express,
// mirroring the per-family `*ShapeProblems` checks in vectors.test.ts.

/// Any JSON object, and nothing else. Decoding fails (type mismatch) for arrays and
/// scalars. Used where the shape only requires "an object" without pinning its fields
/// (the assertion rule leaves unlisted fields unasserted; that comparison is Wave 3).
struct JSONObjectMarker: Decodable {
    init(from decoder: Decoder) throws {
        _ = try decoder.container(keyedBy: DynamicKey.self)
    }
}

/// A CodingKey that accepts any string key, for opening an arbitrary JSON object.
struct DynamicKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

// MARK: - Reducer

struct ReducerCase: Decodable {
    let name: String
    let given: ReducerGiven
    let when: [Command]
    let then: ReducerOutcome

    var label: String { name }

    func shapeProblems() -> [String] {
        var problems: [String] = []
        if when.isEmpty {
            problems.append("when: non-empty array of commands required")
        }
        for key in (given.cells ?? [:]).keys where !isDecimalKey(key) {
            problems.append("given.cells: key \"\(key)\" is not a decimal cell index")
        }
        return problems
    }
}

struct ReducerGiven: Decodable {
    let cols: Int
    let rows: Int
    let blocks: [Int]
    let status: String
    let seq: Int
    let cells: [String: Cell]?
    let firstFillAt: String?
}

/// A filled cell: value and attribution. Both keys must be present (null or string),
/// matching the TS `isCellMap` check; an absent key is a shape failure, an explicit
/// null is allowed (a cleared cell).
struct Cell: Decodable {
    let value: String?
    let by: String?

    enum CodingKeys: String, CodingKey {
        case value = "v"
        case by
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard container.contains(.value), container.contains(.by) else {
            throw DecodingError.dataCorrupted(
                .init(
                    codingPath: container.codingPath,
                    debugDescription: "cell requires both \"v\" and \"by\" (null or string)"))
        }
        value = try container.decodeIfPresent(String.self, forKey: .value)
        by = try container.decodeIfPresent(String.self, forKey: .by)
    }
}

/// A wire command plus server-side meta. The runner only pins `type`; the rest arrive
/// as data for the engine (INV-9) and are unasserted at the shape layer.
struct Command: Decodable {
    let type: String
}

struct ReducerOutcome: Decodable {
    let events: [Event]
    let state: JSONObjectMarker
}

struct Event: Decodable {
    let type: String
    let seq: Int
}

// MARK: - Comparator

struct ComparatorCase: Decodable {
    let solution: String
    let accept: [String]
    let reject: [String]

    var label: String { "solution \"\(solution)\"" }

    func shapeProblems() -> [String] {
        solution.isEmpty ? ["solution: non-empty string required"] : []
    }
}

// MARK: - Navigation

struct NavigationCase: Decodable {
    let name: String
    let given: NavigationGiven
    let when: NavigationMove
    let then: NavigationResult

    var label: String { name }

    func shapeProblems() -> [String] {
        var problems: [String] = []
        if given.cols < 0 {
            problems.append("given.cols: non-negative integer required")
        }
        if given.rows < 0 {
            problems.append("given.rows: non-negative integer required")
        }
        if when.direction != "across" && when.direction != "down" {
            problems.append("when.direction: \"across\" or \"down\" required")
        }
        if when.toward != "forward" && when.toward != "backward" {
            problems.append("when.toward: \"forward\" or \"backward\" required")
        }
        for key in (given.fills ?? [:]).keys where !isDecimalKey(key) {
            problems.append("given.fills: key \"\(key)\" is not a decimal cell index")
        }
        return problems
    }
}

struct NavigationGiven: Decodable {
    let cols: Int
    let rows: Int
    let blocks: [Int]
    let fills: [String: String]?
}

struct NavigationMove: Decodable {
    let direction: String
    let from: Int
    let toward: String
    let canEscapeWord: Bool?
}

struct NavigationResult: Decodable {
    let cell: Int
}
