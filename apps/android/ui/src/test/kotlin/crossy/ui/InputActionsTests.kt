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
}
