// The sticker's motion character, pinned by sampling the closed forms. Twin of apps/ios
// StickerEnvelopeTests.swift. The shipping renderer (ReactionStickerLayer) drives Compose keyframe
// animations built from these SAME constants (the entry-shake fix, owner finding 2026-07-14:
// transform a rasterized layer, never re-render content per frame), so these closed forms are the
// normative curve both evaluators share. The numbers are the web layer's loud entrance (styles.css,
// owner ruling "loud entry is good" 2026-07-14): one 1050 ms timeline — fade in small to 0.35,
// balloon to 1.9 by 16%, tremble +5/-5/+4/-2 degrees at 26/38/50/60% composing OVER the seeded
// tilt, home at 1.88 and 0 degrees at 68%, settle to exactly 1 — then the exit to 0.7 over the
// final 380 ms. A coalesce replays the whole gesture from the refresh instant. The end-at-identity
// tests are the #245/#247 lesson: rest must be exact, with no step at the entrance's end.

package crossy.ui

import kotlin.math.abs
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class StickerEnvelopeTests {
    private fun sticker(bornAt: Double = 100.0): ReactionSticker =
        ReactionBook.place(emptyList(), "bee", "🎉", 3, bornAt)[0]

    private fun coalescedSticker(bornAt: Double = 100.0, refreshedAt: Double): ReactionSticker {
        val born = ReactionBook.place(emptyList(), "bee", "🎉", 3, bornAt)
        return ReactionBook.place(born, "bee", "🎉", 3, refreshedAt)[0]
    }

    // --- The timeline (the web's sticker-in rows, percentages of 1050 ms) ---

    @Test
    fun breakpointsAreTheWebPercentagesOfTheEntrance() {
        val total = StickerEnvelope.ENTRANCE_SECONDS
        assertEquals(1.05, total, 1e-12)
        assertEquals(0.16 * total, StickerEnvelope.BALLOON_AT, 1e-12)
        val beats = StickerEnvelope.trembleBeats
        val percentages = listOf(0.26, 0.38, 0.50, 0.60, 0.68)
        assertEquals(percentages.size, beats.size)
        beats.zip(percentages).forEach { (beat, pct) -> assertEquals(pct * total, beat.at, 1e-12) }
        assertEquals(listOf(5.0, -5.0, 4.0, -2.0, 0.0), beats.map { it.degrees })
        // The scale dip rides the tremble's homecoming leg (60% to 68%), one shared pair of
        // breakpoints, exactly as the web couples them in one keyframe block.
        assertEquals(beats[3].at, StickerEnvelope.SETTLE_DIP_START_AT, 1e-12)
        assertEquals(beats[4].at, StickerEnvelope.SETTLE_DIP_AT, 1e-12)
    }

    @Test
    fun segmentEasingsAreTheWebsCubicBeziers() {
        // The ease-out legs run the web's --ease-out token (0.16, 1, 0.3, 1): strongly front-loaded,
        // monotone (no overshoot past a keyframe's value).
        val easeOut = StickerEnvelope.entranceEaseOut
        assertEquals(0.0, easeOut.valueAt(0.0), 1e-12)
        assertEquals(1.0, easeOut.valueAt(1.0), 1e-12)
        assertEquals(0.972, easeOut.valueAt(0.5), 0.002)
        // The tremble legs run the CSS ease-in-out keyword (0.42, 0, 0.58, 1), symmetric about mid.
        val easeInOut = StickerEnvelope.trembleEaseInOut
        assertEquals(0.5, easeInOut.valueAt(0.5), 1e-9)
        var previous = 0.0
        for (step in 1..100) {
            val value = easeInOut.valueAt(step / 100.0)
            assertTrue(value >= previous, "easings must be monotone")
            previous = value
        }
    }

    // --- The loud entrance (fade in small, balloon, tremble, settle) ---

    @Test
    fun entranceFadesInSmallAndBalloonsToThePinnedPeak() {
        assertEquals(StickerEnvelope.ENTRY_FROM_SCALE, StickerEnvelope.entranceScale(0.0), 1e-12)
        assertEquals(0.35, StickerEnvelope.ENTRY_FROM_SCALE, 1e-12)
        assertEquals(0.0, StickerEnvelope.entranceOpacity(0.0), 1e-12)
        // The balloon leg front-loads on the web's ease-out: half the leg's time buys ~97% of rise.
        assertEquals(1.856, StickerEnvelope.entranceScale(StickerEnvelope.BALLOON_AT / 2), 0.005)
        // 16%: full presence, exactly.
        assertEquals(StickerEnvelope.BALLOON_SCALE, StickerEnvelope.entranceScale(StickerEnvelope.BALLOON_AT), 1e-12)
        assertEquals(1.0, StickerEnvelope.entranceOpacity(StickerEnvelope.BALLOON_AT), 1e-12)
        // The balloon IS the peak: nothing ever exceeds 1.9 (the easing is monotone).
        var step = 0.0
        while (step <= StickerEnvelope.ENTRANCE_SECONDS) {
            assertTrue(StickerEnvelope.entranceScale(step) <= StickerEnvelope.BALLOON_SCALE + 1e-9)
            step += 0.001
        }
    }

    @Test
    fun balloonHoldsWhileTheTrembleSwings() {
        // From 16% to 60% the scale is EXACTLY 1.9: the tremble happens on rotation alone.
        var at = StickerEnvelope.BALLOON_AT
        while (at <= StickerEnvelope.SETTLE_DIP_START_AT) {
            assertEquals(StickerEnvelope.BALLOON_SCALE, StickerEnvelope.entranceScale(at), 1e-12)
            at += 0.01
        }
    }

    @Test
    fun trembleHitsTheBeatsAndComposesOverTheSeededTilt() {
        assertEquals(0.0, StickerEnvelope.entranceTrembleDegrees(0.1), 1e-12)
        for (beat in StickerEnvelope.trembleBeats) {
            assertEquals(beat.degrees, StickerEnvelope.entranceTrembleDegrees(beat.at), 1e-9)
        }
        // Mid-leg, ease-in-out's symmetric midpoint: halfway between 0 and +5.
        val midFirstLeg = (StickerEnvelope.BALLOON_AT + StickerEnvelope.trembleBeats[0].at) / 2
        assertEquals(2.5, StickerEnvelope.entranceTrembleDegrees(midFirstLeg), 1e-6)
        // The whole rendered rotation is tilt PLUS tremble: the wobble swings around the seeded
        // lean, never replaces it (owner ruling 2026-07-14).
        val born = sticker(100.0)
        for (beat in StickerEnvelope.trembleBeats) {
            assertEquals(
                born.tiltDegrees + beat.degrees,
                StickerEnvelope.rotationDegrees(born, 100.0 + beat.at, reduceMotion = false),
                1e-9,
            )
        }
        // And the tremble never exceeds its widest swing, so the composed angle stays within 5
        // degrees of the tilt at every instant.
        var step = 0.0
        while (step <= StickerEnvelope.ENTRANCE_SECONDS) {
            val composed = StickerEnvelope.rotationDegrees(born, 100.0 + step, reduceMotion = false)
            assertTrue(abs(composed - born.tiltDegrees) <= 5 + 1e-9)
            step += 0.001
        }
    }

    @Test
    fun everyTrackEndsAtIdentity_web245() {
        val horizon = StickerEnvelope.ENTRANCE_SECONDS
        assertEquals(1.0, StickerEnvelope.entranceScale(horizon - 1e-6), 1e-4)
        assertEquals(1.0, StickerEnvelope.entranceScale(horizon), 1e-12)
        assertEquals(1.0, StickerEnvelope.entranceScale(horizon + 3), 1e-12)
        assertEquals(0.0, StickerEnvelope.entranceTrembleDegrees(horizon), 1e-12)
        assertEquals(1.0, StickerEnvelope.entranceOpacity(horizon), 1e-12)
    }

    @Test
    fun restingTransformIsIdenticalFromSettleThroughExitStart_web245() {
        val born = sticker(100.0)
        val settleEnd = 100.0 + StickerEnvelope.ENTRANCE_SECONDS
        val exitStart = born.endsAt - StickerEnvelope.EXIT_SECONDS
        var at = settleEnd
        while (at <= exitStart) {
            assertEquals(1.0, StickerEnvelope.scale(born, at, reduceMotion = false), 1e-12)
            assertEquals(born.tiltDegrees, StickerEnvelope.rotationDegrees(born, at, reduceMotion = false), 1e-12)
            at += 0.05
        }
    }

    // --- Exit (the web's sticker-out, 380 ms to scale 0.7, faded) ---

    @Test
    fun exitShrinksAndFadesToNothingAtTheEnd() {
        val born = sticker(100.0)
        val end = born.endsAt
        assertEquals(1.0, StickerEnvelope.scale(born, end - StickerEnvelope.EXIT_SECONDS, reduceMotion = false), 1e-12)
        val mid = StickerEnvelope.scale(born, end - StickerEnvelope.EXIT_SECONDS / 2, reduceMotion = false)
        assertTrue(mid < 1.0)
        assertTrue(mid > StickerEnvelope.EXIT_FINAL_SCALE)
        assertEquals(StickerEnvelope.EXIT_FINAL_SCALE, StickerEnvelope.scale(born, end, reduceMotion = false), 1e-9)
        assertEquals(0.0, StickerEnvelope.opacity(born, end, reduceMotion = false), 1e-12)
    }

    // --- The coalesce replay (a repeat shout, not a softer echo) ---

    @Test
    fun coalesceReplaysTheWholeLoudGestureFromTheRefresh() {
        val refreshed = coalescedSticker(bornAt = 100.0, refreshedAt = 102.0)
        // Before the refresh the first gesture has settled: rest, exactly.
        assertEquals(1.0, StickerEnvelope.scale(refreshed, 101.9, reduceMotion = false), 1e-12)
        // The refresh restarts the WHOLE gesture: opacity back to 0, scale to the small start.
        assertEquals(0.0, StickerEnvelope.opacity(refreshed, 102.0, reduceMotion = false), 1e-12)
        assertEquals(StickerEnvelope.ENTRY_FROM_SCALE, StickerEnvelope.scale(refreshed, 102.0, reduceMotion = false), 1e-12)
        assertEquals(
            StickerEnvelope.BALLOON_SCALE,
            StickerEnvelope.scale(refreshed, 102.0 + StickerEnvelope.BALLOON_AT, reduceMotion = false),
            1e-12,
        )
        // The replayed tremble still composes over the tilt.
        val beat = StickerEnvelope.trembleBeats[0]
        assertEquals(
            refreshed.tiltDegrees + beat.degrees,
            StickerEnvelope.rotationDegrees(refreshed, 102.0 + beat.at, reduceMotion = false),
            1e-9,
        )
        // A never-coalesced sticker rests once settled: no gesture without a shout.
        val born = sticker(100.0)
        assertEquals(1.0, StickerEnvelope.scale(born, 100.0 + 2 + StickerEnvelope.BALLOON_AT, reduceMotion = false), 1e-12)
    }

    // --- Reduce Motion (owner spec: upright, fade-only; the web's fade pair) ---

    @Test
    fun reduceMotionRendersUprightAtRestingScaleAlways() {
        val refreshed = coalescedSticker(bornAt = 100.0, refreshedAt = 102.0)
        var at = 100.0
        while (at <= refreshed.endsAt) {
            assertEquals(1.0, StickerEnvelope.scale(refreshed, at, reduceMotion = true), 1e-12)
            assertEquals(0.0, StickerEnvelope.rotationDegrees(refreshed, at, reduceMotion = true), 1e-12)
            at += 0.25
        }
        assertEquals(0.0, StickerEnvelope.tiltDegrees(refreshed, reduceMotion = true), 1e-12)
        // The plain 180 ms fade reaches presence later than the loud ramp.
        assertTrue(
            StickerEnvelope.opacity(refreshed, 100.1, reduceMotion = true) <
                StickerEnvelope.opacity(refreshed, 100.1, reduceMotion = false),
        )
    }
}
