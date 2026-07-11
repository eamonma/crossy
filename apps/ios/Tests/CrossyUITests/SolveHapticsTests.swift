import XCTest

@testable import CrossyUI

// The haptic grammar (DESIGN.md §7): the travel tick (owner ruling 2026-07-10:
// every word-to-word travel, not just block crossings), word thud, the double
// tick for a word finished under you, and silence for a teammate's routine
// letters. The fold derives whose hand moved from the delta's position against
// the cursor, so every rule pins headlessly against scripted observations.
//
// The fixture: 5x5, blocks at 2 and 10. Row 0 reads {0,1} | block | {3,4};
// column 0 reads {0,5} | block | {15,20}.

final class SolveHapticsTests: XCTestCase {
    private let puzzle = GridPuzzle(rows: 5, cols: 5, blocks: [2, 10])

    private func seeded(
        filled: Set<Int> = [], cell: Int = 0, isAcross: Bool = true
    ) -> SolveHapticFold {
        var fold = SolveHapticFold()
        _ = fold.observe(
            filled: filled, selection: GridSelection(cell: cell, isAcross: isAcross),
            puzzle: puzzle)
        return fold
    }

    func test_firstObservationSeedsSilently_section7() {
        var fold = SolveHapticFold()
        XCTAssertNil(
            fold.observe(
                filled: [0, 5], selection: GridSelection(cell: 1, isAcross: true),
                puzzle: puzzle))
    }

    func test_colinearTravelOverABlock_ticks_section7() {
        var fold = seeded(cell: 1)
        XCTAssertEqual(
            fold.observe(
                filled: [], selection: GridSelection(cell: 3, isAcross: true),
                puzzle: puzzle),
            .travelTick)
    }

    func test_columnTravelOverABlock_ticks_section7() {
        var fold = seeded(cell: 5, isAcross: false)
        XCTAssertEqual(
            fold.observe(
                filled: [], selection: GridSelection(cell: 15, isAcross: false),
                puzzle: puzzle),
            .travelTick)
    }

    func test_travelWithoutABlockIsSilent_section7() {
        var fold = seeded(cell: 0)
        XCTAssertNil(
            fold.observe(
                filled: [], selection: GridSelection(cell: 1, isAcross: true),
                puzzle: puzzle))
    }

    // Owner ruling 2026-07-10: every word-to-word travel ticks, so a line
    // change (landing in another row's word) ticks like a block crossing.
    func test_aLineChangeTicks_section7() {
        var fold = seeded(cell: 1)
        XCTAssertEqual(
            fold.observe(
                filled: [], selection: GridSelection(cell: 8, isAcross: true),
                puzzle: puzzle),
            .travelTick)
    }

    // The axis toggle stands the cursor in a different word on the same cell:
    // a travel, so it ticks (owner ruling 2026-07-10).
    func test_theAxisToggleTicks_section7() {
        var fold = seeded(cell: 0, isAcross: true)
        XCTAssertEqual(
            fold.observe(
                filled: [], selection: GridSelection(cell: 0, isAcross: false),
                puzzle: puzzle),
            .travelTick)
    }

    func test_localLetterCompletingTheWord_thuds_section7() {
        var fold = seeded(filled: [0], cell: 1)
        XCTAssertEqual(
            fold.observe(
                filled: [0, 1], selection: GridSelection(cell: 3, isAcross: true),
                puzzle: puzzle),
            .wordThud)
    }

    // One haptic per intent: the completing letter's thud outranks the
    // advance's block tick (the advance from 1 to 3 crosses the block at 2).
    func test_theThudOutranksTheAdvancesTick_section7() {
        var fold = seeded(filled: [0], cell: 1)
        let haptic = fold.observe(
            filled: [0, 1], selection: GridSelection(cell: 3, isAcross: true),
            puzzle: puzzle)
        XCTAssertEqual(haptic, .wordThud)
        XCTAssertNotEqual(haptic, .travelTick)
    }

    func test_localLetterMidWordIsSilent_section7() {
        var fold = seeded(cell: 3)
        XCTAssertNil(
            fold.observe(
                filled: [3], selection: GridSelection(cell: 4, isAcross: true),
                puzzle: puzzle))
    }

    func test_someoneFinishingYourStandingWord_doubleTicks_section7() {
        var fold = seeded(filled: [3], cell: 3)
        XCTAssertEqual(
            fold.observe(
                filled: [3, 4], selection: GridSelection(cell: 3, isAcross: true),
                puzzle: puzzle),
            .doubleTick)
    }

    // §7: never a haptic for a teammate's routine letters.
    func test_aTeammatesRoutineLetterIsSilent_section7() {
        var fold = seeded(filled: [3], cell: 3)
        XCTAssertNil(
            fold.observe(
                filled: [3, 20], selection: GridSelection(cell: 3, isAcross: true),
                puzzle: puzzle))
    }

    // A snapshot's bulk delta (welcome, resync) is history arriving, not a
    // moment: silent even when it completes the standing word.
    func test_aSnapshotsBulkDeltaIsSilent_section7() {
        var fold = seeded(filled: [3], cell: 3)
        XCTAssertNil(
            fold.observe(
                filled: [3, 4, 0, 1], selection: GridSelection(cell: 3, isAcross: true),
                puzzle: puzzle))
    }

    // A backspace clears and steps back: clears are movement, so the step
    // ticks only when it crosses a block (it does not, within a word).
    func test_aClearIsMovementNotALetter_section7() {
        var fold = seeded(filled: [3, 4], cell: 4)
        XCTAssertNil(
            fold.observe(
                filled: [3], selection: GridSelection(cell: 3, isAcross: true),
                puzzle: puzzle))
    }

    func test_aLetterCompletingTheDownWord_thuds_section7() {
        var fold = seeded(filled: [15], cell: 20, isAcross: false)
        XCTAssertEqual(
            fold.observe(
                filled: [15, 20], selection: GridSelection(cell: 20, isAcross: false),
                puzzle: puzzle),
            .wordThud)
    }
}
