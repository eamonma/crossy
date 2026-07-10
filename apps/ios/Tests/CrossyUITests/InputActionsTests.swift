import XCTest

import CrossyEngine

@testable import CrossyUI

// InputActions: the input layer's pure transforms, held against the engine the way
// GridPuzzleTests pins the word-run rule. Navigation flows through the store ring's
// BoardNavigation facade into CrossyEngine, so these pins close the loop: the same
// inputs through InputActions and through the engine's vectored ops must agree on
// every playable cell of every shape, or the suite fails before the fork can ship.
// The composition rules the web twin owns (filled-after includes the typed cell, the
// backspace wire no-op skip, the frozen refusal) are pinned here too.

final class InputActionsTests: XCTestCase {
    /// The suite's shapes: the vector 5x4, the mini, a strip, and a blockless board.
    private let shapes: [GridPuzzle] = [
        GridPuzzle(rows: 4, cols: 5, blocks: [2, 6, 13]),
        GridPuzzle(rows: 5, cols: 5, blocks: [4, 20]),
        GridPuzzle(rows: 1, cols: 7, blocks: [3]),
        GridPuzzle(rows: 3, cols: 3, blocks: []),
    ]

    private func grid(_ puzzle: GridPuzzle) -> Grid {
        Grid(cols: puzzle.cols, rows: puzzle.rows, blocks: puzzle.blocks)
    }

    private func env(
        _ puzzle: GridPuzzle, filled: Set<Int>, cell: Int, isAcross: Bool,
        frozen: Bool = false
    ) -> InputEnv {
        InputEnv(
            puzzle: puzzle, filled: filled,
            selection: GridSelection(cell: cell, isAcross: isAcross), frozen: frozen)
    }

    /// A deterministic fill set so the parity sweeps exercise filled-skip paths.
    private func fills(_ puzzle: GridPuzzle) -> Set<Int> {
        Set((0..<puzzle.cellCount).filter { !puzzle.blocks.contains($0) && $0 % 3 == 0 })
    }

    // MARK: - Initial position (DESIGN §5)

    func test_initialSelection_matchesEngineClamp_firstPlayableAcross() {
        for puzzle in shapes {
            let expected = getNextCell(grid(puzzle), .across, -1, .forward)
            let selection = InputActions.initialSelection(puzzle)
            XCTAssertEqual(selection.cell, expected)
            XCTAssertTrue(selection.isAcross)
        }
    }

    // MARK: - Letters (typing-advance / full-word-asymmetry families)

    func test_letter_matchesEngineTypingAdvance_everyCellBothAxes_typingAdvanceFamily() {
        for puzzle in shapes {
            let filled = fills(puzzle)
            for cell in 0..<puzzle.cellCount where !puzzle.blocks.contains(cell) {
                for isAcross in [true, false] {
                    let direction: CrossyEngine.Direction = isAcross ? .across : .down
                    var after = filled
                    after.insert(cell)
                    let expected = typingAdvance(grid(puzzle), direction, cell, after)
                    let effect = InputActions.letter(
                        env(puzzle, filled: filled, cell: cell, isAcross: isAcross), "a")
                    XCTAssertEqual(
                        effect.selection,
                        GridSelection(cell: expected, isAcross: isAcross),
                        "cell \(cell) \(isAcross ? "across" : "down") on \(puzzle.rows)x\(puzzle.cols)")
                    XCTAssertEqual(effect.mutations, [.place(cell: cell, value: "A")])
                }
            }
        }
    }

    func test_letter_foldsLowercaseAsciiOnly_INV1() {
        let puzzle = shapes[0]
        let effect = InputActions.letter(env(puzzle, filled: [], cell: 0, isAcross: true), "q")
        XCTAssertEqual(effect.mutations, [.place(cell: 0, value: "Q")])
        // A code point outside the deck's charset is a handled no-op, never a
        // locale-aware fold.
        let rejected = InputActions.letter(env(puzzle, filled: [], cell: 0, isAcross: true), "ı")
        XCTAssertEqual(rejected.mutations, [])
        XCTAssertEqual(rejected.selection.cell, 0)
    }

    // MARK: - Backspace (backspace-step-back family)

    func test_backspace_matchesEngineBackspaceTarget_everyCellBothAxes_backspaceStepBackFamily() {
        for puzzle in shapes {
            let filled = fills(puzzle)
            for cell in 0..<puzzle.cellCount where !puzzle.blocks.contains(cell) {
                for isAcross in [true, false] {
                    let direction: CrossyEngine.Direction = isAcross ? .across : .down
                    let expected = backspaceTarget(grid(puzzle), direction, cell, filled)
                    let effect = InputActions.backspace(
                        env(puzzle, filled: filled, cell: cell, isAcross: isAcross))
                    XCTAssertEqual(
                        effect.selection,
                        GridSelection(cell: expected, isAcross: isAcross),
                        "cell \(cell) \(isAcross ? "across" : "down") on \(puzzle.rows)x\(puzzle.cols)")
                    // Clears where it lands, skipping the wire no-op when the
                    // landing cell renders empty (the web twin's rule).
                    let wanted: [GridMutation] =
                        filled.contains(expected) ? [.clear(cell: expected)] : []
                    XCTAssertEqual(effect.mutations, wanted)
                }
            }
        }
    }

