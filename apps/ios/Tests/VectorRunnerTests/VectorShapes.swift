import Foundation

// Codable structs mirroring vectors/README.md's case shapes, named with the
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
    /// PROTOCOL.md §11 code for a rejected command (vectors/README.md rejection
    /// convention): empty events, unchanged state, and this code alongside them. A
    /// rejection consumes no seq (INV-2). Unasserted when absent, per the assertion
    /// rule; an accepted no-op has no error and emits one cellSet.
    let error: String?
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

// MARK: - Completion

/// Completion is its own family because the two-phase check needs the cell solutions,
/// which the reducer shape does not carry, and it asserts `gameCompleted`, which the
/// reducer never emits (vectors/README.md; PROTOCOL.md §10, §13).
struct CompletionCase: Decodable {
    let name: String
    let given: CompletionGiven
    let when: [Command]
    let then: CompletionOutcome

    var label: String { name }

    func shapeProblems() -> [String] {
        var problems: [String] = []
        if when.isEmpty {
            problems.append("when: non-empty array of commands required")
        }
        for key in given.solution.keys where !isDecimalKey(key) {
            problems.append("given.solution: key \"\(key)\" is not a decimal cell index")
        }
        for (key, value) in given.solution where value.isEmpty {
            problems.append("given.solution: cell \(key) requires a non-empty string")
        }
        for key in (given.cells ?? [:]).keys where !isDecimalKey(key) {
            problems.append("given.cells: key \"\(key)\" is not a decimal cell index")
        }
        return problems
    }
}

/// The reducer's given plus `solution`, the sparse map of cell index to solution string
/// the comparator runs over. Required: a completion case without it fails decoding.
struct CompletionGiven: Decodable {
    let cols: Int
    let rows: Int
    let blocks: [Int]
    let status: String
    let seq: Int
    let solution: [String: String]
    let cells: [String: Cell]?
    let firstFillAt: String?
}

/// Events plus state, like the reducer's outcome but with no rejection convention:
/// vectors/README.md defines `then.error` for the reducer shape only. `gameCompleted`
/// appears here as an `Event` like any other (type and seq are all the shape pins).
struct CompletionOutcome: Decodable {
    let events: [Event]
    let state: JSONObjectMarker
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
