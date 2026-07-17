// Pins the momentum ribbon's geometry against apps/ios MomentumRibbon.swift (and the web sparkline it
// ports): the value/time/index mappings in the reference box, the single-sample flat case, the
// Catmull-Rom-to-bezier control points, and the break gate. Pure math in reference-point space, no
// Compose, the ConfettiEnvelopeTests discipline; the Canvas only scales these to the device.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MomentumRibbonGeometryTests {
    private val g = MomentumRibbonGeometry
    private val eps = 1e-4f

    @Test
    fun `a value maps 1 to the crest and 0 to the baseline, clamped`() {
        assertEquals(g.padTop, g.yForValue(1.0), eps) // crest at padTop (16)
        assertEquals(g.baselineY, g.yForValue(0.0), eps) // 0 sits on the baseline (82)
        assertEquals(g.padTop, g.yForValue(2.0), eps, "over 1 clamps to the crest")
        assertEquals(g.baselineY, g.yForValue(-1.0), eps, "under 0 clamps to the baseline")
        val mid = g.padTop + (g.referenceHeight - g.padTop - g.padBottom) / 2f
        assertEquals(mid, g.yForValue(0.5), eps)
    }

    @Test
    fun `a sample index spans the padded width end to end`() {
        assertEquals(g.padX, g.xForSampleIndex(0f, 40), eps)
        assertEquals(g.referenceWidth - g.padX, g.xForSampleIndex(39f, 40), eps)
    }

    @Test
    fun `a time bins to the nearest sample index, and a zero duration pins to index zero`() {
        assertEquals(g.xForSampleIndex(0f, 40), g.xForTime(0.0, 100.0, 40), eps)
        assertEquals(g.xForSampleIndex(39f, 40), g.xForTime(100.0, 100.0, 40), eps)
        // 50/100 * 39 = 19.5, rounds away from zero to 20 (the iOS .rounded()).
        assertEquals(g.xForSampleIndex(20f, 40), g.xForTime(50.0, 100.0, 40), eps)
        assertEquals(g.padX, g.xForTime(30.0, 0.0, 40), eps, "no duration never divides by zero")
    }

    @Test
    fun `a single sample spans the whole width flat at its value`() {
        val points = g.scaledPoints(listOf(0.5))
        assertEquals(2, points.size)
        assertEquals(g.yForValue(0.5), points[0].y, eps)
        assertEquals(g.yForValue(0.5), points[1].y, eps)
        assertEquals(g.padX, points[0].x, eps)
        assertEquals(g.referenceWidth - g.padX, points[1].x, eps)
    }

    @Test
    fun `forty samples map to forty points`() {
        assertEquals(40, g.scaledPoints(List(40) { it / 39.0 }).size)
    }

    @Test
    fun `the catmull-rom controls clamp the endpoints`() {
        // Three evenly spaced points on the x-axis: the control points stay on the line and the
        // endpoint neighbors are clamped (Pi stands in for Pi-1 at the start, Pi+1 for Pi+2 at the end).
        val pts = listOf(RibbonPoint(0f, 0f), RibbonPoint(6f, 0f), RibbonPoint(12f, 0f))
        val segs = g.curveSegments(pts)
        assertEquals(2, segs.size)
        // Segment 0: c1 = p1 + (p2 - p0)/6 = (1,0); c2 = p2 - (p3 - p1)/6 = (4,0); end = (6,0).
        assertEquals(1f, segs[0].c1.x, eps); assertEquals(0f, segs[0].c1.y, eps)
        assertEquals(4f, segs[0].c2.x, eps)
        assertEquals(6f, segs[0].end.x, eps)
        // Segment 1: c1 = (8,0); c2 = (11,0); end = (12,0).
        assertEquals(8f, segs[1].c1.x, eps)
        assertEquals(11f, segs[1].c2.x, eps)
        assertEquals(12f, segs[1].end.x, eps)
    }

    @Test
    fun `the break marks only with a turning point and a shaped series`() {
        val shaped = RoomMomentum(65.0, List(39) { 0.0 } + listOf(0.7))
        val flat = RoomMomentum(6.0, List(40) { 0.0 })
        val turn = RoomTurningPoint(stallSeconds = 10.0, breakSeconds = 40.0, burst = 3)
        assertTrue(g.marks(shaped, turn))
        assertFalse(g.marks(flat, turn), "a flat solve gets a quiet line, no dot")
        assertFalse(g.marks(shaped, null), "no turning point, no mark")
    }
}
