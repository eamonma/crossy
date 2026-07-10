// Client-store conformance plumbing: the consumer-side executor for the foreign family
// the vector runner only shape-validates (PROTOCOL.md §13; vectors/README.md "Foreign
// families"; apps/ios/vectors.skip.json). Swift twin of
// apps/web/src/store/client-store.vectors.test.ts — the two suites bind the same JSON
// cases to the same store operations, so the web and iOS stores cannot drift.
//
// Discovery is strict in the vector runner's spirit (skipping silently is forbidden):
// a stray file, an empty file, a case that fails the vectors/README.md shape, or a
// stimulus type this runner does not handle throws instead of being skipped.
//
// Every case executes against the real GameStore. Server stimuli are expanded from the
// vector encoding (sparse cells map, abbreviated frames) into full wire frames and
// decoded through CrossyProtocol's codec, so the store consumes exactly what a socket
// would deliver and hand-rolled parsing cannot creep in (the web runner's discipline).

import CrossyProtocol
import CrossyStore
import Foundation
import XCTest

// MARK: - Discovery (the VectorRunnerTests #filePath pattern)

enum ClientStoreVectors {
    /// This file lives at apps/ios/Tests/CrossyStoreTests/, so the repo root is five
    /// components up and vectors/ sits beside apps/ (the RepoLayout pattern).
    static let familyDir: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyStoreTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("vectors/v1/client-store", isDirectory: true)

    struct DiscoveredCluster {
        let cluster: String
        let cases: [ClientStoreVectorCase]
    }

    /// Strict discovery: only .json files, each a non-empty array of cases that decode
    /// to the vectors/README.md client-store shape. Sorted for stable output order.
    static func discover() throws -> [DiscoveredCluster] {
        let entries = try FileManager.default
            .contentsOfDirectory(at: familyDir, includingPropertiesForKeys: [.isRegularFileKey])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var clusters: [DiscoveredCluster] = []
        for file in entries {
            let name = file.lastPathComponent
            let isFile =
                (try file.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile ?? false
            guard isFile, name.hasSuffix(".json") else {
                throw ClientStoreVectorError.strayFile(name)
            }
            let data = try Data(contentsOf: file)
            let cases = try JSONDecoder().decode([ClientStoreVectorCase].self, from: data)
            guard !cases.isEmpty else {
                throw ClientStoreVectorError.emptyFile(name)
            }
            clusters.append(
                DiscoveredCluster(cluster: String(name.dropLast(".json".count)), cases: cases))
        }
        return clusters
    }
}

enum ClientStoreVectorError: Error, CustomStringConvertible {
    case strayFile(String)
    case emptyFile(String)
    case badSyncState(String)
    case badCellIndex(String)
    case malformedSendFrame(type: String)

    var description: String {
        switch self {
        case .strayFile(let name):
            return "vectors/v1/client-store must contain only .json files, found \"\(name)\""
        case .emptyFile(let name):
            return "vectors/v1/client-store/\(name) must be a non-empty JSON array of cases"
        case .badSyncState(let value):
            return "sync must be live | resyncing | reconnecting, found \"\(value)\""
        case .badCellIndex(let key):
            return "\"\(key)\" is not a decimal cell index"
        case .malformedSendFrame(let type):
            return "then.send frame \"\(type)\" is missing fields or unhandled; widen the runner"
        }
    }
}

// MARK: - The vectors/README.md client-store case shape

struct ClientStoreVectorCase: Decodable {
    let name: String
    let given: StoreGiven
    let when: [Stimulus]
    let then: StoreOutcome
}

struct StoreGiven: Decodable {
    let seq: Int
    let sync: String
    let cols: Int
    let rows: Int
    let blocks: [Int]
    let cells: [String: SparseCell]?
    let overlay: [VectorOverlayEntry]
}

/// A sparse-map cell: both keys required, null allowed (the VectorShapes discipline).
struct SparseCell: Decodable {
    let v: String?
    let by: String?

