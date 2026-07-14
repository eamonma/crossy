// The receive-haptic gate (owner spec: soft tap only when a received sticker lands on
// or adjacent to the user's active word), pinned over the demo's 5x5 geometry so the
// row-wrap guard is exercised: numeric neighbors across a row boundary are never
// adjacency.

import CrossyUI
import XCTest

final class ReactionProximityTests: XCTestCase {
    /// The DemoRoom fixture's shape: 5x5 with blocked corners 0 and 24.
    private let puzzle = GridPuzzle(
        rows: 5, cols: 5, blocks: [0, 24], circles: [], numbers: [:])

    func test_onTheActiveWordIsNear() {
        // Across through cell 6: the full second row, cells 5...9.
        let selection = GridSelection(cell: 6, isAcross: true)
        XCTAssertTrue(
            ReactionProximity.landsNearActiveWord(cell: 8, selection: selection, puzzle: puzzle))
    }

    func test_orthogonallyAdjacentToTheWordIsNear() {
        let selection = GridSelection(cell: 6, isAcross: true)
        // Cell 1 sits directly above cell 6; cell 11 directly below.
        XCTAssertTrue(
            ReactionProximity.landsNearActiveWord(cell: 1, selection: selection, puzzle: puzzle))
        XCTAssertTrue(
            ReactionProximity.landsNearActiveWord(cell: 11, selection: selection, puzzle: puzzle))
    }

    func test_twoStepsAwayIsFar() {
        let selection = GridSelection(cell: 6, isAcross: true)
        // Cell 16 is two rows below the word: seen, not felt.
        XCTAssertFalse(
            ReactionProximity.landsNearActiveWord(cell: 16, selection: selection, puzzle: puzzle))
    }

    func test_rowWrapIsNeverAdjacency() {
        // Down through cell 2: cells 2, 7, 12, 17, 22 (the center column). Cells 9
        // and 10 are numeric neighbors of column cells across a row boundary; the
        // wrap guard keeps both far.
        let selection = GridSelection(cell: 2, isAcross: false)
        XCTAssertFalse(
            ReactionProximity.landsNearActiveWord(cell: 9, selection: selection, puzzle: puzzle))
        XCTAssertFalse(
            ReactionProximity.landsNearActiveWord(cell: 10, selection: selection, puzzle: puzzle))
        // A true lateral neighbor of the column still counts.
        XCTAssertTrue(
            ReactionProximity.landsNearActiveWord(cell: 11, selection: selection, puzzle: puzzle))
    }

    func test_outOfRangeCellsAreFar() {
        let selection = GridSelection(cell: 6, isAcross: true)
        XCTAssertFalse(
            ReactionProximity.landsNearActiveWord(cell: -1, selection: selection, puzzle: puzzle))
        XCTAssertFalse(
            ReactionProximity.landsNearActiveWord(cell: 25, selection: selection, puzzle: puzzle))
    }

    func test_aBlockSelectionHasNoWordAndNothingIsNear() {
        let selection = GridSelection(cell: 0, isAcross: true)
        XCTAssertFalse(
            ReactionProximity.landsNearActiveWord(cell: 1, selection: selection, puzzle: puzzle))
    }
}
