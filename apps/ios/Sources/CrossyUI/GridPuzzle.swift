// The render-shaped puzzle: geometry and clue numbering only, mapped from the
// solution-stripped ClientPuzzle by the composition root. INV-6 holds structurally
// here exactly as it does in CrossyProtocol: no solution-shaped field exists and the
// initializer accepts none, so the renderer cannot see a solution even by accident.

public struct GridPuzzle: Sendable, Equatable {
    public let rows: Int
    public let cols: Int
    /// Black-square cell indices: unplayable and immutable (PROTOCOL.md §4).
    public let blocks: Set<Int>
    /// Circled cells, drawn as inset rings (root DESIGN.md §10).
    public let circles: Set<Int>
    /// Shaded-circle cells, a render variant of circles (CrossyProtocol ClientPuzzle).
    public let shadedCircles: Set<Int>
    /// Clue number by cell, derived from clue starts (`numbering(from:)`); rendered
    /// top-left per the module contract.
    public let numbers: [Int: Int]

    public init(
        rows: Int,
        cols: Int,
        blocks: Set<Int>,
        circles: Set<Int> = [],
        shadedCircles: Set<Int> = [],
        numbers: [Int: Int] = [:]
    ) {
        self.rows = rows
        self.cols = cols
        self.blocks = blocks
        self.circles = circles
        self.shadedCircles = shadedCircles
        self.numbers = numbers
    }

    public var cellCount: Int { rows * cols }

    /// Cell numbering from clue starts: each clue numbers its first cell, and an
    /// across and a down clue starting in the same cell share the number by crossword
    /// construction (the caller passes `(clue.number, clue.cellIndices.first)` for
    /// both directions; ingestion guarantees agreement, so last-write is safe).
    public static func numbering(from clueStarts: [(number: Int, cell: Int)]) -> [Int: Int] {
        var numbers: [Int: Int] = [:]
        for start in clueStarts {
            numbers[start.cell] = start.number
        }
        return numbers
    }

    /// The cells of the word running through `cell` on one axis: the contiguous
    /// non-block run to a block or grid edge each way, empty for a block or an
    /// out-of-range cell. Same rule as the engine's `wordBounds`
    /// (Sources/CrossyEngine/Navigation.swift); AD-2 keeps CrossyEngine out of
    /// CrossyUI's imports, so the ten-line run rule is restated here and pinned
    /// against the engine by GridPuzzleTests, where drift fails the suite.
    public func wordCells(through cell: Int, isAcross: Bool) -> Set<Int> {
        guard cell >= 0, cell < cellCount, !blocks.contains(cell) else { return [] }
        let stride = isAcross ? 1 : cols
        let lineStart = isAcross ? (cell / cols) * cols : cell % cols
        let lineEnd = isAcross ? lineStart + cols - 1 : lineStart + (rows - 1) * cols
        var cells: Set<Int> = [cell]
        var cursor = cell
        while cursor - stride >= lineStart, !blocks.contains(cursor - stride) {
            cursor -= stride
            cells.insert(cursor)
        }
        cursor = cell
        while cursor + stride <= lineEnd, !blocks.contains(cursor + stride) {
            cursor += stride
            cells.insert(cursor)
        }
        return cells
    }
}

/// The local player's cursor: a cell and a solving axis. Owned by the input layer
/// (roadmap I2b), passed into the grid as plain render input; the store deliberately
/// holds no local selection (it mirrors the server actor, and selection never
/// crosses the wire).
public struct GridSelection: Sendable, Equatable {
    public var cell: Int
    public var isAcross: Bool

    public init(cell: Int, isAcross: Bool) {
        self.cell = cell
        self.isAcross = isAcross
    }
}
