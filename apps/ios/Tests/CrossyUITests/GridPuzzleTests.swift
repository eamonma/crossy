import XCTest

import CrossyEngine

@testable import CrossyUI

// GridPuzzle: numbering from clue starts, the word-span rule, and the INV-6 sweep.
// The word span restates the engine's wordBounds because AD-2 keeps CrossyEngine out
// of CrossyUI's imports; the exhaustive pin below is the drift fence, so a change to
// either side fails here before it can fork the highlight.

final class GridPuzzleTests: XCTestCase {
    /// The 5x5 mini shape used across this suite: symmetric blocks at 4 and 20.
    private let mini = GridPuzzle(rows: 5, cols: 5, blocks: [4, 20])

    func test_numbering_eachClueNumbersItsFirstCell() {
        let numbers = GridPuzzle.numbering(from: [(1, 0), (5, 5), (2, 1)])
        XCTAssertEqual(numbers, [0: 1, 5: 5, 1: 2])
    }

    func test_numbering_sharedAcrossAndDownStartCollapses() {
        // 1-Across and 1-Down both start in cell 0; crossword numbering guarantees
        // they agree, so the map holds one entry.
        let numbers = GridPuzzle.numbering(from: [(1, 0), (1, 0)])
        XCTAssertEqual(numbers, [0: 1])
    }

    // The drift fence: every playable cell, both axes, against the engine's
    // wordBounds on the same geometry.
    func test_wordCells_matchesEngineWordBounds_everyCellBothAxes() {
        let shapes: [GridPuzzle] = [
            mini,
            GridPuzzle(rows: 1, cols: 7, blocks: [3]),
            GridPuzzle(rows: 4, cols: 3, blocks: [1, 5, 9]),
            GridPuzzle(rows: 3, cols: 3, blocks: []),
        ]
        for puzzle in shapes {
            let grid = Grid(cols: puzzle.cols, rows: puzzle.rows, blocks: puzzle.blocks)
            for cell in 0..<puzzle.cellCount where !puzzle.blocks.contains(cell) {
                for isAcross in [true, false] {
                    let direction: CrossyEngine.Direction = isAcross ? .across : .down
                    let bounds = wordBounds(grid, direction, cell)
                    let stride = isAcross ? 1 : puzzle.cols
                    let expected = Set(
                        Swift.stride(from: bounds.start, through: bounds.end, by: stride))
                    XCTAssertEqual(
                        puzzle.wordCells(through: cell, isAcross: isAcross), expected,
                        "cell \(cell) \(isAcross ? "across" : "down") on \(puzzle.rows)x\(puzzle.cols)")
                }
            }
        }
    }

    func test_wordCells_blockAndOutOfRangeAreEmpty() {
        XCTAssertEqual(mini.wordCells(through: 4, isAcross: true), [])
        XCTAssertEqual(mini.wordCells(through: -1, isAcross: true), [])
        XCTAssertEqual(mini.wordCells(through: 25, isAcross: false), [])
    }

    func test_wordCells_downRunStopsAtBlocks() {
        // Column 4 of the mini: cell 4 is a block, so the down run through 9 is 9..24.
        XCTAssertEqual(mini.wordCells(through: 9, isAcross: false), [9, 14, 19, 24])
    }

    // INV-6: the render-shaped puzzle carries no solution-shaped member, so the
    // renderer cannot see one even by accident (the reflection sweep mirrors
    // CrossyProtocol's INV6NoSolutionTests).
    func test_gridPuzzleCarriesNoSolutionShapedMember_INV6() {
        let labels = Mirror(reflecting: mini).children.compactMap(\.label)
        XCTAssertFalse(labels.isEmpty)
        for label in labels {
            let folded = String(
                decoding: label.utf8.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 },
                as: UTF8.self)
            XCTAssertFalse(folded.contains("solution"), "GridPuzzle.\(label) (INV-6)")
        }
    }
}
