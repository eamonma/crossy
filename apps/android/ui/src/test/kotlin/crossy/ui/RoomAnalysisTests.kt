// Pins the analysis data twins against apps/ios RoomAnalysis.swift: the M:SS format, the stat
// trio derivations, the ribbon's has-signal rule, and the fetch machine's exactly-once walk with
// the completion-race retries (design/post-game/ANALYSIS.md).

package crossy.ui

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RoomAnalysisTests {
    private fun bundle(owners: Map<Int, String>, duration: Double = 65.0) = RoomAnalysis(
        owners = owners,
        momentum = RoomMomentum(durationSeconds = duration, samples = List(40) { 0.0 }),
        firstToFall = null,
        lastSquare = null,
        turningPoint = null,
    )

    @Test
    fun formatMSSFloorsSecondsAndNeverCapsMinutes() {
        assertEquals("0:00", RoomAnalysis.formatMSS(0.0))
        assertEquals("0:59", RoomAnalysis.formatMSS(59.9))
        assertEquals("1:05", RoomAnalysis.formatMSS(65.0))
        assertEquals("75:00", RoomAnalysis.formatMSS(4500.0))
        assertEquals("0:00", RoomAnalysis.formatMSS(-3.0), "negative clamps to zero")
    }

    @Test
    fun theStatTrioDerivesFromOwners() {
        val b = bundle(mapOf(0 to "ada", 1 to "ada", 2 to "grace"))
        assertEquals(2, b.solverCount)
        assertEquals(3, b.entryCount)
        assertEquals("1:05", b.durationLabel)
    }

    @Test
    fun theRibbonHasSignalOnlyWhenABucketCarriedAFill() {
        assertFalse(RoomMomentum(10.0, List(40) { 0.0 }).hasSignal)
        assertTrue(RoomMomentum(10.0, List(39) { 0.0 } + listOf(0.4)).hasSignal)
    }

    @Test
    fun loadResolvesOnceAndASecondCallIsANoOp() = runBlocking<Unit> {
        val model = AnalysisModel()
        var fetches = 0
        model.load(delayMillis = 0) { fetches += 1; bundle(mapOf(0 to "ada")) }
        assertEquals(1, fetches)
        assertTrue(model.phase is AnalysisModel.Phase.Ready)
        model.load(delayMillis = 0) { fetches += 1; null }
        assertEquals(1, fetches, "a resolved model never refetches")
        assertEquals(mapOf(0 to "ada"), model.bundle?.owners)
    }

    @Test
    fun loadRetriesThroughTheCompletionRaceThenStandsAbsent() = runBlocking<Unit> {
        val model = AnalysisModel()
        var fetches = 0
        model.load(tries = 3, delayMillis = 0) { fetches += 1; null }
        assertEquals(3, fetches, "the 404 window earns every retry")
        assertEquals(AnalysisModel.Phase.Absent, model.phase)
    }

    @Test
    fun aLateSuccessWithinTheRetriesLands() = runBlocking<Unit> {
        val model = AnalysisModel()
        var fetches = 0
        model.load(tries = 3, delayMillis = 0) {
            fetches += 1
            if (fetches == 2) bundle(mapOf(5 to "ada")) else null
        }
        assertEquals(2, fetches)
        assertEquals(mapOf(5 to "ada"), model.bundle?.owners)
    }
}
