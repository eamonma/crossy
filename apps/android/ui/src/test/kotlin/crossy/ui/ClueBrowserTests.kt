// The clue browser's row rules pinned against apps/ios ClueBook.ClueBrowserList (DESIGN.md §3
// achromatic emphasis; D26 cross-references): the active row marked on its axis, the crossing word
// quietly marked, a filled word de-emphasized (never the current or crossing word), a referenced row
// washed unless it is current (current wins), and the jump as the pointer's clueClick (first cell,
// axis set, no first-empty scan).
package crossy.ui

import crossy.protocol.Clue
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ClueBrowserTests {
    // A 2x2-ish sketch: 1-Across on cells 0,1; 5-Across on 2,3; 1-Down on 0,2.
    private val across = listOf(
        Clue(1, "First across", listOf(0, 1)),
        Clue(5, "Second across", listOf(2, 3)),
    )
    private val down = listOf(Clue(1, "First down", listOf(0, 2)))

    @Test
    fun `D26 the row under the cursor on its axis is current, the off-axis word is crossing`() {
        val sel = GridSelection(0, isAcross = true)
        val a = ClueBrowser.rows(across, isAcross = true, sel, filled = emptySet(), referenced = emptySet())
        val d = ClueBrowser.rows(down, isAcross = false, sel, filled = emptySet(), referenced = emptySet())
        assertTrue(a[0].isCurrent)
        assertFalse(a[0].isCrossing)
        assertFalse(a[1].isCurrent)
        assertTrue(d[0].isCrossing)
        assertFalse(d[0].isCurrent)
    }

    @Test
    fun `INV10 a filled word de-emphasizes, but the current and crossing words never dim`() {
        val sel = GridSelection(0, isAcross = true)
        val filled = setOf(0, 1, 2, 3) // everything renders non-null
        val a = ClueBrowser.rows(across, isAcross = true, sel, filled, referenced = emptySet())
        val d = ClueBrowser.rows(down, isAcross = false, sel, filled, referenced = emptySet())
        assertFalse(a[0].isDimmed) // current
        assertTrue(a[1].isDimmed) // filled, neither current nor crossing
        assertFalse(d[0].isDimmed) // crossing
    }

    @Test
    fun `D26 a referenced row washes faintly, and current wins over referenced`() {
        val sel = GridSelection(0, isAcross = true)
        val referenced = setOf("5A", "1A")
        val a = ClueBrowser.rows(across, isAcross = true, sel, filled = emptySet(), referenced = referenced)
        assertTrue(a[1].isReferenced) // 5A is named and not current
        assertFalse(a[0].isReferenced) // 1A is current; current wins
    }

    @Test
    fun `D26 the referenced keys speak the number-axis scheme, so a down key never lights an across row`() {
        val sel = GridSelection(3, isAcross = true) // cursor on 5-Across
        val rows = ClueBrowser.rows(down, isAcross = false, sel, filled = emptySet(), referenced = setOf("1A"))
        assertFalse(rows[0].isReferenced) // 1D exists but only 1A was named
    }

    @Test
    fun `DESIGN10 the jump is the pointer's clueClick, first cell with the axis set`() {
        val row = ClueBrowser.rows(down, isAcross = false, selection = null, filled = emptySet(), referenced = emptySet())[0]
        assertEquals(GridSelection(0, isAcross = false), ClueBrowser.jumpTarget(row))
    }

    @Test
    fun `INV10 a word is filled only when every cell renders non-null`() {
        assertTrue(ClueBrowser.isFilled(across[0], setOf(0, 1)))
        assertFalse(ClueBrowser.isFilled(across[0], setOf(0)))
        assertFalse(ClueBrowser.isFilled(Clue(9, "empty word", emptyList()), setOf(0)))
    }
}