    // MARK: - Word jumps (next-word / previous-word families, PR #30 Tab cycle)

    func test_nextAndPreviousWord_matchEngineTabTarget_everyCellBothAxes_nextWordFamily() {
        for puzzle in shapes {
            let filled = fills(puzzle)
            for cell in 0..<puzzle.cellCount where !puzzle.blocks.contains(cell) {
                for isAcross in [true, false] {
                    let direction: CrossyEngine.Direction = isAcross ? .across : .down
                    for forward in [true, false] {
                        let toward: Toward = forward ? .forward : .backward
                        let expected = tabTarget(grid(puzzle), direction, cell, toward, filled)
                        let environment = env(
                            puzzle, filled: filled, cell: cell, isAcross: isAcross)
                        let effect =
                            forward
                            ? InputActions.nextWord(environment)
                            : InputActions.previousWord(environment)
                        XCTAssertEqual(
                            effect.selection,
                            GridSelection(
                                cell: expected.cell,
                                isAcross: expected.direction == .across),
                            "cell \(cell) \(isAcross ? "across" : "down") \(forward ? "fwd" : "back") on \(puzzle.rows)x\(puzzle.cols)")
                        XCTAssertEqual(effect.mutations, [])
                    }
                }
            }
        }
    }

    // MARK: - Toggle and taps (root DESIGN §5 pointer paths)

    func test_toggleDirection_flipsAxisInPlace_neverMutates() {
        let puzzle = shapes[0]
        let effect = InputActions.toggleDirection(
            env(puzzle, filled: [], cell: 8, isAcross: true))
        XCTAssertEqual(effect.selection, GridSelection(cell: 8, isAcross: false))
        XCTAssertEqual(effect.mutations, [])
    }

    func test_tap_movesKeepsDirection_selectedCellToggles_blockIsNil() {
        let puzzle = shapes[0]
        let environment = env(puzzle, filled: [], cell: 8, isAcross: true)
        XCTAssertEqual(
            InputActions.tap(environment, cell: 10), GridSelection(cell: 10, isAcross: true))
        XCTAssertEqual(
            InputActions.tap(environment, cell: 8), GridSelection(cell: 8, isAcross: false))
        XCTAssertNil(InputActions.tap(environment, cell: 2))  // block
        XCTAssertNil(InputActions.tap(environment, cell: -1))
        XCTAssertNil(InputActions.tap(environment, cell: 20))
    }

    // MARK: - Rebus (EXPERIENCE.md baseline; PROTOCOL §3 charset)

    func test_rebus_emitsOnePlaceMutationAndAdvancesByTypingOp_protocol3Charset() {
        let puzzle = shapes[0]
        let filled: Set<Int> = [1]
        var after = filled
        after.insert(0)
        let expected = typingAdvance(grid(puzzle), .across, 0, after)
        let effect = InputActions.rebus(
            env(puzzle, filled: filled, cell: 0, isAcross: true), "rebus")
        XCTAssertEqual(effect.mutations, [.place(cell: 0, value: "REBUS")])
        XCTAssertEqual(effect.selection, GridSelection(cell: expected, isAcross: true))
    }

    func test_rebus_refusesValuesOutsideCharsetOrLength_protocol3() {
        let puzzle = shapes[0]
        let environment = env(puzzle, filled: [], cell: 0, isAcross: true)
        XCTAssertEqual(InputActions.rebus(environment, "").mutations, [])
        XCTAssertEqual(InputActions.rebus(environment, "ABCDEFGHIJK").mutations, [])
        XCTAssertEqual(InputActions.rebus(environment, "A&B").mutations, [])
        XCTAssertEqual(
            InputActions.rebus(environment, "A1b").mutations,
            [.place(cell: 0, value: "A1B")])
    }

    // MARK: - The terminal freeze (web twin's frozen rule)

    func test_frozen_refusesMutations_navigationStaysLive() {
        let puzzle = shapes[0]
        let frozenEnv = env(puzzle, filled: [8], cell: 8, isAcross: true, frozen: true)

        let letter = InputActions.letter(frozenEnv, "A")
        XCTAssertEqual(letter.mutations, [])
        XCTAssertEqual(letter.selection, frozenEnv.selection)

        let backspace = InputActions.backspace(frozenEnv)
        XCTAssertEqual(backspace.mutations, [])
        XCTAssertEqual(backspace.selection, frozenEnv.selection)

        let rebus = InputActions.rebus(frozenEnv, "AB")
        XCTAssertEqual(rebus.mutations, [])

        // Navigation stays live after a terminal state.
        let expected = tabTarget(grid(puzzle), .across, 8, .forward, [8])
        XCTAssertEqual(
            InputActions.nextWord(frozenEnv).selection,
            GridSelection(cell: expected.cell, isAcross: expected.direction == .across))
        XCTAssertEqual(
            InputActions.toggleDirection(frozenEnv).selection,
            GridSelection(cell: 8, isAcross: false))
    }
}
