import CrossyEngine
import Foundation

// Adapters between the vector JSON and the engine's own Swift types, the twin of the
// "Engine binding" section in packages/engine/src/vectors.test.ts. The vectors are the
// shared source of truth; CrossyEngine owns a separate type world (INV-9, README.md).
// These adapters are the boundary that keeps them in agreement, exactly as an app adapter
// would: parse `given` into engine types, call the engine, serialize the result back to
// plain JSON, and assert it against `then`.
//
// The cases arrive as `[String: Any]` from JSONSerialization (mirroring the TS runner's
// `JsonObject`), so the work happens over dictionaries rather than a second Codable decode.
// Comparison follows the vectors/README.md assertion rule byte for byte (see expectMatch).
//
// The engine domain types (`Cell`, `Command`, `Event`) share bare names with the Codable
// shape structs in VectorShapes.swift, and a same-module type shadows an imported one, so
// those three are written fully qualified as `CrossyEngine.*` here.

/// A vector assertion failure. Thrown from a family runner so the calling XCTest method
/// fails with a located message; kept distinct from `VectorError` (discovery/manifest),
/// which the honest-failure guard matches on specifically.
struct VectorMismatch: Error, CustomStringConvertible {
    let message: String
    init(_ message: String) { self.message = message }
    var description: String { message }
}

// MARK: - JSON scalar helpers

/// Read an integer from a JSON scalar, accepting both a bridged `Int` and an `NSNumber`
/// (JSONSerialization yields `NSNumber` for numbers on this platform).
func intValue(_ any: Any?) -> Int? {
    if let i = any as? Int { return i }
    if let n = any as? NSNumber { return n.intValue }
    return nil
}

func parseDirection(_ raw: String?) -> Direction {
    raw == "down" ? .down : .across
}

func parseToward(_ raw: String?) -> Toward {
    raw == "backward" ? .backward : .forward
}

func parseStatus(_ raw: String?) -> Status {
    switch raw {
    case "completed": return .completed
    case "abandoned": return .abandoned
    default: return .ongoing
    }
}

func directionString(_ direction: Direction) -> String {
    direction == .down ? "down" : "across"
}

func statusString(_ status: Status) -> String {
    switch status {
    case .ongoing: return "ongoing"
    case .completed: return "completed"
    case .abandoned: return "abandoned"
    }
}

// MARK: - Building engine inputs from `given`

/// Build the immutable grid geometry from a case's `given`.
func buildGrid(_ given: [String: Any]) -> Grid {
    let blocks = (given["blocks"] as? [Any] ?? []).compactMap(intValue)
    return Grid(
        cols: intValue(given["cols"]) ?? 0,
        rows: intValue(given["rows"]) ?? 0,
        blocks: Set(blocks))
}

/// Build the reducer's starting board state; filledCount is derived from the fills, exactly
/// as the TS `buildBoardState` does.
func buildBoardState(_ given: [String: Any]) -> BoardState {
    var cells: [Int: CrossyEngine.Cell] = [:]
    var filledCount = 0
    if let givenCells = given["cells"] as? [String: Any] {
        for (index, raw) in givenCells {
            guard let cellObj = raw as? [String: Any], let key = Int(index) else { continue }
            let value = cellObj["v"] as? String  // nil for an explicit null or absent key
            let by = cellObj["by"] as? String
            cells[key] = CrossyEngine.Cell(value: value, by: by)
            if value != nil { filledCount += 1 }
        }
    }
    let firstFillAt = given["firstFillAt"] as? String  // nil for null or absent
    // Standing check marks and the permanent count (check family; PROTOCOL §10, D27).
    // Optional in `given`: absent means no marks and no accepted checks yet.
    let checkedWrong = (given["checkedWrong"] as? [Any] ?? []).compactMap(intValue)
    return BoardState(
        grid: buildGrid(given),
        status: parseStatus(given["status"] as? String),
        seq: intValue(given["seq"]) ?? 0,
        firstFillAt: firstFillAt,
        cells: cells,
        filledCount: filledCount,
        checkedWrong: Set(checkedWrong),
        checkCount: intValue(given["checkCount"]) ?? 0)
}

/// The set of filled cell indices from a navigation case's `given.fills`.
func buildFilled(_ given: [String: Any]) -> Set<Int> {
    guard let fills = given["fills"] as? [String: Any] else { return [] }
    return Set(fills.keys.compactMap(Int.init))
}

/// Build the cell-index to solution-string map from a completion case's `given`.
func buildSolution(_ given: [String: Any]) -> Solution {
    var solution: Solution = [:]
    guard let raw = given["solution"] as? [String: Any] else { return solution }
    for (index, value) in raw {
        guard let key = Int(index), let string = value as? String else { continue }
        solution[key] = string
    }
    return solution
}

/// A `when` entry (wire command plus server meta) as the engine command, plain data (INV-9).
/// `checkPuzzle` carries only its commandId (vectors/README.md "Check cases"; PROTOCOL §10).
func asCommand(_ w: [String: Any]) -> CrossyEngine.Command {
    let commandId = w["commandId"] as? String ?? ""
    if w["type"] as? String == "checkPuzzle" {
        return .checkPuzzle(commandId: commandId)
    }
    let cell = intValue(w["cell"]) ?? -1
    let by = w["by"] as? String ?? ""
    let at = w["at"] as? String ?? ""
    if w["type"] as? String == "placeLetter" {
        return .placeLetter(
            commandId: commandId, cell: cell, value: w["value"] as? String ?? "", by: by, at: at)
    }
    return .clearCell(commandId: commandId, cell: cell, by: by, at: at)
}

