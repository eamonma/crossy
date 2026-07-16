// The input transforms as pure functions: a keystroke produces a mutation plus a cursor advance, a
// backspace clears where it lands, a toggle never mutates, and a tap on the current cell flips the
// axis. Cursor moves defer to BoardNavigation (the engine's navigation ops), so these smoke cases
// guard the wiring, not the navigation rules the vectors already pin. INV-1: deck values fold ASCII
// only and validate against the wire charset.
package crossy.ui

import crossy.store.BoardNavigation
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class InputActionsTests {

    private val geometry = BoardNavigation.Geometry(cols = 5, rows = 5, blocks = emptySet())

    private fun env(cell: Int, across: Boolean, filled: Set<Int> = emptySet(), frozen: Boolean = false) =
        InputEnv(geometry, filled, GridSelection(cell, across), frozen)

    @Test
    fun `INV-1 deckValue folds ascii lowercase and validates the charset`() {
        assertEquals("A", InputActions.deckValue("a"))
        assertEquals("5", InputActions.deckValue("5"))
        assertEquals("AB", InputActions.deckValue("ab"))
        assertNull(InputActions.deckValue(""))
        assertNull(InputActions.deckValue("!"))
    }

    @Test
    fun `a letter places at the cursor and advances within the word`() {
        val effect = InputActions.letter(env(0, across = true), 'h')
        assertEquals(listOf<GridMutation>(GridMutation.Place(0, "H")), effect.mutations)
        assertEquals(GridSelection(1, isAcross = true), effect.selection)
    }

    @Test
    fun `INV-4 a frozen board refuses the mutation and holds the cursor`() {
        val effect = InputActions.letter(env(0, across = true, frozen = true), 'h')
        assertTrue(effect.mutations.isEmpty())
        assertEquals(GridSelection(0, isAcross = true), effect.selection)
    }

    @Test
    fun `backspace on a filled cell clears in place`() {
        val effect = InputActions.backspace(env(2, across = true, filled = setOf(2)))
        assertEquals(listOf<GridMutation>(GridMutation.Clear(2)), effect.mutations)
        assertEquals(GridSelection(2, isAcross = true), effect.selection)
    }

    @Test
    fun `backspace on an empty cell steps back and clears there`() {
        // From an empty cell 2 with cell 1 filled, backspace steps to 1 and clears it.
        val effect = InputActions.backspace(env(2, across = true, filled = setOf(1)))
        assertEquals(GridSelection(1, isAcross = true), effect.selection)
        assertEquals(listOf<GridMutation>(GridMutation.Clear(1)), effect.mutations)
    }

    @Test
    fun `toggleDirection flips the axis and never mutates`() {
        val effect = InputActions.toggleDirection(env(7, across = true))
        assertTrue(effect.mutations.isEmpty())
        assertEquals(GridSelection(7, isAcross = false), effect.selection)
    }

    @Test
    fun `a tap on the current cell toggles direction, another cell keeps it`() {
        assertEquals(GridSelection(3, isAcross = false), InputActions.tap(env(3, across = true), 3))
        assertEquals(GridSelection(8, isAcross = true), InputActions.tap(env(3, across = true), 8))
    }

    @Test
    fun `a tap out of range returns null`() {
        assertNull(InputActions.tap(env(0, across = true), 999))
    }

    // The input layer carries the navigation prefs, axis change included (personal-settings slice
    // 1). The vector 5x4 (blocks 2, 6, 13); row 3 (cells 15..19) is one full across word.
    private val prefsGeom = BoardNavigation.Geometry(cols = 5, rows = 4, blocks = setOf(2, 6, 13))

    private fun prefsEnv(from: Int, filled: Set<Int>, prefs: BoardNavigation.NavigationPrefs) =
        InputEnv(prefsGeom, filled, GridSelection(from, isAcross = true), frozen = false, navigationPrefs = prefs)

    @Test
    fun `a letter honors skip-off advancing to the next cell regardless of fill`() {
        // 16 filled, skip-off: the letter lands on the very next cell 16.
        val prefs = BoardNavigation.NavigationPrefs(skipFilledInWord = false, endOfWord = BoardNavigation.EndOfWord.FIRST_BLANK)
        val effect = InputActions.letter(prefsEnv(15, setOf(16), prefs), 'a')
        assertEquals(GridSelection(16, isAcross = true), effect.selection)
        assertEquals(listOf<GridMutation>(GridMutation.Place(15, "A")), effect.mutations)
    }

    @Test
    fun `a letter with next-clue completing a word crosses to the next clue and its axis`() {
        // Row 3 has one blank (19) left; typing it completes the word. next-clue leaves for the Tab
        // target and the effect adopts that clue's axis, so the axis is not pinned to the typed cell.
        val before = setOf(15, 16, 17, 18)
        val prefs = BoardNavigation.NavigationPrefs(skipFilledInWord = true, endOfWord = BoardNavigation.EndOfWord.NEXT_CLUE)
        val effect = InputActions.letter(prefsEnv(19, before, prefs), 'a')
        val tab = BoardNavigation.tabTarget(prefsGeom, isAcross = true, from = 19, forward = true, filled = before + 19)
        assertEquals(tab.cell, effect.selection.cell)
        assertEquals(tab.isAcross, effect.selection.isAcross)
        assertEquals(listOf<GridMutation>(GridMutation.Place(19, "A")), effect.mutations)
    }

    @Test
    fun `a letter with default prefs matches the bare typing op no behavior change`() {
        // With the default env prefs, the letter path is the pre-slice op, so a person who never
        // opens Settings sees zero change.
        val before = setOf(16, 18)
        val effect = InputActions.letter(prefsEnv(15, before, BoardNavigation.NavigationPrefs.DEFAULT), 'a')
        assertEquals(BoardNavigation.typingAdvance(prefsGeom, isAcross = true, from = 15, filled = before + 15), effect.selection.cell)
        assertEquals(true, effect.selection.isAcross)
    }
}
