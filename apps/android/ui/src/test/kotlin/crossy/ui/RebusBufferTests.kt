// The rebus buffer lifecycle (EXPERIENCE.md baseline rebus: multi-glyph entry committed as one
// value), the pure transitions RoomScreen routes deck keys through. Twin of the rebus cases in iOS
// SelectionModelTests: letters grow the buffer to the PROTOCOL.md §3 cap, backspace edits it and
// exits when already empty, and the rebus key commits a non-empty value or just closes an empty one.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class RebusBufferTests {
    @Test
    fun `a letter grows the buffer and folds ascii INV-1`() {
        assertEquals("RE", RebusBuffer.append("R", 'e'))
        assertEquals("R5", RebusBuffer.append("R", '5'))
    }

    @Test
    fun `a non-value character is ignored`() {
        assertEquals("R", RebusBuffer.append("R", '!'))
    }

    @Test
    fun `the buffer caps at ten glyphs protocol-3`() {
        var buffer = ""
        for (character in "ABCDEFGHIJKLM") buffer = RebusBuffer.append(buffer, character)
        assertEquals("ABCDEFGHIJ", buffer)
    }

    @Test
    fun `backspace edits the buffer then exits on empty`() {
        assertEquals(RebusStep.Editing("A"), RebusBuffer.backspace("AB"))
        assertEquals(RebusStep.Editing(""), RebusBuffer.backspace("A"))
        assertEquals(RebusStep.Exit, RebusBuffer.backspace(""))
    }

    @Test
    fun `the rebus key commits a non-empty value and closes an empty one protocol-3`() {
        assertEquals(RebusStep.Commit("REBUS"), RebusBuffer.commit("REBUS"))
        assertEquals(RebusStep.Exit, RebusBuffer.commit(""))
    }
}
