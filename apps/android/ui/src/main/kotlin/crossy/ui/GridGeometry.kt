// The render-shaped puzzle: geometry and clue numbering, derived from the solution-stripped
// ClientPuzzle (INV-6 holds structurally, exactly as in :protocol: no solution-shaped field
// exists). Twin of the iOS GridPuzzle. This is derived render data, not a redefinition of a wire
// type: `numbers` is computed from clue starts (ClientPuzzle carries none), and `wordCells` reuses
// the engine's word bounds through the store facade (BoardNavigation) so the ten-line scan rule is
// never restated on this side of the fence.

package crossy.ui

import crossy.protocol.ClientPuzzle
import crossy.store.BoardNavigation

class GridGeometry(
    val rows: Int,
    val cols: Int,
    /** Black-square cell indices: unplayable and immutable (PROTOCOL.md §4). */
    val blocks: Set<Int>,
    /** Circled cells, drawn as inset rings (DESIGN.md §10). */
    val circles: Set<Int>,
    /** Shaded-circle cells, a render variant of circles. */
    val shadedCircles: Set<Int>,
    /** Clue number by cell, derived from clue starts; rendered top-left per the module contract. */
    val numbers: Map<Int, Int>,
) {
    val cellCount: Int get() = rows * cols

    /** Playable cells: the grid minus the black squares (PROTOCOL.md §4). */
    val playableCellCount: Int get() = cellCount - blocks.count { it in 0 until cellCount }

    private val nav: BoardNavigation.Geometry = BoardNavigation.Geometry(cols, rows, blocks)

    /** The cells of the word running through `cell` on one axis: the contiguous non-block run to a
     *  block or grid edge each way, empty for a block or an out-of-range cell. The extent comes from
     *  the engine's `wordBounds` (via the store facade); enumerating it by the axis stride is a pure
     *  index walk, no rule of its own. */
    fun wordCells(cell: Int, isAcross: Boolean): Set<Int> {
        if (cell < 0 || cell >= cellCount || cell in blocks) return emptySet()
        val bounds = BoardNavigation.wordBoundsOf(nav, isAcross, cell)
        val stride = if (isAcross) 1 else cols
        val out = LinkedHashSet<Int>()
        var c = bounds.start
        while (c <= bounds.end) {
            out.add(c)
            c += stride
        }
        return out
    }

    companion object {
        /** Map a client puzzle to render geometry. Numbering: each clue numbers its first cell, and
         *  an across and a down clue starting in the same cell share the number by crossword
         *  construction (ingestion guarantees agreement, so last-write is safe). */
        fun from(puzzle: ClientPuzzle): GridGeometry {
            val numbers = HashMap<Int, Int>()
            for (clue in puzzle.clues.across) clue.cellIndices.firstOrNull()?.let { numbers[it] = clue.number }
            for (clue in puzzle.clues.down) clue.cellIndices.firstOrNull()?.let { numbers[it] = clue.number }
            return GridGeometry(
                rows = puzzle.rows,
                cols = puzzle.cols,
                blocks = puzzle.blocks.toSet(),
                circles = puzzle.circles.toSet(),
                shadedCircles = puzzle.shadedCircles?.toSet() ?: emptySet(),
                numbers = numbers,
            )
        }
    }
}
