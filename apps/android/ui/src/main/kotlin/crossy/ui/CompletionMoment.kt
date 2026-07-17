// The completion moment and the terminal facts (roadmap I2d), the pure Kotlin twin of apps/ios
// Sources/CrossyUI/CompletionMoment.swift. The celebration is the mosaic (apps/ios/DESIGN.md §8): on
// the store's transition into completed, every filled letter tints to its writer's roster color,
// holds for a breath, then settles back to ink. It fires on the status TRANSITION, exactly once
// (INV-3): never on render, never again on a reconnect into an already-completed room (a welcome
// snapshot of a completed game shows the terminal state without replaying the celebration).
//
// Everything here is pure value math so the exactly-once gate and the envelopes pin headlessly, the
// FlashEnvelope discipline: CelebrationGate is a fold over observed store states, MosaicEnvelope and
// ConfettiEnvelope are closed forms over elapsed seconds, and the confetti field is deterministically
// seeded. The Compose layer (RoomScreen) drives the gate from render transitions and samples the
// envelopes per frame through the camera transform; the tested character and the shipped render share
// one source of truth. ID-1: the mosaic and the confetti are each muteable by one AttributionSwitches
// constant, checked at the source so a muted switch derives nothing.

package crossy.ui

import crossy.design.AttributionSwitches
import crossy.design.IdentityRoster
import crossy.design.Motion
import crossy.design.RGBColor
import crossy.protocol.GameStatus
import crossy.protocol.Participant
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin

/**
 * The room's lifecycle as the celebration reads it, mapped from the store's GameStatus at the view
 * boundary (the Presence pattern: :ui names its own plain type, protocol types stay in their ring).
 * Twin of the iOS RoomStatus.
 */
enum class RoomStatus {
    ONGOING,
    COMPLETED,
    ABANDONED,
    ;

    companion object {
        /** Map the wire status into the celebration's vocabulary. */
        fun from(status: GameStatus): RoomStatus = when (status) {
            GameStatus.ONGOING -> ONGOING
            GameStatus.COMPLETED -> COMPLETED
            GameStatus.ABANDONED -> ABANDONED
        }
    }
}

/**
 * The exactly-once celebration derivation (INV-3), a pure fold over observed (status, live) pairs:
 * the celebration fires on the ONE observation where the status turns completed after the store has
 * exposed a live ongoing board. A store that was never live-and-ongoing (a fresh connection whose
 * first snapshot is already terminal) shows the terminal state and never celebrates; a store that
 * already fired never fires again, whatever reconnects follow. The store applies snapshots atomically,
 * so the view never observes a transient ongoing-live pair inside a welcome-into-completed.
 *
 * Immutable, the FlashBook idiom: `observe` returns the next gate paired with whether it fired, so the
 * gate lives beside the render model as view state and a snapshot or resync provably cannot touch it.
 * Twin of the iOS mutating CelebrationGate.
 */
data class CelebrationGate(
    private val wasLiveOngoing: Boolean = false,
    private val fired: Boolean = false,
) {
    /** The gate after one observation, and whether the celebration fired on it. */
    data class Step(val gate: CelebrationGate, val fired: Boolean)

    /** Feed one observed store state; the returned [Step] fires true exactly when the celebration
     *  fires. Idempotent for repeated identical observations. */
    fun observe(status: RoomStatus, live: Boolean): Step {
        if (status == RoomStatus.ONGOING) {
            // A live ongoing board arms the gate; a not-yet-live ongoing observation leaves it be.
            return Step(if (live) copy(wasLiveOngoing = true) else this, false)
        }
        if (status == RoomStatus.COMPLETED && wasLiveOngoing && !fired) {
            return Step(copy(fired = true), true)
        }
        return Step(this, false)
    }
}

