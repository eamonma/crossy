// Pins the receive-haptic gate against apps/ios ReactionProximity.swift: on the word, orthogonal
// neighbors (row-wrap guarded), never diagonals, never across the board.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ReactionProximityTests {
    // A 3x3 with a center block; the active across word through cell 0 is (0,1,2).
    private val geometry = GridGeometry(
        rows = 3,
        cols = 3,
        blocks = setOf(4),
        circles = emptySet(),
        shadedCircles = emptySet(),
        numbers = emptyMap(),
    )
    private val standing = GridSelection(0, isAcross = true)

    @Test
    fun onTheWordAndOrthogonalNeighborsFeel() {
        assertTrue(ReactionProximity.landsNearActiveWord(1, standing, geometry), "on the word")
        assertTrue(ReactionProximity.landsNearActiveWord(3, standing, geometry), "below cell 0")
        assertTrue(ReactionProximity.landsNearActiveWord(5, standing, geometry), "below cell 2")
    }

    @Test
    fun acrossTheBoardAndDiagonalsAreSeenNotFelt() {
        // 6/8 are diagonal-or-farther from every cell of (0,1,2): silent.
        assertFalse(ReactionProximity.landsNearActiveWord(6, standing, geometry))
        assertFalse(ReactionProximity.landsNearActiveWord(8, standing, geometry))
        assertFalse(ReactionProximity.landsNearActiveWord(7, standing, geometry), "two steps down is not adjacency")
    }

    @Test
    fun rowWrapIsGuardedAndOutOfRangeIsFalse() {
        // The active down word through cell 2 is (2,5,8); cell 3 begins the next row and its
        // left-neighbor arithmetic must not wrap onto cell 2.
        val down = GridSelection(2, isAcross = false)
        assertFalse(ReactionProximity.landsNearActiveWord(3, down, geometry), "row wrap is not adjacency")
        assertFalse(ReactionProximity.landsNearActiveWord(-1, standing, geometry))
        assertFalse(ReactionProximity.landsNearActiveWord(9, standing, geometry))
    }
}
