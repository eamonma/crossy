// Sittings on the Android post-game surface (design/post-game/SITTINGS.md, D29; owner rulings; twin of
// apps/ios SittingsPresentationTests.swift): active time is THE headline Time, the sitting count is
// context, never a second stat ("24:13 · 2 sittings", only at two or more), and the momentum ribbon
// draws a quiet seam tick at each interior sitting boundary through the same time-to-x bucketing the
// break marker maps by. An older bundle (no sittings) and a single-sitting game read exactly as today.
// Pure value/geometry math, no Compose, the RoomAnalysisTests discipline. (The facts-content cases live
// with RoomFactsSheet, this file pins the analysis-panel and ribbon halves.)

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class SittingsSuffixTests {
    private fun analysis(durationSeconds: Double = 1453.0, sittings: RoomSittings?) = RoomAnalysis(
        owners = emptyMap(),
        momentum = RoomMomentum(durationSeconds = durationSeconds, samples = emptyList()),
        turningPoint = null,
        titles = emptyList(),
        sittings = sittings,
    )

    private fun sittings(count: Int, endings: List<Double>): RoomSittings {
        val spans = mutableListOf<RoomSittings.Span>()
        var start = 0.0
        for (end in endings) {
            spans.add(RoomSittings.Span(startSeconds = start, endSeconds = end))
            start = end
        }
        return RoomSittings(count = count, spans = spans, wallSeconds = endings.lastOrNull() ?: 0.0)
    }

    // Owner ruling, D29: the suffix renders only at two or more sittings.
    @Test
    fun `the suffix renders at two or more sittings`() {
        assertEquals(
            "2 sittings",
            analysis(sittings = sittings(count = 2, endings = listOf(300.0, 1453.0))).sittingCountSuffix,
        )
        assertEquals(
            "3 sittings",
            analysis(sittings = sittings(count = 3, endings = listOf(300.0, 900.0, 1453.0))).sittingCountSuffix,
        )
    }

    // A single-sitting game reads exactly as today: no suffix (D29).
    @Test
    fun `no suffix for a single sitting`() {
        assertNull(analysis(sittings = sittings(count = 1, endings = listOf(1453.0))).sittingCountSuffix)
    }

    // An older cached bundle omits sittings entirely; the surface degrades to today's rendering
    // (PROTOCOL.md §12 absence rule, D29).
    @Test
    fun `no suffix when sittings absent, an older bundle`() {
        assertNull(analysis(sittings = null).sittingCountSuffix)
    }

    // The headline keeps the one moment formatter (formatMSS, unified with web in the hour-roll fix):
    // sittings add context, never a formatting fork (D29).
    @Test
    fun `the headline keeps the hour-rolling formatter, no fork`() {
        val bundle = analysis(
            durationSeconds = 3700.0,
            sittings = sittings(count = 2, endings = listOf(1800.0, 3700.0)),
        )
        assertEquals("1:01:40", bundle.durationLabel)
        assertEquals("2 sittings", bundle.sittingCountSuffix)
    }

    // The seam lookup: every span end but the last, on the active axis (D29).
    @Test
    fun `interior boundaries are every span end but the last`() {
        assertEquals(
            listOf(300.0, 900.0),
            sittings(count = 3, endings = listOf(300.0, 900.0, 1453.0)).interiorBoundarySeconds,
        )
        assertEquals(emptyList<Double>(), sittings(count = 1, endings = listOf(1453.0)).interiorBoundarySeconds)
    }
}

// The ribbon's seam ticks (D29): interior boundaries through the SAME inverse bucketing the break marker
// uses, so a seam lands on the bin its sittings butt against; edges draw nothing (a zero-width span
// clamps to an edge by contract, PROTOCOL.md §12). Pinned in the ribbon's reference box (340x104), the
// same space MomentumRibbon scales from (Android returns reference-space x; the Canvas scales it).
class SittingsSeamTickTests {
    private val g = MomentumRibbonGeometry
    private val sampleCount = 40
    private val eps = 1e-3f

