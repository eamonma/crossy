// The composition root's wire->render mapping for the post-game analysis (mirrors iOS RoomMapping
// .analysis; AAD-2: :app owns the protocol->render translation so :ui stays out of the REST ring). Pins
// AnalysisView -> RoomAnalysis: the string-keyed owner map parses to cell indices (a non-integer key
// drops), the momentum and beats carry through, and the nullable moments stay null when absent. INV-6
// rides through untouched: the wire and the render shape both hold userIds, cells, and numbers only,
// with nowhere to put a solution value. Pure JVM (testProdDebugUnitTest).

package crossy.app

import crossy.protocol.AnalysisView
import crossy.ui.RoomBeat
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
    ) = AnalysisView(
        owners = owners,
        momentum = AnalysisView.Momentum(durationSeconds = duration, samples = samples),
        moments = moments,
    )

    @Test
    fun `the owner map parses string keys to cell indices, dropping a non-integer key`() {
        val room = analysisFromView(view(mapOf("0" to "ada", "5" to "grace", "x" to "ghost")))
        assertEquals(mapOf(0 to "ada", 5 to "grace"), room.owners, "a bad key drops, never throws")
        assertEquals(2, room.solverCount)
        assertEquals(2, room.entryCount)
    }

    @Test
    fun `momentum and the three beats carry through`() {
        val room = analysisFromView(
            view(
                owners = mapOf("0" to "ada"),
                duration = 128.0,
                samples = List(39) { 0.0 } + listOf(0.9),
                moments = AnalysisView.Moments(
                    firstToFall = AnalysisView.Beat(cell = 0, userId = "ada", atSeconds = 0.0),
                    lastSquare = AnalysisView.Beat(cell = 5, userId = "grace", atSeconds = 128.0),
                    turningPoint = AnalysisView.TurningPoint(stallSeconds = 12.0, breakSeconds = 40.0, burst = 4),
                ),
            ),
        )
        assertEquals(128.0, room.momentum.durationSeconds)
        assertEquals(0.9, room.momentum.samples.last())
        assertTrue(room.momentum.hasSignal)
        assertEquals(RoomBeat(0, "ada", 0.0), room.firstToFall)
        assertEquals(RoomBeat(5, "grace", 128.0), room.lastSquare)
        assertEquals(RoomTurningPoint(12.0, 40.0, 4), room.turningPoint)
    }

    @Test
    fun `absent moments stay null (a short solve or a seeded fixture)`() {
        val room = analysisFromView(view(mapOf("0" to "ada")))
        assertNull(room.firstToFall)
        assertNull(room.lastSquare)
        assertNull(room.turningPoint)
    }
}