    private enum CodingKeys: String, CodingKey {
        case v
        case by
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        v = try container.decode(String?.self, forKey: .v)
        by = try container.decode(String?.self, forKey: .by)
    }
}

/// An overlay entry: `value` must be present (null re-sends clearCell); `agedOut` is
/// case input in `given` only (PROTOCOL.md §8 leaves the measure unsettled).
struct VectorOverlayEntry: Decodable {
    let commandId: String
    let cell: Int
    let value: String?
    let agedOut: Bool?

    private enum CodingKeys: String, CodingKey {
        case commandId
        case cell
        case value
        case agedOut
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        commandId = try container.decode(String.self, forKey: .commandId)
        cell = try container.decode(Int.self, forKey: .cell)
        value = try container.decode(String?.self, forKey: .value)
        agedOut = try container.decodeIfPresent(Bool.self, forKey: .agedOut)
    }
}

/// One `when` step: `source: "local"` (the user acted) or `source: "server"` (a frame
/// arrived), with the message fields inline. An unhandled source/type pair fails
/// decoding loudly (widen the runner), mirroring the web's expandServerFrame default.
enum Stimulus: Decodable {
    case local(LocalIntent)
    case server(ServerStimulus)

    enum LocalIntent {
        case placeLetter(commandId: String, cell: Int, value: String)
        case clearCell(commandId: String, cell: Int)
    }

    enum ServerStimulus {
        case cellSet(
            seq: Int, cell: Int, value: String?, by: String, commandId: String,
            firstFillAt: String?)
        case error(code: String, fatal: Bool, commandId: String?)
        case sync(SnapshotBoard)
        case welcome(SnapshotBoard)
    }

    private enum CodingKeys: String, CodingKey {
        case source, type, seq, cell, value, by, commandId, firstFillAt, code, fatal, board
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let source = try container.decode(String.self, forKey: .source)
        let type = try container.decode(String.self, forKey: .type)
        switch (source, type) {
        case ("local", "placeLetter"):
            self = .local(
                .placeLetter(
                    commandId: try container.decode(String.self, forKey: .commandId),
                    cell: try container.decode(Int.self, forKey: .cell),
                    value: try container.decode(String.self, forKey: .value)))
        case ("local", "clearCell"):
            self = .local(
                .clearCell(
                    commandId: try container.decode(String.self, forKey: .commandId),
                    cell: try container.decode(Int.self, forKey: .cell)))
        case ("server", "cellSet"):
            self = .server(
                .cellSet(
                    seq: try container.decode(Int.self, forKey: .seq),
                    cell: try container.decode(Int.self, forKey: .cell),
                    value: try container.decode(String?.self, forKey: .value),
                    by: try container.decode(String.self, forKey: .by),
                    commandId: try container.decode(String.self, forKey: .commandId),
                    firstFillAt: try container.decodeIfPresent(String.self, forKey: .firstFillAt)))
        case ("server", "error"):
            self = .server(
                .error(
                    code: try container.decode(String.self, forKey: .code),
                    fatal: try container.decode(Bool.self, forKey: .fatal),
                    commandId: try container.decodeIfPresent(String.self, forKey: .commandId)))
        case ("server", "sync"):
            self = .server(.sync(try container.decode(SnapshotBoard.self, forKey: .board)))
        case ("server", "welcome"):
            self = .server(.welcome(try container.decode(SnapshotBoard.self, forKey: .board)))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container,
                debugDescription: "unhandled stimulus \(source)/\(type); widen the runner")
        }
    }
}

/// The abbreviated snapshot board a `sync`/`welcome` stimulus carries.
struct SnapshotBoard: Decodable {
    let seq: Int
    let status: String
    let firstFillAt: String?
    let cells: [String: SparseCell]?
    let recentCommandIds: [String]?
}

/// The store state after the stimuli. `firstFillAt` is double-optional so an absent
/// key stays unasserted (the assertion rule) while an explicit null asserts nil.
struct StoreOutcome: Decodable {
    let seq: Int
    let sync: String
    let overlay: [VectorOverlayEntry]
    let render: [String: String?]
    let send: [ExpectedFrame]
    let firstFillAt: String??

