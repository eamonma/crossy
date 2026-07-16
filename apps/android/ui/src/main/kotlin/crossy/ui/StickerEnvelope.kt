// The reaction sticker's motion contract, one set of constants with closed-form curves as the
// pinned specification. Twin of apps/ios StickerEnvelope (Sources/CrossyUI/ReactionModel.swift) and
// the web layer's styles.css sticker-in/out keyframes; the numbers are the web's loud entrance
// (owner ruling "loud entry is good", 2026-07-14), so all three clients shout alike.
//
// The SHIPPING renderer (ReactionStickerLayer) does not sample these per frame: it builds Compose
// keyframe animations FROM these exact constants, so the compositor transforms each glyph's one
// rasterized layer and the content is never re-rendered mid-flight (the owner's entry-shake finding
// 2026-07-14: ANIMATE TRANSFORMS OF A RASTERIZED LAYER, NEVER RE-RENDER CONTENT PER FRAME). The
// closed forms here remain normative: StickerEnvelopeTests samples them to pin the character, and
// they are the reference for any future sampled use, so the tested curve and the shipped keyframes
// share one source of truth.
//
// One 1050 ms linear timeline with per-segment easing: fade in small (scale 0.35 with the whole
// opacity ramp) to the 1.9 balloon by 16%, tremble +5/-5/+4/-2 degrees at 26/38/50/60% composing
// OVER the seeded static tilt, home to 1.88 and 0 degrees at 68%, then settle to exactly 1 by
// 1050 ms. Every track ends at identity, so rest is exact with no step at the entrance's end
// (#245/#247's lesson). A coalesce replays the WHOLE gesture from the refresh instant (a repeat
// shout, not a softer echo). The exit shrinks to 0.7 and fades over the final 380 ms of the 5 s life.

package crossy.ui

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

object StickerEnvelope {
    /** One tremble beat: the rotation the gesture reaches, `at` seconds into the entrance. Degrees
     *  are the animated wobble alone; the renderer and the closed forms both add them ON TOP of the
     *  sticker's seeded tilt. */
    data class TrembleBeat(val at: Double, val degrees: Double)

    /**
     * One CSS cubic-bezier easing, evaluated in pure Kotlin so headless tests pin the exact curve
     * the compositor runs. `valueAt` solves the bezier's x for the input progress by bisection
     * (valid CSS control points keep x monotone), then evaluates y. The renderer lifts the same
     * control points into Compose CubicBezierEasing. Twin of the Swift EasingCurve.
     */
    data class EasingCurve(val x1: Double, val y1: Double, val x2: Double, val y2: Double) {
        fun valueAt(t: Double): Double {
            val x = min(1.0, max(0.0, t))
            if (x <= 0.0) return 0.0
            if (x >= 1.0) return 1.0
            var lower = 0.0
            var upper = 1.0
            repeat(64) {
                val mid = (lower + upper) / 2
                if (axis(mid, x1, x2) < x) lower = mid else upper = mid
            }
            val u = (lower + upper) / 2
            return axis(u, y1, y2)
        }

        /** One bezier axis with endpoints 0 and 1: B(u) = 3(1-u)^2 u c1 + 3(1-u) u^2 c2 + u^3. */
        private fun axis(u: Double, c1: Double, c2: Double): Double {
            val inv = 1 - u
            return 3 * inv * inv * u * c1 + 3 * inv * u * u * c2 + u * u * u
        }
    }

    // The loud entrance: the web's sticker-in keyframes, absolute seconds into the 1050 ms timeline.
    const val ENTRANCE_SECONDS: Double = 1.05

    /** 0%: the sticker fades in small. */
    const val ENTRY_FROM_SCALE: Double = 0.35

    /** 16% (168 ms): the balloon at full presence; the opacity ramp ends here too. */
    const val BALLOON_SCALE: Double = 1.9
    const val BALLOON_AT: Double = 0.168

    /** The tremble's beats (26/38/50/60/68%): decaying swings, then home to zero. */
    val trembleBeats: List<TrembleBeat> = listOf(
        TrembleBeat(0.273, 5.0),
        TrembleBeat(0.399, -5.0),
        TrembleBeat(0.525, 4.0),
        TrembleBeat(0.630, -2.0),
        TrembleBeat(0.714, 0.0),
    )

    /** The settle dip: the balloon eases 1.9 to 1.88 across the tremble's homecoming leg (60% to
     *  68%, the last two beats), then the settle runs 1.88 to exactly 1 over the tail. */
    const val SETTLE_DIP_SCALE: Double = 1.88
    const val SETTLE_DIP_START_AT: Double = 0.630
    const val SETTLE_DIP_AT: Double = 0.714

    /** The entrance's ease-out legs (0 to 16%, and the 68% to 100% settle): the web's --ease-out
     *  token, cubic-bezier(0.16, 1, 0.3, 1). Monotone, so the balloon is the exact peak and the
     *  settle never undershoots. */
    val entranceEaseOut = EasingCurve(0.16, 1.0, 0.3, 1.0)

    /** The tremble legs and the settle dip: the CSS ease-in-out keyword, cubic-bezier(0.42,0,0.58,1). */
    val trembleEaseInOut = EasingCurve(0.42, 0.0, 0.58, 1.0)

    // Exit (shrink+fade inside the sticker's life; the web's sticker-out).
    const val EXIT_SECONDS: Double = 0.38
    const val EXIT_FINAL_SCALE: Double = 0.7

    // Reduce Motion: upright, fade-only (owner spec; the web's fade pair).
    const val REDUCED_MOTION_FADE_IN_SECONDS: Double = 0.18

