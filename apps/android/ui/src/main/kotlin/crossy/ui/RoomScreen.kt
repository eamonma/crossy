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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
) {
    val render by store.render.collectAsStateWithLifecycle()
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO

    val geometry = remember(puzzle) { GridGeometry.from(puzzle) }
    val navGeom = remember(geometry) { BoardNavigation.Geometry(geometry.cols, geometry.rows, geometry.blocks) }
    var selection by remember(puzzle) { mutableStateOf(InputActions.initialSelection(navGeom)) }

    val values = remember(render) { buildValues(render, geometry) }
    val filled = values.keys
    val frozen = render.status != GameStatus.ONGOING
    val activeWord = remember(selection, geometry) { geometry.wordCells(selection.cell, selection.isAcross) }
    val presence = remember(render, ground) { Presence.marks(render.cursors, render.participants, render.selfUserId, ground) }
    val cursorTint =
        if (AttributionSwitches.colorInMotionEnabled) Presence.selfColor(render.participants, render.selfUserId, ground)
        else ground.tokens.ink
    val activeClue = remember(selection, puzzle) { activeClueOf(puzzle, selection) }

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
        RoomBar(roomName, render.participants, render.sync, render.status, ground, onExit = onExit)
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
        KeyDeck(ground = ground) { key ->
            when (key) {
                is DeckKey.Letter -> apply(InputActions.letter(env(), key.character))
                DeckKey.Backspace -> apply(InputActions.backspace(env()))
                DeckKey.DirectionToggle -> apply(InputActions.toggleDirection(env()))
            }
        }
    }
}

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

/** The clue running through the cursor on its axis: the one whose cell list contains the selection.
 *  Null when no clue names the cell (a lone cell or a gap), which renders an empty bar. */
private fun activeClueOf(puzzle: ClientPuzzle, selection: GridSelection): ActiveClue? {
    val list = if (selection.isAcross) puzzle.clues.across else puzzle.clues.down
    val clue = list.firstOrNull { selection.cell in it.cellIndices } ?: return null
    val axis = if (selection.isAcross) "ACROSS" else "DOWN"
    return ActiveClue("${clue.number} $axis", clue.text)
}