/**
 * The mosaic's clock (DESIGN.md §8: tint, hold, settle), pure math over elapsed seconds, the
 * FlashEnvelope pattern. The rise is the celebration spring's response from the motion grammar (§7:
 * celebration is the register allowed to breathe); hold and settle are starting values for the device
 * tuning pass. iOS carries seconds; the twin carries Motion's integer milliseconds converted to the
 * seconds clock (reactionNow) here, exactly as GridFlash does. Twin of the Swift MosaicEnvelope.
 */
object MosaicEnvelope {
    /** The tint: ink to the writers' colors, on the celebration spring's response. */
    const val RISE_SECONDS: Double = Motion.Springs.celebrationResponseMs / 1000.0

    /** The hold: one breath at full tint. */
    const val HOLD_SECONDS: Double = 1.6

    /** The settle: back to ink, a slow exhale, longer than the rise. */
    const val SETTLE_SECONDS: Double = 0.9

    /** The whole envelope, the window the mosaic retires against. */
    const val DURATION_SECONDS: Double = RISE_SECONDS + HOLD_SECONDS + SETTLE_SECONDS

    /**
     * Tint intensity `elapsed` seconds after the trigger, in [0, 1]: an ease-out rise, a flat hold,
     * an ease-in-out settle, zero outside the envelope. Under Reduce Motion the eased rise and settle
     * are replaced by a single step (full tint held for the whole envelope, then cleared, no animated
     * motion), mirroring the Motion.kt doctrine that every animation has a reduced-motion equivalent
     * that does not move (the GridFlash FlashEnvelope twin). The mosaic still shows the attribution
     * color under Reduce Motion (it is the celebration's headline, kept like iOS keeps it); it just
     * does not animate.
     */
    fun intensity(elapsed: Double, reduceMotion: Boolean = false): Double {
        if (elapsed <= 0.0) return 0.0
        if (elapsed >= DURATION_SECONDS) return 0.0
        if (reduceMotion) return 1.0
        if (elapsed < RISE_SECONDS) {
            val t = elapsed / RISE_SECONDS
            return 1.0 - (1.0 - t).pow(3)
        }
        if (elapsed < RISE_SECONDS + HOLD_SECONDS) return 1.0
        val t = (elapsed - RISE_SECONDS - HOLD_SECONDS) / SETTLE_SECONDS
        if (t >= 1.0) return 0.0
        // Ease-in-out: the settle leaves the hold as gently as it lands on ink.
        val eased = if (t < 0.5) 4.0 * t * t * t else 1.0 - (-2.0 * t + 2.0).pow(3) / 2.0
        return 1.0 - eased
    }

    /**
     * The paper WASH's intensity `elapsed` seconds after the trigger: the same ease-out rise as the
     * glyph tint (one clock, one bloom), then 1 forever. The settle returns the LETTERS to ink
     * ([intensity] falls to zero) while the wash STANDS as the completed board's record, the web
     * reveal arc's settled WASH (INK -> FIELD -> WASH), never back to plain ink. An envelope that fell
     * to zero was the flash-then-disappear bug: the room's fingerprint erased itself ~3s after it
     * appeared. Under Reduce Motion the eased rise is a single step (full wash held), the [intensity]
     * reduced-motion doctrine; the wash stands either way. Twin of the Swift MosaicEnvelope.washIntensity.
     */
    fun washIntensity(elapsed: Double, reduceMotion: Boolean = false): Double {
        if (elapsed <= 0.0) return 0.0
        if (reduceMotion) return 1.0
        if (elapsed >= RISE_SECONDS) return 1.0
        val t = elapsed / RISE_SECONDS
        return 1.0 - (1.0 - t).pow(3)
    }
}

/**
 * The isolation filter's value (web legend parity: the analysis legend rows toggle the same dim on the
 * web mosaic): which solver the settled wash isolates, who it isolated before, and the toggle's
 * instant, enough for the draw pass to crossfade between the two dims statelessly. Pure presentation
 * over the standing MosaicWash; it never touches the celebration (INV-3) or the wash's own clock. Twin
 * of the Swift MosaicIsolation.
 */