    /** The entrance scale at `elapsed` since the shout (birth, or a coalesce replay). Piecewise over
     *  the web's rows; at and past ENTRANCE_SECONDS the value is EXACTLY 1 (the bezier ends on 1, so
     *  the boundary carries no step). */
    fun entranceScale(sinceShout: Double): Double {
        val elapsed = sinceShout
        if (elapsed <= 0.0) return ENTRY_FROM_SCALE
        if (elapsed >= ENTRANCE_SECONDS - 1e-9) return 1.0
        if (elapsed < BALLOON_AT) {
            return ENTRY_FROM_SCALE +
                (BALLOON_SCALE - ENTRY_FROM_SCALE) * entranceEaseOut.valueAt(elapsed / BALLOON_AT)
        }
        if (elapsed < SETTLE_DIP_START_AT) return BALLOON_SCALE
        if (elapsed < SETTLE_DIP_AT) {
            val progress = (elapsed - SETTLE_DIP_START_AT) / (SETTLE_DIP_AT - SETTLE_DIP_START_AT)
            return BALLOON_SCALE + (SETTLE_DIP_SCALE - BALLOON_SCALE) * trembleEaseInOut.valueAt(progress)
        }
        val progress = (elapsed - SETTLE_DIP_AT) / (ENTRANCE_SECONDS - SETTLE_DIP_AT)
        return SETTLE_DIP_SCALE + (1.0 - SETTLE_DIP_SCALE) * entranceEaseOut.valueAt(progress)
    }

    /** The tremble rotation at `elapsed` since the shout: zero through the balloon, the eased swings
     *  between beats, zero again from the homecoming on. This value ADDS to the seeded static tilt,
     *  never replaces it. */
    fun entranceTrembleDegrees(sinceShout: Double): Double {
        val elapsed = sinceShout
        val last = trembleBeats.last()
        if (elapsed <= BALLOON_AT || elapsed >= last.at) return 0.0
        var fromAt = BALLOON_AT
        var fromDegrees = 0.0
        for (beat in trembleBeats) {
            if (elapsed < beat.at) {
                val progress = (elapsed - fromAt) / (beat.at - fromAt)
                return fromDegrees + (beat.degrees - fromDegrees) * trembleEaseInOut.valueAt(progress)
            }
            fromAt = beat.at
            fromDegrees = beat.degrees
        }
        return 0.0
    }

    /** The entrance opacity: the whole ramp rides the balloon leg, 0 to 1 by 16%. */
    fun entranceOpacity(sinceShout: Double): Double {
        val elapsed = sinceShout
        if (elapsed <= 0.0) return 0.0
        if (elapsed >= BALLOON_AT) return 1.0
        return entranceEaseOut.valueAt(elapsed / BALLOON_AT)
    }

    /** The exit's shrink factor over the sticker's final EXIT_SECONDS; 1 before. */
    fun exitScale(untilEnd: Double): Double {
        if (untilEnd >= EXIT_SECONDS) return 1.0
        val progress = 1.0 - max(0.0, untilEnd) / EXIT_SECONDS
        return 1.0 + (EXIT_FINAL_SCALE - 1.0) * smoothstep(progress)
    }

    /** When the sticker's CURRENT gesture started: the latest coalesce already in the past, else the
     *  birth (a replay is the whole gesture, re-run from its refresh instant). */
    private fun shoutAt(sticker: ReactionSticker, now: Double): Double =
        if (now < sticker.refreshedAt) sticker.bornAt else sticker.refreshedAt

    /** The whole scale for one sticker at one instant. Reduce Motion renders at rest: scale 1
     *  always (fade-only entry and exit, no balloon, no shrink). */
    fun scale(sticker: ReactionSticker, now: Double, reduceMotion: Boolean): Double {
        if (reduceMotion) return 1.0
        return entranceScale(now - shoutAt(sticker, now)) * exitScale(sticker.endsAt - now)
    }

    /** The whole rotation the sticker renders at: the seeded static tilt with the tremble composing
     *  over it. Upright and motionless under Reduce Motion. */
    fun rotationDegrees(sticker: ReactionSticker, now: Double, reduceMotion: Boolean): Double {
        if (reduceMotion) return 0.0
        return sticker.tiltDegrees + entranceTrembleDegrees(now - shoutAt(sticker, now))
    }

    /** The whole opacity for one sticker at one instant. Reduce Motion swaps the ramp for the web's
     *  plain 180 ms ease from birth and ignores replays (fade in once, fade out once). */
    fun opacity(sticker: ReactionSticker, now: Double, reduceMotion: Boolean): Double {
        val entry =
            if (reduceMotion) min(1.0, max(0.0, (now - sticker.bornAt) / REDUCED_MOTION_FADE_IN_SECONDS))
            else entranceOpacity(now - shoutAt(sticker, now))
        val remaining = sticker.endsAt - now
        if (remaining >= EXIT_SECONDS) return entry
        if (remaining <= 0.0) return 0.0
        return entry * (remaining / EXIT_SECONDS)
    }

    /** The tilt the renderer applies statically: the born-correct angle, or upright under Reduce
     *  Motion (owner spec). */
    fun tiltDegrees(sticker: ReactionSticker, reduceMotion: Boolean): Double =
        if (reduceMotion) 0.0 else sticker.tiltDegrees

    private fun smoothstep(t: Double): Double {
        val clamped = min(1.0, max(0.0, t))
        return clamped * clamped * (3 - 2 * clamped)
    }

    /** Present only so a composed-angle guard reads naturally; abs of the tremble never exceeds 5. */
    internal fun maxTrembleMagnitude(): Double = trembleBeats.maxOf { abs(it.degrees) }
}
