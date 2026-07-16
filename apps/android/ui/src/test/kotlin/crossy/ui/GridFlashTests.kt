// The conflict-flash envelope pinned against Motion.Flash (the loud 300 ms wash, PROTOCOL.md §8,
// D02), the values shared with apps/ios/Sources/CrossyUI/GridFlash.swift so the twins cannot drift:
// a linear attack to full over 50 ms, an eased decay over the next 250 ms, and a Reduce Motion step
// that holds full tint for the envelope with no animated decay. FlashBook's ID-1 color-in-motion
// gate and its sweep are pinned here too.
package crossy.ui

import crossy.design.RGBColor
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GridFlashTests {
    private val red = RGBColor(255, 0, 0)

    @Test
    fun `D02 the flash is dark before the trigger and after the envelope`() {
        assertEquals(0.0, FlashEnvelope.opacity(-0.01))
        assertEquals(0.0, FlashEnvelope.opacity(0.0))
        // At and past the 300 ms envelope (Motion.Flash.durationMs) the wash is clear.
        assertEquals(0.0, FlashEnvelope.opacity(FlashEnvelope.DURATION_SECONDS))
        assertEquals(0.0, FlashEnvelope.opacity(0.5))
    }

    @Test
    fun `D02 the attack is linear to full over 50 ms`() {
        // Half of Motion.Flash.attackDurationMs (25 ms) is half tint; the 50 ms peak is full. The
        // peak lands at the attack/decay boundary where the decay bezier is solved by bisection, so
        // it is full to the solver's residual (a shared iOS trait, 24 iterations), not bit-exact.
        assertEquals(0.5, FlashEnvelope.opacity(0.025), 1e-9)
        assertEquals(1.0, FlashEnvelope.opacity(0.05), 1e-6)
    }

    @Test
    fun `D02 the decay eases down from the peak, never a linear fade`() {
        // The 250 ms decay leg (Motion.Flash.decayDurationMs) is monotone down from the 50 ms peak to
        // clear at 300 ms, and eases (a mid-decay sample sits above the linear midpoint).
        val peak = FlashEnvelope.opacity(0.05)
        val early = FlashEnvelope.opacity(0.10)
        val late = FlashEnvelope.opacity(0.20)
        assertTrue(peak > early && early > late && late > 0.0) { "decay must fall monotonically" }
        // Ease-out (Motion.Flash control points 0.16/0.30 with y=1): the front of the decay drops
        // fast, so a quarter into the 250 ms decay (elapsed 0.1125 s) the value has already fallen
        // well below the linear-fade quarter of 0.75.
        assertTrue(FlashEnvelope.opacity(0.1125) < 0.75) { "decay must be eased, not linear" }
    }

    @Test
    fun `D02 Reduce Motion steps rather than animates`() {
        // A held full tint across the whole envelope, then nothing: no eased decay to animate.
        assertEquals(0.0, FlashEnvelope.opacity(0.0, reduceMotion = true))
        assertEquals(1.0, FlashEnvelope.opacity(0.001, reduceMotion = true))
        assertEquals(1.0, FlashEnvelope.opacity(0.15, reduceMotion = true))
        assertEquals(1.0, FlashEnvelope.opacity(0.29, reduceMotion = true))
        assertEquals(0.0, FlashEnvelope.opacity(FlashEnvelope.DURATION_SECONDS, reduceMotion = true))
    }

    @Test
    fun `ID-1 a muted color-in-motion switch drops the trigger at the source`() {
        val muted = FlashBook().record(cell = 4, color = red, at = 1.0, colorInMotionEnabled = false)
        assertTrue(muted.isEmpty)
        val on = FlashBook().record(cell = 4, color = red, at = 1.0, colorInMotionEnabled = true)
        assertTrue(!on.isEmpty)
        assertEquals(red, on.flashes[4]?.color)
    }

    @Test
    fun `D02 the latest writer wins on a cell`() {
        val blue = RGBColor(0, 0, 255)
        val book = FlashBook()
            .record(cell = 7, color = red, at = 1.0, colorInMotionEnabled = true)
            .record(cell = 7, color = blue, at = 1.2, colorInMotionEnabled = true)
        assertEquals(1, book.flashes.size)
        assertEquals(blue, book.flashes[7]?.color)
        assertEquals(1.2, book.flashes[7]?.startedAt)
    }

    @Test
    fun `D02 opacity is null off a cell and before it opens, and the sweep retires it`() {
        val book = FlashBook().record(cell = 2, color = red, at = 1.0, colorInMotionEnabled = true)
        assertNull(book.opacity(cell = 3, at = 1.01)) // no flash there
        assertNull(book.opacity(cell = 2, at = 1.0)) // elapsed 0: dark
        assertTrue((book.opacity(cell = 2, at = 1.02) ?: 0.0) > 0.0) // mid-attack
        // nextExpiry is one envelope past the trigger; sweeping past it empties the book.
        assertEquals(1.0 + FlashEnvelope.DURATION_SECONDS, book.nextExpiry())
        assertTrue(book.sweep(at = 1.0 + FlashEnvelope.DURATION_SECONDS).isEmpty)
        assertTrue(!book.sweep(at = 1.1).isEmpty) // still inside the envelope
    }
}
