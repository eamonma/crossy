// The input map as pure transforms: environment plus intent in, next selection plus mutations
// out. Twin of the iOS InputActions and apps/web/src/input/actions.ts (Wave 2.1d). Every cursor
// move goes through BoardNavigation, the store ring's facade over the engine's navigation ops
// (the module graph keeps :engine out of :ui's direct imports), so the input layer cannot drift
// from the navigation vectors. Mutations are intents for the store's command path
// (GameStore.placeLetter / clearCell); nothing here touches a store. The typing advance carries
// the person's navigation prefs (personal-settings slice 1); `.DEFAULT` reproduces the pre-slice
// behavior exactly, so callers that never set them are unchanged and the navigation vectors hold.

package crossy.ui

import crossy.protocol.Direction
import crossy.protocol.isValidValue
import crossy.protocol.normalizeValue
import crossy.store.BoardNavigation

/** The local player's cursor: a cell and a solving axis. Owned by the input layer, passed into the
 *  grid as plain render input; the store holds no local selection (it mirrors the server actor, and
 *  selection never crosses the wire). Twin of the iOS GridSelection. */
data class GridSelection(val cell: Int, val isAcross: Boolean) {
    val direction: Direction get() = if (isAcross) Direction.ACROSS else Direction.DOWN
}

/** A board mutation the input layer wants sent through the store's command path. */
sealed interface GridMutation {
    data class Place(val cell: Int, val value: String) : GridMutation
    data class Clear(val cell: Int) : GridMutation
}

/** One intent's outcome: where the cursor goes and what (if anything) hits the wire. */
data class InputEffect(val selection: GridSelection, val mutations: List<GridMutation> = emptyList())

/**
 * Everything an input transform reads: geometry, the INV-10 rendered fill set (sequenced state
 * painted with the overlay), the cursor, the terminal freeze, and the per-device navigation prefs
 * (personal-settings slice 1). `frozen` is true after completed or abandoned: navigation stays
 * live, mutation freezes locally and never reaches the wire. `navigationPrefs` defaults to the
 * pre-slice behavior, so callers that never set them are unchanged and the navigation vectors hold.
 */
data class InputEnv(
    val geometry: BoardNavigation.Geometry,
    /** Cells currently rendering non-null (GameStore.renderValue, INV-10). */
    val filled: Set<Int>,
    val selection: GridSelection,
    val frozen: Boolean,
    /** The person's typing-advance settings, per device and client-local; `.DEFAULT` reproduces
     *  the pre-slice behavior exactly. */
    val navigationPrefs: BoardNavigation.NavigationPrefs = BoardNavigation.NavigationPrefs.DEFAULT,
)

object InputActions {
    /** The initial position: first playable cell, direction across (DESIGN.md §5), via the
     *  engine's clamp exactly as the web's `initialSelection`. */
    fun initialSelection(geometry: BoardNavigation.Geometry): GridSelection =
        GridSelection(BoardNavigation.initialCell(geometry), isAcross = true)

    /** A letter key: place at the cursor and advance by the typing op, filled-skip inside the word
     *  against the board after this keystroke. Accepts ASCII A-Z0-9 after the fold; anything else is
     *  a no-op. Frozen refuses the mutation and holds. */
    fun letter(env: InputEnv, character: Char): InputEffect {
        val value = deckValue(character.toString()) ?: return refused(env)
        return place(env, value)
    }

    /** A rebus commit: the whole multi-glyph value lands as one command through the same path as a
     *  letter, and the cursor advances by the same typing op (charset and length per PROTOCOL.md §3). */
    fun rebus(env: InputEnv, value: String): InputEffect {
        val normalized = deckValue(value) ?: return refused(env)
        return place(env, normalized)
    }

    /** Backspace: a non-empty cursor clears in place and stays; an already-empty one steps back per
     *  the vectored rule and clears where it lands, skipping the wire no-op when the landing cell is
     *  already empty. Frozen refuses the mutation and holds. */
    fun backspace(env: InputEnv): InputEffect {
        if (env.frozen) return refused(env)
        val target = BoardNavigation.backspaceTarget(env.geometry, env.selection.isAcross, env.selection.cell, env.filled)
        return InputEffect(
            selection = GridSelection(target, env.selection.isAcross),
            mutations = if (target in env.filled) listOf(GridMutation.Clear(target)) else emptyList(),
        )
    }

    /** Next word: Tab over the circular clue cycle, full clues skipped, axis crossing included. On
     *  touch this is the swipe along the solving direction (DESIGN.md §5). */
    fun nextWord(env: InputEnv): InputEffect = tab(env, forward = true)

    /** Previous word: Shift+Tab over the same cycle; the swipe against the solving direction. */
    fun previousWord(env: InputEnv): InputEffect = tab(env, forward = false)

    /** Toggle the solving axis in place: the swipe across the solving direction. Pure selection
     *  change, never a mutation. */
    fun toggleDirection(env: InputEnv): InputEffect =
        InputEffect(GridSelection(env.selection.cell, !env.selection.isAcross))

    /** The pointer path (web `cellClick`, v2 verbatim): a playable non-current cell moves the cursor
     *  and keeps direction; the current cell toggles direction; a block returns null. Taps never
     *  mutate, so they stay live after a terminal state. */
    fun tap(env: InputEnv, cell: Int): GridSelection? {
        val count = env.geometry.cols * env.geometry.rows
        if (cell < 0 || cell >= count || cell in env.geometry.blocks) return null
        if (cell == env.selection.cell) return GridSelection(cell, !env.selection.isAcross)
        return GridSelection(cell, env.selection.isAcross)
    }

    // MARK: shared paths

    private fun tab(env: InputEnv, forward: Boolean): InputEffect {
        val target = BoardNavigation.tabTarget(env.geometry, env.selection.isAcross, env.selection.cell, forward, env.filled)
        return InputEffect(GridSelection(target.cell, target.isAcross))
    }

    private fun place(env: InputEnv, value: String): InputEffect {
        if (env.frozen) return refused(env)
        val filledAfter = env.filled + env.selection.cell
        // The pref-aware advance carries the person's skip-filled and end-of-word choices (slice 1).
        // The end-of-word `.NEXT_CLUE` move may cross the across/down axis, so the landing axis rides
        // back with the cell rather than being pinned here.
        val next = BoardNavigation.typingAdvance(
            env.geometry, env.selection.isAcross, env.selection.cell, filledAfter, env.navigationPrefs)
        return InputEffect(
            selection = GridSelection(next.cell, next.isAcross),
            mutations = listOf(GridMutation.Place(env.selection.cell, value)),
        )
    }

    /** A handled intent that does nothing: the frozen-mutation refusal. */
    private fun refused(env: InputEnv): InputEffect = InputEffect(env.selection)

    /** Normalize a deck-entered value: ASCII-only uppercase fold (INV-1) via :protocol, then
     *  validate against the wire charset `A-Z0-9`, length 1 to 10 (PROTOCOL.md §3). Returns the
     *  normalized value, or null when it is not a legal cell value. The normalization and validation
     *  rules live in :protocol and are not restated here. */
    fun deckValue(raw: String): String? {
        if (!isValidValue(raw)) return null
        return normalizeValue(raw)
    }
}
