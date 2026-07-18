// Swipe-intent mapping (root DESIGN.md §5; twin of apps/ios SwipeIntent.swift): on touch, a swipe
// along the solving direction is Tab (forward with the reading order, backward against it), and a
// swipe across it toggles the direction. The classifier is pure geometry over a finished drag;
// whether a drag was a swipe at all is the grid's call (a drag that panned the camera is a pan, never
// a swipe), so the two gestures cannot double-fire. Kept a pure value type (no Compose) so the whole
// grammar is JVM-testable; the grid measures the drag translation in dp before asking.

package crossy.ui

import kotlin.math.abs
import kotlin.math.hypot

enum class SwipeIntent {
    NEXT_WORD,
    PREVIOUS_WORD,
    TOGGLE_DIRECTION,
}

/** How readily a drag reads as a swipe (twin of SwipeClassifier.SwipeTuning). Two dials: the travel
 *  floor in dp on the dominant axis, and the factor by which that axis must beat the other so the
 *  gesture carries one honest intent rather than a diagonal smear. The person picks one of three
 *  presets in Settings; STANDARD reproduces the pre-tuning behavior exactly, so an untouched device
 *  never shifts and the swipe tables stay pinned. */
data class SwipeTuning(val minimumTravel: Float, val dominanceRatio: Float) {
    companion object {
        /** A lighter touch: shorter, looser swipes fire. */
        val RELAXED = SwipeTuning(minimumTravel = 16f, dominanceRatio = 1.5f)

        /** The default, and the pre-tuning constants: one cell module in dp at typical zoom, the
         *  dominant axis twice the other (twin of SwipeTuning.standard). */
        val STANDARD = SwipeTuning(minimumTravel = 24f, dominanceRatio = 2f)

        /** Waits for a longer, straighter, more deliberate swipe. */
        val PRECISE = SwipeTuning(minimumTravel = 32f, dominanceRatio = 2.5f)
    }
}

/** The person's swipe-sensitivity choice (personal-settings; twin of SwipeSensitivity). Stored as its
 *  raw case name by NavigationSettingsStore; an absent or unrecognized stored value resolves to
 *  STANDARD, so an untouched device keeps the pre-tuning behavior. */
enum class SwipeSensitivity {
    RELAXED,
    STANDARD,
    PRECISE;

    /** The geometry this choice hands the classifier. */
    val tuning: SwipeTuning
        get() = when (this) {
            RELAXED -> SwipeTuning.RELAXED
            STANDARD -> SwipeTuning.STANDARD
            PRECISE -> SwipeTuning.PRECISE
        }
}

object SwipeClassifier {
    /** The window the grid projects lift-off velocity across to synthesize a predicted end
     *  translation for the flick-assist path. iOS gets predictedEndTranslation free from SwiftUI's
     *  DragGesture (the translation plus a platform-defined velocity projection); Android has no
     *  equivalent, so the grid synthesizes one as `translation + velocity * this window`. 0.1s is the
     *  ballpark a hand's flick decelerates over: long enough to carry a fast twitch past the travel
     *  floor, short enough that a slow drag's prediction stays near its actual end. Because iOS's
     *  projection is platform-defined, exact twinship is impossible; the 2x cap in the flick-assist
     *  path bounds how far the two platforms' predictions can diverge, so a borderline flick might
     *  differ by a page turn but never by more than the cap allows. */
    const val FLICK_PROJECTION_SECONDS: Float = 0.1f

    /** Classify a finished drag against the current solving axis; null when the gesture is too short
     *  or too diagonal to mean anything. `dx`/`dy` are the drag translation in dp. `tuning` sets the
     *  travel floor and dominance ratio; STANDARD reproduces the pre-tuning behavior exactly. */
    fun classify(
        dx: Float,
        dy: Float,
        isAcross: Boolean,
        tuning: SwipeTuning = SwipeTuning.STANDARD,
    ): SwipeIntent? {
        val horizontal =
            abs(dx) >= abs(dy) * tuning.dominanceRatio && abs(dx) >= tuning.minimumTravel
        val vertical =
            abs(dy) >= abs(dx) * tuning.dominanceRatio && abs(dy) >= tuning.minimumTravel

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

    /** The flick-assist path (twin of the classify(translation:predictedEndTranslation:) overload): a
     *  fast, short flick whose actual translation falls under the travel floor still turns the page if
     *  its momentum would have carried it there. Classify the actual translation first; only when that
     *  means nothing consult the predicted end translation, after capping it so its Euclidean length
     *  never exceeds 2x the actual translation's. The cap scales the predicted vector uniformly, which
     *  preserves its direction and its dominance ratio (so the read stays honest), and it stops a tiny
     *  twitch with a high lift-off velocity from firing a page turn the hand never asked for.
     *  `dx`/`dy` are the actual drag translation in dp; `predictedDx`/`predictedDy` the predicted end
     *  translation in dp. */
    fun classify(
        dx: Float,
        dy: Float,
        predictedDx: Float,
        predictedDy: Float,
        isAcross: Boolean,
        tuning: SwipeTuning = SwipeTuning.STANDARD,
    ): SwipeIntent? {
        classify(dx, dy, isAcross, tuning)?.let { return it }

        // Cap the predicted vector to 2x the actual travel, scaling uniformly so its direction and
        // dominance survive. A zero actual translation caps the prediction to zero, so a pure flick
        // off a still finger classifies as nothing.
        val actualLength = hypot(dx, dy)
        val predictedLength = hypot(predictedDx, predictedDy)
        val cap = 2f * actualLength
        if (predictedLength <= cap || predictedLength == 0f) {
            return classify(predictedDx, predictedDy, isAcross, tuning)
        }
        val scale = cap / predictedLength
        return classify(predictedDx * scale, predictedDy * scale, isAcross, tuning)
    }
}