data class MosaicIsolation(
    /** The isolated solver's userId, or null while a clear fades back to the full multi-color wash. */
    val solverId: String?,
    /** The previous value, the crossfade's from-side (null = the full wash). */
    val previousSolverId: String?,
    /** The monotonic seconds clock (reactionNow) at the toggle. */
    val changedAt: Double,
)

/**
 * The mosaic's palette: writer attribution to roster color, one entry per cell that holds a sequenced
 * letter with a writer. Derived entirely from the store's sequenced cells (DESIGN.md §8), never from
 * the optimistic overlay; a cleared cell keeps its clearer as `by` with no value and must not tint.
 * ID-1: the completion mosaic is muteable by a single constant; a muted switch derives nothing, so no
 * draw pass can leak a tint. Twin of the iOS GridMosaic.
 */
object GridMosaic {
    /** The paper wash under the tinted glyph, scaled by the envelope's intensity. Louder than the
     *  teammate wash (0.10): the mosaic is the celebration. */
    const val WASH_ALPHA: Float = 0.30f

    /** The isolation dim's floor: the fraction of the standing wash a non-isolated cell keeps. The
     *  wash composites as alpha OVER the paper, so a lower alpha IS a step toward the ground color on
     *  both grounds by construction; the dimmed hands recess into paper while the isolated one holds
     *  the full wash. Dimmed, never erased: the record stays traceable. Twin of the iOS isolationDim. */
    const val ISOLATION_DIM: Double = 0.18

    /** The isolation crossfade: fast and quiet (a filter, not a celebration), and already the §7
     *  reduced-motion form (a pure opacity crossfade). Twin of the iOS isolationFadeDuration. */
    const val ISOLATION_FADE_SECONDS: Double = 0.25

    /**
     * The per-cell wash multiplier under an isolation, `elapsed` seconds after the toggle: an
     * ease-in-out crossfade from the previous value's dim to the current one's. Null isolation is the
     * full wash. Pure math, so the filter pins headlessly and any frame past the fade (a paused frame
     * loop's frozen clock included) draws the exact target. Keys per cell on the OWNER, not the color
     * (two solvers can share a roster slot's color). Twin of the iOS isolationMultiplier.
     */
    fun isolationMultiplier(owner: String, isolation: MosaicIsolation?, elapsed: Double): Double {
        if (isolation == null) return 1.0
        val from = isolationTarget(owner, isolation.previousSolverId)
        val to = isolationTarget(owner, isolation.solverId)
        if (from == to) return to
        if (elapsed <= 0.0) return from
        val t = elapsed / ISOLATION_FADE_SECONDS
        if (t >= 1.0) return to
        // The settle's own ease-in-out: the filter leaves one value as gently as it lands on the other.
        val eased = if (t < 0.5) 4.0 * t * t * t else 1.0 - (-2.0 * t + 2.0).pow(3) / 2.0
        return from + (to - from) * eased
    }

    /** One side's resting multiplier: the full wash for no isolation or the isolated solver's own
     *  hand, the dim floor for everyone else's. */
    private fun isolationTarget(owner: String, solverId: String?): Double {
        if (solverId == null) return 1.0
        return if (owner == solverId) 1.0 else ISOLATION_DIM
    }

    /**
     * Colors by cell. `writers` maps a cell to the userId whose sequenced letter it holds; slotting
     * follows the presence rule (Presence.marks): the wire color is authoritative, the user-id hash is
     * the fallback, and the local player tints like everyone else (the mosaic is the whole room's
     * fingerprint). ID-1 gated: a muted switch yields an empty palette.
     */
    fun colors(
        writers: Map<Int, String>,
        participants: List<Participant>,
        ground: GridGround,
        completionMosaicEnabled: Boolean = AttributionSwitches.completionMosaicEnabled,
    ): Map<Int, RGBColor> {
        if (!completionMosaicEnabled) return emptyMap()
        val roster = participants.associateBy { it.userId }
        val out = HashMap<Int, RGBColor>(writers.size)
        for ((cell, by) in writers) {
            val identity = IdentityRoster.colorForWireColor(roster[by]?.color ?: "")
                ?: IdentityRoster.color(by)
            out[cell] = ground.rosterColor(identity)
        }
        return out
    }
}

