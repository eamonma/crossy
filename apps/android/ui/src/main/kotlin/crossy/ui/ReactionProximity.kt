// The receive-haptic gate (owner spec; twin of apps/ios ReactionProximity.swift): a received
// sticker taps softly only when it lands on or orthogonally adjacent to the user's active word —
// a reaction across the board is seen, not felt, so a lively room never buzzes (the
// SolveHapticFold rule for teammate letters, carried over). Pure over GridGeometry so the rule is
// pinned in tests; the composition root consults it where the reaction notice lands.

package crossy.ui

object ReactionProximity {
    /** True when `cell` is in the active word through `selection`, or one orthogonal step from any
     *  of its cells (row-wrap guarded; diagonals are not adjacency). */
    fun landsNearActiveWord(cell: Int, selection: GridSelection, geometry: GridGeometry): Boolean {
        if (cell < 0 || cell >= geometry.cellCount) return false
        val word = geometry.wordCells(selection.cell, selection.isAcross)
        if (word.isEmpty()) return false
        if (cell in word) return true
        val cols = geometry.cols
        val neighbors = buildList {
            if (cell % cols > 0) add(cell - 1)
            if (cell % cols < cols - 1) add(cell + 1)
            add(cell - cols)
            add(cell + cols)
        }
        return neighbors.any { it in word }
    }
}
