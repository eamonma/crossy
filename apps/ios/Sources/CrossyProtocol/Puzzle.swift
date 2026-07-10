// The client puzzle (INV-6, DESIGN.md §4, §7; PROTOCOL.md §12). Twin of the client half
// of packages/protocol/src/puzzle.ts.
//
// INV-6 is structural here, deliberately more so than in the TS twin: this module
// defines NO `ServerPuzzle` and no `Solution` type at all. The solution-bearing shape
// exists only server-side; a client that cannot even spell the type cannot decode,
// hold, or re-encode a solution. INV6NoSolutionTests pins this with a reflection sweep
// and a decode-with-solution-present golden.
//
// PROTOCOL.md §12 pins the load-bearing fact (the solution split) and leaves the
// exhaustive puzzle schema (image clues, cross-references, per-cell numbering) to
// ingestion; this is the faithful minimal model the wire contract needs, matching
// `PuzzleBase` field for field.

/// A clue, structured at ingestion (DESIGN.md §7). No answer field, on either side of
/// the split. Twin of `Clue`.
public struct Clue: Sendable, Equatable, Codable {
    public let number: Int
    public let text: String
    public let cellIndices: [Int]

    public init(number: Int, text: String, cellIndices: [Int]) {
        self.number = number
        self.text = text
        self.cellIndices = cellIndices
    }
}

/// Across and down clue lists. Twin of `Clues`.
public struct Clues: Sendable, Equatable, Codable {
    public let across: [Clue]
    public let down: [Clue]

    public init(across: [Clue], down: [Clue]) {
        self.across = across
        self.down = down
    }
}

/// The only puzzle type on any client-facing payload (REST §12). No solution field,
/// transitively (INV-6). Twin of `ClientPuzzle` (= `PuzzleBase`). `shadedCircles` is
/// genuinely optional-and-absent (the TS field is `?`; ingestion omits it when empty),
/// so synthesized Codable's decodeIfPresent/encodeIfPresent is exactly right and the
/// conformance stays synthesized.
public struct ClientPuzzle: Sendable, Equatable, Codable {
    public let rows: Int
    public let cols: Int
    /// Black-square cell indices: unplayable and immutable (PROTOCOL.md §4).
    public let blocks: [Int]
    /// Circled cell indices, a visual overlay (DESIGN.md §2).
    public let circles: [Int]
    /// Shaded-circle cells, a render variant of circles (DESIGN.md §7). Absent when none.
    public let shadedCircles: [Int]?
    public let clues: Clues

    public init(
        rows: Int,
        cols: Int,
        blocks: [Int],
        circles: [Int],
        shadedCircles: [Int]? = nil,
        clues: Clues
    ) {
        self.rows = rows
        self.cols = cols
        self.blocks = blocks
        self.circles = circles
        self.shadedCircles = shadedCircles
        self.clues = clues
    }
}
