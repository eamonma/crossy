// The composition root's wire->render mapping for the post-game analysis (mirrors iOS RoomMapping
// .analysis; AAD-2: :app owns the protocol->render translation so :ui stays out of the REST ring). Pins
// AnalysisView -> RoomAnalysis: the string-keyed owner map parses to cell indices (a non-integer key
// drops), the momentum and the turning point carry through, the titles ride verbatim (keys included,
// the display table decides what it knows, PROTOCOL.md §12), and the sittings partition maps or reads
// as none from an older bundle. INV-6 rides through untouched: the wire and the render shape both hold
// userIds, cells, keys, and numbers only, with nowhere to put a solution value. Pure JVM
// (testProdDebugUnitTest).

package crossy.app

import crossy.protocol.AnalysisView
import crossy.ui.RoomSittings
import crossy.ui.RoomTitle
import crossy.ui.RoomTurningPoint
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AnalysisMappingTests {
    private fun view(
        owners: Map<String, String>,
        moments: AnalysisView.Moments = AnalysisView.Moments(),
        duration: Double = 65.0,
        samples: List<Double> = List(40) { 0.0 },
        titles: List<AnalysisView.Title>? = null,
        sittings: AnalysisView.Sittings? = null,
    ) = AnalysisView(
        owners = owners,
        momentum = AnalysisView.Momentum(durationSeconds = duration, samples = samples),
        moments = moments,
        titles = titles,
        sittings = sittings,
    )

    @Test
    fun `the owner map parses string keys to cell indices, dropping a non-integer key`() {
        val room = analysisFromView(view(mapOf("0" to "ada", "5" to "grace", "x" to "ghost")))
        assertEquals(mapOf(0 to "ada", 5 to "grace"), room.owners, "a bad key drops, never throws")
        assertEquals(2, room.solverCount)
        assertEquals(2, room.entryCount)
    }

    @Test
    fun `momentum and the turning point carry through`() {
        val room = analysisFromView(
            view(
                owners = mapOf("0" to "ada"),
                duration = 128.0,
                samples = List(39) { 0.0 } + listOf(0.9),
                moments = AnalysisView.Moments(
                    turningPoint = AnalysisView.TurningPoint(stallSeconds = 12.0, breakSeconds = 40.0, burst = 4),
                ),
            ),
        )
        assertEquals(128.0, room.momentum.durationSeconds)
        assertEquals(0.9, room.momentum.samples.last())
        assertTrue(room.momentum.hasSignal)
        assertEquals(RoomTurningPoint(12.0, 40.0, 4), room.turningPoint)
    }

    @Test
    fun `titles ride verbatim in wire order, key and evidence carried, null evidence preserved`() {
        val room = analysisFromView(
            view(
                owners = mapOf("0" to "ada"),
                titles = listOf(
                    AnalysisView.Title(userId = "ada", title = "saboteur", evidence = 7),
                    AnalysisView.Title(userId = "grace", title = "one-hit-wonder", evidence = null),
                    // An unknown key rides through the mapping untouched (the render layer drops it).
                    AnalysisView.Title(userId = "noor", title = "night-owl", evidence = 5),
                ),
            ),
        )
        assertEquals(
            listOf(
                RoomTitle("ada", "saboteur", 7),
                RoomTitle("grace", "one-hit-wonder", null),
                RoomTitle("noor", "night-owl", 5),
            ),
            room.titles,
        )
    }

    @Test
    fun `the sittings partition maps count, spans, and wall seconds`() {
        val room = analysisFromView(
            view(
                owners = mapOf("0" to "ada"),
                sittings = AnalysisView.Sittings(
                    count = 2,
                    spans = listOf(
                        AnalysisView.Sittings.Span(startSeconds = 0.0, endSeconds = 300.0),
                        AnalysisView.Sittings.Span(startSeconds = 300.0, endSeconds = 360.0),
                    ),
                    wallSeconds = 29160.0,
                ),
            ),
        )
        assertEquals(
            RoomSittings(
                count = 2,
                spans = listOf(RoomSittings.Span(0.0, 300.0), RoomSittings.Span(300.0, 360.0)),
                wallSeconds = 29160.0,
            ),
            room.sittings,
        )
        assertEquals("2 sittings", room.sittingCountSuffix)
    }

    @Test
    fun `an older bundle omits titles and sittings, reading as none`() {
        val room = analysisFromView(view(mapOf("0" to "ada")))
        assertNull(room.turningPoint)
        assertTrue(room.titles.isEmpty(), "absent titles read as an empty list, no section")
        assertNull(room.sittings, "absent sittings degrade to today's rendering")
        assertNull(room.sittingCountSuffix)
    }
}
