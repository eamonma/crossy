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

/// The navigation operations (vectors/README.md `when.op`). Absent `op` means `advance`,
/// the seed's single-cell getNextCell, so the 12 seed cases stay byte-identical. Codable
/// accepts any string, so membership is pinned in `shapeProblems`, mirroring the TS
/// `NAV_OPS` check. An array (not a Set) keeps the problem message's order matching the TS.
let navigationOps: [String] = ["advance", "wordBounds", "tab", "typing", "backspace"]

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
        for key in (given.fills ?? [:]).keys where !isDecimalKey(key) {
            problems.append("given.fills: key \"\(key)\" is not a decimal cell index")
        }
        let op = when.op ?? "advance"
        if !navigationOps.contains(op) {
            problems.append(
                "when.op: one of \(navigationOps.joined(separator: ", ")) (absent means advance)")
        }
        // Every op names a direction and a starting cell (`from` is Int by decoding).
        if when.direction != "across" && when.direction != "down" {
            problems.append("when.direction: \"across\" or \"down\" required")
        }
        // Op-specific `when` inputs and `then` outputs (vectors/README.md table).
        switch op {
        case "advance":
            problems += towardProblems()
            if then.cell == nil { problems.append("then.cell: integer required") }
        case "tab":
            problems += towardProblems()
            if then.cell == nil { problems.append("then.cell: integer required") }
            // tab pins the unchanged axis on a clue-list wrap (vectors/README.md).
            if then.direction != "across" && then.direction != "down" {
                problems.append("then.direction: \"across\" or \"down\" required")
            }
        case "wordBounds":
            if then.start == nil { problems.append("then.start: integer required") }
            if then.end == nil { problems.append("then.end: integer required") }
        case "typing", "backspace":
            if then.cell == nil { problems.append("then.cell: integer required") }
        default:
            break
        }
        return problems
    }

    private func towardProblems() -> [String] {
        when.toward == "forward" || when.toward == "backward"
            ? []
            : ["when.toward: \"forward\" or \"backward\" required"]
    }
}

struct NavigationGiven: Decodable {
    let cols: Int
    let rows: Int
    let blocks: [Int]
    let fills: [String: String]?
}

/// `op` selects the operation (absent means advance). `direction` and `from` are required
/// for every op, so they stay non-optional; `toward` is present only for `advance` and
/// `tab`, so it is optional and its presence is enforced per op in `shapeProblems`.
struct NavigationMove: Decodable {
    let op: String?
    let direction: String
    let from: Int
    let toward: String?
    let canEscapeWord: Bool?
}

/// The op's landing. `advance`/`typing`/`backspace` set `cell`; `wordBounds` sets `start`
/// and `end`; `tab` sets `cell` and the unchanged `direction`. All optional here, with the
/// per-op requirement enforced in `shapeProblems`, mirroring the TS dispatch.
struct NavigationResult: Decodable {
    let cell: Int?
    let start: Int?
    let end: Int?
    let direction: String?
}

// MARK: - Client store

/// The store's connection state, a token set defined in vectors/README.md (PROTOCOL.md
/// names the wire behaviors, not the states). Codable accepts any string, so membership is
/// pinned in `shapeProblems`, mirroring how NavigationMove validates `direction` and the TS
/// `SYNC_STATES` check.
let clientStoreSyncStates: Set<String> = ["live", "resyncing", "reconnecting"]

/// Client-store cases carry a store state (sequenced `seq` + `sync` + sparse `cells` plus an
/// `overlay`), a `when` sequence of local commands and server messages, and the resulting
/// `seq`, `sync`, `overlay`, `render`, and `send`. The encoding is defined and normative in
/// vectors/README.md. This family is foreign to the engine (the manifest's `foreign`
/// bucket): the runner shape-validates it here but never executes it; its consumer is the
/// web + iOS store, not CrossyEngine (PROTOCOL.md §13).
struct ClientStoreCase: Decodable {
    let name: String
    let given: ClientStoreGiven
    let when: [StimulusStep]
    let then: ClientStoreOutcome

    var label: String { name }

