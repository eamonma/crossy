// The completion confetti pinned against apps/ios CompletionMoment.swift (ConfettiEnvelope /
// ConfettiField): the analytic pose math and the deterministically seeded field, so the drift's
// character cannot fork between the twins. Pure value math, no Compose, the GridFlashTests
// discipline; the Compose overlay (ConfettiOverlay) only evaluates these poses against elapsed time.
package crossy.ui

import crossy.design.RGBColor
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ConfettiEnvelopeTests {
    private val red = RGBColor(255, 0, 0)
    private val blue = RGBColor(0, 0, 255)

    private val fleck = ConfettiFleck(
        unitX = 0.5, delay = 0.2, fall = 2.0, sway = 0.02, swayRate = 2.0,
        phase = 0.7, spin = 1.5, size = 7.0, colorIndex = 0,
    )

    @Test
    fun `a fleck has no pose before its delay or after its fall`() {
        assertNull(ConfettiEnvelope.pose(fleck, elapsed = 0.0))
        assertNull(ConfettiEnvelope.pose(fleck, elapsed = 0.19))
        assertNull(ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + fleck.fall + 0.01))
        assertNotNull(ConfettiEnvelope.pose(fleck, elapsed = fleck.delay))
        // The exact end tolerates one ulp of float noise (the iOS 1e-9 rule) and clamps to the exit.
        assertNotNull(ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + fleck.fall))
    }

    @Test
    fun `the fall enters above the stage and exits below it`() {
        val entry = ConfettiEnvelope.pose(fleck, elapsed = fleck.delay)!!
        assertEquals(-0.06, entry.unitY, 1e-9) // just above the stage
        val exit = ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + fleck.fall)!!
        assertEquals(1.08, exit.unitY, 1e-9) // -0.06 + 1.14: just below the stage
    }

    @Test
    fun `the fall eases in, reading as gravity`() {
        // Halfway through its time the fleck has covered less than half its path (0.55*0.5 + 0.45*0.25
        // = 0.3875 of the 1.14 span): speed gathers toward the exit without integration.
        val half = ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + fleck.fall / 2)!!
        val coveredAtHalf = (half.unitY + 0.06) / 1.14
        assertEquals(0.3875, coveredAtHalf, 1e-9)
        assertTrue(coveredAtHalf < 0.5) { "the fall must ease in, not run linear" }
    }

    @Test
    fun `alpha fades in fast and out over the last fifth`() {
        // Fade-in: 0 at entry, full by 0.2 s in.
        assertEquals(0.0, ConfettiEnvelope.pose(fleck, elapsed = fleck.delay)!!.alpha, 1e-9)
        assertEquals(0.5, ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + 0.1)!!.alpha, 1e-9)
        assertEquals(1.0, ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + 0.3)!!.alpha, 1e-9)
        // Fade-out: gone exactly at the exit, half through the last tenth of a two-second fall.
        assertEquals(0.0, ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + fleck.fall)!!.alpha, 1e-9)
        val nearEnd = ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + fleck.fall * 0.95)!!
        assertTrue(nearEnd.alpha in 0.0..0.5) { "the last fifth must fade out" }
    }

    @Test
    fun `rotation is the phase plus spin over time in flight`() {
        val t = 0.8
        val pose = ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + t)!!
        assertEquals(fleck.phase + fleck.spin * t, pose.rotation, 1e-9)
    }

    @Test
    fun `sway oscillates about the spawn x within its amplitude`() {
        val pose = ConfettiEnvelope.pose(fleck, elapsed = fleck.delay + 0.5)!!
        assertTrue(kotlin.math.abs(pose.unitX - fleck.unitX) <= fleck.sway + 1e-9)
    }

    @Test
    fun `the drift's whole window is the stagger plus the longest fall`() {
        assertEquals(
            ConfettiEnvelope.MAX_DELAY + ConfettiEnvelope.FALL_MAX,
            ConfettiEnvelope.DURATION_SECONDS,
            1e-9,
        )
    }

    @Test
    fun `the field is deterministic for one seed and full-count`() {
        val a = ConfettiField.make(listOf(red, blue))
        val b = ConfettiField.make(listOf(red, blue))
        assertEquals(a, b) // same seed, same drift: tests and renders pin real values
        assertEquals(ConfettiEnvelope.FLECK_COUNT, a.flecks.size)
        // A different seed builds a different drift.
        val other = ConfettiField.make(listOf(red, blue), seed = 7L)
        assertTrue(other != a)
    }

    @Test
    fun `every fleck's parameters land inside the envelope's ranges`() {
        val field = ConfettiField.make(listOf(red, blue, RGBColor(0, 255, 0)))
        for (fleck in field.flecks) {
            assertTrue(fleck.unitX in -0.02..1.02)
            assertTrue(fleck.delay in 0.0..ConfettiEnvelope.MAX_DELAY)
            assertTrue(fleck.fall in ConfettiEnvelope.FALL_MIN..ConfettiEnvelope.FALL_MAX)
            assertTrue(fleck.sway in 0.008..0.035)
            assertTrue(fleck.swayRate in 1.6..3.4)
            assertTrue(fleck.phase in 0.0..(2.0 * Math.PI))
            assertTrue(fleck.spin in -3.0..3.0)
            assertTrue(fleck.size in 5.0..9.0)
            assertTrue(fleck.colorIndex in 0..2)
        }
        // The palette round-robins so every roster color drifts.
        assertEquals(setOf(0, 1, 2), field.flecks.map { it.colorIndex }.toSet())
    }

    @Test
    fun `an empty palette yields an empty field, so a colorless room does not drift`() {
        val field = ConfettiField.make(emptyList())
        assertTrue(field.isEmpty)
        assertTrue(field.flecks.isEmpty() && field.colors.isEmpty())
    }
}
