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
        assertTrue(FactsOperations.make(isHost = true).canEndGame)
        assertFalse(FactsOperations.make(isHost = false).canEndGame)
        assertFalse(FactsOperations.none.hasAny)
        assertTrue(FactsOperations.make(isHost = true).hasAny)
    }

    @Test
    fun `EXPERIENCE the end-game confirm is two-beat and plainly worded`() {
        assertEquals("End this game for everyone?", RoomFactsCopy.endGameConfirmTitle)
        assertEquals("This ends the game for everyone in the room.", RoomFactsCopy.endGameConfirmBody)
        assertEquals("Keep playing", RoomFactsCopy.endGameCancelAction)
    }
}