/**
 * One mosaic in flight, or a standing wash at rest: the palette and the trigger instant, snapshotted
 * by the room and consumed by the grid's per-frame draw pass against the render clock (reactionNow).
 * `settled` splits the two clocks the grid keys on (wash stands at 1, glyph falls to ink); `writers`
 * carries the per-cell owner the isolation filter keys on (not the color); `isolation` is the legend's
 * tapped solver over the settled wash. Twin of the iOS MosaicWash.
 */
data class MosaicWash(
    val colors: Map<Int, RGBColor>,
    /** The monotonic seconds clock (reactionNow) at the celebration trigger. */
    val startedAt: Double,
    /** Cell to the writer whose hand it is (the same map `colors` derives from): the isolation filter
     *  keys per cell on the OWNER, not the color, so two solvers sharing a slot's color still split. */
    val writers: Map<Int, String> = emptyMap(),
    /** True once the envelope has landed (or immediately, for a stand with no bloom, the
     *  reconnect-into-completed path): the draw pass paints the standing wash (wash 1, glyph 0) with no
     *  clock, and the grid's frame loop pauses. A settled mosaic costs no frames. */
    val settled: Boolean = false,
    /** The isolation filter over the settled wash, or null at the full multi-color record. */
    val isolation: MosaicIsolation? = null,
)

/**
 * The mosaic's lifecycle as an immutable value the room folds forward (the CelebrationGate idiom: the
 * pure twin of iOS's mutable @Observable CompletionModel mosaic fields, held beside the render model so
 * a snapshot or resync provably cannot touch it). Split from CelebrationGate on purpose: the GATE is the
 * exactly-once celebration arbiter (INV-3); this is the wash's own presentation lifecycle. The bloom and
 * the stand share ONE arming, so neither can follow the other, and the stand never runs through the
 * gate, so a reconnect-into-completed wears the record without ever celebrating (INV-3 by construction).
 * Twin of the Swift CompletionModel's mosaicStartedAt / mosaicSettled / isolation trio.
 */
data class MosaicMoment(
    /** Non-null from the bloom's start (or a stand) on, forever: the settle lands on the STANDING wash,
     *  never back on plain ink, so the completed board keeps the room's fingerprint. */
    val startedAt: Double? = null,
    /** True once the envelope has landed (or immediately, for a stand): the wash is a constant now, so
     *  the grid's frame loop pauses. */
    val settled: Boolean = false,
    /** The one arming the bloom and the stand share; spent once, forever. */
    val armed: Boolean = false,
    /** The isolation filter's one truth: a tapped legend row isolates that solver on the settled wash;
     *  null is the full multi-color record. */
    val isolation: MosaicIsolation? = null,
) {
    /** The isolated solver, or null at the full wash (the legend rows' selected state). */
    val isolatedSolverId: String? get() = isolation?.solverId

    /**
     * Start the completion bloom on the gate's one firing (INV-3): arm and set the trigger, so the wash
     * blooms on the clock. A no-op once armed. `enabled` is the ID-1 mute (a muted switch arms but
     * derives no wash, so the mosaic can never later bloom). Twin of the iOS startMosaic's mosaic arming.
     */
    fun bloom(now: Double, enabled: Boolean): MosaicMoment {
        if (armed) return this
        return if (enabled) copy(startedAt = now, settled = false, armed = true) else copy(armed = true)
    }

    /** The settle's landing: the mosaic STANDS (`startedAt` is never nilled, the wash stays as the
     *  completed board's record) and the frame loop may pause. Twin of the iOS settleMosaic. */
    fun settle(): MosaicMoment = copy(settled = true)

    /**
     * Stand the settled wash without a celebration: the reconnect-into-completed path. INV-3 holds, no
     * bloom plays; this is terminal-state RENDERING, not a celebration. Born past its own envelope, so
     * any clock that reads it sees the settled form; `settled` is what the draw pass actually keys on.
     * Shares the one arming with [bloom], so a stand can never follow a bloom or vice versa. `enabled`
     * is the ID-1 mute (a muted switch stands nothing). Twin of the iOS standMosaic.
     */
    fun stand(now: Double, enabled: Boolean): MosaicMoment {
        if (armed) return this
        return if (enabled) {
            copy(startedAt = now - MosaicEnvelope.DURATION_SECONDS, settled = true, armed = true)
        } else {
            copy(armed = true)
        }
    }

    /**
     * Toggle isolation from a legend row: the same solver clears back to the full wash, another
     * switches to them. Isolation exists only on the SETTLED wash, so a bloom in flight (or an
     * unsettled room) ignores the tap outright: the one arming and the celebration gate are
     * untouchable (INV-3), and a pure presentation value moves nothing but `isolation`. The previous
     * value rides along as the crossfade's from-side. Twin of the iOS toggleIsolation.
     */
    fun toggleIsolation(userId: String, now: Double): MosaicMoment {
        if (!settled) return this
        val current = isolation?.solverId
        return copy(
            isolation = MosaicIsolation(
                solverId = if (current == userId) null else userId,
                previousSolverId = current,
                changedAt = now,
            ),
        )
    }
}

