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

    // The Analysis header's Time label renders through the one moment formatter, and it must match
    // the web's formatMSS (apps/web/src/ui/analysisReadout.ts) digit for digit so the same room
    // reads identically on both platforms. The pre-fix twin never rolled minutes into hours, so a
    // 3700-second solve read "61:40" on Android while the web read "1:01:40"; these pin the roll.
    // Twin of apps/ios RoomAnalysisTimeTests.swift.
    private fun label(seconds: Double) = bundle(emptyMap(), duration = seconds).durationLabel

    @Test
    fun formatWholeMinutesAndSecondsZeroPadsTheSecondsField() {
        assertEquals("6:12", label(372.0))
        assertEquals("0:09", label(9.0))
        assertEquals("0:00", label(0.0))
    }

    @Test
    fun formatFloorsFractionalSecondsNeverADecimal() {
        assertEquals("2:05", label(125.9))
    }

    @Test
    fun formatUnderAnHourStaysMSSUpToThe5959Boundary() {
        // The last M:SS reading before the hour rolls: 59:59 keeps the flat shape.
        assertEquals("59:59", label(3599.0))
    }

    @Test
    fun formatTheHourBoundaryRollsTo1_00_00() {
        // Exactly 3600s is the first H:MM:SS reading, minutes and seconds zero-padded.
        assertEquals("1:00:00", label(3600.0))
    }

    @Test
    fun formatPastAnHourCarriesTheHourTheBugWas3700Read6140() {
        // The fix: a 3700-second solve rolls minutes into hours (1:01:40), matching the web; the
        // pre-fix formatter left it "61:40".
        assertEquals("1:01:40", label(3700.0))
        assertEquals("1:01:01", label(3661.0))
    }

    @Test
    fun formatNegativeOrNonFiniteReadsZeroNeverNaN() {
        assertEquals("0:00", label(-5.0), "negative clamps to zero")
        assertEquals("0:00", label(Double.NaN))
        assertEquals("0:00", label(Double.POSITIVE_INFINITY))
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
