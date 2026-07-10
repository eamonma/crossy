import Foundation
import XCTest

@testable import CrossyUI

// The selection layer against the navigation vectors themselves (PROTOCOL §13), the
// vector-runner pattern applied to InputActions: every tab, typing, and backspace
// case from vectors/v1/navigation runs through the input transform that carries it
// on iOS, so the layer is pinned to the shared normative ground, not just to the
// engine port. The families the deck cannot reach (single-cell-advance and
// word-bounds are arrow-key and internal ops, space-clear-advance is a hardware
// keyboard rule, all Phase I4) are skipped by op, and an unknown op in a consumed
// file fails loudly rather than silently (vectors/README.md).

final class NavigationVectorParityTests: XCTestCase {
    private static let navigationDir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyUITests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("vectors/v1/navigation", isDirectory: true)

    /// The ops the I2b input layer carries, and the deck/gesture transform each one
    /// runs through.
    private static let boundOps: Set<String> = ["tab", "typing", "backspace"]

    func test_inputActions_matchNavigationVectors_tabTypingBackspace_PR30() throws {
        let files = try FileManager.default
            .contentsOfDirectory(at: Self.navigationDir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertFalse(files.isEmpty, "no navigation vectors found")

        var boundCases = 0
        for file in files {
            let data = try Data(contentsOf: file)
            guard let cases = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else {
                return XCTFail("\(file.lastPathComponent): not an array of cases")
            }
            for raw in cases {
                if try runCase(raw, file: file.lastPathComponent) { boundCases += 1 }
            }
        }
        // The three families are non-empty on disk; a zero count means the loader
        // silently missed everything, which the manifest rules forbid.
        XCTAssertGreaterThan(boundCases, 0)
    }

    /// Runs one case if its op is bound; returns whether it ran.
    private func runCase(_ raw: [String: Any], file: String) throws -> Bool {
        guard let given = raw["given"] as? [String: Any],
            let when = raw["when"] as? [String: Any],
            let then = raw["then"] as? [String: Any]
        else {
            XCTFail("\(file): case missing given/when/then")
            return false
        }
        let name = (raw["name"] as? String) ?? "unnamed"
        let op = (when["op"] as? String) ?? "advance"
        guard Self.boundOps.contains(op) else {
            // advance and wordBounds are engine-internal or I4 surface; anything
            // else in these files is a vector this suite does not know.
            if op != "advance" && op != "wordBounds" {
                XCTFail("\(file): unknown navigation op \"\(op)\"")
            }
            return false
        }

        let puzzle = GridPuzzle(
            rows: intValue(given["rows"]) ?? 0,
            cols: intValue(given["cols"]) ?? 0,
            blocks: Set((given["blocks"] as? [Any] ?? []).compactMap(intValue)))
        let fills = Set(((given["fills"] as? [String: Any]) ?? [:]).keys.compactMap(Int.init))
        let isAcross = (when["direction"] as? String) != "down"
        let from = intValue(when["from"]) ?? 0
        let expectedCell = intValue(then["cell"])

        switch op {
        case "tab":
            let forward = (when["toward"] as? String) != "backward"
            let env = InputEnv(
                puzzle: puzzle, filled: fills,
                selection: GridSelection(cell: from, isAcross: isAcross), frozen: false)
            let effect = forward ? InputActions.nextWord(env) : InputActions.previousWord(env)
            XCTAssertEqual(effect.selection.cell, expectedCell, "\(file): \(name)")
            if let direction = then["direction"] as? String {
                XCTAssertEqual(
                    effect.selection.isAcross, direction != "down", "\(file): \(name)")
            }
            XCTAssertEqual(effect.mutations, [], "\(file): \(name)")
        case "typing":
            // The vector's `fills` is the board after the keystroke (`from` is
            // filled); the input env carries the board before it, and letter()
            // re-adds the typed cell.
            var before = fills
            before.remove(from)
            let env = InputEnv(
                puzzle: puzzle, filled: before,
                selection: GridSelection(cell: from, isAcross: isAcross), frozen: false)
            let effect = InputActions.letter(env, "A")
            XCTAssertEqual(effect.selection.cell, expectedCell, "\(file): \(name)")
            XCTAssertEqual(effect.selection.isAcross, isAcross, "\(file): \(name)")
            XCTAssertEqual(
                effect.mutations, [.place(cell: from, value: "A")], "\(file): \(name)")
        case "backspace":
            let env = InputEnv(
                puzzle: puzzle, filled: fills,
                selection: GridSelection(cell: from, isAcross: isAcross), frozen: false)
            let effect = InputActions.backspace(env)
            XCTAssertEqual(effect.selection.cell, expectedCell, "\(file): \(name)")
            XCTAssertEqual(effect.selection.isAcross, isAcross, "\(file): \(name)")
            if let landed = expectedCell {
                let wanted: [GridMutation] = fills.contains(landed) ? [.clear(cell: landed)] : []
                XCTAssertEqual(effect.mutations, wanted, "\(file): \(name)")
            }
        default:
            XCTFail("unreachable op \(op)")
        }
        return true
    }

    private func intValue(_ any: Any?) -> Int? {
        if let int = any as? Int { return int }
        if let number = any as? NSNumber { return number.intValue }
        return nil
    }
}
