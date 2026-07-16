// The swipe classifier as pure geometry over a finished drag (root DESIGN.md §5): along the solving
// direction is next/previous word, across it toggles; too short or too diagonal means nothing. Twin
// of apps/ios SwipeIntent.swift's SwipeClassifier; the drag-end classification the grid feeds when
// the camera held a one-finger drag inert, so pan and swipe never double-fire. Defends the swipe
// mapping contract, not a numbered invariant.
package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class SwipeClassifierTests {

    @Test
    fun `across, a horizontal swipe is next or previous word by sign`() {
        assertEquals(SwipeIntent.NEXT_WORD, SwipeClassifier.classify(60f, 4f, isAcross = true))
        assertEquals(SwipeIntent.PREVIOUS_WORD, SwipeClassifier.classify(-60f, 4f, isAcross = true))
    }

    @Test
    fun `across, a vertical swipe toggles the direction`() {
        assertEquals(SwipeIntent.TOGGLE_DIRECTION, SwipeClassifier.classify(4f, 60f, isAcross = true))
        assertEquals(SwipeIntent.TOGGLE_DIRECTION, SwipeClassifier.classify(4f, -60f, isAcross = true))
    }

    @Test
    fun `down, a vertical swipe is next or previous word by sign`() {
        assertEquals(SwipeIntent.NEXT_WORD, SwipeClassifier.classify(4f, 60f, isAcross = false))
        assertEquals(SwipeIntent.PREVIOUS_WORD, SwipeClassifier.classify(4f, -60f, isAcross = false))
    }

    @Test
    fun `down, a horizontal swipe toggles the direction`() {
        assertEquals(SwipeIntent.TOGGLE_DIRECTION, SwipeClassifier.classify(60f, 4f, isAcross = false))
    }

    @Test
    fun `a drag under the travel floor means nothing`() {
        // 20 dp on the dominant axis is below MINIMUM_TRAVEL (24), whatever the axis.
        assertNull(SwipeClassifier.classify(20f, 2f, isAcross = true))
        assertNull(SwipeClassifier.classify(2f, 20f, isAcross = false))
    }

    @Test
    fun `a too-diagonal drag means nothing`() {
        // 40 across and 30 down: neither axis beats the other by the dominance ratio (2x).
        assertNull(SwipeClassifier.classify(40f, 30f, isAcross = true))
    }

    @Test
    fun `the travel floor and dominance ratio are the pinned iOS constants`() {
        assertEquals(24f, SwipeClassifier.MINIMUM_TRAVEL)
        assertEquals(2f, SwipeClassifier.DOMINANCE_RATIO)
    }
}
