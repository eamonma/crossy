// Pins the haptic grammar against apps/ios SolveHaptics.swift (DESIGN.md §7): whose hand moved is
// derived from (filled, selection) deltas, never plumbed; the first observation seeds silently; a
// bulk delta (welcome, resync) is history, not a moment; a teammate's routine letter never buzzes.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class SolveHapticFoldTests {
    // A 3x3 with a center block: two-cell words around the ring.
    //   0 1 2
    //   3 # 5
    //   6 7 8
    private val geometry = GridGeometry(
        rows = 3,
        cols = 3,
        blocks = setOf(4),
        circles = emptySet(),
        shadedCircles = emptySet(),
        numbers = emptyMap(),
    )

    private fun at(cell: Int, isAcross: Boolean = true) = GridSelection(cell, isAcross)

    @Test
    fun theFirstObservationSeedsAndNeverBuzzes() {
        val fold = SolveHapticFold()
        assertNull(fold.observe(setOf(0, 1, 2), at(0), geometry), "arrival into a half-filled board is not action")
    }

    @Test
    fun travelToAnotherWordTicksAndWithinWordStepsStaySilent() {
        val fold = SolveHapticFold()
        fold.observe(emptySet(), at(0), geometry)
        // 0 -> 1: same across word (0,1,2), a within-word step: silent.
        assertNull(fold.observe(emptySet(), at(1), geometry))
        // 1 -> 6: another word: the tick (owner ruling: every word-to-word travel).
        assertEquals(SolveHaptic.TRAVEL_TICK, fold.observe(emptySet(), at(6), geometry))
    }

    @Test
    fun theAxisToggleIsTravelWhenTheWordChanges() {
        val fold = SolveHapticFold()
        fold.observe(emptySet(), at(0, isAcross = true), geometry)
        // Toggling at cell 0 changes the standing word (0,1,2) -> (0,3,6): a travel tick.
        assertEquals(SolveHaptic.TRAVEL_TICK, fold.observe(emptySet(), at(0, isAcross = false), geometry))
    }

    @Test
    fun aLocalCompletingLetterThudsAndOutranksTheAdvanceTick() {
        val fold = SolveHapticFold()
        fold.observe(setOf(0, 1), at(2), geometry)
        // The local hand places cell 2, completing across word (0,1,2); the advance jumps to
        // another word, but the thud outranks the travel tick (one haptic per intent).
        assertEquals(SolveHaptic.WORD_THUD, fold.observe(setOf(0, 1, 2), at(3), geometry))
    }

    @Test
    fun aLocalRoutineLetterThatAdvancesWithinTheWordIsSilent() {
        val fold = SolveHapticFold()
        fold.observe(emptySet(), at(0), geometry)
        // Place at 0 (word not complete), advance within the word to 1: no haptic.
        assertNull(fold.observe(setOf(0), at(1), geometry))
    }

    @Test
    fun aTeammateFinishingTheStandingWordDoubleTicks() {
        // A teammate's letter in the standing word that leaves it unfinished is silent.
        val fold = SolveHapticFold()
        fold.observe(setOf(0), at(1), geometry)
        assertNull(fold.observe(setOf(0, 2), at(1), geometry))
        // A teammate's letter that finishes the standing across word (0,1,2): the double tick.
        val fold2 = SolveHapticFold()
        fold2.observe(setOf(0, 1), at(0), geometry)
        assertEquals(SolveHaptic.DOUBLE_TICK, fold2.observe(setOf(0, 1, 2), at(0), geometry))
    }

    @Test
    fun aTeammatesRoutineLetterIsSilentAlways() {
        val fold = SolveHapticFold()
        fold.observe(emptySet(), at(0), geometry)
        // A teammate places cell 8, far from the standing word and finishing nothing: silence.
        assertNull(fold.observe(setOf(8), at(0), geometry))
    }

    @Test
    fun aBulkDeltaIsASnapshotAndStaysSilent() {
        val fold = SolveHapticFold()
        fold.observe(emptySet(), at(0), geometry)
        // A resync lands five letters at once, even completing words: history, not a moment.
        assertNull(fold.observe(setOf(0, 1, 2, 3, 6), at(0), geometry))
    }

    @Test
    fun tuningMirrorsTheIosConstants() {
        assertEquals(0.6, SolveHapticTuning.TRAVEL_TICK_INTENSITY)
        assertEquals(1.0, SolveHapticTuning.WORD_THUD_INTENSITY)
        assertEquals(0.8, SolveHapticTuning.DOUBLE_TICK_INTENSITY)
        assertEquals(90, SolveHapticTuning.DOUBLE_TICK_GAP_MILLISECONDS)
        assertEquals(0.7, SolveHapticTuning.REACTION_SENT_INTENSITY)
        assertEquals(0.5, SolveHapticTuning.REACTION_LANDED_INTENSITY)
    }
}