/**
 * The completion confetti (owner ask 2026-07-11, amending §8's no-confetti line): a restrained drift
 * over the room in its roster colors, riding the celebration's one instant beside the mosaic. It
 * never blocks a touch and is skipped entirely under Reduce Motion (the mosaic still lands; a static
 * confetto is just litter). The field is pure math, deterministically seeded, so the whole drift pins
 * headlessly. Twin of the iOS ConfettiFleck/ConfettiEnvelope/ConfettiField.
 */
data class ConfettiFleck(
    /** Spawn x in unit stage width. */
    val unitX: Double,
    /** Seconds after the trigger before this fleck enters. */
    val delay: Double,
    /** Seconds this fleck takes to cross the stage. */
    val fall: Double,
    /** Sway amplitude in unit stage width. */
    val sway: Double,
    /** Sway angular rate, radians per second. */
    val swayRate: Double,
    /** Sway phase offset, radians. */
    val phase: Double,
    /** Spin rate, radians per second (signed). */
    val spin: Double,
    /** Long edge, dp. */
    val size: Double,
    /** Index into the field's palette. */
    val colorIndex: Int,
)

/** One fleck's render state at an instant, in unit stage coordinates. */
data class ConfettiPose(
    val unitX: Double,
    val unitY: Double,
    val rotation: Double,
    val alpha: Double,
)

/** The drift's constants and per-fleck kinematics. Analytic over elapsed time (no per-frame
 *  integration), the MosaicEnvelope discipline: a dropped frame costs smoothness, never trajectory. */
object ConfettiEnvelope {
    const val FLECK_COUNT: Int = 90

    /** Spawn stagger window. */
    const val MAX_DELAY: Double = 0.5
    const val FALL_MIN: Double = 1.7
    const val FALL_MAX: Double = 2.4

    /** The whole drift is over by here; the overlay unmounts on this clock. */
    const val DURATION_SECONDS: Double = MAX_DELAY + FALL_MAX

