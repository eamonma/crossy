import XCTest

import CrossyEngine

@testable import CrossyStore
@testable import CrossyUI

// The typing-advance preferences (personal-settings slice 1), pinned rule by rule over
// the pure engine op and then through the input layer that carries it on iOS. The two
// knobs compose independently, so the suite walks the OFF/ON matrix and the two
// end-of-word behaviors, and it asserts the default prefs reproduce the pre-slice op the
// navigation vectors pin (typing-advance.json, full-word-asymmetry.json). The next-clue
// move is defined as the Tab traversal order the auto-advance path already walks, so its
// cases assert against `tabTarget` rather than a restated landing.
//
// The shape is the vector 5x4 (blocks 2, 6, 13); row 3 (cells 15..19) is one full across
// word with no interior block, the clean stage for the word-end rules:
//
//   Row0:  0  1  X  3  4
//   Row1:  5  X  7  8  9
//   Row2: 10 11 12  X 14
//   Row3: 15 16 17 18 19

final class TypingPrefsTests: XCTestCase {
    private let puzzle = GridPuzzle(rows: 4, cols: 5, blocks: [2, 6, 13])

    private func grid() -> Grid { Grid(cols: 5, rows: 4, blocks: [2, 6, 13]) }

    /// The engine advance with an explicit preference; row-3 across unless stated.
    private func advance(
        from: Int, filled: Set<Int>, skip: Bool, end: EndOfWordBehavior,
        direction: CrossyEngine.Direction = .across
    ) -> (cell: Int, direction: CrossyEngine.Direction) {
        typingAdvance(
            grid(), direction, from, filled,
            NavigationPrefs(skipFilledInWord: skip, endOfWord: end))
    }

    // MARK: - The default reproduces the pre-slice op exactly (vectors stay green)

    func test_defaultPrefs_matchTheFourArgOp_everyCellBothAxes_typingAdvanceFamily() {
        let g = grid()
        for cell in 0..<20 where ![2, 6, 13].contains(cell) {
            for direction in [CrossyEngine.Direction.across, .down] {
                var after: Set<Int> = [0, 3, 9, 12]  // an arbitrary standing fill
                after.insert(cell)
                let bare = typingAdvance(g, direction, cell, after)
                let withDefault = typingAdvance(g, direction, cell, after, .default)
                XCTAssertEqual(withDefault.cell, bare, "cell \(cell) \(direction)")
                XCTAssertEqual(withDefault.direction, direction, "cell \(cell) \(direction)")
            }
        }
    }

    // MARK: - skipFilledInWord (the OFF/ON matrix, mid-word)

    func test_skipOn_advancesToNextEmptyCell_skipFilledInWord() {
        // from 15 (just typed), 16 empty: land on 16.
        XCTAssertEqual(advance(from: 15, filled: [15], skip: true, end: .firstBlank).cell, 16)
    }

    func test_skipOn_jumpsOverAFilledRunToTheFirstEmpty_skipFilledInWord() {
        // 16, 17 already filled: skip past them to 18.
        XCTAssertEqual(
            advance(from: 15, filled: [15, 16, 17], skip: true, end: .firstBlank).cell, 18)
    }

    func test_skipOff_advancesToTheImmediatelyNextCell_evenWhenFilled() {
        // 16 already filled: skip-off lands on it anyway (the very next cell).
        XCTAssertEqual(
            advance(from: 15, filled: [15, 16], skip: false, end: .firstBlank).cell, 16)
    }

    func test_skipOff_advancesToTheImmediatelyNextCell_whenEmpty() {
        XCTAssertEqual(
            advance(from: 15, filled: [15], skip: false, end: .firstBlank).cell, 16)
    }

    // MARK: - endOfWord: word-end with blanks behind the cursor

    func test_wordEndWithBlanksBehind_firstBlank_jumpsBackToFirstBlank_endOfWord() {
        // skip-off walked to the last cell 19 with 16 still blank behind: first-blank
        // jumps back to 16.
        let result = advance(from: 19, filled: [15, 17, 18, 19], skip: false, end: .firstBlank)
        XCTAssertEqual(result.cell, 16)
        XCTAssertEqual(result.direction, .across)
    }

    func test_wordEndWithBlanksBehind_nextClue_advancesToNextClue_endOfWord() {
        // Same reach, but next-clue leaves the word for the next clue in the Tab order,
        // never hunting a blank behind. It equals the auto-advance path's tab target.
        let filled: Set<Int> = [15, 17, 18, 19]
        let result = advance(from: 19, filled: filled, skip: false, end: .nextClue)
        let tab = tabTarget(grid(), .across, 19, .forward, filled)
        XCTAssertEqual(result.cell, tab.cell)
        XCTAssertEqual(result.direction, tab.direction)
    }

