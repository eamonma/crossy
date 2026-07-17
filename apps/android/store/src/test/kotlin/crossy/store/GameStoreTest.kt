// Store behaviors the client-store vectors deliberately leave to the client, mirrored from
// apps/ios GameStoreTests.swift and apps/web gameStore.test.ts so the three stores cannot drift:
// the conflict-flash trigger (PROTOCOL.md §8: view animation, so the vectors exclude it; the store
// still owns detecting it), the terminal-state freeze, the transport-drop transition into
// reconnecting, the honest `connecting` initial state and its input gate, presence application
// (§9, render-only), the derived timer origin (D15), the born-live filled count (§12a), and the
// store-owned reconnect decisions (AD-6). The mailbox loop (AD-1) is exercised against a scripted
// transport on a test dispatcher.

package crossy.store

import crossy.protocol.Board
import crossy.protocol.Cell
import crossy.protocol.CellSetMessage
import crossy.protocol.ClientMessage
import crossy.protocol.Cursor
import crossy.protocol.CursorMessage
import crossy.protocol.Direction
import crossy.protocol.ErrorCode
import crossy.protocol.ErrorMessage
import crossy.protocol.GameAbandonedMessage
import crossy.protocol.GameCompletedMessage
import crossy.protocol.GameStatus
import crossy.protocol.HeartbeatMessage
import crossy.protocol.KickedMessage
import crossy.protocol.MoveCursorMessage
import crossy.protocol.Participant
import crossy.protocol.PlaceLetterMessage
import crossy.protocol.PlayerConnectedMessage
import crossy.protocol.PlayerDisconnectedMessage
import crossy.protocol.RequestSyncMessage
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.Stats
import crossy.protocol.SyncMessage
import crossy.protocol.WelcomeMessage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GameStoreTest {
    // --- Fixtures (the web/iOS suites' board/cellSet helpers, twinned) ---

    private fun board(
        seq: Int = 0,
        status: GameStatus = GameStatus.ONGOING,
        firstFillAt: String? = null,
        cells: List<Cell>? = null,
        participants: List<Participant> = emptyList(),
        cursors: List<Cursor> = emptyList(),
        recentCommandIds: List<String> = emptyList(),
    ): Board = Board(
        seq = seq,
        status = status,
        firstFillAt = firstFillAt,
        completedAt = null,
        abandonedAt = null,
        cells = cells ?: List(20) { Cell(null, null) },
        participants = participants,
        cursors = cursors,
        recentCommandIds = recentCommandIds,
        stats = null,
    )

    private fun cellSet(
        seq: Int = 1,
        cell: Int = 0,
        value: String? = "A",
        by: String = "u-other",
        commandId: String = "c-other",
        firstFillAt: String? = null,
    ): ServerMessage = ServerMessage.CellSet(
        CellSetMessage(seq, cell, value, by, commandId, "2026-07-07T00:00:00Z", firstFillAt),
    )

    private fun welcome(board: Board, userId: String = "me"): ServerMessage = ServerMessage.Welcome(
        WelcomeMessage(1, WelcomeMessage.SelfIdentity(userId, Role.SOLVER), board),
    )

    /** A store brought live via a welcome (self is "me"), with flashes recorded. */
    private fun makeLiveStore(welcomeBoard: Board = board()): Pair<GameStore, MutableList<ConflictFlash>> {
        val store = GameStore()
        val flashes = mutableListOf<ConflictFlash>()
        store.onConflictFlash = { flashes.add(it) }
        store.receive(welcome(welcomeBoard))
        return store to flashes
    }

    // --- Honest initial connect and the pre-welcome input gate (PROTOCOL.md §7) ---

    @Test
    fun freshStoreStartsConnectingNotReconnecting_PROTOCOL7() {
        assertEquals(
            SyncState.CONNECTING,
            GameStore().render.value.sync,
            "no welcome yet: connecting, not a post-drop state",
        )
    }

    @Test
    fun refusesLocalIntentsBeforeTheFirstWelcome_INV10() {
        val store = GameStore()
        store.placeLetter(0, "A")
        store.clearCell(0)
        store.moveCursor(0, Direction.ACROSS)
        store.heartbeat()
        assertTrue(store.render.value.overlay.isEmpty(), "no overlay entry against a board that does not exist")
        assertTrue(store.outbox.isEmpty(), "nothing reaches the wire before authoritative state")
    }

    @Test
    fun firstWelcomeUnlocksInputAndGoesLive_PROTOCOL7() {
        val (store, _) = makeLiveStore()
        assertEquals(SyncState.LIVE, store.render.value.sync)
        assertEquals("me", store.render.value.selfUserId)
        store.placeLetter(0, "A", "c1")
        assertEquals(1, store.render.value.overlay.size)
        assertEquals(listOf<ClientMessage>(ClientMessage.PlaceLetter(PlaceLetterMessage("c1", 0, "A"))), store.outbox)
    }

    // --- Terminal states freeze mutation locally (INV-4 scope) ---

    @Test
    fun refusesPlaceLetterAfterCompleted_INV4() {
        val (store, _) = makeLiveStore(board(status = GameStatus.COMPLETED))
        store.placeLetter(0, "A")
        assertTrue(store.render.value.overlay.isEmpty())
        assertTrue(store.outbox.isEmpty())
    }

    @Test
    fun refusesClearCellAfterAbandoned_INV4() {
        val (store, _) = makeLiveStore(board(status = GameStatus.ABANDONED))
        store.clearCell(0)
        assertTrue(store.render.value.overlay.isEmpty())
        assertTrue(store.outbox.isEmpty())
    }

    @Test
    fun inOrderGameCompletedFreezesMutationAndAppliesStats_INV4() {
        val (store, _) = makeLiveStore(board(seq = 5))
        val stats = Stats(solveTimeSeconds = 2272, totalEvents = 5, participantCount = 2, checkCount = 0)
        store.receive(ServerMessage.GameCompleted(GameCompletedMessage(6, "2026-07-07T19:40:03Z", stats)))
        assertEquals(GameStatus.COMPLETED, store.render.value.status)
        assertEquals(6, store.render.value.seq)
        assertEquals("2026-07-07T19:40:03Z", store.render.value.completedAt)
        assertEquals(stats, store.render.value.stats)
        store.placeLetter(0, "A")
        assertTrue(store.render.value.overlay.isEmpty(), "a terminal board refuses mutation locally")
    }

    @Test
    fun inOrderGameAbandonedFreezesMutation_INV4() {
        val (store, _) = makeLiveStore(board(seq = 5))
        store.receive(ServerMessage.GameAbandoned(GameAbandonedMessage(6, "2026-07-07T19:40:03Z", "host")))
        assertEquals(GameStatus.ABANDONED, store.render.value.status)
        assertEquals("2026-07-07T19:40:03Z", store.render.value.abandonedAt)
        store.clearCell(0)
        assertTrue(store.render.value.overlay.isEmpty())
    }

    // --- The kicked notice surfaces to the composition root (PROTOCOL.md §6) ---

    @Test
    fun kickedNoticeSurfacesToTheRootAndTouchesNoSequencedState_PROTOCOL6() {
        val (store, _) = makeLiveStore(board(seq = 5))
        val kicks = mutableListOf<KickedMessage>()
        store.onKicked = { kicks.add(it) }
        store.receive(ServerMessage.Kicked(KickedMessage("removed by host")))
        // The notice carries no seq: it hands off to the root's terminal flag and moves nothing
        // sequenced (PROTOCOL.md §6, close 1008 follows).
        assertEquals(listOf(KickedMessage("removed by host")), kicks)
        assertEquals(5, store.render.value.seq)
        assertEquals(GameStatus.ONGOING, store.render.value.status)
    }

    // --- Connection loss and store-owned reconnect decisions (PROTOCOL.md §7; AD-6) ---

    @Test
    fun transportDropGoesReconnectingAndPreservesOverlayForResend_PROTOCOL7_INV10() {
        val (store, _) = makeLiveStore()
        store.placeLetter(3, "K", "c-live")
        store.connectionLost()
        assertEquals(SyncState.RECONNECTING, store.render.value.sync)
        assertEquals(
            listOf(PendingCommand("c-live", 3, "K")),
            store.render.value.overlay,
            "the overlay must survive the drop so snapshot reconciliation can re-send it",
        )
    }

    @Test
    fun storeOwnsTheReconnectWalkAdapterOnlySleepsAndDials_AD6_PROTOCOL7() {
        val store = GameStore(backoff = BackoffSchedule(random = { 1.0 }))
        assertEquals(0.0, store.nextReconnectDelaySeconds())
        assertEquals(1.0, store.nextReconnectDelaySeconds())
        assertEquals(2.0, store.nextReconnectDelaySeconds())
        store.connectionSurvived(29.0)
        assertEquals(4.0, store.nextReconnectDelaySeconds(), "a short life does not reset the walk")
        store.connectionSurvived(31.0)
        assertEquals(0.0, store.nextReconnectDelaySeconds(), "a 30 s survival resets the walk")
    }

    @Test
    fun resyncingIgnoresSequencedEventsUntilTheSnapshotLands_PROTOCOL7() {
        val (store, _) = makeLiveStore(board(seq = 12))
        store.receive(cellSet(seq = 15, cell = 1, value = "B")) // gap
        assertEquals(SyncState.RESYNCING, store.render.value.sync)
        assertEquals(listOf<ClientMessage>(ClientMessage.RequestSync(RequestSyncMessage())), store.outbox)
        // Even a would-be in-order event is ignored while awaiting the snapshot.
        store.receive(cellSet(seq = 13, cell = 2, value = "C"))
        assertEquals(12, store.render.value.seq)
        assertNull(store.render.value.renderValue(2))
        // The snapshot restores order and goes live.
        store.receive(ServerMessage.Sync(SyncMessage(board(seq = 16))))
        assertEquals(SyncState.LIVE, store.render.value.sync)
        assertEquals(16, store.render.value.seq)
    }

    // --- INV-1: ASCII-only normalization before sending ---

    @Test
    fun placeLetterUppercasesAsciiOnlyBeforeSending_INV1() {
        val (store, _) = makeLiveStore()
        store.placeLetter(0, "a", "c1")
        // Turkish dotless i is not ASCII a-z: it must pass through unchanged, never locale-fold
        // (the INV-1 trap).
        store.placeLetter(1, "ı", "c2")
        assertEquals(
            listOf<ClientMessage>(
                ClientMessage.PlaceLetter(PlaceLetterMessage("c1", 0, "A")),
                ClientMessage.PlaceLetter(PlaceLetterMessage("c2", 1, "ı")),
            ),
            store.outbox,
        )
        assertEquals("A", store.render.value.renderValue(0), "the overlay renders the normalized value")
    }

    // --- Conflict flash trigger (PROTOCOL.md §8, D02): store detects, view animates ---

    @Test
    fun flashesWhenAnotherUsersCellSetChangesANonNullValueYouRender_D02() {
        val cells = MutableList(20) { Cell(null, null) }
        cells[0] = Cell("A", "me")
        val (store, flashes) = makeLiveStore(board(cells = cells))
        store.receive(cellSet(seq = 1, cell = 0, value = "B", by = "u-other"))
        assertEquals(listOf(ConflictFlash(0, "u-other")), flashes)
    }

    @Test
    fun flashesOnAnEraseOfYourRenderedLetterNeverSilent_D02() {
        val cells = MutableList(20) { Cell(null, null) }
        cells[0] = Cell("A", "me")
        val (store, flashes) = makeLiveStore(board(cells = cells))
        store.receive(cellSet(seq = 1, cell = 0, value = null, by = "u-other"))
        assertEquals(listOf(ConflictFlash(0, "u-other")), flashes)
        assertNull(store.render.value.renderValue(0), "the erase applied; it flashed instead of hiding")
    }

    @Test
    fun doesNotFlashWhenAnotherUserFillsACellYouRenderAsEmpty_D02() {
        val (store, flashes) = makeLiveStore()
        store.receive(cellSet(seq = 1, cell = 0, value = "Z", by = "u-other"))
        assertTrue(flashes.isEmpty())
    }

    @Test
    fun doesNotFlashOnYourOwnEcho_commandIdMatchClearsOverlayInstead_D02_INV10() {
        val (store, flashes) = makeLiveStore()
        store.placeLetter(0, "A", "c1")
        store.receive(cellSet(seq = 1, cell = 0, value = "A", by = "me", commandId = "c1"))
        assertTrue(flashes.isEmpty())
        assertTrue(store.render.value.overlay.isEmpty(), "the echo cleared the overlay entry")
    }

    @Test
    fun doesNotFlashWhenAPendingOverlayEntryMasksTheChange_D02_INV10() {
        val (store, flashes) = makeLiveStore()
        store.placeLetter(0, "C", "c-mine")
        // Another user's event lands under my still-pending entry: the rendered composite does
        // not change, so no flash.
        store.receive(cellSet(seq = 1, cell = 0, value = "B", by = "u-other", commandId = "c-other"))
        assertTrue(flashes.isEmpty())
        assertEquals("C", store.render.value.renderValue(0))
    }

    // --- Presence: render-only, never sequenced (PROTOCOL.md §9) ---

    @Test
    fun playerConnectedUpsertsTheParticipant_PROTOCOL9() {
        val (store, _) = makeLiveStore()
        val joined = PlayerConnectedMessage(userId = "u2", displayName = "Ana", color = "#7F77DD", role = Role.SOLVER)
        store.receive(ServerMessage.PlayerConnected(joined))
        store.receive(ServerMessage.PlayerConnected(joined)) // reconnect: upsert, not duplicate
        assertEquals(1, store.render.value.participants.size)
        assertEquals("u2", store.render.value.participants.first().userId)
        assertEquals(true, store.render.value.participants.first().connected)
        assertEquals(0, store.render.value.seq, "presence is never sequenced")
    }

    @Test
    fun playerDisconnectedMarksDisconnectedAndDropsTheCursor_PROTOCOL9() {
        val participant = Participant("u2", "Ana", "#7F77DD", Role.SOLVER, true)
        val cursor = Cursor("u2", 7, Direction.DOWN)
        val (store, _) = makeLiveStore(board(participants = listOf(participant), cursors = listOf(cursor)))
        assertEquals(cursor, store.render.value.cursors["u2"])
        store.receive(ServerMessage.PlayerDisconnected(PlayerDisconnectedMessage("u2")))
        assertEquals(false, store.render.value.participants.first().connected)
        assertNull(store.render.value.cursors["u2"], "a departed player's cursor never lingers")
    }

    @Test
    fun removeParticipantDropsTheRosterRowAndCursorNotJustGreysIt_PROTOCOL12() {
        val host = Participant("u1", "Host", "#7F77DD", Role.HOST, true)
        val target = Participant("u2", "Ana", "#77DD9A", Role.SOLVER, true)
        val cursor = Cursor("u2", 7, Direction.DOWN)
        val (store, _) = makeLiveStore(board(participants = listOf(host, target), cursors = listOf(cursor)))
        // A confirmed host kick removes the row outright, unlike a disconnect which only greys
        // it: the kicked member is no longer a member (PROTOCOL.md §12).
        store.removeParticipant("u2")
        assertEquals(listOf("u1"), store.render.value.participants.map { it.userId })
        assertNull(store.render.value.cursors["u2"], "the kicked member's cursor never lingers")
        assertEquals(0, store.render.value.seq, "presence is never sequenced")
    }

    @Test
    fun removeParticipantIsIdempotentForAnUnknownUser_PROTOCOL12() {
        val host = Participant("u1", "Host", "#7F77DD", Role.HOST, true)
        val (store, _) = makeLiveStore(board(participants = listOf(host)))
        store.removeParticipant("ghost")
        assertEquals(listOf("u1"), store.render.value.participants.map { it.userId })
    }

    // --- Seeding the pre-welcome roster (the players pill's first frame; §4, §9) ---

    // The REST roster seeds the pill at its true count before the first frame (owner device
    // finding 2026-07-11). The seed is the ROSTER, not presence: each member holds the
    // not-yet-heard-from liveness the welcome already speaks (connected: false).
    @Test
    fun seedRosterSetsTheRosterNotYetHeardFromBeforeTheWelcome_PROTOCOL9() {
        val store = GameStore()
        assertEquals(SyncState.CONNECTING, store.render.value.sync)
        store.seedRoster(
            listOf(
                Participant("u1", "", "", Role.HOST, false),
                Participant("u2", "", "", Role.SOLVER, false),
            ),
        )
        assertEquals(listOf("u1", "u2"), store.render.value.participants.map { it.userId })
        assertEquals(
            listOf(false, false),
            store.render.value.participants.map { it.connected },
            "REST members are the roster, not presence: liveness is the socket's to report",
        )
    }

    @Test
    fun welcomeRebuildsTheSeededRosterWholesale_PROTOCOL7() {
        val store = GameStore()
        store.seedRoster(listOf(Participant("u1", "", "", Role.HOST, false)))
        val live = Participant("u1", "Ada", "#7F77DD", Role.HOST, true)
        store.receive(welcome(board(participants = listOf(live))))
        assertEquals(listOf(live), store.render.value.participants, "the welcome is the roster's authority")
    }

    @Test
    fun seedRosterIsRefusedAfterTheWelcome_PROTOCOL7() {
        val live = Participant("u1", "Ada", "#7F77DD", Role.HOST, true)
        val (store, _) = makeLiveStore(board(participants = listOf(live)))
        store.seedRoster(listOf(Participant("u1", "", "", Role.HOST, false)))
        assertEquals(
            listOf(live),
            store.render.value.participants,
            "a seed after the welcome cannot demote the live roster to not-yet-heard-from",
        )
    }

    // A solved card seeds the store completed before the socket answers (the seeded-birth rule,
    // DESIGN.md §4, §12). INV-4: completion is terminal, so the seed can only agree with the
    // welcome that confirms it.
    @Test
    fun seedCompletedRetiresTheDeckBeforeTheWelcome_INV4() {
        val store = GameStore()
        assertEquals(SyncState.CONNECTING, store.render.value.sync)
        assertEquals(
            GameStatus.ONGOING,
            store.render.value.status,
            "a fresh store is ongoing until seeded or told otherwise",
        )
        store.seedCompleted("2026-07-08T20:11:47.000Z")
        assertEquals(GameStatus.COMPLETED, store.render.value.status, "a solved card retires the deck pre-welcome")
        assertEquals("2026-07-08T20:11:47.000Z", store.render.value.completedAt, "the frozen clock reads the seed")
    }

    @Test
    fun welcomeConfirmsTheSeededCompletion_PROTOCOL7() {
        val store = GameStore()
        store.seedCompleted("2026-07-08T20:11:47.000Z")
        store.receive(welcome(board(status = GameStatus.COMPLETED)))
        assertEquals(GameStatus.COMPLETED, store.render.value.status, "the welcome confirms the seed")
        assertEquals(SyncState.LIVE, store.render.value.sync)
    }

    @Test
    fun seedCompletedIsRefusedAfterTheWelcome_PROTOCOL7() {
        val (store, _) = makeLiveStore() // welcome lands ongoing
        assertEquals(GameStatus.ONGOING, store.render.value.status)
        store.seedCompleted("2026-07-08T20:11:47.000Z")
        assertEquals(
            GameStatus.ONGOING,
            store.render.value.status,
            "a seed after the welcome cannot freeze a live room",
        )
        assertNull(store.render.value.completedAt)
    }

    // A host-ended card seeds the store abandoned before the socket answers, the terminal twin of
    // seedCompleted (the seeded-birth rule, DESIGN.md §4, §12). INV-4: abandonment is terminal, so
    // the seed can only agree with the welcome that confirms it.
    @Test
    fun seedAbandonedRetiresTheDeckBeforeTheWelcome_INV4() {
        val store = GameStore()
        assertEquals(SyncState.CONNECTING, store.render.value.sync)
        assertEquals(
            GameStatus.ONGOING,
            store.render.value.status,
            "a fresh store is ongoing until seeded or told otherwise",
        )
        store.seedAbandoned("2026-07-07T18:52:00.000Z")
        assertEquals(GameStatus.ABANDONED, store.render.value.status, "a host-ended card retires the deck pre-welcome")
        assertEquals("2026-07-07T18:52:00.000Z", store.render.value.abandonedAt, "the frozen clock reads the seed")
    }

    @Test
    fun welcomeConfirmsTheSeededAbandonment_PROTOCOL7() {
        val store = GameStore()
        store.seedAbandoned("2026-07-07T18:52:00.000Z")
        store.receive(welcome(board(status = GameStatus.ABANDONED)))
        assertEquals(GameStatus.ABANDONED, store.render.value.status, "the welcome confirms the seed")
        assertEquals(SyncState.LIVE, store.render.value.sync)
    }

    @Test
    fun seedAbandonedIsRefusedAfterTheWelcome_PROTOCOL7() {
        val (store, _) = makeLiveStore() // welcome lands ongoing
        assertEquals(GameStatus.ONGOING, store.render.value.status)
        store.seedAbandoned("2026-07-07T18:52:00.000Z")
        assertEquals(
            GameStatus.ONGOING,
            store.render.value.status,
            "a seed after the welcome cannot freeze a live room",
        )
        assertNull(store.render.value.abandonedAt)
    }

    @Test
    fun cursorNoticeUpdatesRenderOnlyPresence_PROTOCOL9() {
        val (store, _) = makeLiveStore()
        store.receive(ServerMessage.Cursor(CursorMessage("u2", 17, Direction.ACROSS)))
        assertEquals(Cursor("u2", 17, Direction.ACROSS), store.render.value.cursors["u2"])
        assertEquals(0, store.render.value.seq, "cursors carry no seq and mutate no durable state")
    }

    @Test
    fun moveCursorEmitsAnEphemeralFrameWithoutAnOverlayEntry_PROTOCOL9() {
        val (store, _) = makeLiveStore()
        store.moveCursor(4, Direction.DOWN)
        assertEquals(listOf<ClientMessage>(ClientMessage.MoveCursor(MoveCursorMessage(4, Direction.DOWN))), store.outbox)
        assertTrue(store.render.value.overlay.isEmpty())
    }

    @Test
    fun heartbeatEmitsThroughTheSingleOutboundPath_PROTOCOL9() {
        val (store, _) = makeLiveStore()
        store.heartbeat()
        assertEquals(listOf<ClientMessage>(ClientMessage.Heartbeat(HeartbeatMessage())), store.outbox)
    }

    // --- Non-fatal errors surface (PROTOCOL.md §8) ---

    @Test
    fun nonFatalErrorSurfacesTheRejectionAndClearsItsOverlayEntry_INV10() {
        val (store, _) = makeLiveStore()
        store.placeLetter(0, "A", "c1")
        val rejection = ErrorMessage(ErrorCode.RATE_LIMITED, "slow down", false, "c1")
        store.receive(ServerMessage.Error(rejection))
        assertTrue(store.render.value.overlay.isEmpty())
        assertEquals(rejection, store.render.value.lastRejection)
    }

    // --- The derived timer origin (D15; PROTOCOL.md §6): delta path ---

    @Test
    fun firstFillDeltaStartsTheTimerWithoutWaitingForASnapshot_D15() {
        val (store, _) = makeLiveStore()
        assertNull(store.render.value.firstFillAt)
        store.receive(cellSet(seq = 1, cell = 0, value = "A", firstFillAt = "2026-07-07T19:02:11Z"))
        assertEquals("2026-07-07T19:02:11Z", store.render.value.firstFillAt)
    }

    // --- Filled count for the born-live island frame (PROTOCOL.md §12a) ---

    @Test
    fun filledCountIsZeroOnAFreshStore_PROTOCOL12a() {
        assertEquals(0, GameStore().render.value.filledCount)
    }

    @Test
    fun filledCountMatchesTheServersNonNullValueRule_PROTOCOL12a() {
        val cells = MutableList(20) { Cell(null, null) }
        cells[0] = Cell("A", "me")
        cells[3] = Cell("B", "u-other")
        cells[7] = Cell("C", "me")
        val (store, _) = makeLiveStore(board(cells = cells))
        assertEquals(3, store.render.value.filledCount)
    }

    @Test
    fun filledCountExcludesClearedCells_PROTOCOL12a() {
        val cells = MutableList(20) { Cell(null, null) }
        cells[0] = Cell("A", "me")
        cells[3] = Cell(null, "me") // cleared: has a writer, no value
        val (store, _) = makeLiveStore(board(cells = cells))
        assertEquals(1, store.render.value.filledCount, "a cleared cell holds a writer but no value: not filled")
    }

    @Test
    fun filledCountCountsConfirmedStateNotTheOptimisticOverlay_INV10() {
        val (store, _) = makeLiveStore()
        store.placeLetter(0, "A", "c1")
        assertEquals(0, store.render.value.filledCount, "a pending overlay entry is not confirmed fill")
        store.receive(cellSet(seq = 1, cell = 0, value = "A", by = "me", commandId = "c1"))
        assertEquals(1, store.render.value.filledCount, "the server echo confirms the fill")
    }

    @Test
    fun filledCountTracksLiveDeltasAndErases_PROTOCOL12a() {
        val (store, _) = makeLiveStore()
        store.receive(cellSet(seq = 1, cell = 0, value = "A", firstFillAt = "2026-07-07T19:02:11Z"))
        store.receive(cellSet(seq = 2, cell = 1, value = "B"))
        assertEquals(2, store.render.value.filledCount)
        store.receive(cellSet(seq = 3, cell = 0, value = null))
        assertEquals(1, store.render.value.filledCount, "an erase drops the value: no longer filled")
    }

    // --- The mailbox (AD-1): one consumption loop, one ordered outbound pump ---

    // advanceUntilIdle is the test-dispatcher clock (ExperimentalCoroutinesApi): the mailbox's
    // pump child runs cooperatively, so idling the scheduler is the deterministic "let it run".
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun mailboxAppliesInboundInOrderAndForwardsEmissionsFIFO_AD1_PROTOCOL7() = runTest {
        val transport = RecordingTransport()
        val store = GameStore()
        val run = launch { store.run(transport) }

        transport.deliver(welcome(board(seq = 12)))
        advanceUntilIdle()
        assertEquals(SyncState.LIVE, store.render.value.sync)

        // A local intent interleaves with event application in the one total order.
        store.placeLetter(0, "A", "c1")
        advanceUntilIdle()
        assertEquals(1, transport.sent.size, "intent frame forwarded")

        // A gap makes the store emit requestSync; the pump forwards it after c1.
        transport.deliver(cellSet(seq = 15, cell = 1, value = "B"))
        advanceUntilIdle()
        assertEquals(
            listOf<ClientMessage>(
                ClientMessage.PlaceLetter(PlaceLetterMessage("c1", 0, "A")),
                ClientMessage.RequestSync(RequestSyncMessage()),
            ),
            transport.sent,
            "outbound frames leave in emission order through the single pump",
        )
        assertEquals(SyncState.RESYNCING, store.render.value.sync)

        // The inbound flow completing IS the transport drop (Ports.kt): the mailbox turns it
        // into reconnecting and returns.
        transport.finish()
        advanceUntilIdle()
        run.join()
        assertEquals(SyncState.RECONNECTING, store.render.value.sync)
        assertEquals(
            listOf(PendingCommand("c1", 0, "A")),
            store.render.value.overlay,
            "the overlay survives the drop for the reconnect re-send (INV-10)",
        )
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun mailboxForwardsReconciliationResendsAfterASyncSnapshot_INV10_PROTOCOL8() = runTest {
        val transport = RecordingTransport()
        val store = GameStore(
            seed = GameStore.Seed(
                seq = 20,
                sync = SyncState.RESYNCING,
                overlay = listOf(PendingCommand("c-live", 3, "K")),
            ),
        )
        val run = launch { store.run(transport) }

        transport.deliver(ServerMessage.Sync(SyncMessage(board(seq = 24))))
        advanceUntilIdle()
        assertEquals(
            listOf<ClientMessage>(ClientMessage.PlaceLetter(PlaceLetterMessage("c-live", 3, "K"))),
            transport.sent,
        )
        assertEquals(SyncState.LIVE, store.render.value.sync)

        transport.finish()
        advanceUntilIdle()
        run.join()
    }
}

/**
 * A scripted Transport (Ports.kt): the test yields inbound frames and records what the store's
 * pump sends. Everything runs on the one test dispatcher, so the recording is race-free (the
 * store's single-dispatcher confinement, AAD-2).
 */
private class RecordingTransport : Transport {
    private val channel = Channel<ServerMessage>(Channel.UNLIMITED)
    override val inbound: Flow<ServerMessage> = channel.receiveAsFlow()
    val sent = mutableListOf<ClientMessage>()

    fun deliver(message: ServerMessage) {
        channel.trySend(message)
    }

    fun finish() {
        channel.close()
    }

    override suspend fun connect() {}

    override suspend fun send(message: ClientMessage) {
        sent.add(message)
    }

    override suspend fun close() {}
}
