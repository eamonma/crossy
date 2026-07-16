// The typing-advance preferences (personal-settings slice 1), pinned rule by rule over the store's
// BoardNavigation facade. Twin of iOS TypingPrefsTests, walking the skip OFF/ON matrix and the two
// end-of-word behaviors. It asserts the default prefs reproduce the four-arg op the navigation
// vectors pin (typing-advance.json, full-word-asymmetry.json) cell by cell on both axes, so an
// unset device sees zero change and no vector diverges. The next-clue move is defined as the Tab
// traversal order the auto-advance path already walks, so its cases assert against the engine's
// tabTarget rather than a restated landing.
//
// The shape is the vector 5x4 (blocks 2, 6, 13); row 3 (cells 15..19) is one full across word with
// no interior block, the clean stage for the word-end rules:
//
//   Row0:  0  1  X  3  4
//   Row1:  5  X  7  8  9
//   Row2: 10 11 12  X 14
//   Row3: 15 16 17 18 19

package crossy.store

import crossy.engine.Direction
import crossy.engine.Grid
import crossy.engine.Toward
import crossy.engine.tabTarget
import crossy.engine.typingAdvance
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class TypingPrefsNavigationTests {
    private val blocks = setOf(2, 6, 13)
    private val geometry = BoardNavigation.Geometry(cols = 5, rows = 4, blocks = blocks)
    private val grid = Grid(cols = 5, rows = 4, blocks = blocks)

    private fun prefs(skip: Boolean, end: BoardNavigation.EndOfWord) =
        BoardNavigation.NavigationPrefs(skipFilledInWord = skip, endOfWord = end)

    /** The facade advance with an explicit preference; row-3 across unless stated. */
    private fun advance(
        from: Int,
        filled: Set<Int>,
        skip: Boolean,
        end: BoardNavigation.EndOfWord,
        isAcross: Boolean = true,
    ) = BoardNavigation.typingAdvance(geometry, isAcross, from, filled, prefs(skip, end))

    // The default reproduces the pre-slice op exactly (the vectors stay green).
    @Test
    fun `default prefs match the four-arg op every cell both axes typing-advance family`() {
        for (cell in 0 until 20) {
            if (cell in blocks) continue
            for (isAcross in listOf(true, false)) {
                val after = setOf(0, 3, 9, 12) + cell // an arbitrary standing fill
                val dir = if (isAcross) Direction.ACROSS else Direction.DOWN
                val bare = typingAdvance(grid, dir, cell, after)
                val withDefault =
                    BoardNavigation.typingAdvance(geometry, isAcross, cell, after, BoardNavigation.NavigationPrefs.DEFAULT)
                assertEquals(bare, withDefault.cell, "cell $cell across=$isAcross")
                assertEquals(isAcross, withDefault.isAcross, "cell $cell across=$isAcross")
            }
        }
    }

    // skipFilledInWord: the OFF/ON matrix, mid-word.
    @Test
    fun `skip on advances to the next empty cell skipFilledInWord`() {
        // from 15 (just typed), 16 empty: land on 16.
        assertEquals(16, advance(15, setOf(15), skip = true, end = BoardNavigation.EndOfWord.FIRST_BLANK).cell)
    }

    @Test
    fun `skip on jumps over a filled run to the first empty skipFilledInWord`() {
        // 16, 17 already filled: skip past them to 18.
        assertEquals(18, advance(15, setOf(15, 16, 17), skip = true, end = BoardNavigation.EndOfWord.FIRST_BLANK).cell)
    }

    @Test
    fun `skip off advances to the immediately next cell even when filled skipFilledInWord`() {
        // 16 already filled: skip-off lands on it anyway (the very next cell).
        assertEquals(16, advance(15, setOf(15, 16), skip = false, end = BoardNavigation.EndOfWord.FIRST_BLANK).cell)
    }

    @Test
    fun `skip off advances to the immediately next cell when empty skipFilledInWord`() {
        assertEquals(16, advance(15, setOf(15), skip = false, end = BoardNavigation.EndOfWord.FIRST_BLANK).cell)
    }

    // endOfWord: word-end with blanks behind the cursor.
    @Test
    fun `word end with blanks behind first-blank jumps back to first blank endOfWord`() {
        // skip-off walked to the last cell 19 with 16 still blank behind: first-blank jumps to 16.
        val result = advance(19, setOf(15, 17, 18, 19), skip = false, end = BoardNavigation.EndOfWord.FIRST_BLANK)
        assertEquals(16, result.cell)
        assertEquals(true, result.isAcross)
    }

    @Test
    fun `word end with blanks behind next-clue advances to next clue endOfWord`() {
        // Same reach, but next-clue leaves the word for the next clue in the Tab order, never
        // hunting a blank behind. It equals the auto-advance path's tab target.
        val filled = setOf(15, 17, 18, 19)
        val result = advance(19, filled, skip = false, end = BoardNavigation.EndOfWord.NEXT_CLUE)
        val tab = tabTarget(grid, Direction.ACROSS, 19, Toward.FORWARD, filled)
        assertEquals(tab.cell, result.cell)
        assertEquals(tab.direction == Direction.ACROSS, result.isAcross)
    }

    @Test
    fun `skip on crossing a filled run to word end first-blank wraps to first blank endOfWord`() {
        // from 17, 18 and 19 filled ahead, 15 blank behind: skip-on finds nothing forward, so it
        // wraps to the word's first blank, 15.
        val result = advance(17, setOf(16, 17, 18, 19), skip = true, end = BoardNavigation.EndOfWord.FIRST_BLANK)
        assertEquals(15, result.cell)
    }

    // endOfWord: word fully filled (word complete).
    @Test
    fun `word full first-blank stays on last cell the vectored default holds`() {
        // full-word-asymmetry.json: typing the last cell of a full word stays on it. The default
        // end-of-word keeps this, so the pre-slice behavior and the vectors hold.
        val result = advance(19, setOf(15, 16, 17, 18, 19), skip = true, end = BoardNavigation.EndOfWord.FIRST_BLANK)
        assertEquals(19, result.cell)
        assertEquals(true, result.isAcross)
    }

    @Test
    fun `word full next-clue advances to next clue endOfWord`() {
        val filled = setOf(15, 16, 17, 18, 19)
        val result = advance(19, filled, skip = true, end = BoardNavigation.EndOfWord.NEXT_CLUE)
        val tab = tabTarget(grid, Direction.ACROSS, 19, Toward.FORWARD, filled)
        assertEquals(tab.cell, result.cell)
        assertEquals(tab.direction == Direction.ACROSS, result.isAcross)
    }

    @Test
    fun `last cell of last clue next-clue wraps through the cycle endOfWord`() {
        // Everything filled but the very first across cell (0): from the grid's last playable cell
        // 19, next-clue wraps the whole cycle back to the first blank, cell 0, exactly as the Tab
        // target does. Covers the last-cell-of-the-last-clue reach.
        val filled = (0 until 20).toSet() - blocks - 0
        val result = advance(19, filled, skip = true, end = BoardNavigation.EndOfWord.NEXT_CLUE)
        val tab = tabTarget(grid, Direction.ACROSS, 19, Toward.FORWARD, filled)
        assertEquals(tab.cell, result.cell)
        assertEquals(0, result.cell)
    }
}
