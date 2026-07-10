import XCTest

@testable import CrossyUI

// The clue chrome's derivations (EXPERIENCE.md clue browser: both directions
// sectioned, current word pinned, filled words quietly de-emphasized, tap to
// jump). The lookup is the web's clueOn and the jump is the web's clueClick,
// verbatim: new interaction semantics never fork (apps/ios/ROADMAP.md inherited
// conventions).

final class ClueBookTests: XCTestCase {
    // A toy book: 1-Across covers 0-2, 4-Across covers 5-6; 1-Down covers 0,3;
    // 2-Down covers 1,4.
    private let book = ClueBook(
        across: [
            ClueEntry(number: 1, text: "First across", cells: [0, 1, 2], isAcross: true),
            ClueEntry(number: 4, text: "Second across", cells: [5, 6], isAcross: true),
        ],
        down: [
            ClueEntry(number: 1, text: "First down", cells: [0, 3], isAcross: false),
            ClueEntry(number: 2, text: "Second down", cells: [1, 4], isAcross: false),
        ])

    func test_clueAt_findsTheWordThroughACellPerAxis_webClueOnParity() {
        XCTAssertEqual(book.clue(at: 1, isAcross: true)?.number, 1)
        XCTAssertEqual(book.clue(at: 1, isAcross: false)?.number, 2)
        XCTAssertNil(book.clue(at: 9, isAcross: true))
    }

    func test_currentForSelection_readsTheSolvingAxis() {
        let selection = GridSelection(cell: 1, isAcross: false)
        XCTAssertEqual(book.current(for: selection)?.id, "2D")
        XCTAssertNil(book.current(for: nil))
    }

    func test_jumpTarget_isTheCluesFirstCellUnconditionally_webClueClickParity() {
        let down = book.down[1]
        let jump = ClueBrowserList.jumpTarget(down)
        // No first-empty scan: that is Tab's rule, not the pointer's.
        XCTAssertEqual(jump.cell, 1)
        XCTAssertFalse(jump.isAcross)
    }

    func test_rows_markTheCurrentAndCrossingWords() {
        let selection = GridSelection(cell: 1, isAcross: true)
        let across = ClueBrowserList.rows(book.across, selection: selection, filled: [])
        let down = ClueBrowserList.rows(book.down, selection: selection, filled: [])
        XCTAssertTrue(across[0].isCurrent)
        XCTAssertFalse(across[0].isCrossing)
        XCTAssertFalse(across[1].isCurrent)
        // 2-Down passes through the cursor cell on the crossing axis.
        XCTAssertTrue(down[1].isCrossing)
        XCTAssertFalse(down[1].isCurrent)
        XCTAssertFalse(down[0].isCrossing)
    }

    func test_rows_deEmphasizeFilledWords_inv10Composite() {
        let selection = GridSelection(cell: 5, isAcross: true)
        // 1-Across is fully filled; 4-Across (current) is also full but never dims.
        let filled: Set<Int> = [0, 1, 2, 5, 6]
        let rows = ClueBrowserList.rows(book.across, selection: selection, filled: filled)
        XCTAssertTrue(rows[0].isDimmed)
        XCTAssertTrue(rows[1].isCurrent)
        XCTAssertFalse(rows[1].isDimmed, "the current word never dims")
    }

    func test_rows_partialFillDoesNotDim() {
        let rows = ClueBrowserList.rows(
            book.across, selection: GridSelection(cell: 5, isAcross: true), filled: [0, 1])
        XCTAssertFalse(rows[0].isDimmed)
    }

    func test_isFilled_anEmptyWordIsNeverFilled() {
        let empty = ClueEntry(number: 9, text: "Ghost", cells: [], isAcross: true)
        XCTAssertFalse(ClueBrowserList.isFilled(empty, filled: []))
    }
}
