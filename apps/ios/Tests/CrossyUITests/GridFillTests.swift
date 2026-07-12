import XCTest

@testable import CrossyUI

// Background precedence, root DESIGN.md §10, pinned in full:
// black square > current cell > check > cross-reference > active word > teammate-here
// > default. Each step of the cascade is asserted with every lower flag raised, so
// no reordering can slip through.

final class GridFillTests: XCTestCase {
    func test_precedence_blockBeatsEverything_rootDesignSection10() {
        XCTAssertEqual(
            CellFill.resolve(
                isBlock: true, isCurrent: true, isChecked: true, isCrossReferenced: true,
                inActiveWord: true, hasTeammate: true),
            .block)
    }

    func test_precedence_currentBeatsCheckCrossRefWordAndTeammate() {
        XCTAssertEqual(
            CellFill.resolve(
                isBlock: false, isCurrent: true, isChecked: true, isCrossReferenced: true,
                inActiveWord: true, hasTeammate: true),
            .current)
    }

    func test_precedence_checkBeatsCrossRefWordAndTeammate_m6Slot() {
        XCTAssertEqual(
            CellFill.resolve(
                isBlock: false, isCurrent: false, isChecked: true, isCrossReferenced: true,
                inActiveWord: true, hasTeammate: true),
            .check)
    }

    func test_precedence_crossReferenceBeatsWordAndTeammate() {
        XCTAssertEqual(
            CellFill.resolve(
                isBlock: false, isCurrent: false, isChecked: false, isCrossReferenced: true,
                inActiveWord: true, hasTeammate: true),
            .crossReference)
    }

    func test_precedence_wordBeatsTeammate() {
        XCTAssertEqual(
            CellFill.resolve(
                isBlock: false, isCurrent: false, isChecked: false, isCrossReferenced: false,
                inActiveWord: true, hasTeammate: true),
            .activeWord)
    }

    func test_precedence_teammateBeatsBase() {
        XCTAssertEqual(
            CellFill.resolve(
                isBlock: false, isCurrent: false, isChecked: false, isCrossReferenced: false,
                inActiveWord: false, hasTeammate: true),
            .teammate)
    }

    func test_precedence_noFlagsIsBase() {
        XCTAssertEqual(
            CellFill.resolve(
                isBlock: false, isCurrent: false, isChecked: false, isCrossReferenced: false,
                inActiveWord: false, hasTeammate: false),
            .base)
    }

    // The enum declares its cases in precedence order; drawing code may rely on it.
    func test_casesDeclareThePrecedenceOrder() {
        XCTAssertEqual(
            CellFill.allCases,
            [.block, .current, .check, .crossReference, .activeWord, .teammate, .base])
    }
}