    private enum CodingKeys: String, CodingKey {
        case seq, sync, overlay, render, send, firstFillAt
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seq = try container.decode(Int.self, forKey: .seq)
        sync = try container.decode(String.self, forKey: .sync)
        overlay = try container.decode([VectorOverlayEntry].self, forKey: .overlay)
        render = try container.decode([String: String?].self, forKey: .render)
        send = try container.decode([ExpectedFrame].self, forKey: .send)
        firstFillAt =
            container.contains(.firstFillAt)
            ? .some(try container.decode(String?.self, forKey: .firstFillAt))
            : .none
    }
}

/// An outbound frame the store must have emitted, reconstructed as the real wire type
/// (a string re-sends placeLetter, null re-sends clearCell; vectors/README.md).
struct ExpectedFrame: Decodable {
    let type: String
    let commandId: String?
    let cell: Int?
    let value: String?

    func asClientMessage() throws -> ClientMessage {
        switch type {
        case "requestSync":
            return .requestSync(RequestSyncMessage())
        case "placeLetter":
            guard let commandId, let cell, let value else {
                throw ClientStoreVectorError.malformedSendFrame(type: type)
            }
            return .placeLetter(PlaceLetterMessage(commandId: commandId, cell: cell, value: value))
        case "clearCell":
            guard let commandId, let cell else {
                throw ClientStoreVectorError.malformedSendFrame(type: type)
            }
            return .clearCell(ClearCellMessage(commandId: commandId, cell: cell))
        default:
            throw ClientStoreVectorError.malformedSendFrame(type: type)
        }
    }
}

// MARK: - Expansion: vector encoding to full wire frames, through the real codec

private func orNull(_ value: String?) -> Any {
    if let value { return value }
    return NSNull()
}

/// Expand the vector's abbreviated board (sparse cells map; only seq / status /
/// firstFillAt / cells / recentCommandIds) into the full PROTOCOL.md §4 payload the
/// codec requires. The geometry comes from the case's `given`.
private func expandBoard(_ board: SnapshotBoard, cols: Int, rows: Int) -> [String: Any] {
    let cells: [[String: Any]] = (0..<(cols * rows)).map { index in
        let cell = board.cells?[String(index)]
        return ["v": orNull(cell?.v), "by": orNull(cell?.by)]
    }
    return [
        "seq": board.seq,
        "status": board.status,
        // A snapshot may pin firstFillAt (§4); absent means null, pre-first-fill.
        "firstFillAt": orNull(board.firstFillAt),
        "completedAt": NSNull(),
        "abandonedAt": NSNull(),
        "cells": cells,
        "participants": [Any](),
        "cursors": [Any](),
        "recentCommandIds": board.recentCommandIds ?? [String](),
        "stats": NSNull(),
    ]
}

/// Expand one server stimulus into the full wire frame the codec accepts.
private func expandServerFrame(
    _ stimulus: Stimulus.ServerStimulus, cols: Int, rows: Int
) -> [String: Any] {
    switch stimulus {
    case .cellSet(let seq, let cell, let value, let by, let commandId, let firstFillAt):
        var frame: [String: Any] = [
            "type": "cellSet",
            "seq": seq,
            "cell": cell,
            "value": orNull(value),
            "by": by,
            "commandId": commandId,
            // The vector encoding omits `at` (unasserted); the wire requires it.
            "at": "2026-07-07T00:00:00Z",
        ]
        // firstFillAt rides only the first fill (PROTOCOL.md §6); pass it through.
        if let firstFillAt { frame["firstFillAt"] = firstFillAt }
        return frame
    case .error(let code, let fatal, let commandId):
        var frame: [String: Any] = [
            "type": "error",
            "code": code,
            // The vector encoding omits the human-readable message; the wire requires it.
            "message": code,
            "fatal": fatal,
        ]
        if let commandId { frame["commandId"] = commandId }
        return frame
    case .sync(let board):
        return ["type": "sync", "board": expandBoard(board, cols: cols, rows: rows)]
    case .welcome(let board):
        return [
            "type": "welcome",
            "protocolVersion": 1,
            "self": ["userId": "vector-self", "role": "solver"],
            "board": expandBoard(board, cols: cols, rows: rows),
        ]
    }
}