    /** The ribbon's own scaleX arithmetic for a bin index in the reference box (padX 4): the expected
     *  side of the pin, computed independently. */
    private fun expectedX(bin: Int): Float = g.padX + bin.toFloat() / (sampleCount - 1) * (g.referenceWidth - 2 * g.padX)

    private fun spans(endings: List<Double>): RoomSittings {
        val result = mutableListOf<RoomSittings.Span>()
        var start = 0.0
        for (end in endings) {
            result.add(RoomSittings.Span(startSeconds = start, endSeconds = end))
            start = end
        }
        return RoomSittings(count = endings.size, spans = result, wallSeconds = endings.lastOrNull() ?: 0.0)
    }

    // The pinned fixture (the REST snapshot's analysis-view sittings): duration 60, spans [0,45][45,60].
    // The one interior boundary at 45s buckets to bin round(45/60 * 39) = 29 and lands on that bin's x.
    @Test
    fun `tick positions for the pinned fixture`() {
        val ticks = g.seamTickXs(spans(listOf(45.0, 60.0)), duration = 60.0, count = sampleCount)
        assertEquals(1, ticks.size)
        assertEquals(expectedX(29), ticks[0], eps)
    }

    // Three sittings, two seams, each on its own bin (D29: spans[k].endSeconds, k < count-1).
    @Test
    fun `three sittings draw two ticks`() {
        val ticks = g.seamTickXs(spans(listOf(160.0, 260.0, 512.0)), duration = 512.0, count = sampleCount)
        // round(160/512 * 39) = 12; round(260/512 * 39) = 20.
        assertEquals(2, ticks.size)
        assertEquals(expectedX(12), ticks[0], eps)
        assertEquals(expectedX(20), ticks[1], eps)
    }

    // No sittings (an older bundle) or a single sitting: no ticks, the ribbon renders exactly as before
    // this wave (D29).
    @Test
    fun `no ticks when sittings absent or single`() {
        assertEquals(emptyList<Float>(), g.seamTickXs(null, duration = 60.0, count = sampleCount))
        assertEquals(emptyList<Float>(), g.seamTickXs(spans(listOf(60.0)), duration = 60.0, count = sampleCount))
    }

    // A zero-width span clamps its boundary to the axis edge (PROTOCOL.md §12, the wrong-writes-only
    // sitting), and a zero-width seam tick draws nothing.
    @Test
    fun `edge-clamped boundaries draw nothing`() {
        // Boundary at the start edge (a first sitting with no trace entry) ...
        assertEquals(emptyList<Float>(), g.seamTickXs(spans(listOf(0.0, 60.0)), duration = 60.0, count = sampleCount))
        // ... and at the end edge (a last sitting with no trace entry).
        val atEnd = RoomSittings(
            count = 2,
            spans = listOf(RoomSittings.Span(0.0, 60.0), RoomSittings.Span(60.0, 60.0)),
            wallSeconds = 60.0,
        )
        assertEquals(emptyList<Float>(), g.seamTickXs(atEnd, duration = 60.0, count = sampleCount))
    }

    // Two boundaries bucketed into one bin collapse to one tick, the marker's own discrete granularity
    // (design/post-game/ANALYSIS.md bucketing).
    @Test
    fun `boundaries in one bin collapse to one tick`() {
        val ticks = g.seamTickXs(spans(listOf(1800.0, 1810.0, 3600.0)), duration = 3600.0, count = sampleCount)
        // round(1800/3600 * 39) = round(19.5) = 20; round(1810/3600 * 39) = 20 too.
        assertEquals(1, ticks.size)
        assertEquals(expectedX(20), ticks[0], eps)
    }

    // A degenerate duration draws no seam (the marker's own zero-duration guard).
    @Test
    fun `a zero duration draws no ticks`() {
        assertEquals(emptyList<Float>(), g.seamTickXs(spans(listOf(0.0, 0.0)), duration = 0.0, count = sampleCount))
    }
}
