// The receive-haptic gate (owner spec): a received sticker taps softly only when it
// lands on or orthogonally adjacent to the user's active word — a reaction across the
// board is seen, not felt, so a lively room never buzzes (the SolveHapticFold rule for
// teammate letters, carried over). Pure over GridPuzzle so the rule is pinned in
// tests; the composition root consults it where the reaction notice lands.

public enum ReactionProximity {
    /// True when `cell` is in the active word through `selection`, or one orthogonal
    /// step from any of its cells (row-wrap guarded; diagonals are not adjacency).
    public static func landsNearActiveWord(
        cell: Int, selection: GridSelection, puzzle: GridPuzzle
    ) -> Bool {
        guard cell >= 0, cell < puzzle.cellCount else { return false }
        let word = puzzle.wordCells(through: selection.cell, isAcross: selection.isAcross)
        guard !word.isEmpty else { return false }
        if word.contains(cell) { return true }
        let cols = puzzle.cols
        var neighbors: [Int] = []
        if cell % cols > 0 { neighbors.append(cell - 1) }
        if cell % cols < cols - 1 { neighbors.append(cell + 1) }
        neighbors.append(cell - cols)
        neighbors.append(cell + cols)
        return neighbors.contains { word.contains($0) }
    }
}
