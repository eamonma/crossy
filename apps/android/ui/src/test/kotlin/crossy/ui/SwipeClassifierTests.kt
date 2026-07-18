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
        // 20 dp on the dominant axis is below STANDARD's 24dp travel floor, whatever the axis.
        assertNull(SwipeClassifier.classify(20f, 2f, isAcross = true))
        assertNull(SwipeClassifier.classify(2f, 20f, isAcross = false))
    }

    @Test
    fun `a too-diagonal drag means nothing`() {
        // 40 across and 30 down: neither axis beats the other by the dominance ratio (2x).
        assertNull(SwipeClassifier.classify(40f, 30f, isAcross = true))
    }

    @Test
    fun `the STANDARD preset is the pinned iOS travel floor and dominance ratio`() {
        assertEquals(24f, SwipeTuning.STANDARD.minimumTravel)
        assertEquals(2f, SwipeTuning.STANDARD.dominanceRatio)
    }

    // The preset threshold-edge tables (root DESIGN.md §5): each tuning bites at its own travel floor
    // and dominance ratio, and the two off-STANDARD presets accept or refuse a drag STANDARD would rule
    // the other way, so the sensitivity choice actually moves the boundary.

    @Test
    fun `RELAXED bites at its lower floor and looser ratio`() {
        val t = SwipeTuning.RELAXED
        // Exactly at the 16dp floor with total dominance: classifies.
        assertEquals(SwipeIntent.NEXT_WORD, SwipeClassifier.classify(16f, 0f, isAcross = true, tuning = t))
        // Exactly at the 1.5x dominance ratio (24 across over 16 down): classifies.
        assertEquals(SwipeIntent.NEXT_WORD, SwipeClassifier.classify(24f, 16f, isAcross = true, tuning = t))
        // Just inside the ratio: nothing.
        assertNull(SwipeClassifier.classify(23f, 16f, isAcross = true, tuning = t))
        // A 16dp flick STANDARD would drop (its floor is 24) fires under RELAXED: the looser touch.
        assertNull(SwipeClassifier.classify(16f, 0f, isAcross = true, tuning = SwipeTuning.STANDARD))
    }

    @Test
    fun `PRECISE waits for its higher floor and stricter ratio`() {
        val t = SwipeTuning.PRECISE
        // Exactly at the 32dp floor with total dominance: classifies.
        assertEquals(SwipeIntent.NEXT_WORD, SwipeClassifier.classify(32f, 0f, isAcross = true, tuning = t))
        // Exactly at the 2.5x dominance ratio (40 across over 16 down): classifies.
        assertEquals(SwipeIntent.NEXT_WORD, SwipeClassifier.classify(40f, 16f, isAcross = true, tuning = t))
        // Just inside the ratio: nothing.
        assertNull(SwipeClassifier.classify(39f, 16f, isAcross = true, tuning = t))
        // A 31dp flick STANDARD accepts is refused under PRECISE: it waits for the deliberate one.
        assertNull(SwipeClassifier.classify(31f, 0f, isAcross = true, tuning = t))
        assertEquals(SwipeIntent.NEXT_WORD, SwipeClassifier.classify(31f, 0f, isAcross = true, tuning = SwipeTuning.STANDARD))
    }

    // Flick assist (root DESIGN.md §5): a short flick whose actual translation misses the floor still
    // turns the page if its momentum would have carried it there, but only up to the 2x cap.

    @Test
    fun `a fast short flick classifies on its predicted end translation`() {
        // 18dp of actual travel is under STANDARD's 24dp floor, so the actual translation means nothing;
        // a generous predicted end (30dp, within 2x of 18) carries it to a page turn.
        assertEquals(
            SwipeIntent.NEXT_WORD,
            SwipeClassifier.classify(
                dx = 18f, dy = 0f, predictedDx = 30f, predictedDy = 0f, isAcross = true,
            ),
        )
    }

    @Test
    fun `a tiny twitch with a huge predicted end stays null under the 2x cap`() {
        // 6dp of actual travel caps the prediction at 12dp however fast the lift-off; 12dp is under the
        // 24dp floor, so a violent flick off a still finger fires nothing.
        assertNull(
            SwipeClassifier.classify(
                dx = 6f, dy = 0f, predictedDx = 100f, predictedDy = 0f, isAcross = true,
            ),
        )
    }

    @Test
    fun `the predicted end is never consulted when the actual translation classifies`() {
        // The actual translation already reads NEXT_WORD; a predicted end that alone would read the
        // opposite must not override it.
        assertEquals(
            SwipeIntent.NEXT_WORD,
            SwipeClassifier.classify(
                dx = 60f, dy = 4f, predictedDx = -200f, predictedDy = 0f, isAcross = true,
            ),
        )
    }

    @Test
    fun `each SwipeSensitivity maps to its preset tuning`() {
        assertEquals(SwipeTuning.RELAXED, SwipeSensitivity.RELAXED.tuning)
        assertEquals(SwipeTuning.STANDARD, SwipeSensitivity.STANDARD.tuning)
        assertEquals(SwipeTuning.PRECISE, SwipeSensitivity.PRECISE.tuning)
        // The pinned preset values the iOS twin shares.
        assertEquals(SwipeTuning(16f, 1.5f), SwipeTuning.RELAXED)
        assertEquals(SwipeTuning(24f, 2f), SwipeTuning.STANDARD)
        assertEquals(SwipeTuning(32f, 2.5f), SwipeTuning.PRECISE)
    }
}
