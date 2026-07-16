// The conflict flash (PROTOCOL.md §8, D02; apps/ios/DESIGN.md §7): roughly 300 ms in the writer's
// color when a visible value changes under you, sharp attack and long decay, never a linear fade.
// Kotlin twin of apps/ios/Sources/CrossyUI/GridFlash.swift. The store detects the trigger
// (GameStore.onConflictFlash); this file owns the envelope math and the in-flight bookkeeping, so the
// tested character and the shipped render (CrossyGrid samples it per frame) share one source of truth.
// Color in motion is ID-1 scope: recording is gated behind AttributionSwitches.colorInMotionEnabled,
// so muting the switch silences the flash at the source. The envelope constants are Motion.Flash's,
// carried in milliseconds on Android and converted to the seconds clock (reactionNow) here.

package crossy.ui

import crossy.design.AttributionSwitches
import crossy.design.Motion
import crossy.design.RGBColor

/** One flash in flight over a cell. `startedAt` is the monotonic seconds clock (reactionNow) at the
 *  trigger; elapsed time is computed against the render clock each frame, never stored. */
data class GridFlash(val color: RGBColor, val startedAt: Double)

/**
 * The flash envelope: a linear attack to full tint over 50 ms, then a 250 ms cubic-bezier ease-out
 * decay to clear (Motion.Flash constants and control points). Under Reduce Motion the eased envelope
 * is replaced by a single step (full tint held for the envelope, then cleared, no animated decay),
 * mirroring the Motion.kt doctrine that every animation has a reduced-motion equivalent that does not
 * move. Twin of the Swift FlashEnvelope; the durations are Motion.Flash's milliseconds as seconds.
 */
object FlashEnvelope {
    private const val ATTACK_SECONDS: Double = Motion.Flash.attackDurationMs / 1000.0
    private const val DECAY_SECONDS: Double = Motion.Flash.decayDurationMs / 1000.0

    /** Total envelope in seconds (Motion.Flash.durationMs), the window the sweep retires against. */
    const val DURATION_SECONDS: Double = Motion.Flash.durationMs / 1000.0

    /** Opacity of the writer's color `elapsed` seconds after the trigger, in [0, 1]. Reduce Motion
     *  steps: full tint for the whole envelope, then nothing (no eased decay to animate). */
    fun opacity(elapsed: Double, reduceMotion: Boolean = false): Double {
        if (elapsed <= 0.0) return 0.0
        if (elapsed >= DURATION_SECONDS) return 0.0
        if (reduceMotion) return 1.0
        if (elapsed < ATTACK_SECONDS) return elapsed / ATTACK_SECONDS
        val decayed = (elapsed - ATTACK_SECONDS) / DECAY_SECONDS
        if (decayed >= 1.0) return 0.0
        return 1.0 - easedDecay(decayed)
    }

    /** The decay easing: a cubic bezier through Motion.Flash's control points, solved for progress by
     *  bisection (x(t) is monotone for control x in [0, 1]), then evaluated for y. Twin of the Swift
     *  easedDecay and the StickerEnvelope EasingCurve. */
    internal fun easedDecay(progress: Double): Double {
        val p1 = Motion.Flash.decayControlPoint1
        val p2 = Motion.Flash.decayControlPoint2
        var low = 0.0
        var high = 1.0
        repeat(24) {
            val mid = (low + high) / 2
            if (bezier(mid, p1.x, p2.x) < progress) low = mid else high = mid
        }
        val t = (low + high) / 2
        return bezier(t, p1.y, p2.y)
    }

    private fun bezier(t: Double, c1: Double, c2: Double): Double {
        val u = 1 - t
        return 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t
    }
}

/**
 * Active flashes by cell, an immutable value the grid holds as view state (the ReactionBook idiom):
 * a new flash on a cell replaces the one in flight (the latest writer wins, like the event that
 * caused it). Held beside the render model, never inside the store, so a snapshot or resync is
 * provably unable to touch one. Twin of the Swift FlashBook.
 */
data class FlashBook(val flashes: Map<Int, GridFlash> = emptyMap()) {
    val isEmpty: Boolean get() = flashes.isEmpty()

    /** Record a flash trigger. ID-1: color in motion is muteable by a single constant, so a muted
     *  switch drops the trigger here at the source; the default argument reads the real switch and
     *  tests pass both states explicitly. */
    fun record(
        cell: Int,
        color: RGBColor,
        at: Double,
        colorInMotionEnabled: Boolean = AttributionSwitches.colorInMotionEnabled,
    ): FlashBook {
        if (!colorInMotionEnabled) return this
        return FlashBook(flashes + (cell to GridFlash(color, at)))
    }

    /** Drop every flash whose envelope has fully decayed. */
    fun sweep(at: Double): FlashBook =
        FlashBook(flashes.filterValues { at - it.startedAt < FlashEnvelope.DURATION_SECONDS })

    /** The overlay opacity for a cell, null when nothing is in flight there or it has cleared. */
    fun opacity(cell: Int, at: Double, reduceMotion: Boolean = false): Double? {
        val flash = flashes[cell] ?: return null
        val value = FlashEnvelope.opacity(at - flash.startedAt, reduceMotion)
        return if (value > 0.0) value else null
    }

    /** The soonest instant any in-flight flash fully decays, null when the book is empty. The grid's
     *  sweep re-arms off this, the FlashBook sweep pattern the sticker layer already speaks. */
    fun nextExpiry(): Double? =
        flashes.values.minOfOrNull { it.startedAt + FlashEnvelope.DURATION_SECONDS }
}