// MARK: - Serializing engine outputs to the `then` JSON shape

/// A JSON scalar for an optional string: the string, or `NSNull` for nil, so the assertion
/// rule can compare an explicit null.
func jsonScalar(_ value: String?) -> Any {
    value ?? NSNull()
}

/// Serialize a board state to the `then.state` JSON shape (cells as a sparse map).
func serializeState(_ state: BoardState) -> [String: Any] {
    var cells: [String: Any] = [:]
    for (index, cell) in state.cells {
        cells[String(index)] = ["v": jsonScalar(cell.value), "by": jsonScalar(cell.by)]
    }
    return [
        "status": statusString(state.status),
        "seq": state.seq,
        "filledCount": state.filledCount,
        "firstFillAt": jsonScalar(state.firstFillAt),
        "cells": cells,
        // The wire and the vectors list the standing marks ascending (PROTOCOL §10).
        "checkedWrong": state.checkedWrong.sorted(),
        "checkCount": state.checkCount,
    ]
}

func serializeCellSet(_ event: CellSet) -> [String: Any] {
    [
        "type": "cellSet",
        "seq": event.seq,
        "cell": event.cell,
        "value": jsonScalar(event.value),
        "by": event.by,
        "commandId": event.commandId,
        "at": event.at,
    ]
}

func serializeEvent(_ event: CrossyEngine.Event) -> [String: Any] {
    switch event {
    case .cellSet(let cellSet): return serializeCellSet(cellSet)
    case .gameCompleted(let completed): return ["type": "gameCompleted", "seq": completed.seq]
    case .puzzleChecked(let checked):
        return [
            "type": "puzzleChecked",
            "seq": checked.seq,
            "wrongCells": checked.wrongCells,
            "checkCount": checked.checkCount,
            "commandId": checked.commandId,
        ]
    }
}

// MARK: - The assertion rule (vectors/README.md)

/// An expected object constrains exactly the fields it lists; an absent field is
/// unasserted. Expected arrays match in length and order, each element under the same rule.
/// Strings compare byte for byte over UTF-8 (INV-1), never by canonical String equality, so
/// Turkish dotted/dotless i and any non-ASCII scalar are compared as raw bytes. Numbers are
/// integers throughout the engine, so they compare as integers.
func expectMatch(_ actual: Any?, _ expected: Any, _ path: String) throws {
    if expected is NSNull {
        if actual == nil || actual is NSNull { return }
        throw VectorMismatch("\(path): expected null, got \(render(actual))")
    }
    if let expectedArray = expected as? [Any] {
        guard let actualArray = actual as? [Any] else {
            throw VectorMismatch("\(path): expected an array, got \(render(actual))")
        }
        guard actualArray.count == expectedArray.count else {
            throw VectorMismatch(
                "\(path): array length \(actualArray.count), expected \(expectedArray.count)")
        }
        for index in expectedArray.indices {
            try expectMatch(actualArray[index], expectedArray[index], "\(path)[\(index)]")
        }
        return
    }
    if let expectedObject = expected as? [String: Any] {
        guard let actualObject = actual as? [String: Any] else {
            throw VectorMismatch("\(path): expected an object, got \(render(actual))")
        }
        for (key, value) in expectedObject {
            try expectMatch(actualObject[key], value, "\(path).\(key)")
        }
        return
    }
    if let expectedString = expected as? String {
        guard let actualString = actual as? String else {
            throw VectorMismatch("\(path): expected string \"\(expectedString)\", got \(render(actual))")
        }
        guard actualString.utf8.elementsEqual(expectedString.utf8) else {
            throw VectorMismatch(
                "\(path): string \"\(actualString)\" != expected \"\(expectedString)\" (byte-wise)")
        }
        return
    }
    if let expectedInt = intValue(expected) {
        guard let actualInt = intValue(actual) else {
            throw VectorMismatch("\(path): expected \(expectedInt), got \(render(actual))")
        }
        guard actualInt == expectedInt else {
            throw VectorMismatch("\(path): \(actualInt), expected \(expectedInt)")
        }
        return
    }
    throw VectorMismatch("\(path): unhandled expected value \(render(expected))")
}

/// Assert one integer output against its expected JSON scalar (navigation ops).
func expectInt(_ actual: Int, _ expected: Any?, _ path: String) throws {
    guard let expected = expected else { throw VectorMismatch("\(path): missing expected value") }
    try expectMatch(actual, expected, path)
}

/// Assert one string output against its expected JSON scalar (tab's direction).
func expectString(_ actual: String, _ expected: Any?, _ path: String) throws {
    guard let expected = expected else { throw VectorMismatch("\(path): missing expected value") }
    try expectMatch(actual, expected, path)
}

private func render(_ value: Any?) -> String {
    guard let value = value else { return "nil" }
    if value is NSNull { return "null" }
    return "\(value)"
}
