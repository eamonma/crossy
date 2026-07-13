// The §10 background precedence, pinned so the order can never fork (root DESIGN.md §10). The
// resolver is the one place the order lives; these cases are its guard.
package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CellFillTests {

    @Test
    fun `INV-DESIGN10 a block outranks every other flag`() {
        val fill = CellFill.resolve(isBlock = true, isCurrent = true, inActiveWord = true, hasTeammate = true)
        assertEquals(CellFill.BLOCK, fill)
    }

    @Test
    fun `INV-DESIGN10 the current cell outranks its active word and a teammate`() {
        val fill = CellFill.resolve(isBlock = false, isCurrent = true, inActiveWord = true, hasTeammate = true)
        assertEquals(CellFill.CURRENT, fill)
    }

    @Test
    fun `INV-DESIGN10 the active word outranks a teammate below it`() {
        val fill = CellFill.resolve(isBlock = false, isCurrent = false, inActiveWord = true, hasTeammate = true)
        assertEquals(CellFill.ACTIVE_WORD, fill)
    }

    @Test
    fun `INV-DESIGN10 teammate-here paints only when nothing above it does`() {
        val fill = CellFill.resolve(isBlock = false, isCurrent = false, inActiveWord = false, hasTeammate = true)
        assertEquals(CellFill.TEAMMATE, fill)
    }

    @Test
    fun `INV-DESIGN10 a bare playable cell falls through to base`() {
        assertEquals(CellFill.BASE, CellFill.resolve(isBlock = false, isCurrent = false))
    }

    @Test
    fun `INV-DESIGN10 check and cross-reference sit between current and active word`() {
        // Check and cross-reference are M6 scope but their rank is declared now; a checked cell
        // reads before a referenced one, and both before the active word.
        assertEquals(CellFill.CHECK, CellFill.resolve(isBlock = false, isCurrent = false, isChecked = true, isCrossReferenced = true, inActiveWord = true))
        assertEquals(CellFill.CROSS_REFERENCE, CellFill.resolve(isBlock = false, isCurrent = false, isChecked = false, isCrossReferenced = true, inActiveWord = true))
    }
}