    func test_skipOnCrossingAFilledRunToWordEnd_firstBlank_wrapsToFirstBlank_endOfWord() {
        // from 17, 18 and 19 filled ahead, 15 blank behind: skip-on finds nothing
        // forward, so it wraps to the word's first blank, 15.
        let result = advance(from: 17, filled: [16, 17, 18, 19], skip: true, end: .firstBlank)
        XCTAssertEqual(result.cell, 15)
    }

    // MARK: - endOfWord: word fully filled (word complete)

    func test_wordFull_firstBlank_staysOnLastCell_theVectoredDefaultHolds() {
        // full-word-asymmetry.json: typing the last cell of a full word stays on it. The
        // default end-of-word keeps this, so the pre-slice behavior and the vectors hold.
        let result = advance(
            from: 19, filled: [15, 16, 17, 18, 19], skip: true, end: .firstBlank)
        XCTAssertEqual(result.cell, 19)
        XCTAssertEqual(result.direction, .across)
    }

    func test_wordFull_nextClue_advancesToNextClue_endOfWord() {
        let filled: Set<Int> = [15, 16, 17, 18, 19]
        let result = advance(from: 19, filled: filled, skip: true, end: .nextClue)
        let tab = tabTarget(grid(), .across, 19, .forward, filled)
        XCTAssertEqual(result.cell, tab.cell)
        XCTAssertEqual(result.direction, tab.direction)
    }

    func test_lastCellOfLastClue_nextClue_wrapsThroughTheCycle_endOfWord() {
        // Everything filled but the very first across cell (0): from the grid's last
        // playable cell 19, next-clue wraps the whole cycle back to the first blank, cell
        // 0, exactly as the Tab target does. Covers the last-cell-of-the-last-clue reach.
        var filled = Set(0..<20).subtracting([2, 6, 13])
        filled.remove(0)
        let result = advance(from: 19, filled: filled, skip: true, end: .nextClue)
        let tab = tabTarget(grid(), .across, 19, .forward, filled)
        XCTAssertEqual(result.cell, tab.cell)
        XCTAssertEqual(result.cell, 0)
    }

    // MARK: - The input layer carries the prefs, axis change included

    /// An env with an explicit preference, board before the keystroke.
    private func env(
        from: Int, isAcross: Bool, filled: Set<Int>, prefs: BoardNavigation.NavigationPrefs
    ) -> InputEnv {
        InputEnv(
            puzzle: puzzle, filled: filled,
            selection: GridSelection(cell: from, isAcross: isAcross), frozen: false,
            navigationPrefs: prefs)
    }

    func test_letter_honorsSkipOff_advancesToNextCellRegardlessOfFill() {
        // 16 filled, skip-off: the letter lands on the very next cell 16.
        let effect = InputActions.letter(
            env(
                from: 15, isAcross: true, filled: [16],
                prefs: BoardNavigation.NavigationPrefs(
                    skipFilledInWord: false, endOfWord: .firstBlank)),
            "a")
        XCTAssertEqual(effect.selection, GridSelection(cell: 16, isAcross: true))
        XCTAssertEqual(effect.mutations, [.place(cell: 15, value: "A")])
    }

    func test_letter_nextClue_completingAWord_crossesToTheNextClueAndItsAxis() {
        // Row 3 has one blank (19) left; typing it completes the word. next-clue leaves
        // for the Tab target, and the input effect adopts that clue's axis (it may be a
        // down clue), so the axis is not pinned to the typed cell's.
        let before: Set<Int> = [15, 16, 17, 18]
        let effect = InputActions.letter(
            env(
                from: 19, isAcross: true, filled: before,
                prefs: BoardNavigation.NavigationPrefs(
                    skipFilledInWord: true, endOfWord: .nextClue)),
            "a")
        var after = before
        after.insert(19)
        let tab = tabTarget(grid(), .across, 19, .forward, after)
        XCTAssertEqual(effect.selection.cell, tab.cell)
        XCTAssertEqual(effect.selection.isAcross, tab.direction == .across)
        XCTAssertEqual(effect.mutations, [.place(cell: 19, value: "A")])
    }

    func test_letter_defaultPrefs_matchTheBareTypingOp_noBehaviorChange() {
        // With the default env prefs, the letter path is byte-for-byte the pre-slice op,
        // so a person who never opens Settings sees zero change.
        let before: Set<Int> = [16, 18]
        let effect = InputActions.letter(
            env(from: 15, isAcross: true, filled: before, prefs: .default), "a")
        var after = before
        after.insert(15)
        XCTAssertEqual(effect.selection.cell, typingAdvance(grid(), .across, 15, after))
        XCTAssertEqual(effect.selection.isAcross, true)
    }
}
