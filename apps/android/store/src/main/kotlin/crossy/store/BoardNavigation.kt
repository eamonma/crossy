// Cursor navigation on the store ring. ARCHITECTURE.md §3 has the store calling the engine
// synchronously for navigation, and AAD-1 keeps :engine out of :ui's imports, so this facade is
// the declared surface the input layer (roadmap I2b) drives navigation through. Type mapping
// only: every rule lives in :engine where the navigation vectors pin it (PROTOCOL.md §13,
// DESIGN.md §5), and nothing here restates one. Twin of apps/ios BoardNavigation.swift, trimmed
// to the engine surface this port actually ships: the Kotlin :engine has no pref-aware
// typingAdvance/NavigationPrefs yet (that iOS slice has no Android engine twin), so this facade
// exposes exactly what crossy.engine provides, never a parallel type.

package crossy.store

import crossy.engine.Direction
import crossy.engine.Grid
import crossy.engine.TabTarget
import crossy.engine.Toward
import crossy.engine.WordBounds
import crossy.engine.backspaceTarget
import crossy.engine.getNextCell
import crossy.engine.tabTarget
import crossy.engine.typingAdvance
import crossy.engine.wordBounds

object BoardNavigation {
    /** Grid geometry in plain values, the engine's `Grid` re-expressed so callers above the store
     * never name an engine type. */
    data class Geometry(val cols: Int, val rows: Int, val blocks: Set<Int>) {
        internal val grid: Grid get() = Grid(cols, rows, blocks)
    }

    /** A Tab landing in plain values: the cell and whether the landing clue is across. */
    data class TabLanding(val cell: Int, val isAcross: Boolean)

    private fun direction(isAcross: Boolean): Direction =
        if (isAcross) Direction.ACROSS else Direction.DOWN

    private fun toward(forward: Boolean): Toward =
        if (forward) Toward.FORWARD else Toward.BACKWARD

    /** The initial cursor position: first playable cell (DESIGN.md §5), computed as the engine's
     * out-of-range clamp exactly as the web's `initialSelection` does, so the rule is never
     * restated. */
    fun initialCell(geometry: Geometry): Int =
        getNextCell(geometry.grid, Direction.ACROSS, -1, Toward.FORWARD)

    /** Single-cell advance with block-skip (the seed's getNextCell; the single-cell-advance
     * vectors). */
    fun step(
        geometry: Geometry,
        isAcross: Boolean,
        from: Int,
        forward: Boolean,
        canEscapeWord: Boolean = true,
    ): Int = getNextCell(geometry.grid, direction(isAcross), from, toward(forward), canEscapeWord)

    /** The word's inclusive extent along the axis from `from` (the word-bounds vectors). */
    fun wordBoundsOf(geometry: Geometry, isAcross: Boolean, from: Int): WordBounds =
        wordBounds(geometry.grid, direction(isAcross), from)

    /** The cursor move after a letter lands at `from`, with `filled` the board after that
     * keystroke (the typing-advance and full-word-asymmetry vectors). Keeps the solving axis. */
    fun typingAdvance(geometry: Geometry, isAcross: Boolean, from: Int, filled: Set<Int>): Int =
        typingAdvance(geometry.grid, direction(isAcross), from, filled)

    /** The cursor move on Backspace (the backspace-step-back vectors). */
    fun backspaceTarget(geometry: Geometry, isAcross: Boolean, from: Int, filled: Set<Int>): Int =
        backspaceTarget(geometry.grid, direction(isAcross), from, filled)

    /** Tab and Shift+Tab over the circular clue cycle, axis crossing included (the next-word /
     * previous-word / full-word-asymmetry vectors). */
    fun tabTarget(
        geometry: Geometry,
        isAcross: Boolean,
        from: Int,
        forward: Boolean,
        filled: Set<Int>,
    ): TabLanding {
        val target: TabTarget =
            tabTarget(geometry.grid, direction(isAcross), from, toward(forward), filled)
        return TabLanding(target.cell, target.direction == Direction.ACROSS)
    }
}