    func shapeProblems() -> [String] {
        var problems: [String] = []
        if when.isEmpty {
            problems.append("when: non-empty array of steps required")
        }
        // The sync token set: Codable accepts any string, the set is defined here.
        if !clientStoreSyncStates.contains(given.sync) {
            problems.append("given.sync: \"live\" | \"resyncing\" | \"reconnecting\" required")
        }
        if !clientStoreSyncStates.contains(then.sync) {
            problems.append("then.sync: \"live\" | \"resyncing\" | \"reconnecting\" required")
        }
        // Stimulus source discrimination: each step is `local` (the user acted) or `server`
        // (a frame arrived). The message-specific fields sit inline, unasserted here.
        for step in when where step.source != "local" && step.source != "server" {
            problems.append(
                "when: step source \"\(step.source)\" is not \"local\" or \"server\"")
        }
        // Sparse cell-index maps key by decimal index (vectors/README.md).
        for key in (given.cells ?? [:]).keys where !isDecimalKey(key) {
            problems.append("given.cells: key \"\(key)\" is not a decimal cell index")
        }
        for key in then.render.keys where !isDecimalKey(key) {
            problems.append("then.render: key \"\(key)\" is not a decimal cell index")
        }
        return problems
    }
}

/// The store state before the stimulus. `overlay` is the ordered pending queue (send order,
/// oldest first); each entry MAY carry `agedOut` (given only). `cells` defaults to empty and
/// `sync` is validated in `shapeProblems`.
struct ClientStoreGiven: Decodable {
    let seq: Int
    let sync: String
    let cols: Int
    let rows: Int
    let blocks: [Int]
    let cells: [String: Cell]?
    let overlay: [OverlayEntry]
}

/// The store state after: `seq`, `sync`, the resulting `overlay` (send order), `render` (the
/// composite the user sees, string or null per cell), and `send` (ordered outbound frames).
/// `render`'s keys are decimal cell indices, checked in `shapeProblems`.
struct ClientStoreOutcome: Decodable {
    let seq: Int
    let sync: String
    let overlay: [OverlayEntry]
    let render: RenderMap
    let send: [OutboundFrame]
}

/// A pending optimistic write: `commandId`, `cell`, and `value` (a string re-sends
/// placeLetter, null re-sends clearCell). `value` must be present (null or string), so the
/// custom init rejects an absent key, mirroring the `Cell` shape. `agedOut` is optional
/// (given.overlay only); when present it must be a boolean.
struct OverlayEntry: Decodable {
    let commandId: String
    let cell: Int
    let value: String?
    let agedOut: Bool?

    enum CodingKeys: String, CodingKey {
        case commandId, cell, value, agedOut
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        commandId = try container.decode(String.self, forKey: .commandId)
        cell = try container.decode(Int.self, forKey: .cell)
        guard container.contains(.value) else {
            throw DecodingError.keyNotFound(
                CodingKeys.value,
                .init(
                    codingPath: container.codingPath,
                    debugDescription: "overlay entry requires \"value\" (null or string)"))
        }
        value = try container.decodeIfPresent(String.self, forKey: .value)
        agedOut = try container.decodeIfPresent(Bool.self, forKey: .agedOut)
    }
}

/// One `when` step: `source` ("local" | "server", validated in `shapeProblems`) and `type`.
/// The message-specific fields (seq, cell, value, code, fatal, board, ...) arrive as data
/// for the store and are unasserted at the shape layer, mirroring how `Command` pins only
/// `type` for the reducer's polymorphic commands. This is the client-store shape's
/// polymorphic seam: the full message decode and the `then` comparison live in the
/// consumer's suite (apps/web, then iOS), never here (PROTOCOL.md §13).
struct StimulusStep: Decodable {
    let source: String
    let type: String
}

/// An outbound frame the store emitted (`requestSync`, a re-sent `placeLetter`/`clearCell`).
/// The shape pins only `type`, mirroring the TS `isSendList` check; the reconstructed
/// payload is compared in the consumer's suite.
struct OutboundFrame: Decodable {
    let type: String
}

/// A sparse render map: decimal cell index to the displayed value, string or null. Codable
/// cannot pin decimal keys, so this collects them for `shapeProblems`; decoding each value as
/// `String?` rejects a non-string, non-null value straight from the bytes (a present value
/// is null or a string, matching the TS `isRenderMap` check).
struct RenderMap: Decodable {
    let keys: [String]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicKey.self)
        var collected: [String] = []
        for key in container.allKeys {
            _ = try container.decodeIfPresent(String.self, forKey: key)
            collected.append(key.stringValue)
        }
        keys = collected
    }
}
