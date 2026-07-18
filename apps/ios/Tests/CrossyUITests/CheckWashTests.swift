// The mark wash timing model (apps/ios Wave 15.5, U6): the flagship reveal. The stagger, the
// sub-900 ms bound, the ascending order, and the hidden-until-start behavior are pinned here so
// the ceremony cannot silently regress into a pop. Pure model tests, no view.

import XCTest

@testable import CrossyUI

final class CheckWashTests: XCTestCase {

    // MARK: - The stagger (owner ruling: rank * min(60ms, 500/(n-1)), cell anim ~360ms)

    func test_perCellDelayCapsAtSixtyMilliseconds_U6() {
        // For small mark sets the 60 ms cap binds, so the sweep stays legible.
        XCTAssertEqual(CheckWash.perCellDelay(count: 2), 0.06, accuracy: 1e-9)
        XCTAssertEqual(CheckWash.perCellDelay(count: 9), 0.06, accuracy: 1e-9)
    }

    func test_perCellDelayCompressesForLargeSets_U6() {
        // For large sets the 500 ms budget binds, so the whole wash still fits under 900 ms.
        XCTAssertEqual(CheckWash.perCellDelay(count: 11), 0.05, accuracy: 1e-9)  // 500/10
        XCTAssertEqual(CheckWash.perCellDelay(count: 51), 0.01, accuracy: 1e-9)  // 500/50
    }

    func test_singleMarkHasNoStagger_U6() {
        XCTAssertEqual(CheckWash.perCellDelay(count: 1), 0)
        XCTAssertEqual(CheckWash(cells: [7], startedAt: 0).totalDuration, 0.36, accuracy: 1e-9)
    }

    func test_wholeWashStaysUnderNineHundredMilliseconds_U6() {
        for n in 1...200 {
            let wash = CheckWash(cells: Array(0..<n), startedAt: 0)
            XCTAssertLessThan(
                wash.totalDuration, 0.9, "n=\(n) wash must finish under 900 ms, got \(wash.totalDuration)")
        }
    }

    // MARK: - Ascending order and the hidden-until-start behavior

    func test_cellsAreSortedAscendingRegardlessOfInputOrder_PROTOCOL6() {
        let wash = CheckWash(cells: [44, 3, 17], startedAt: 0)
        XCTAssertEqual(wash.cells, [3, 17, 44])
    }

    func test_everyCoatHiddenBeforeTheStart_U6() {
        let wash = CheckWash(cells: [3, 17, 44], startedAt: 100)
        for cell in [3, 17, 44] {
            XCTAssertEqual(wash.reveal(cell: cell, now: 99.9), 0, "coats stay hidden through the breath")
        }
    }

    func test_earlierCellsRevealBeforeLaterCells_U6() {
        let wash = CheckWash(cells: [3, 17, 44], startedAt: 0)
        // Just after the second cell's start, the first is further along than the second,
        // and the third has not begun.
        let t = CheckWash.perCellDelay(count: 3) + 0.001
        XCTAssertGreaterThan(wash.reveal(cell: 3, now: t), wash.reveal(cell: 17, now: t))
        XCTAssertGreaterThan(wash.reveal(cell: 17, now: t), wash.reveal(cell: 44, now: t))
        XCTAssertEqual(wash.reveal(cell: 44, now: t), 0, "the last cell has not started yet")
    }

    func test_everyCoatFullByTheEnd_U6() {
        let wash = CheckWash(cells: [3, 17, 44], startedAt: 0)
        let end = wash.startedAt + wash.totalDuration + 0.001
        for cell in [3, 17, 44] {
            XCTAssertEqual(wash.reveal(cell: cell, now: end), 1, accuracy: 1e-9)
        }
        XCTAssertTrue(wash.isComplete(now: end))
    }

    func test_aCellOutsideTheWashRevealsFull_U6() {
        let wash = CheckWash(cells: [3, 17], startedAt: 0)
        XCTAssertEqual(wash.reveal(cell: 99, now: 0), 1, "a cell not in this wash is not animated")
    }

    func test_firstCellRevealMidAnimationIsPartial_U6() {
        let wash = CheckWash(cells: [3, 17, 44], startedAt: 0)
        let mid = wash.reveal(cell: 3, now: CheckWash.cellAnimation / 2)
        XCTAssertGreaterThan(mid, 0)
        XCTAssertLessThan(mid, 1)
    }
}
