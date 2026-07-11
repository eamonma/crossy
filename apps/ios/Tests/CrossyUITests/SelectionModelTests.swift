import XCTest

import CrossyEngine

@testable import CrossyUI

// SelectionModel: the observable owner of the local cursor (I2b), driven here
// through injected closures so no store is constructed; the GameStore binding is a
// five-line convenience the demo exercises. Pins the intent wiring (deck press,
// tap, swipe), the rebus buffer lifecycle with its one-command commit
// (EXPERIENCE.md baseline, PROTOCOL §3 cap), and that board facts flow in through
// the INV-10 rendered-composite closure, never a second source of truth.

@MainActor
final class SelectionModelTests: XCTestCase {
    /// The vector 5x4: blocks at 2, 6, 13.
    private let puzzle = GridPuzzle(rows: 4, cols: 5, blocks: [2, 6, 13])

    /// A model over a mutable fake board: places and clears write through to
    /// `filled`, exactly the composite a bound GameStore would render (INV-10).
    @MainActor
    private final class Harness {
        var filled: Set<Int> = []
        var frozen = false
        var places: [(cell: Int, value: String)] = []
        var clears: [Int] = []
        var model: SelectionModel!

        init(puzzle: GridPuzzle) {
            model = SelectionModel(
                puzzle: puzzle,
                isFilled: { [weak self] in self?.filled.contains($0) ?? false },
                isFrozen: { [weak self] in self?.frozen ?? false },
                sendPlace: { [weak self] cell, value in
                    self?.places.append((cell, value))
                    self?.filled.insert(cell)
                },
                sendClear: { [weak self] cell in
                    self?.clears.append(cell)
                    self?.filled.remove(cell)
                })
        }
    }

