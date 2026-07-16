// Swipe-intent mapping (root DESIGN.md §5; twin of apps/ios SwipeIntent.swift): on touch, a swipe
// along the solving direction is Tab (forward with the reading order, backward against it), and a
// swipe across it toggles the direction. The classifier is pure geometry over a finished drag;
// whether a drag was a swipe at all is the grid's call (a drag that panned the camera is a pan, never
// a swipe), so the two gestures cannot double-fire. Kept a pure value type (no Compose) so the whole
// grammar is JVM-testable; the grid measures the drag translation in dp before asking.

package crossy.ui

import kotlin.math.abs

enum class SwipeIntent {
    NEXT_WORD,
    PREVIOUS_WORD,
    TOGGLE_DIRECTION,
}

object SwipeClassifier {
    /** A drag must travel at least this far on its dominant axis to read as a swipe rather than a
     *  stray touch; one cell module in dp at typical zoom (twin of SwipeClassifier.minimumTravel). */
    const val MINIMUM_TRAVEL: Float = 24f

    /** The dominant axis must beat the other by this factor, or the gesture is too diagonal to carry
     *  one honest intent (twin of SwipeClassifier.dominanceRatio). */
    const val DOMINANCE_RATIO: Float = 2f

    /** Classify a finished drag against the current solving axis; null when the gesture is too short
     *  or too diagonal to mean anything. `dx`/`dy` are the drag translation in dp. */
    fun classify(dx: Float, dy: Float, isAcross: Boolean): SwipeIntent? {
        val horizontal = abs(dx) >= abs(dy) * DOMINANCE_RATIO && abs(dx) >= MINIMUM_TRAVEL
        val vertical = abs(dy) >= abs(dx) * DOMINANCE_RATIO && abs(dy) >= MINIMUM_TRAVEL

        if (horizontal) {
            if (isAcross) return if (dx > 0f) SwipeIntent.NEXT_WORD else SwipeIntent.PREVIOUS_WORD
            return SwipeIntent.TOGGLE_DIRECTION
        }
        if (vertical) {
            if (isAcross) return SwipeIntent.TOGGLE_DIRECTION
            return if (dy > 0f) SwipeIntent.NEXT_WORD else SwipeIntent.PREVIOUS_WORD
        }
        return null
    }
}