    /**
     * Pose `elapsed` seconds after the trigger, null while the fleck has not entered or after it has
     * finished. Enters just above the stage (unitY < 0), exits just below (unitY > 1), fades in fast
     * and out over its last fifth. Twin of the iOS ConfettiEnvelope.pose.
     */
    fun pose(fleck: ConfettiFleck, elapsed: Double): ConfettiPose? {
        val t = elapsed - fleck.delay
        // The end check tolerates one ulp of float noise; p clamps so the exit pose is exact.
        if (t < 0.0 || t > fleck.fall + 1e-9) return null
        val p = minOf(1.0, t / fleck.fall)
        // Ease-in fall: gathering speed reads as gravity without integration.
        val unitY = -0.06 + 1.14 * (0.55 * p + 0.45 * p * p)
        val unitX = fleck.unitX + fleck.sway * sin(fleck.swayRate * t + fleck.phase)
        val alpha = minOf(1.0, t / 0.2) * maxOf(0.0, minOf(1.0, (1.0 - p) / 0.2))
        return ConfettiPose(
            unitX = unitX,
            unitY = unitY,
            rotation = fleck.phase + fleck.spin * t,
            alpha = alpha,
        )
    }
}

/**
 * The confetti field: flecks plus their palette, built once per celebration. Colors come from the
 * room's roster (the people are the only color, §1). An empty palette yields an empty field, so a room
 * with no one to color simply does not drift. Twin of the iOS ConfettiField.
 */
data class ConfettiField(
    val flecks: List<ConfettiFleck>,
    val colors: List<RGBColor>,
) {
    val isEmpty: Boolean get() = flecks.isEmpty()

    companion object {
        /** iOS's default seed; the same seed always builds the same drift so tests pin real values. */
        const val DEFAULT_SEED: Long = 0xC0FE_1D0L

        /**
         * SplitMix64: tiny, deterministic, pure (no platform randomness), so the same seed always
         * builds the same drift and tests pin real values. Twin of the iOS ConfettiField.SplitMix64;
         * the golden-ratio and mix constants are written as their two's-complement Long literals
         * (Kotlin has no unsigned Long literal above Long.MAX) so the arithmetic matches Swift's
         * wrapping UInt64 math bit for bit.
         */
        private class SplitMix64(var state: Long) {
            fun next(): Long {
                state += -0x61c8864680b583ebL // 0x9E3779B97F4A7C15
                var z = state
                z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L // 0xBF58476D1CE4E5B9
                z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L // 0x94D049BB133111EB
                return z xor (z ushr 31)
            }

            /** Uniform in [0, 1). */
            fun unit(): Double = (next() ushr 11).toDouble() * (1.0 / 9_007_199_254_740_992.0)

            fun range(lo: Double, hi: Double): Double = lo + unit() * (hi - lo)
        }

        fun make(colors: List<RGBColor>, seed: Long = DEFAULT_SEED): ConfettiField {
            if (colors.isEmpty()) return ConfettiField(emptyList(), emptyList())
            val rng = SplitMix64(seed)
            val flecks = (0 until ConfettiEnvelope.FLECK_COUNT).map { i ->
                ConfettiFleck(
                    unitX = rng.range(-0.02, 1.02),
                    delay = rng.range(0.0, ConfettiEnvelope.MAX_DELAY),
                    fall = rng.range(ConfettiEnvelope.FALL_MIN, ConfettiEnvelope.FALL_MAX),
                    sway = rng.range(0.008, 0.035),
                    swayRate = rng.range(1.6, 3.4),
                    phase = rng.range(0.0, 2.0 * PI),
                    spin = rng.range(-3.0, 3.0),
                    size = rng.range(5.0, 9.0),
                    colorIndex = i % colors.size,
                )
            }
            return ConfettiField(flecks, colors)
        }
    }
}

/** The mosaic's writer attribution, from sequenced cells only (DESIGN.md §8: derived entirely from
 *  the event log): a cell maps to its writer iff it holds a sequenced letter. The optimistic overlay
 *  never tints (a pending command that raced completion will be rejected, not celebrated), and a
 *  cleared cell keeps its clearer as `by` with no value, so it is excluded. Twin of the iOS
 *  CrossyGridView.sequencedWriters. */
fun sequencedWriters(cells: Map<Int, crossy.protocol.Cell>): Map<Int, String> {
    val out = HashMap<Int, String>()
    for ((index, cell) in cells) {
        if (cell.v == null) continue
        val by = cell.by ?: continue
        out[index] = by
    }
    return out
}
