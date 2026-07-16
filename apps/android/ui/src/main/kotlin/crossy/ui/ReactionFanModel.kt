// The reaction fan's grammar, pure (the throttle discipline: decide here, gesture code only
// reports). Twin of apps/ios ReactionFanModel + ReactionFanLayout. Two ways in, one way out:
// HOLD-SLIDE-RELEASE (touch down opens, sliding highlights, release over an emoji fires, release
// elsewhere cancels) and TAP-TAP (release on the button opens a standing fan; a tap fires; ~3 s of
// idle or a tap away closes). Firing ALWAYS dismisses the fan (owner ruling from the web review).
// Exhaustive transition tests live in ReactionFanModelTests; the Compose fan (ReactionFan.kt)
// translates touches into these calls and renders the phase. Kept a pure value type (no Compose)
// so the whole grammar is JVM-testable.

package crossy.ui

/**
 * The fan's whole state, an immutable value the Compose surface holds as one mutableStateOf and
 * advances by returning the next value. Mirrors the Swift struct's mutating methods as pure copies.
 */
data class ReactionFanModel(
    /** The five slots this fan offers, in slot order: the holder's personal set (D25), defaulting to
     *  the protocol's default five for a surface with no store. The reaction-sets follow-up track
     *  passes the per-user five here; this parameter is the open seam. */
    val emojis: List<String> = ReactionPolicy.defaultSet,
    val phase: Phase = Phase.CLOSED,
    /** The slot under the held finger, for the render's highlight; null off the row. */
    val highlighted: Int? = null,
    /** When the standing fan opened (or last mattered), the idle timeout's anchor. */
    val openedAt: Double? = null,
    /** Whether the current hold began on an already-standing fan, so releasing on the button TOGGLES
     *  it closed instead of reopening it. */
    private val holdBeganTapOpen: Boolean = false,
) {
    enum class Phase {
        CLOSED,

        /** A finger holds the button: the fan stands only as long as the touch does. */
        HELD_OPEN,

        /** Opened by a tap: the fan stands alone until a fire, a tap away, or idle. */
        TAP_OPEN,
    }

    /** What the caller does about one transition. `Fire` carries the emoji to send; the fan is
     *  already closed by the time it returns (fire always dismisses). */
    sealed interface Effect {
        data object None : Effect
        data class Fire(val emoji: String) : Effect
    }

    val isOpen: Boolean get() = phase != Phase.CLOSED

    /** A transition result: the next model plus the effect the caller must run. */
    data class Step(val model: ReactionFanModel, val effect: Effect = Effect.None)

    // --- Hold-slide-release ---

    /** The touch landed on the button. Opens the fan immediately (no long-press latency: the hold
     *  IS the open). */
    fun holdBegan(): ReactionFanModel =
        copy(phase = Phase.HELD_OPEN, highlighted = null, holdBeganTapOpen = phase == Phase.TAP_OPEN)

    /** The held finger moved; `over` is the slot under it (null off the row). */
    fun holdMoved(over: Int?): ReactionFanModel {
        if (phase != Phase.HELD_OPEN) return this
        return copy(highlighted = over?.takeIf { it in emojis.indices })
    }

    /** The hold ended. Over an emoji: fire and dismiss. On the button: the tap fallback (open
     *  standing, or toggle an already-standing fan closed). Anywhere else: cancel. */
    fun holdEnded(over: Int?, onButton: Boolean, now: Double): Step {
        if (phase != Phase.HELD_OPEN) return Step(this)
        if (over != null && over in emojis.indices) {
            return Step(closed(), Effect.Fire(emojis[over]))
        }
        if (onButton) {
            return if (holdBeganTapOpen) {
                Step(closed())
            } else {
                Step(copy(phase = Phase.TAP_OPEN, highlighted = null, openedAt = now, holdBeganTapOpen = false))
            }
        }
        return Step(closed())
    }

    // --- The standing (tap-opened) fan ---

    /** A tap on one emoji of the standing fan. */
    fun tapEmoji(at: Int): Step {
        if (phase != Phase.TAP_OPEN || at !in emojis.indices) return Step(this)
        return Step(closed(), Effect.Fire(emojis[at]))
    }

    /** A touch anywhere else while the fan stands (DESIGN.md §4: transient surfaces yield to intent;
     *  the touch still lands where it fell). */
    fun tapAway(): ReactionFanModel = if (phase == Phase.TAP_OPEN) closed() else this

    /** The idle timer fired. Validated against `openedAt` so a timer scheduled for a previous
     *  opening can never close a newer one. */
    fun idleExpired(now: Double): ReactionFanModel {
        val opened = openedAt
        if (phase != Phase.TAP_OPEN || opened == null || now - opened < TAP_OPEN_IDLE_SECONDS) return this
        return closed()
    }

    private fun closed(): ReactionFanModel =
        copy(phase = Phase.CLOSED, highlighted = null, openedAt = null, holdBeganTapOpen = false)

    companion object {
        /** The tap-opened fan's idle life (owner spec: ~3 s). */
        const val TAP_OPEN_IDLE_SECONDS: Double = 3.0
    }
}

/**
 * The open fan's geometry, pure so the hold-slide hit test and the render cannot disagree: one
 * horizontal capsule of `SLOT_SIZE` squares (the 44 dp touch floor), slid across by x alone. Values
 * in dp; the view maps gesture locations into the capsule's own space before asking. Twin of the iOS
 * ReactionFanLayout.
 */
object ReactionFanLayout {
    const val SLOT_SIZE: Double = 44.0
    const val SLOT_SPACING: Double = 2.0
    const val CAPSULE_PADDING: Double = 6.0

    /** How far past the capsule a held finger still counts as "over the row": hold-slide is a coarse
     *  gesture and the thumb occludes the target. */
    const val HOLD_SLACK: Double = 18.0

    fun width(count: Int): Double {
        if (count <= 0) return 0.0
        return count * SLOT_SIZE + (count - 1) * SLOT_SPACING + CAPSULE_PADDING * 2
    }

    val height: Double get() = SLOT_SIZE + CAPSULE_PADDING * 2

    /** A slot's center x, from the capsule's leading edge. */
    fun slotCenterX(index: Int, count: Int): Double =
        CAPSULE_PADDING + index * (SLOT_SIZE + SLOT_SPACING) + SLOT_SIZE / 2

    /** The slot under a point in the capsule's space, with `HOLD_SLACK` of grace around the whole
     *  capsule; null beyond it. */
    fun slot(atX: Double, y: Double, count: Int): Int? {
        if (count <= 0) return null
        if (y < -HOLD_SLACK || y > height + HOLD_SLACK) return null
        if (atX < -HOLD_SLACK || atX > width(count) + HOLD_SLACK) return null
        val inner = atX - CAPSULE_PADDING
        val pitch = SLOT_SIZE + SLOT_SPACING
        val index = kotlin.math.floor(inner / pitch).toInt()
        return index.coerceIn(0, count - 1)
    }
}
