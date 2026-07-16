// The solve room (iOS SolveScreen, trimmed to the Wave A4 functional bar): the top bar, the Canvas
// grid, the active-clue bar, and the key deck, composed over one GameStore's StateFlow. A pure
// function of the render model plus the local selection; every intent flows through InputActions so
// the screen cannot drift from the navigation vectors, and every mutation goes to the store's
// command path (optimistic overlay, INV-10). Presence, cursor relay, and the terminal freeze all
// read the same render model the grid draws from.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import crossy.design.AttributionSwitches
import crossy.protocol.ClientPuzzle
import crossy.protocol.Clue
import crossy.protocol.GameStatus
import crossy.store.BoardNavigation
import crossy.store.GameStore
import crossy.store.RenderModel

@Composable
fun RoomScreen(
    store: GameStore,
    puzzle: ClientPuzzle,
    roomName: String?,
    modifier: Modifier = Modifier,
    onExit: () -> Unit = {},
    // The room's share intent, or null when there is no code to share (the demo room). The
    // composition root builds the short link and fires the system share sheet (RoomBar surfaces it).
    onShare: (() -> Unit)? = null,
) {
    val render by store.render.collectAsStateWithLifecycle()
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO

    val geometry = remember(puzzle) { GridGeometry.from(puzzle) }
    val navGeom = remember(geometry) { BoardNavigation.Geometry(geometry.cols, geometry.rows, geometry.blocks) }
    var selection by remember(puzzle) { mutableStateOf(InputActions.initialSelection(navGeom)) }

    val values = remember(render) { buildValues(render, geometry) }
    val filled = values.keys
    // A terminal room (completed or abandoned) freezes input and retires the deck (INV-4): one
    // condition, one predicate. `frozen` gates local mutation through InputActions; `deckRetired`
    // reads the same fact to remove the deck itself below.
    val frozen = deckRetired(render)
    val activeWord = remember(selection, geometry) { geometry.wordCells(selection.cell, selection.isAcross) }
    val presence = remember(render, ground) { Presence.marks(render.cursors, render.participants, render.selfUserId, ground) }
    val cursorTint =
        if (AttributionSwitches.colorInMotionEnabled) Presence.selfColor(render.participants, render.selfUserId, ground)
        else ground.tokens.ink
    // The active clue and, from its prose, the cells of every clue it cross-references (numeric refs
    // plus, when it is a revealer, the starred clues; D26). One resolution, so the bar and the board
    // tint read the same active clue. The grid tint is the only surface here: Android has no clue
    // rail (ClueBar shows just the active clue), so the adjacent-clue lift-up has no home yet.
    val activeEntry = remember(selection, puzzle) { activeClueEntry(puzzle, selection) }
    val activeClue = activeEntry?.let {
        ActiveClue("${it.number} ${if (selection.isAcross) "ACROSS" else "DOWN"}", it.text)
    }
    val crossReference = remember(activeEntry, selection.isAcross, puzzle) {
        val keys = referencedKeys(activeEntry, selection.isAcross, puzzle.clues.across, puzzle.clues.down)
        referencedCells(keys, puzzle.clues.across, puzzle.clues.down)
    }

    // The input env is rebuilt per intent so it reads the latest filled set and freeze.
    fun env() = InputEnv(navGeom, filled, selection, frozen)

    fun relayCursor(sel: GridSelection) = store.moveCursor(sel.cell, sel.direction)

    fun apply(effect: InputEffect) {
        for (mutation in effect.mutations) when (mutation) {
            is GridMutation.Place -> store.placeLetter(mutation.cell, mutation.value)
            is GridMutation.Clear -> store.clearCell(mutation.cell)
        }
        selection = effect.selection
        relayCursor(effect.selection)
    }

    Column(modifier = modifier.fillMaxSize().background(ground.tokens.canvas.toColor())) {
        RoomBar(roomName, render.participants, render.sync, render.status, ground, onExit = onExit, onShare = onShare)
        Box(
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            CrossyGrid(
                geometry = geometry,
                values = values,
                selection = selection,
                activeWord = activeWord,
                presence = presence,
                ground = ground,
                cursorTint = cursorTint,
                crossReference = crossReference,
                modifier = Modifier.fillMaxWidth(),
                onCellTap = { cell ->
                    InputActions.tap(env(), cell)?.let {
                        selection = it
                        relayCursor(it)
                    }
                },
            )
        }
        ClueBar(
            clue = activeClue,
            ground = ground,
            onPrev = { apply(InputActions.previousWord(env())) },
            onNext = { apply(InputActions.nextWord(env())) },
        )
        if (frozen) {
            // A terminal room retires the deck for everyone (iOS SolveScreen; #205 solved, #235
            // host-ended): the deck just leaves, a small spacer keeps the bottom breath (iOS
            // completed: Color.clear.frame(height: 12)). The abandoned one-line notice and the
            // deck's own glass are a later design track, not the Wave A4 functional bar.
            Spacer(Modifier.height(12.dp))
        } else {
            KeyDeck(ground = ground) { key ->
                when (key) {
                    is DeckKey.Letter -> apply(InputActions.letter(env(), key.character))
                    DeckKey.Backspace -> apply(InputActions.backspace(env()))
                    DeckKey.DirectionToggle -> apply(InputActions.toggleDirection(env()))
                }
            }
        }
    }
}

/** A terminal room retires its key deck for everyone (iOS SolveScreen / RoomTerminal.deckRetired;
 *  #205 solved, #235 host-ended): once the render model reports completed or abandoned the deck
 *  leaves and never returns. A pure function of the render model, so the retirement lands on the
 *  first frame the model reports terminal — the welcome that carries the terminal status retires
 *  the deck with no flash, exactly as a mid-solve completion does. One predicate covers both
 *  terminal statuses (`!= ONGOING`), so the host-ended case (#235) needs no view logic beyond the
 *  solved case (#205). Mutation was already refused by the store and InputActions (INV-4); this is
 *  the rendered truth. Selection stays for browsing. */
internal fun deckRetired(render: RenderModel): Boolean = render.status != GameStatus.ONGOING

/** The board's rendered composite as a cell to glyph map, blocks and empty cells omitted. Reads the
 *  store's INV-10 composite (sequenced state painted with the overlay) through GameStore.renderValue. */
private fun buildValues(render: RenderModel, geometry: GridGeometry): Map<Int, String> {
    val out = HashMap<Int, String>()
    for (cell in 0 until geometry.cellCount) {
        if (cell in geometry.blocks) continue
        render.renderValue(cell)?.let { out[cell] = it }
    }
    return out
}

/** The clue running through the cursor on its axis: the one whose cell list contains the selection,
 *  on the solving axis. Null when no clue names the cell (a lone cell or a gap), which renders an
 *  empty bar and tints nothing. The bar label and the cross-reference resolution both read this one
 *  clue, so they can never disagree on which clue is active. */
private fun activeClueEntry(puzzle: ClientPuzzle, selection: GridSelection): Clue? {
    val list = if (selection.isAcross) puzzle.clues.across else puzzle.clues.down
    return list.firstOrNull { selection.cell in it.cellIndices }
}
