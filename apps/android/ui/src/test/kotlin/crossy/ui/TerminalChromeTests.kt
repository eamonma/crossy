// The kicked lexicon pinned verbatim against apps/ios RoomTerminal (CompletionMoment.swift;
// EXPERIENCE.md §5), so all three clients say the same one honest sentence and offer the same plain
// way home.
package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class TerminalChromeTests {
    @Test
    fun `EXPERIENCE5 the kicked notice is the one honest sentence, verbatim from iOS`() {
        assertEquals("The host removed you from this room", RoomTerminal.kickedNotice)
    }

    @Test
    fun `EXPERIENCE5 the kicked exit says where it goes`() {
        assertEquals("Back to Rooms", RoomTerminal.kickedExitWord)
    }
}
