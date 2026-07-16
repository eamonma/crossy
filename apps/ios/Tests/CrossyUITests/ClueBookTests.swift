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

    // Cross-references (mirror of the web's `referencedKeys` in apps/web/src/ui/clueRefs.ts):
    // the current clue's text is parsed, filtered to entries that actually exist in this
    // book, and the current clue itself excluded, so a self-reference or a reference to a
    // clue this grid lacks never lights a row.
    private let refBook = ClueBook(
        across: [
            // 1-Across names 2-Down (exists) and 9-Down (does not) and itself (1-Across).
            ClueEntry(
                number: 1, text: "With 2-Down and 9-Down; see 1-Across",
                cells: [0, 1, 2], isAcross: true),
            ClueEntry(number: 4, text: "Second across", cells: [5, 6], isAcross: true),
        ],
        down: [
            ClueEntry(number: 1, text: "First down", cells: [0, 3], isAcross: false),
            ClueEntry(number: 2, text: "Second down", cells: [1, 4], isAcross: false),
        ])

    func test_referencedIds_filtersToExistingEntriesAndDropsSelf_webReferencedKeys() {
        let current = refBook.across[0]  // 1-Across
        let ids = refBook.referencedIds(for: current)
        // 2-Down exists and is named; 9-Down is named but absent; 1-Across is self.
        XCTAssertEqual(ids, ["2D"])
    }

    func test_referencedIds_isEmptyForNilOrAReferenceLessClue() {
        XCTAssertEqual(refBook.referencedIds(for: nil), [])
        XCTAssertEqual(refBook.referencedIds(for: refBook.across[1]), [])
    }

    func test_referencedCells_unionsTheReferencedEntriesCells() {
        let current = refBook.across[0]  // references 2-Down at cells [1, 4]
        XCTAssertEqual(refBook.referencedCells(for: current), [1, 4])
        XCTAssertEqual(refBook.referencedCells(for: nil), [])
    }

    func test_rows_markReferencedWords_currentWins() {
        let current = refBook.across[0]  // 1-Across, references 2-Down
        let referenced = refBook.referencedIds(for: current)
        let selection = GridSelection(cell: 0, isAcross: true)  // on 1-Across
        let down = ClueBrowserList.rows(
            refBook.down, selection: selection, filled: [], referenced: referenced)
        // 2-Down is referenced by the current clue.
        XCTAssertTrue(down[1].isReferenced)
        XCTAssertFalse(down[0].isReferenced)
    }

    func test_rows_aCurrentRowIsNeverAlsoReferenced_currentWins() {
        // Selection on 1-Across; feed 1-Across's own id into the referenced set to
        // prove current wins even if a set ever carried the current clue.
        let selection = GridSelection(cell: 0, isAcross: true)
        let across = ClueBrowserList.rows(
            refBook.across, selection: selection, filled: [], referenced: ["1A"])
        XCTAssertTrue(across[0].isCurrent)
        XCTAssertFalse(across[0].isReferenced, "the current word never doubles as referenced")
    }

    // Starred clues (D26), the second kind of reference resolved at this same chokepoint. The
    // grammar is pinned in StarredClueTests; here it meets a real clue list, so these are the
    // existence and self-exclusion guards and the union with numeric refs. The reference puzzle
    // is refPuzzleAcross / refPuzzleDown, shared with the grammar cases.
    private let refPuzzle = ClueBook(across: refPuzzleAcross, down: refPuzzleDown)

    func test_referencedIds_resolvesTheRevealerToExactlyTheFourStarredEntries() {
        let revealer = refPuzzleAcross[4]  // 61-Across
        XCTAssertEqual(refPuzzle.referencedIds(for: revealer), ["18A", "29A", "37A", "50A"])
    }

    func test_referencedIds_isOneWay_aStarredClueResolvesToEmpty() {
        XCTAssertEqual(refPuzzle.referencedIds(for: refPuzzleAcross[0]), [])  // 18-Across
    }

    func test_referencedIds_resolvesARevealerToEmptyWhenNoClueWearsTheStar() {
        let starless = ClueBook(across: [refPuzzleAcross[4]], down: refPuzzleDown)
        XCTAssertEqual(starless.referencedIds(for: refPuzzleAcross[4]), [])
    }

    // Self-exclusion, the starred path: a revealer that itself wears the star satisfies both
    // predicates, so without the guard it would light itself. It lights its siblings only,
    // exactly as "8-Down, see also 8-Down" on 8-Down lights nothing.
    func test_referencedIds_excludesAStarredRevealerFromTheSetItNames() {
        let selfNaming = ClueEntry(
            number: 61, text: "*A hint to the starred clues", cells: [8, 9], isAcross: true)
        let book = ClueBook(
            across: Array(refPuzzleAcross[0..<4]) + [selfNaming], down: refPuzzleDown)
        XCTAssertEqual(book.referencedIds(for: selfNaming), ["18A", "29A", "37A", "50A"])
    }

    func test_referencedIds_unionsANumericRefAndAStarredRefIntoOneSet() {
        let clue = ClueEntry(
            number: 1, text: "With 61-Across, a hint to the starred answers", cells: [0, 2],
            isAcross: false)
        let book = ClueBook(across: refPuzzleAcross, down: [clue])
        XCTAssertEqual(
            book.referencedIds(for: clue), ["61A", "18A", "29A", "37A", "50A"])
    }
}
