// Store behaviors the client-store vectors deliberately leave to the client, mirrored
// from apps/web/src/store/gameStore.test.ts so the two stores cannot drift: the
// conflict-flash trigger (PROTOCOL.md §8: view animation, so the vectors exclude it;
// the store still owns detecting it), the terminal-state freeze, the transport-drop
// transition into reconnecting, the honest `connecting` initial state and its input
// gate, presence application (§9, render-only), and the store-owned reconnect
// decisions (AD-6). The mailbox loop (AD-1) is exercised against a scripted transport.

import CrossyProtocol
import CrossyStore
import XCTest

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class GameStoreTests: XCTestCase {
    // MARK: - Fixtures (the web suite's board/cellSet helpers, twinned)

    private func board(
        seq: Int = 0,
        status: GameStatus = .ongoing,
        firstFillAt: String? = nil,
        cells: [Cell]? = nil,
        participants: [Participant] = [],
        cursors: [Cursor] = [],
        recentCommandIds: [String] = []
    ) -> Board {
        Board(
            seq: seq,
            status: status,
            firstFillAt: firstFillAt,
            completedAt: nil,
            abandonedAt: nil,
            cells: cells ?? Array(repeating: Cell(v: nil, by: nil), count: 20),
            participants: participants,
            cursors: cursors,
            recentCommandIds: recentCommandIds,
            stats: nil)
    }

    private func cellSet(
        seq: Int = 1,
        cell: Int = 0,
        value: String? = "A",
        by: String = "u-other",
        commandId: String = "c-other",
        firstFillAt: String? = nil
    ) -> ServerMessage {
        .cellSet(
            CellSetMessage(
                seq: seq, cell: cell, value: value, by: by, commandId: commandId,
                at: "2026-07-07T00:00:00Z", firstFillAt: firstFillAt))
    }

    private func welcome(_ board: Board, userId: String = "me") -> ServerMessage {
        .welcome(
            WelcomeMessage(
                protocolVersion: 1,
                selfIdentity: WelcomeMessage.SelfIdentity(userId: userId, role: .solver),
                board: board))
    }

    /// A store brought live via a welcome (self is "me"), with flashes recorded.
    private func makeLiveStore(_ welcomeBoard: Board? = nil) -> (GameStore, () -> [ConflictFlash]) {
        let store = GameStore()
        var flashes: [ConflictFlash] = []
        store.onConflictFlash = { flashes.append($0) }
        store.receive(welcome(welcomeBoard ?? board()))
        return (store, { flashes })
    }

    // MARK: - Honest initial connect and the pre-welcome input gate (PROTOCOL.md §7)

    func test_freshStoreStartsConnectingNotReconnecting_PROTOCOL7() {
        let store = GameStore()
        XCTAssertEqual(store.sync, .connecting, "no welcome yet: connecting, not a post-drop state")
    }

    func test_refusesLocalIntentsBeforeTheFirstWelcome_INV10() {
        let store = GameStore()
        store.placeLetter(cell: 0, value: "A")
        store.clearCell(cell: 0)
        store.moveCursor(cell: 0, direction: .across)
        store.heartbeat()
        XCTAssertTrue(store.overlay.isEmpty, "no overlay entry against a board that does not exist")
        XCTAssertTrue(store.outbox.isEmpty, "nothing reaches the wire before authoritative state")
    }

    func test_firstWelcomeUnlocksInputAndGoesLive_PROTOCOL7() {
        let (store, _) = makeLiveStore()
        XCTAssertEqual(store.sync, .live)
        XCTAssertEqual(store.selfUserId, "me")
        store.placeLetter(cell: 0, value: "A", commandId: "c1")
        XCTAssertEqual(store.overlay.count, 1)
        XCTAssertEqual(
            store.outbox,
            [.placeLetter(PlaceLetterMessage(commandId: "c1", cell: 0, value: "A"))])
    }

    // MARK: - Terminal states freeze mutation locally (INV-4 scope)

    func test_refusesPlaceLetterAfterCompleted_INV4() {
        let (store, _) = makeLiveStore(board(status: .completed))
        store.placeLetter(cell: 0, value: "A")
        XCTAssertTrue(store.overlay.isEmpty)
        XCTAssertTrue(store.outbox.isEmpty)
    }

    func test_refusesClearCellAfterAbandoned_INV4() {
        let (store, _) = makeLiveStore(board(status: .abandoned))
        store.clearCell(cell: 0)
        XCTAssertTrue(store.overlay.isEmpty)
        XCTAssertTrue(store.outbox.isEmpty)
    }

    func test_inOrderGameCompletedFreezesMutationAndAppliesStats_INV4() {
        let (store, _) = makeLiveStore(board(seq: 5))
        let stats = Stats(solveTimeSeconds: 2272, totalEvents: 5, participantCount: 2)
        store.receive(
            .gameCompleted(GameCompletedMessage(seq: 6, at: "2026-07-07T19:40:03Z", stats: stats)))
        XCTAssertEqual(store.status, .completed)
        XCTAssertEqual(store.seq, 6)
        XCTAssertEqual(store.completedAt, "2026-07-07T19:40:03Z")
        XCTAssertEqual(store.stats, stats)
        store.placeLetter(cell: 0, value: "A")
        XCTAssertTrue(store.overlay.isEmpty, "a terminal board refuses mutation locally")
    }

    func test_inOrderGameAbandonedFreezesMutation_INV4() {
        let (store, _) = makeLiveStore(board(seq: 5))
        store.receive(
            .gameAbandoned(GameAbandonedMessage(seq: 6, at: "2026-07-07T19:40:03Z", by: "host")))
        XCTAssertEqual(store.status, .abandoned)
        XCTAssertEqual(store.abandonedAt, "2026-07-07T19:40:03Z")
        store.clearCell(cell: 0)
        XCTAssertTrue(store.overlay.isEmpty)
    }

    // MARK: - The kicked notice surfaces to the composition root (PROTOCOL.md §6)

    func test_kickedNoticeSurfacesToTheRootAndTouchesNoSequencedState_PROTOCOL6() {
        let (store, _) = makeLiveStore(board(seq: 5))
        var kicks: [KickedMessage] = []
        store.onKicked = { kicks.append($0) }
        store.receive(.kicked(KickedMessage(reason: "removed by host")))
        // The notice carries no seq: it hands off to the root's terminal flag and
        // moves nothing sequenced (PROTOCOL.md §6, close 1008 follows).
        XCTAssertEqual(kicks, [KickedMessage(reason: "removed by host")])
        XCTAssertEqual(store.seq, 5)
        XCTAssertEqual(store.status, .ongoing)
    }

    // MARK: - Connection loss and store-owned reconnect decisions (PROTOCOL.md §7; AD-6)

    func test_transportDropGoesReconnectingAndPreservesOverlayForResend_PROTOCOL7_INV10() {
        let (store, _) = makeLiveStore()
        store.placeLetter(cell: 3, value: "K", commandId: "c-live")
        store.connectionLost()
        XCTAssertEqual(store.sync, .reconnecting)
        XCTAssertEqual(
            store.overlay, [PendingCommand(commandId: "c-live", cell: 3, value: "K")],
            "the overlay must survive the drop so snapshot reconciliation can re-send it")
    }

    func test_storeOwnsTheReconnectWalkAdapterOnlySleepsAndDials_AD6_PROTOCOL7() {
        let store = GameStore(backoff: BackoffSchedule(random: { 1.0 }))
        XCTAssertEqual(store.nextReconnectDelaySeconds(), 0)
        XCTAssertEqual(store.nextReconnectDelaySeconds(), 1)
        XCTAssertEqual(store.nextReconnectDelaySeconds(), 2)
        store.connectionSurvived(seconds: 29)
        XCTAssertEqual(store.nextReconnectDelaySeconds(), 4, "a short life does not reset the walk")
        store.connectionSurvived(seconds: 31)
        XCTAssertEqual(store.nextReconnectDelaySeconds(), 0, "a 30 s survival resets the walk")
    }

    func test_resyncingIgnoresSequencedEventsUntilTheSnapshotLands_PROTOCOL7() {
        let (store, _) = makeLiveStore(board(seq: 12))
        store.receive(cellSet(seq: 15, cell: 1, value: "B"))  // gap
        XCTAssertEqual(store.sync, .resyncing)
        XCTAssertEqual(store.outbox, [.requestSync(RequestSyncMessage())])
        // Even a would-be in-order event is ignored while awaiting the snapshot.
        store.receive(cellSet(seq: 13, cell: 2, value: "C"))
        XCTAssertEqual(store.seq, 12)
        XCTAssertNil(store.renderValue(2))
        // The snapshot restores order and goes live.
        store.receive(.sync(SyncMessage(board: board(seq: 16))))
        XCTAssertEqual(store.sync, .live)
        XCTAssertEqual(store.seq, 16)
    }

    // MARK: - INV-1: ASCII-only normalization before sending

    func test_placeLetterUppercasesAsciiOnlyBeforeSending_INV1() {
        let (store, _) = makeLiveStore()
        store.placeLetter(cell: 0, value: "a", commandId: "c1")
        // Turkish dotless i is not ASCII a-z: it must pass through unchanged, never
        // locale-fold (the INV-1 trap).
        store.placeLetter(cell: 1, value: "\u{131}", commandId: "c2")
        XCTAssertEqual(
            store.outbox,
            [
                .placeLetter(PlaceLetterMessage(commandId: "c1", cell: 0, value: "A")),
                .placeLetter(PlaceLetterMessage(commandId: "c2", cell: 1, value: "\u{131}")),
            ])
        XCTAssertEqual(store.renderValue(0), "A", "the overlay renders the normalized value")
    }

    // MARK: - Conflict flash trigger (PROTOCOL.md §8, D02): store detects, view animates

    func test_flashesWhenAnotherUsersCellSetChangesANonNullValueYouRender_D02() {
        var cells = Array(repeating: Cell(v: nil, by: nil), count: 20)
        cells[0] = Cell(v: "A", by: "me")
        let (store, flashes) = makeLiveStore(board(cells: cells))
        store.receive(cellSet(seq: 1, cell: 0, value: "B", by: "u-other"))
        XCTAssertEqual(flashes(), [ConflictFlash(cell: 0, by: "u-other")])
    }

    func test_flashesOnAnEraseOfYourRenderedLetterNeverSilent_D02() {
        var cells = Array(repeating: Cell(v: nil, by: nil), count: 20)
        cells[0] = Cell(v: "A", by: "me")
        let (store, flashes) = makeLiveStore(board(cells: cells))
        store.receive(cellSet(seq: 1, cell: 0, value: nil, by: "u-other"))
        XCTAssertEqual(flashes(), [ConflictFlash(cell: 0, by: "u-other")])
        XCTAssertNil(store.renderValue(0), "the erase applied; it flashed instead of hiding")
    }

    func test_doesNotFlashWhenAnotherUserFillsACellYouRenderAsEmpty_D02() {
        let (store, flashes) = makeLiveStore()
        store.receive(cellSet(seq: 1, cell: 0, value: "Z", by: "u-other"))
        XCTAssertTrue(flashes().isEmpty)
    }

    func test_doesNotFlashOnYourOwnEcho_commandIdMatchClearsOverlayInstead_D02_INV10() {
        let (store, flashes) = makeLiveStore()
        store.placeLetter(cell: 0, value: "A", commandId: "c1")
        store.receive(cellSet(seq: 1, cell: 0, value: "A", by: "me", commandId: "c1"))
        XCTAssertTrue(flashes().isEmpty)
        XCTAssertTrue(store.overlay.isEmpty, "the echo cleared the overlay entry")
    }

    func test_doesNotFlashWhenAPendingOverlayEntryMasksTheChange_D02_INV10() {
        let (store, flashes) = makeLiveStore()
        store.placeLetter(cell: 0, value: "C", commandId: "c-mine")
        // Another user's event lands under my still-pending entry: the rendered
        // composite does not change, so no flash.
        store.receive(cellSet(seq: 1, cell: 0, value: "B", by: "u-other", commandId: "c-other"))
        XCTAssertTrue(flashes().isEmpty)
        XCTAssertEqual(store.renderValue(0), "C")
    }

    // MARK: - Presence: render-only, never sequenced (PROTOCOL.md §9)

    func test_playerConnectedUpsertsTheParticipant_PROTOCOL9() {
        let (store, _) = makeLiveStore()
        let joined = PlayerConnectedMessage(
            userId: "u2", displayName: "Ana", color: "#7F77DD", role: .solver)
        store.receive(.playerConnected(joined))
        store.receive(.playerConnected(joined))  // reconnect: upsert, not duplicate
        XCTAssertEqual(store.participants.count, 1)
        XCTAssertEqual(store.participants.first?.userId, "u2")
        XCTAssertEqual(store.participants.first?.connected, true)
        XCTAssertEqual(store.seq, 0, "presence is never sequenced")
    }

    func test_playerDisconnectedMarksDisconnectedAndDropsTheCursor_PROTOCOL9() {
        let participant = Participant(
            userId: "u2", displayName: "Ana", color: "#7F77DD", role: .solver, connected: true)
        let cursor = Cursor(userId: "u2", cell: 7, direction: .down)
        let (store, _) = makeLiveStore(board(participants: [participant], cursors: [cursor]))
        XCTAssertEqual(store.cursors["u2"], cursor)
        store.receive(.playerDisconnected(PlayerDisconnectedMessage(userId: "u2")))
        XCTAssertEqual(store.participants.first?.connected, false)
        XCTAssertNil(store.cursors["u2"], "a departed player's cursor never lingers")
    }

    func test_removeParticipantDropsTheRosterRowAndCursorNotJustGreysIt_PROTOCOL12() {
        let host = Participant(
            userId: "u1", displayName: "Host", color: "#7F77DD", role: .host, connected: true)
        let target = Participant(
            userId: "u2", displayName: "Ana", color: "#77DD9A", role: .solver, connected: true)
        let cursor = Cursor(userId: "u2", cell: 7, direction: .down)
        let (store, _) = makeLiveStore(
            board(participants: [host, target], cursors: [cursor]))
        // A confirmed host kick removes the row outright, unlike a disconnect which
        // only greys it: the kicked member is no longer a member (PROTOCOL.md §12).
        store.removeParticipant(userId: "u2")
        XCTAssertEqual(store.participants.map(\.userId), ["u1"])
        XCTAssertNil(store.cursors["u2"], "the kicked member's cursor never lingers")
        XCTAssertEqual(store.seq, 0, "presence is never sequenced")
    }

    func test_removeParticipantIsIdempotentForAnUnknownUser_PROTOCOL12() {
        let host = Participant(
            userId: "u1", displayName: "Host", color: "#7F77DD", role: .host, connected: true)
        let (store, _) = makeLiveStore(board(participants: [host]))
        store.removeParticipant(userId: "ghost")
        XCTAssertEqual(store.participants.map(\.userId), ["u1"])
    }

    // MARK: - Seeding the pre-welcome roster (the players pill's first frame; §4, §9)

    // The REST roster seeds the pill at its true count before the first frame, so the
    // players pill never renders a lone placeholder puck that snaps wide when the
    // welcome lands (owner device finding 2026-07-11). The seed is the ROSTER, not
    // presence: each member holds the not-yet-heard-from liveness the welcome already
    // speaks (connected: false), no new state invented (PROTOCOL.md §9).
    func test_seedRosterSetsTheRosterNotYetHeardFromBeforeTheWelcome_PROTOCOL9() {
        let store = GameStore()
        XCTAssertEqual(store.sync, .connecting)
        store.seedRoster([
            Participant(userId: "u1", displayName: "", color: "", role: .host, connected: false),
            Participant(userId: "u2", displayName: "", color: "", role: .solver, connected: false),
        ])
        XCTAssertEqual(store.participants.map(\.userId), ["u1", "u2"])
        XCTAssertEqual(
            store.participants.map(\.connected), [false, false],
            "REST members are the roster, not presence: liveness is the socket's to report")
    }

    // The welcome stays the authority: it rebuilds participants wholesale with the real
    // displayName, color, and true liveness, overwriting the blank seed (PROTOCOL.md §7).
    func test_welcomeRebuildsTheSeededRosterWholesale_PROTOCOL7() {
        let store = GameStore()
        store.seedRoster([
            Participant(userId: "u1", displayName: "", color: "", role: .host, connected: false)
        ])
        let live = Participant(
            userId: "u1", displayName: "Ada", color: "#7F77DD", role: .host, connected: true)
        store.receive(welcome(board(participants: [live])))
        XCTAssertEqual(store.participants, [live], "the welcome is the roster's authority")
    }

    // The seed is a pre-handshake courtesy only: once a live roster exists (past the
    // welcome), a stray re-seed can never overwrite real presence with connected:false.
    func test_seedRosterIsRefusedAfterTheWelcome_PROTOCOL7() {
        let live = Participant(
            userId: "u1", displayName: "Ada", color: "#7F77DD", role: .host, connected: true)
        let (store, _) = makeLiveStore(board(participants: [live]))
        store.seedRoster([
            Participant(userId: "u1", displayName: "", color: "", role: .host, connected: false)
        ])
        XCTAssertEqual(
            store.participants, [live],
            "a seed after the welcome cannot demote the live roster to not-yet-heard-from")
    }

    // A solved card seeds the store completed before the socket answers (the seeded-birth
    // rule, DESIGN.md §4, §12), so the key deck retires from the first frame rather than
    // flashing for the connect beat. INV-4: completion is terminal, so the seed can only
    // agree with the welcome that confirms it.
    func test_seedCompletedRetiresTheDeckBeforeTheWelcome_INV4() {
        let store = GameStore()
        XCTAssertEqual(store.sync, .connecting)
        XCTAssertEqual(store.status, .ongoing, "a fresh store is ongoing until seeded or told otherwise")
        store.seedCompleted(at: "2026-07-08T20:11:47.000Z")
        XCTAssertEqual(store.status, .completed, "a solved card retires the deck pre-welcome")
        XCTAssertEqual(store.completedAt, "2026-07-08T20:11:47.000Z", "the frozen clock reads the seed")
        // No live ongoing board was ever observed, so nothing here can arm a celebration
        // (CelebrationGate) or a pour-back (TerminalPourBackGate); those are the view's to
        // derive, and both require an ongoing-live observation a welcome-into-completed
        // never exposes. The store only carries the terminal status forward.
    }

    // The welcome stays the authority (PROTOCOL.md §7): a completed welcome confirms the
    // seed, and the snapshot's completedAt overwrites the seeded one wholesale.
    func test_welcomeConfirmsTheSeededCompletion_PROTOCOL7() {
        let store = GameStore()
        store.seedCompleted(at: "2026-07-08T20:11:47.000Z")
        store.receive(welcome(board(status: .completed)))
        XCTAssertEqual(store.status, .completed, "the welcome confirms the seed")
        XCTAssertEqual(store.sync, .live)
    }

    // The seed is a pre-handshake courtesy only, gated to connecting exactly like
    // seedRoster: a stray seedCompleted after the welcome can never freeze a live room.
    func test_seedCompletedIsRefusedAfterTheWelcome_PROTOCOL7() {
        let (store, _) = makeLiveStore()  // welcome lands ongoing
        XCTAssertEqual(store.status, .ongoing)
        store.seedCompleted(at: "2026-07-08T20:11:47.000Z")
        XCTAssertEqual(store.status, .ongoing, "a seed after the welcome cannot freeze a live room")
        XCTAssertNil(store.completedAt)
    }

    // A host-ended card seeds the store abandoned before the socket answers, the terminal
    // twin of seedCompleted (the seeded-birth rule, DESIGN.md §4, §12), so the key deck
    // retires from the first frame rather than flashing for the connect beat. INV-4:
    // abandonment is terminal, so the seed can only agree with the welcome that confirms it.
    func test_seedAbandonedRetiresTheDeckBeforeTheWelcome_INV4() {
        let store = GameStore()
        XCTAssertEqual(store.sync, .connecting)
        XCTAssertEqual(store.status, .ongoing, "a fresh store is ongoing until seeded or told otherwise")
        store.seedAbandoned(at: "2026-07-07T18:52:00.000Z")
        XCTAssertEqual(store.status, .abandoned, "a host-ended card retires the deck pre-welcome")
        XCTAssertEqual(store.abandonedAt, "2026-07-07T18:52:00.000Z", "the frozen clock reads the seed")
        XCTAssertNil(store.completedAt, "an abandoned seed never sets completion (the two are exclusive)")
    }

    // The welcome stays the authority (PROTOCOL.md §7): an abandoned welcome confirms the
    // seed, and the snapshot overwrites the seeded status wholesale.
    func test_welcomeConfirmsTheSeededAbandonment_PROTOCOL7() {
        let store = GameStore()
        store.seedAbandoned(at: "2026-07-07T18:52:00.000Z")
        store.receive(welcome(board(status: .abandoned)))
        XCTAssertEqual(store.status, .abandoned, "the welcome confirms the seed")
        XCTAssertEqual(store.sync, .live)
    }

    // The seed is a pre-handshake courtesy only, gated to connecting exactly like
    // seedCompleted: a stray seedAbandoned after the welcome can never freeze a live room.
    func test_seedAbandonedIsRefusedAfterTheWelcome_PROTOCOL7() {
        let (store, _) = makeLiveStore()  // welcome lands ongoing
        XCTAssertEqual(store.status, .ongoing)
        store.seedAbandoned(at: "2026-07-07T18:52:00.000Z")
        XCTAssertEqual(store.status, .ongoing, "a seed after the welcome cannot freeze a live room")
        XCTAssertNil(store.abandonedAt)
    }

    func test_cursorNoticeUpdatesRenderOnlyPresence_PROTOCOL9() {
        let (store, _) = makeLiveStore()
        store.receive(.cursor(CursorMessage(userId: "u2", cell: 17, direction: .across)))
        XCTAssertEqual(store.cursors["u2"], Cursor(userId: "u2", cell: 17, direction: .across))
        XCTAssertEqual(store.seq, 0, "cursors carry no seq and mutate no durable state")
    }

    func test_moveCursorEmitsAnEphemeralFrameWithoutAnOverlayEntry_PROTOCOL9() {
        let (store, _) = makeLiveStore()
        store.moveCursor(cell: 4, direction: .down)
        XCTAssertEqual(store.outbox, [.moveCursor(MoveCursorMessage(cell: 4, direction: .down))])
        XCTAssertTrue(store.overlay.isEmpty)
    }

    func test_heartbeatEmitsThroughTheSingleOutboundPath_PROTOCOL9() {
        let (store, _) = makeLiveStore()
        store.heartbeat()
        XCTAssertEqual(store.outbox, [.heartbeat(HeartbeatMessage())])
    }

    // MARK: - Non-fatal errors surface (PROTOCOL.md §8)

    func test_nonFatalErrorSurfacesTheRejectionAndClearsItsOverlayEntry_INV10() {
        let (store, _) = makeLiveStore()
        store.placeLetter(cell: 0, value: "A", commandId: "c1")
        let rejection = ErrorMessage(
            code: .rateLimited, message: "slow down", fatal: false, commandId: "c1")
        store.receive(.error(rejection))
        XCTAssertTrue(store.overlay.isEmpty)
        XCTAssertEqual(store.lastRejection, rejection)
    }

    // MARK: - The derived timer origin (D15; PROTOCOL.md §6): delta path

    func test_firstFillDeltaStartsTheTimerWithoutWaitingForASnapshot_D15() {
        let (store, _) = makeLiveStore()
        XCTAssertNil(store.firstFillAt)
        store.receive(cellSet(seq: 1, cell: 0, value: "A", firstFillAt: "2026-07-07T19:02:11Z"))
        XCTAssertEqual(store.firstFillAt, "2026-07-07T19:02:11Z")
    }

    // MARK: - Filled count for the born-live island frame (PROTOCOL.md §12a)

    /// A fresh store carries nothing, so no fill: the born-live frame reads 0 filled, the
    /// same floor the server's empty board reports.
    func test_filledCountIsZeroOnAFreshStore_PROTOCOL12a() {
        XCTAssertEqual(GameStore().filledCount, 0)
    }

    /// Filled counts one cell per non-nil value from the snapshot: exactly the server's
    /// filledCount rule (apps/session/src/hydrate.ts, `v !== null`), so the island's first
    /// frame and the emitter's first push agree on how full the grid is.
    func test_filledCountMatchesTheServersNonNullValueRule_PROTOCOL12a() {
        var cells = Array(repeating: Cell(v: nil, by: nil), count: 20)
        cells[0] = Cell(v: "A", by: "me")
        cells[3] = Cell(v: "B", by: "u-other")
        cells[7] = Cell(v: "C", by: "me")
        let (store, _) = makeLiveStore(board(cells: cells))
        XCTAssertEqual(store.filledCount, 3)
    }

    /// A cleared cell keeps its clearer as `by` with `v:nil` (PROTOCOL.md §4, §6) and does
    /// NOT count as filled, matching the server (a cell counts only when `v !== null`), so a
    /// clear lowers the born-live count exactly as it lowers the pushed one.
    func test_filledCountExcludesClearedCells_PROTOCOL12a() {
        var cells = Array(repeating: Cell(v: nil, by: nil), count: 20)
        cells[0] = Cell(v: "A", by: "me")
        cells[3] = Cell(v: nil, by: "me")  // cleared: has a writer, no value
        let (store, _) = makeLiveStore(board(cells: cells))
        XCTAssertEqual(store.filledCount, 1, "a cleared cell holds a writer but no value: not filled")
    }

    /// The optimistic overlay is a render concern (INV-10); the born-live frame carries
    /// CONFIRMED progress, so a pending place does not inflate the count until the server's
    /// echo lands as sequenced state.
    func test_filledCountCountsConfirmedStateNotTheOptimisticOverlay_INV10() {
        let (store, _) = makeLiveStore()
        store.placeLetter(cell: 0, value: "A", commandId: "c1")
        XCTAssertEqual(store.filledCount, 0, "a pending overlay entry is not confirmed fill")
        store.receive(
            cellSet(seq: 1, cell: 0, value: "A", by: "me", commandId: "c1"))
        XCTAssertEqual(store.filledCount, 1, "the server echo confirms the fill")
    }

    /// A live delta raises the count and a delta erase lowers it, tracking sequenced state
    /// cell by cell so the born-live frame is always the room's real progress at request time.
    func test_filledCountTracksLiveDeltasAndErases_PROTOCOL12a() {
        let (store, _) = makeLiveStore()
        store.receive(cellSet(seq: 1, cell: 0, value: "A", firstFillAt: "2026-07-07T19:02:11Z"))
        store.receive(cellSet(seq: 2, cell: 1, value: "B"))
        XCTAssertEqual(store.filledCount, 2)
        store.receive(cellSet(seq: 3, cell: 0, value: nil))
        XCTAssertEqual(store.filledCount, 1, "an erase drops the value: no longer filled")
    }

    // MARK: - The mailbox (AD-1): one consumption loop, one ordered outbound pump

    func test_mailboxAppliesInboundInOrderAndForwardsEmissionsFIFO_AD1_PROTOCOL7() async throws {
        let transport = RecordingTransport()
        let store = GameStore()
        let run = Task { await store.run(transport) }

        transport.deliver(welcome(board(seq: 12)))
        try await waitUntil("store goes live") { store.sync == .live }

        // A local intent interleaves with event application in the one total order.
        store.placeLetter(cell: 0, value: "A", commandId: "c1")
        try await waitUntil("intent frame forwarded") { await transport.sentCount == 1 }

        // A gap makes the store emit requestSync; the pump forwards it after c1.
        transport.deliver(cellSet(seq: 15, cell: 1, value: "B"))
        try await waitUntil("requestSync forwarded") { await transport.sentCount == 2 }
        let sent = await transport.sent
        XCTAssertEqual(
            sent,
            [
                .placeLetter(PlaceLetterMessage(commandId: "c1", cell: 0, value: "A")),
                .requestSync(RequestSyncMessage()),
            ],
            "outbound frames leave in emission order through the single pump")
        XCTAssertEqual(store.sync, .resyncing)

        // The inbound stream finishing IS the transport drop (Ports.swift): the
        // mailbox turns it into reconnecting and returns.
        transport.finish()
        await run.value
        XCTAssertEqual(store.sync, .reconnecting)
        XCTAssertEqual(
            store.overlay, [PendingCommand(commandId: "c1", cell: 0, value: "A")],
            "the overlay survives the drop for the reconnect re-send (INV-10)")
    }

    func test_mailboxForwardsReconciliationResendsAfterASyncSnapshot_INV10_PROTOCOL8() async throws {
        let transport = RecordingTransport()
        let store = GameStore(
            seed: GameStore.Seed(
                seq: 20, sync: .resyncing,
                overlay: [PendingCommand(commandId: "c-live", cell: 3, value: "K")]))
        let run = Task { await store.run(transport) }

        transport.deliver(.sync(SyncMessage(board: board(seq: 24))))
        try await waitUntil("re-send forwarded") { await transport.sentCount == 1 }
        let sent = await transport.sent
        XCTAssertEqual(
            sent, [.placeLetter(PlaceLetterMessage(commandId: "c-live", cell: 3, value: "K"))])
        XCTAssertEqual(store.sync, .live)

        transport.finish()
        await run.value
    }

    /// Cooperatively wait for a condition driven by the mailbox's own tasks. All the
    /// moving parts share the main actor, so yielding lets them run; the bound only
    /// exists to fail loudly instead of hanging.
    private func waitUntil(
        _ what: String,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ condition: () async -> Bool
    ) async throws {
        for _ in 0..<10_000 {
            if await condition() { return }
            await Task.yield()
        }
        XCTFail("timed out waiting until \(what)", file: file, line: line)
    }
}

/// A scripted Transport (Ports.swift): the test yields inbound frames and records what
/// the store's pump sends. An actor, so the recording is data-race free under Swift 6.
@available(iOS 17.0, macOS 14.0, *)
private actor RecordingTransport: Transport {
    nonisolated let inbound: AsyncStream<ServerMessage>
    private nonisolated let continuation: AsyncStream<ServerMessage>.Continuation
    private(set) var sent: [ClientMessage] = []

    var sentCount: Int { sent.count }

    init() {
        let (stream, continuation) = AsyncStream<ServerMessage>.makeStream()
        self.inbound = stream
        self.continuation = continuation
    }

    nonisolated func deliver(_ message: ServerMessage) {
        continuation.yield(message)
    }

    nonisolated func finish() {
        continuation.finish()
    }

    func connect() async throws {}

    func send(_ message: ClientMessage) async {
        sent.append(message)
    }

    func close() async {}
}
