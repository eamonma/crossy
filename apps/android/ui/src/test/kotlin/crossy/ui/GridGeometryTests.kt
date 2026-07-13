// The render geometry derived from a ClientPuzzle: clue numbering, playable count, and the word
// cells the active-word highlight reads. INV-6: the source is the solution-stripped ClientPuzzle
// and there is no value here to leak. The word run is pinned against the engine through the store
// facade (BoardNavigation), so this cannot drift from the navigation vectors.
package crossy.ui

import crossy.protocol.ClientPuzzle
import crossy.protocol.Clue
import crossy.protocol.Clues
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class GridGeometryTests {

    // A 3x3 with the center a block (index 4). Across clues: [0,1,2] and [6,7,8]; the middle row
    // splits into singletons [3] and [5]. Down clues mirror it.
    private val puzzle = ClientPuzzle(
        rows = 3,
        cols = 3,
        blocks = listOf(4),
        circles = listOf(0),
        shadedCircles = null,
        clues = Clues(
            across = listOf(
                Clue(1, "top", listOf(0, 1, 2)),
                Clue(4, "left mid", listOf(3)),
                Clue(5, "right mid", listOf(5)),
                Clue(6, "bottom", listOf(6, 7, 8)),
            ),
            down = listOf(
                Clue(1, "left", listOf(0, 3, 6)),
                Clue(2, "top mid", listOf(1)),
                Clue(3, "right", listOf(2, 5, 8)),
            ),
        ),
    )

    private val geometry = GridGeometry.from(puzzle)

    @Test
    fun `INV-6 numbering keys each clue on its first cell`() {
        assertEquals(1, geometry.numbers[0])
        assertEquals(4, geometry.numbers[3])
        assertEquals(5, geometry.numbers[5])
        assertEquals(6, geometry.numbers[6])
        assertEquals(2, geometry.numbers[1])
        assertEquals(3, geometry.numbers[2])
    }

    @Test
    fun `INV-6 playable count is the grid minus its blocks`() {
        assertEquals(8, geometry.playableCellCount)
    }

    @Test
    fun `INV-6 circles carry over from the client puzzle`() {
        assertEquals(setOf(0), geometry.circles)
        assertEquals(emptySet<Int>(), geometry.shadedCircles)
    }

    @Test
    fun `word cells run to a block or edge along the axis`() {
        assertEquals(setOf(0, 1, 2), geometry.wordCells(1, isAcross = true))
        assertEquals(setOf(0, 3, 6), geometry.wordCells(3, isAcross = false))
    }

    @Test
    fun `a block yields no word cells`() {
        assertEquals(emptySet<Int>(), geometry.wordCells(4, isAcross = true))
    }
}
