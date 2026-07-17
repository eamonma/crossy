// The facts sheet's pure derivations pinned against apps/ios RoomFactsSheet.swift (owner ruling
// 2026-07-10: the time pill is the room's facts): the headline clock rule (the server's stat leads,
// else the ambient clock's freeze arithmetic), the words (room name, puzzle facts joined by the
// middot, dropped when absent), and the operations (End game for the host alone, PROTOCOL.md §12).
package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RoomFactsTests {
    @Test
    fun `PROTOCOL6 the server's solve stat leads the headline when it exists`() {
        assertEquals(
            "1:05",
            RoomFactsClock.headline(solveTimeSeconds = 65, firstFillAt = "1970-01-01T00:00:00Z", freezeAt = null, nowMillis = 5_000),
        )
    }

    @Test
    fun `ID2 without a stat the headline is the ambient clock, ticking then frozen`() {
        assertEquals(
            "0:05",
            RoomFactsClock.headline(solveTimeSeconds = null, firstFillAt = "1970-01-01T00:00:00Z", freezeAt = null, nowMillis = 5_000),
        )
        assertEquals(
            "0:03",
            RoomFactsClock.headline(
                solveTimeSeconds = null,
                firstFillAt = "1970-01-01T00:00:00Z",
                freezeAt = "1970-01-01T00:00:03Z",
                nowMillis = 999_000,
            ),
        )
    }

    @Test
    fun `ID5 the words are the room name and the puzzle facts joined plainly, absent facts dropped`() {
        val bare = RoomFactsContent.make("Sunday crew")
        assertEquals("Sunday crew", bare.label)
        assertNull(bare.detail)

        val full = RoomFactsContent.make("Sunday crew", puzzleTitle = "Themeless 12", puzzleAuthor = "A. Setter", puzzleDate = "2026-07-01")
        assertEquals("Themeless 12 · A. Setter · 2026-07-01", full.detail)

        val partial = RoomFactsContent.make("Sunday crew", puzzleTitle = "", puzzleAuthor = "A. Setter")
        assertEquals("A. Setter", partial.detail)
    }

    @Test
    fun `PROTOCOL12 end game is the host's operation alone`() {
        val host = FactsOperations.make(isHost = true, isSpectator = false, supportsCheck = false, emptyCells = 0)
        val nonHost = FactsOperations.make(isHost = false, isSpectator = false, supportsCheck = false, emptyCells = 0)
        assertTrue(host.canEndGame)
        assertFalse(nonHost.canEndGame)
        assertFalse(FactsOperations.none.hasAny)
        assertTrue(host.hasAny)
    }

    @Test
    fun `EXPERIENCE the end-game confirm is two-beat and plainly worded`() {
        assertEquals("End this game for everyone?", RoomFactsCopy.endGameConfirmTitle)
        assertEquals("This ends the game for everyone in the room.", RoomFactsCopy.endGameConfirmBody)
        assertEquals("Keep playing", RoomFactsCopy.endGameCancelAction)
    }

    // --- The room check (PROTOCOL.md §5, §10; D27), mirrored from iOS FactsOperations/RoomFactsContent ---

    @Test
    fun `D27 host sees the check above end game`() {
        val ops = FactsOperations.make(isHost = true, isSpectator = false, supportsCheck = true, emptyCells = 0)
        assertTrue(ops.canEndGame)
        assertTrue(ops.check != null)
        assertTrue(ops.hasAny)
        assertEquals(2, ops.rowCount)
    }

    // A non-host solver checks but never ends: end-game stays host-only (§12), the check is any
    // host or solver (§5).
    @Test
    fun `PROTOCOL5 a solver sees the check row only`() {
        val ops = FactsOperations.make(isHost = false, isSpectator = false, supportsCheck = true, emptyCells = 3)
        assertFalse(ops.canEndGame)
        assertTrue(ops.check != null)
        assertEquals(1, ops.rowCount)
    }

    // Spectators never see the check row (§5: checkPuzzle is host|solver; the server enforces it).
    @Test
    fun `PROTOCOL5 a spectator never sees the check`() {
        val ops = FactsOperations.make(isHost = false, isSpectator = true, supportsCheck = true, emptyCells = 0)
        assertNull(ops.check)
        assertFalse(ops.hasAny)
    }

    // Without a check-capable transport the row does not exist at all (design R8): the demo's
    // loopback drops checkPuzzle, so the demo sheet must not grow a row that confirms into a void.
    @Test
    fun `R8 no live transport excludes the check row entirely`() {
        val ops = FactsOperations.make(isHost = true, isSpectator = false, supportsCheck = false, emptyCells = 0)
        assertNull(ops.check)
        assertEquals(1, ops.rowCount)
    }

    // The grid-full gate (§5, §10): enabled at zero empty, disabled below full with the quiet
    // remaining-cells hint. Natural casing, singular at one; a negative input clamps to zero (R9).
    @Test
    fun `PROTOCOL10 the check enables only on a full grid and hints below it`() {
        val full = FactsOperations.Check(emptyCells = 0)
        assertTrue(full.isEnabled)
        assertNull(full.hint)
        val three = FactsOperations.Check(emptyCells = 3)
        assertFalse(three.isEnabled)
        assertEquals("3 empty", three.hint)
        val one = FactsOperations.Check(emptyCells = 1)
        assertFalse(one.isEnabled)
        assertEquals("1 empty", one.hint)
        val negative = FactsOperations.Check(emptyCells = -2)
        assertTrue(negative.isEnabled)
        assertNull(negative.hint)
    }

    // The check record among the facts (§10, D27; R10): quiet, neutral, natural casing, absent
    // before the first accepted check (no zeros).
    @Test
    fun `D27 the checked line wording is natural and countless before the first check`() {
        assertNull(RoomFactsContent.checkedLine(0))
        assertEquals("Checked once", RoomFactsContent.checkedLine(1))
        assertEquals("Checked 2 times", RoomFactsContent.checkedLine(2))
        assertEquals("Checked 7 times", RoomFactsContent.checkedLine(7))
    }

    @Test
    fun `R10 make carries the checked line from the count`() {
        assertEquals("Checked 3 times", RoomFactsContent.make("Tuesday", checkCount = 3).checkedLine)
        assertNull(RoomFactsContent.make("Tuesday").checkedLine)
    }

    @Test
    fun `D27 the check confirm copy is verbatim and the dialog is non-destructive`() {
        assertEquals("Check puzzle", RoomFactsCopy.checkAction)
        assertEquals("Check the puzzle for everyone?", RoomFactsCopy.checkConfirmTitle)
        assertEquals("Wrong letters get marked for the whole room. This is recorded.", RoomFactsCopy.checkConfirmBody)
        assertEquals("Check puzzle", RoomFactsCopy.checkConfirmAction)
        assertEquals("Keep solving", RoomFactsCopy.checkCancelAction)
    }

    // The sitting count as completed-facts context (owner ruling, D29): appended to the " · "
    // grammar only at two or more; one sitting (or a pre-D29 null) reads exactly as today.
    @Test
    fun `D29 the sitting count joins the facts grammar only at two or more`() {
        assertNull(RoomFactsContent.make("crew", sittingCount = null).detail)
        assertNull(RoomFactsContent.make("crew", sittingCount = 1).detail)
        assertEquals("2 sittings", RoomFactsContent.make("crew", sittingCount = 2).detail)
        assertEquals(
            "Themeless 12 · 3 sittings",
            RoomFactsContent.make("crew", puzzleTitle = "Themeless 12", sittingCount = 3).detail,
        )
    }
}