    func test_initialSelection_isFirstPlayableAcross_design5() {
        let harness = Harness(puzzle: puzzle)
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 0, isAcross: true))
    }

    func test_letterPress_placesAtCursorAndAdvances_typingAdvanceFamily() {
        let harness = Harness(puzzle: puzzle)
        harness.model.press(.letter("C"))
        XCTAssertEqual(harness.places.map(\.cell), [0])
        XCTAssertEqual(harness.places.map(\.value), ["C"])
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 1, isAcross: true))
    }

    func test_backspaceOnEmptyCell_stepsBackAndClearsFilledLanding_backspaceStepBackFamily() {
        let harness = Harness(puzzle: puzzle)
        harness.filled = [7]
        harness.model.tap(cell: 8)
        harness.model.press(.backspace)
        XCTAssertEqual(harness.clears, [7])
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 7, isAcross: true))
    }

    func test_swipeIntents_runTheVectoredJumps_nextWordFamily_PR30() {
        let harness = Harness(puzzle: puzzle)
        let grid = Grid(cols: puzzle.cols, rows: puzzle.rows, blocks: puzzle.blocks)
        let expected = tabTarget(grid, .across, 0, .forward, [])
        harness.model.swipe(.nextWord)
        XCTAssertEqual(
            harness.model.selection,
            GridSelection(cell: expected.cell, isAcross: expected.direction == .across))

        harness.model.swipe(.toggleDirection)
        XCTAssertEqual(harness.model.selection.isAcross, expected.direction != .across)
    }

    func test_tap_movesOrTogglesAndIgnoresBlocks_pointerPaths() {
        let harness = Harness(puzzle: puzzle)
        harness.model.tap(cell: 8)
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 8, isAcross: true))
        harness.model.tap(cell: 8)
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 8, isAcross: false))
        harness.model.tap(cell: 2)  // block: no move, no toggle
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 8, isAcross: false))
    }

    // MARK: - Rebus lifecycle (EXPERIENCE.md baseline)

    func test_rebusCommit_sendsOneMultiGlyphCommandAndAdvances_protocol3() {
        let harness = Harness(puzzle: puzzle)
        harness.model.press(.rebus)
        XCTAssertTrue(harness.model.isRebusActive)
        for character in "REBUS" { harness.model.press(.letter(character)) }
        XCTAssertEqual(harness.model.rebusBuffer, "REBUS")
        XCTAssertEqual(harness.places.count, 0, "typing into the buffer never hits the wire")
        harness.model.press(.rebus)
        XCTAssertFalse(harness.model.isRebusActive)
        XCTAssertEqual(harness.places.map(\.value), ["REBUS"])
        XCTAssertEqual(harness.places.map(\.cell), [0])
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 1, isAcross: true))
    }

    func test_rebusBuffer_capsAtTenGlyphs_protocol3() {
        let harness = Harness(puzzle: puzzle)
        harness.model.press(.rebus)
        for character in "ABCDEFGHIJKLM" { harness.model.press(.letter(character)) }
        XCTAssertEqual(harness.model.rebusBuffer, "ABCDEFGHIJ")
    }

    func test_rebusBackspace_editsThenExits_emptyCommitJustCloses() {
        let harness = Harness(puzzle: puzzle)
        harness.model.press(.rebus)
        harness.model.press(.letter("A"))
        harness.model.press(.backspace)
        XCTAssertEqual(harness.model.rebusBuffer, "")
        harness.model.press(.backspace)
        XCTAssertFalse(harness.model.isRebusActive, "backspace on an empty buffer exits")
        XCTAssertEqual(harness.clears, [], "rebus editing never clears board cells")

        harness.model.press(.rebus)
        harness.model.press(.rebus)  // empty commit
        XCTAssertFalse(harness.model.isRebusActive)
        XCTAssertEqual(harness.places.count, 0)
    }

    func test_tapAndSwipe_discardOpenRebusEntry() {
        let harness = Harness(puzzle: puzzle)
        harness.model.press(.rebus)
        harness.model.press(.letter("A"))
        harness.model.tap(cell: 8)
        XCTAssertFalse(harness.model.isRebusActive)
        XCTAssertEqual(harness.places.count, 0)

        harness.model.press(.rebus)
        harness.model.press(.letter("A"))
        harness.model.swipe(.nextWord)
        XCTAssertFalse(harness.model.isRebusActive)
        XCTAssertEqual(harness.places.count, 0)
    }

    // MARK: - The terminal freeze

    func test_frozen_pressesRefuseMutationButNavigationStaysLive() {
        let harness = Harness(puzzle: puzzle)
        harness.frozen = true
        harness.model.press(.letter("A"))
        XCTAssertEqual(harness.places.count, 0)
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 0, isAcross: true))
        harness.model.swipe(.toggleDirection)
        XCTAssertEqual(harness.model.selection.isAcross, false)
    }

    // MARK: - Jump (the roster's Go to target resolution)

    // The roster's Go to action resolves a member's live cursor
    // (RosterCursor, PROTOCOL.md §4, §9) into the same GridSelection a
    // clue-browser jump lands on, and CrossyGridView's `.onChange(of: selection)`
    // then drives the GridCamera follow (I2c) unmodified: the mechanism is
    // exactly `jump(to:)`, so pinning `jump` here pins the roster's target
    // resolution too.
    func test_jump_landsOnTheGivenCellAndAxis_rosterGoTo() {
        let harness = Harness(puzzle: puzzle)
        let cursor = RosterCursor(cell: 11, isAcross: false)
        harness.model.jump(to: GridSelection(cell: cursor.cell, isAcross: cursor.isAcross))
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 11, isAcross: false))
    }

    func test_jump_ignoresABlockedOrOutOfRangeTarget() {
        let harness = Harness(puzzle: puzzle)
        harness.model.jump(to: GridSelection(cell: 2, isAcross: true))  // a block
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 0, isAcross: true))
        harness.model.jump(to: GridSelection(cell: 999, isAcross: true))  // out of range
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 0, isAcross: true))
    }

    func test_filledFacts_flowThroughTheRenderedCompositeClosure_INV10() {
        let harness = Harness(puzzle: puzzle)
        // Cell 11 filled by "the room" (not via the model): typing at 10 must skip
        // it to 12, proving the model reads the rendered composite, not its own
        // bookkeeping.
        harness.filled = [11]
        harness.model.tap(cell: 10)
        harness.model.press(.letter("A"))
        XCTAssertEqual(harness.model.selection, GridSelection(cell: 12, isAcross: true))
    }
}