/// Round-trip through JSON bytes and CrossyProtocol's ServerMessage union, so the
/// store consumes exactly what a decoded socket frame carries.
func decodeServerStimulus(
    _ stimulus: Stimulus.ServerStimulus, cols: Int, rows: Int
) throws -> ServerMessage {
    let data = try JSONSerialization.data(
        withJSONObject: expandServerFrame(stimulus, cols: cols, rows: rows))
    return try JSONDecoder().decode(ServerMessage.self, from: data)
}

// MARK: - The case runner (binds vector operations to store calls)

/// Executes one case against the real GameStore, exactly as the web runner's runCase
/// binds it: `given` seeds the store, local steps call placeLetter/clearCell with the
/// case's commandId, server steps decode through the codec into receive(_:), and
/// `then` reads seq / sync / overlay / renderValue / outbox / firstFillAt.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
func runClientStoreCase(
    _ vectorCase: ClientStoreVectorCase,
    cluster: String,
    file: StaticString = #filePath,
    line: UInt = #line
) throws {
    let given = vectorCase.given
    guard let sync = SyncState(rawValue: given.sync) else {
        throw ClientStoreVectorError.badSyncState(given.sync)
    }
    var cells: [Int: Cell] = [:]
    for (key, sparse) in given.cells ?? [:] {
        guard let index = Int(key) else { throw ClientStoreVectorError.badCellIndex(key) }
        cells[index] = Cell(v: sparse.v, by: sparse.by)
    }
    let overlay = given.overlay.map {
        PendingCommand(
            commandId: $0.commandId, cell: $0.cell, value: $0.value, agedOut: $0.agedOut ?? false)
    }
    let store = GameStore(
        seed: GameStore.Seed(seq: given.seq, sync: sync, cells: cells, overlay: overlay))

    for stimulus in vectorCase.when {
        switch stimulus {
        case .local(.placeLetter(let commandId, let cell, let value)):
            store.placeLetter(cell: cell, value: value, commandId: commandId)
        case .local(.clearCell(let commandId, let cell)):
            store.clearCell(cell: cell, commandId: commandId)
        case .server(let serverStimulus):
            store.receive(
                try decodeServerStimulus(serverStimulus, cols: given.cols, rows: given.rows))
        }
    }

    let then = vectorCase.then
    let label = "\(cluster): \(vectorCase.name)"
    XCTAssertEqual(store.seq, then.seq, "\(label) - then.seq", file: file, line: line)
    XCTAssertEqual(store.sync.rawValue, then.sync, "\(label) - then.sync", file: file, line: line)

    // then.overlay is send order; expected constrains commandId/cell/value (the
    // assertion rule leaves agedOut unasserted, and re-added entries drop it anyway).
    XCTAssertEqual(
        store.overlay.count, then.overlay.count, "\(label) - then.overlay length",
        file: file, line: line)
    for (index, pair) in zip(store.overlay, then.overlay).enumerated() {
        let (actual, expected) = pair
        XCTAssertEqual(
            actual.commandId, expected.commandId, "\(label) - then.overlay[\(index)].commandId",
            file: file, line: line)
        XCTAssertEqual(
            actual.cell, expected.cell, "\(label) - then.overlay[\(index)].cell",
            file: file, line: line)
        XCTAssertEqual(
            actual.value, expected.value, "\(label) - then.overlay[\(index)].value",
            file: file, line: line)
    }

    // then.render: the composite the user sees (INV-10), per listed cell.
    for (key, expected) in then.render {
        guard let cell = Int(key) else { throw ClientStoreVectorError.badCellIndex(key) }
        XCTAssertEqual(
            store.renderValue(cell), expected, "\(label) - then.render.\(key)",
            file: file, line: line)
    }

    // then.send: the ordered outbound frames the store emitted. With no transport
    // pump running, emissions accumulate in the outbox in send order — the same
    // synchronous record the web suite captures through its fake transport.
    let expectedSends = try then.send.map { try $0.asClientMessage() }
    XCTAssertEqual(store.outbox, expectedSends, "\(label) - then.send", file: file, line: line)

    // The derived timer origin, asserted only where the case pins it (PROTOCOL.md §6).
    if case .some(let origin) = then.firstFillAt {
        XCTAssertEqual(
            store.firstFillAt, origin, "\(label) - then.firstFillAt", file: file, line: line)
    }
}
