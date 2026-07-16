// Cursor navigation on the store ring. ARCHITECTURE.md §3 has the store calling the engine
// synchronously for navigation, and AAD-1 keeps :engine out of :ui's imports, so this facade is
// the declared surface the input layer (roadmap I2b) drives navigation through. Type mapping
// only for the vectored ops: each rule lives in :engine where the navigation vectors pin it
// (PROTOCOL.md §13, DESIGN.md §5), and nothing here restates one. Twin of apps/ios
// BoardNavigation.swift.
//
// The one exception is the pref-aware typing advance (personal-settings slice 1). iOS keeps that
// rule in CrossyEngine and its facade only maps the types; the Kotlin :engine has no prefs-aware
// twin yet, so the algorithm is composed here from the engine's own primitives (wordBounds,
// tabTarget) rather than forked from them. The default-prefs path reproduces the four-arg engine
// op the vectors pin exactly (the store tests assert this cell by cell, both axes), so an unset
// device sees zero change and no vector diverges. It is the obvious candidate to hoist into
// :engine once that slice lands an Android engine twin.

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

    /** A typing-advance landing in plain values: the cell and whether the landing clue is across.
     * The `.NEXT_CLUE` end-of-word move may cross the across/down axis, so the axis rides back with
     * the cell rather than being pinned by the caller. Twin of iOS's `(cell, isAcross)` return. */
    data class TypingLanding(val cell: Int, val isAcross: Boolean)

    /** What to do on reaching the end of a word while typing (personal-settings slice 1), the twin
     * of the engine's `EndOfWordBehavior` on iOS. `FIRST_BLANK` wraps back to the word's first
     * blank when the word is incomplete, else stays on its last cell (the vectored default,
     * full-word-asymmetry.json); `NEXT_CLUE` leaves for the next clue in the Tab order the moment
     * the word fills, never wrapping back within the word. */
    enum class EndOfWord { FIRST_BLANK, NEXT_CLUE }

    /** The per-device navigation preferences a person can set (personal-settings slice 1), the
     * `Geometry` pattern in plain values. `DEFAULT` reproduces the pre-slice Android behavior
     * exactly, so an unset device sees zero change and the navigation vectors stay green: skip
     * filled cells inside the word, and at the word's end wrap to its first blank. */
    data class NavigationPrefs(
        val skipFilledInWord: Boolean,
        val endOfWord: EndOfWord,
    ) {
        companion object {
            val DEFAULT = NavigationPrefs(skipFilledInWord = true, endOfWord = EndOfWord.FIRST_BLANK)
        }
    }

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
     * keystroke (the typing-advance and full-word-asymmetry vectors). Default prefs; keeps the
     * solving axis. */
    fun typingAdvance(geometry: Geometry, isAcross: Boolean, from: Int, filled: Set<Int>): Int =
        typingAdvance(geometry.grid, direction(isAcross), from, filled)

    /** The pref-aware typing advance (personal-settings slice 1): the person's chosen skip-filled
     * and end-of-word behavior arrives as `prefs` data. `NEXT_CLUE` may cross the across/down axis,
     * so this returns the landing axis alongside the cell. Mirrors the iOS engine's five-arg op
     * (the Kotlin :engine has no twin yet, so the algorithm is composed here from wordBounds and
     * tabTarget; DEFAULT reproduces the four-arg engine op above, both axes, every cell). */
    fun typingAdvance(
        geometry: Geometry,
        isAcross: Boolean,
        from: Int,
        filled: Set<Int>,
        prefs: NavigationPrefs,
    ): TypingLanding {
        val dir = direction(isAcross)
        val bounds = wordBounds(geometry.grid, dir, from)
        val stride = if (isAcross) 1 else geometry.cols

        // Advance within the word. Skip-on hunts the next blank; skip-off takes the very next cell
        // regardless of fill. Either way this only fires while a forward cell remains in the word.
        if (prefs.skipFilledInWord) {
            var cell = from + stride
            while (cell <= bounds.end) {
                if (cell !in filled) return TypingLanding(cell, isAcross)
                cell += stride
            }
        } else if (from + stride <= bounds.end) {
            return TypingLanding(from + stride, isAcross)
        }

        // No forward cell left inside the word: apply the end-of-word rule.
        return when (prefs.endOfWord) {
            EndOfWord.FIRST_BLANK -> {
                var cell = bounds.start
                while (cell <= bounds.end) {
                    if (cell !in filled) return TypingLanding(cell, isAcross)
                    cell += stride
                }
                // The word is full: stay on its last cell, the pre-slice default the vectors pin
                // (full-word-asymmetry.json: typing the last cell of a full word stays on it).
                TypingLanding(bounds.end, isAcross)
            }
            EndOfWord.NEXT_CLUE -> {
                // Leave for the next clue in the Tab order the auto-advance path already walks; its
                // axis rides back so the caller never pins the typed cell's.
                val target: TabTarget = tabTarget(geometry.grid, dir, from, Toward.FORWARD, filled)
                TypingLanding(target.cell, target.direction == Direction.ACROSS)
            }
        }
    }

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
