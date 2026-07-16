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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import crossy.design.AttributionSwitches
import crossy.design.IdentityRoster
import crossy.protocol.ClientPuzzle
import crossy.protocol.Clue
import crossy.protocol.GameStatus
import crossy.store.BoardNavigation
import crossy.store.GameStore
import crossy.store.RenderModel
import crossy.store.SyncState
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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
    // The holder's personal reaction set (Wave 8.5; D25): the five the send fan offers, sourced from
    // GET /me's reactionSet (null -> the defaults) and threaded by the composition root. Read at
    // composition, so a Settings edit reaches the fan the next time a room is entered (live mid-room
    // propagation is not required). Defaults to the protocol five for the demo room and previews.
    reactionEmojis: List<String> = ReactionPolicy.defaultSet,
    // The wall-clock instant (epoch millis) the driver's next reconnect dial is due, or null when
    // none is scheduled (SessionDriver.onReconnectScheduled, threaded by the composition root). The
    // room bar counts it down while the weather is reconnecting; a stale value left after the socket
    // returns live is never rendered (the chip gates on sync), so no clear step is needed.
    reconnectRetryAt: Long? = null,
) {
    val render by store.render.collectAsStateWithLifecycle()
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO

    val geometry = remember(puzzle) { GridGeometry.from(puzzle) }
    val navGeom = remember(geometry) { BoardNavigation.Geometry(geometry.cols, geometry.rows, geometry.blocks) }
    var selection by remember(puzzle) { mutableStateOf(InputActions.initialSelection(navGeom)) }
    // The person's typing-advance settings (personal-settings slice 1). The Settings UI for prefs is
    // a later track (iOS's NavigationSettingsStore), so the room threads the pre-slice default for
    // now: one obvious seam for the store-backed prefs to arrive through.
    val navigationPrefs = BoardNavigation.NavigationPrefs.DEFAULT
    // The inline rebus entry in flight; null when rebus mode is off (iOS SelectionModel.rebusBuffer).
    // Moving the cursor away (a tap or a clue step) discards an open entry, exactly as iOS does.
    var rebusBuffer by remember(puzzle) { mutableStateOf<String?>(null) }

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

    // Ephemeral reactions (PROTOCOL.md §9; D24): a transient sticker book held HERE beside the
    // store, never inside it, so a snapshot or resync is provably unable to touch a sticker. The
    // store fans inbound reactions out on `reactions`; the fan's local echo places its own sticker
    // (the server never echoes a react). ReactionBook keeps the book a pure transform on an
    // immutable list, so Compose observes every placement, coalesce, and sweep.
    val reduceMotion = rememberReduceMotion()
    var stickers by remember(puzzle) { mutableStateOf(emptyList<ReactionSticker>()) }
    var reactionSentAt by remember(puzzle) { mutableStateOf(emptyList<Double>()) }

    // The conflict flash (PROTOCOL.md §8, D02): the store detects the trigger, the grid animates the
    // ~300 ms wash in the writer's color. The book is held HERE beside the render model (the iOS
    // CrossyGridView wireFlashSink placement), never inside the store. The sink resolves the writer's
    // roster color the way RoomBar resolves a dot (wire color, else the identity hash) and reads the
    // latest participants off the store so the closure captures nothing stale. Recording is ID-1
    // gated inside FlashBook.record, so muting color-in-motion silences the flash at the source.
    var flashes by remember(puzzle) { mutableStateOf(FlashBook()) }
    DisposableEffect(store, ground) {
        store.onConflictFlash = { flash ->
            val writer = store.render.value.participants.firstOrNull { it.userId == flash.by }
            val identity = writer?.let { IdentityRoster.colorForWireColor(it.color) ?: IdentityRoster.color(it.userId) }
                ?: IdentityRoster.color(flash.by)
            flashes = flashes.record(flash.cell, ground.rosterColor(identity), reactionNow())
        }
        onDispose { store.onConflictFlash = null }
    }
    // The sweep (the FlashBook pattern): re-armed on every trigger, it sleeps to the soonest envelope
    // end, then retires everything past it. Under Reduce Motion the grid holds the wash static and
    // this sweep is the only thing that clears it, so the step reads for the envelope then leaves.
    LaunchedEffect(flashes) {
        val next = flashes.nextExpiry() ?: return@LaunchedEffect
        val waitMs = ((next - reactionNow()) * 1000).toLong()
        if (waitMs > 0) delay(waitMs + 20)
        flashes = flashes.sweep(reactionNow())
    }

    LaunchedEffect(store) {
        store.reactions.collect { event ->
            stickers = ReactionBook.place(stickers, event.userId, event.emoji, event.cell, reactionNow())
        }
    }
    // The sweep (the FlashBook pattern): re-armed on every mutation, it sleeps to the soonest end,
    // then retires everything past it; the layer's own exit fade already played by then.
    LaunchedEffect(stickers) {
        val next = ReactionBook.nextExpiry(stickers) ?: return@LaunchedEffect
        val waitMs = ((next - reactionNow()) * 1000).toLong()
        if (waitMs > 0) delay(waitMs + 20)
        stickers = ReactionBook.sweep(stickers, reactionNow())
    }

    // Fire a reaction at the current cursor cell: the 5/s sliding-window cap decides, an accepted
    // send echoes locally at once (the server never echoes, §9) and goes to the wire. A capped
    // attempt sends nothing and echoes nothing.
    fun fireReaction(emoji: String) {
        val self = render.selfUserId ?: return
        val now = reactionNow()
        if (!ReactionSendCap.allows(reactionSentAt, now)) return
        reactionSentAt = ReactionSendCap.record(reactionSentAt, now)
        stickers = ReactionBook.place(stickers, self, emoji, selection.cell, now)
        store.react(emoji, selection.cell)
    }

    // The input env is rebuilt per intent so it reads the latest filled set, freeze, and prefs.
    fun env() = InputEnv(navGeom, filled, selection, frozen, navigationPrefs)

    // The cursor relay (iOS SolveScreen.relayCursor): every selection change goes to the room,
    // throttled to the wire's 10/s cap with a leading send and one coalesced trailing send that
    // always carries the latest position (PROTOCOL.md §9). The store refuses sends while connecting.
    val relayScope = rememberCoroutineScope()
    val relay = remember(puzzle) { CursorRelayThrottle() }
    var trailingRelay by remember(puzzle) { mutableStateOf<Job?>(null) }

    fun relayCursor(sel: GridSelection) {
        when (val verdict = relay.selectionChanged(reactionNow())) {
            is CursorRelayThrottle.Verdict.Send -> store.moveCursor(sel.cell, sel.direction)
            is CursorRelayThrottle.Verdict.ScheduleTrailing -> {
                trailingRelay?.cancel() // one pending trailing send at a time (iOS relayTrailing)
                trailingRelay = relayScope.launch {
                    delay((verdict.afterSeconds * 1000).toLong())
                    relay.trailingFired(reactionNow())
                    // Read the latest selection at fire time; a stale final cursor would lie.
                    store.moveCursor(selection.cell, selection.direction)
                }
            }
            CursorRelayThrottle.Verdict.Coalesce -> Unit
        }
    }

    fun apply(effect: InputEffect) {
        for (mutation in effect.mutations) when (mutation) {
            is GridMutation.Place -> store.placeLetter(mutation.cell, mutation.value)
            is GridMutation.Clear -> store.clearCell(mutation.cell)
        }
        selection = effect.selection
        relayCursor(effect.selection)
    }

    // A deck key while a rebus buffer is open (iOS SelectionModel.pressInRebusMode): letters grow
    // the buffer, backspace edits and exits, the rebus key commits. Outside the buffer, the rebus
    // key opens it and the rest run the vectored input actions.
    fun onDeckKey(key: DeckKey) {
        val buffer = rebusBuffer
        if (buffer != null) {
            when (key) {
                is DeckKey.Letter -> rebusBuffer = RebusBuffer.append(buffer, key.character)
                DeckKey.Backspace -> rebusBuffer = when (val step = RebusBuffer.backspace(buffer)) {
                    is RebusStep.Editing -> step.buffer
                    else -> null
                }
                DeckKey.Rebus -> when (val step = RebusBuffer.commit(buffer)) {
                    is RebusStep.Commit -> { rebusBuffer = null; apply(InputActions.rebus(env(), step.value)) }
                    else -> rebusBuffer = null
                }
            }
            return
        }
        when (key) {
            is DeckKey.Letter -> apply(InputActions.letter(env(), key.character))
            DeckKey.Backspace -> apply(InputActions.backspace(env()))
            DeckKey.Rebus -> rebusBuffer = ""
        }
    }

    Column(modifier = modifier.fillMaxSize().background(ground.tokens.canvas.toColor())) {
        RoomBar(roomName, render.participants, render.sync, render.status, ground, onExit = onExit, onShare = onShare, reconnectRetryAt = reconnectRetryAt)
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
                flashes = flashes,
                reduceMotion = reduceMotion,
                modifier = Modifier.fillMaxWidth(),
                onCellTap = { cell ->
                    InputActions.tap(env(), cell)?.let {
                        rebusBuffer = null // moving the cursor away discards an open rebus entry
                        selection = it
                        relayCursor(it)
                    }
                },
            )
            // The sticker overlay ABOVE the grid, sized to it (same fillMaxWidth + aspectRatio, so
            // one module edge governs both): reactions render at their cell as native emoji. It
            // never hit-tests, so grid taps pass through untouched.
            ReactionStickerLayer(
                stickers = stickers,
                geometry = geometry,
                reduceMotion = reduceMotion,
                modifier = Modifier.fillMaxWidth().aspectRatio(geometry.cols.toFloat() / geometry.rows),
            )
            // The floating fan at the grid's trailing-bottom corner (near the clue bar's trailing
            // corner). It is composed here, OUTSIDE the terminal deck retirement below, so it stays
            // visible in any status (reactions are legal post-completion, §9). Gated only before the
            // first welcome, where there is no cursor to aim at yet.
            ReactionFan(
                onPick = { fireReaction(it) },
                ground = ground,
                emojis = reactionEmojis,
                enabled = render.sync != SyncState.CONNECTING,
                modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp),
            )
            // Reconnecting (and the pre-welcome connecting state) dims the board (DESIGN.md §8;
            // RoomWeather.boardDimmed): a paper wash at 0.45, never a modal or a spinner. It carries
            // no pointer input, so taps still reach the grid and the fan beneath it; input stays live
            // and the store holds it gracefully (PROTOCOL.md §8).
            if (RoomWeather.boardDimmed(render.sync)) {
                Box(
                    Modifier
                        .matchParentSize()
                        .background(ground.tokens.canvas.toColor().copy(alpha = RoomWeather.boardDimOpacity.toFloat())),
                )
            }
        }
        ClueBar(
            clue = activeClue,
            ground = ground,
            // A clue step is a move-away, so it discards an open rebus entry (iOS swipe rule).
            onPrev = { rebusBuffer = null; apply(InputActions.previousWord(env())) },
            onNext = { rebusBuffer = null; apply(InputActions.nextWord(env())) },
        )
        if (frozen) {
            // A terminal room retires the deck for everyone (iOS SolveScreen; #205 solved, #235
            // host-ended): the deck just leaves, a small spacer keeps the bottom breath (iOS
            // completed: Color.clear.frame(height: 12)). The abandoned one-line notice and the
            // deck's own glass are a later design track, not the Wave A4 functional bar.
            Spacer(Modifier.height(12.dp))
        } else {
            // The inline rebus field sits over the deck while a buffer is open (iOS SolveScreen):
            // multi-glyph entry types into it and the rebus key commits it back through the deck.
            rebusBuffer?.let { buffer ->
                RebusField(
                    buffer = buffer,
                    ground = ground,
                    modifier = Modifier.padding(horizontal = 10.dp).padding(bottom = 6.dp),
                )
            }
            KeyDeck(ground = ground, rebusActive = rebusBuffer != null, onKey = { onDeckKey(it) })
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
