package crossy.protocol

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Contract snapshots for every WebSocket message (PROTOCOL.md §§2, 4, 5, 6), the Kotlin half of
// packages/protocol/src/codec.test.ts and apps/ios WireSnapshotTests.swift: the fixtures are the
// same PROTOCOL.md examples, so every twin is pinned to the same normative bytes and drift fails
// CI on whichever side moved (D04).

class WireSnapshotTests {
    // --- Handshake (PROTOCOL.md §2) ---

    @Test
    fun helloRoundTripsTheSection2ExampleWithResumeFromSeq() {
        val hello = pinClientFrame(HelloMessage.serializer(), "hello")
        assertEquals(1, hello.protocolVersion)
        assertEquals("<access JWT>", hello.token)
        assertEquals(123, hello.resumeFromSeq)
    }

    @Test
    fun helloWithoutResumeFromSeqStaysAbsentOnReencode() {
        val hello = pinClientFrame(HelloMessage.serializer(), "hello-minimal")
        assertNull(hello.resumeFromSeq)
        val reencoded = ProtocolJson.encodeToString(HelloMessage.serializer(), hello)
        assertFalse(
            ProtocolJson.parseToJsonElement(reencoded).jsonObject.containsKey("resumeFromSeq"),
            "an absent optional must stay off the wire, never become null (§2, §3)",
        )
    }

    @Test
    fun welcomeRoundTripsWithEmbeddedBoardAndSelfKey() {
        // `self` is the one wire key the Swift twin cannot spell; Kotlin names it directly.
        val welcome = pinServerFrame(WelcomeMessage.serializer(), "welcome")
        assertEquals(1, welcome.protocolVersion)
        assertEquals("u1", welcome.self.userId)
        assertEquals(Role.SOLVER, welcome.self.role)
        assertEquals(412, welcome.board.seq)
    }

    // --- Board payload (PROTOCOL.md §4) ---

    @Test
    fun syncRoundTripsTheSection4BoardExample() {
        val sync = pinServerFrame(SyncMessage.serializer(), "sync")
        val board = sync.board
        assertEquals(GameStatus.ONGOING, board.status)
        assertEquals("2026-07-07T19:02:11Z", board.firstFillAt)
        assertNull(board.completedAt)
        assertNull(board.stats)
        assertEquals(listOf("cmd-1", "cmd-2"), board.recentCommandIds)
        // §4 cell attribution: {v:null,by:null} is a black square or never-written cell;
        // {v:null,by:"u2"} is a cell a writer cleared. Both survive the round trip.
        assertEquals(Cell(v = null, by = null), board.cells[1])
        assertEquals(Cell(v = null, by = "u2"), board.cells[2])
        assertEquals(listOf(Cursor(userId = "u1", cell = 17, direction = Direction.ACROSS)), board.cursors)
        // §4/§10: standing room-check marks and the permanent count ride every snapshot, so
        // reconnect and resync heal the marks with no delta replay (D27).
        assertEquals(listOf(0), board.checkedWrongCells)
        assertEquals(1, board.checkCount)
    }

    @Test
    fun syncCompletedBoardCarriesNonNullStats() {
        val sync = pinServerFrame(SyncMessage.serializer(), "sync-completed")
        assertEquals(GameStatus.COMPLETED, sync.board.status)
        assertEquals(
            Stats(solveTimeSeconds = 2272, totalEvents = 899, participantCount = 4, checkCount = 2),
            sync.board.stats,
        )
        assertEquals("2026-07-07T19:40:03Z", sync.board.completedAt)
        // §4/§10: a completed board froze its permanent count into stats.checkCount (D27).
        assertEquals(sync.board.stats?.checkCount, sync.board.checkCount)
        // §4, D29: this fixture predates activeSolveSeconds/sittingCount (a frozen pre-D29 stats
        // row); the lossless round trip above doubles as the absence pin — null decoded, keys kept
        // absent on re-encode, never backfilled.
        assertNull(sync.board.stats?.activeSolveSeconds)
        assertNull(sync.board.stats?.sittingCount)
    }

    // --- Client to server (PROTOCOL.md §5) ---

    @Test
    fun placeLetterRoundTrips() {
        val message = pinClientFrame(PlaceLetterMessage.serializer(), "placeLetter")
        assertEquals(PlaceLetterMessage(commandId = "c1", cell = 17, value = "A"), message)
    }

    @Test
    fun clearCellRoundTrips() {
        val message = pinClientFrame(ClearCellMessage.serializer(), "clearCell")
        assertEquals(ClearCellMessage(commandId = "c2", cell = 17), message)
    }

    @Test
    fun moveCursorRoundTrips() {
        val message = pinClientFrame(MoveCursorMessage.serializer(), "moveCursor")
        assertEquals(MoveCursorMessage(cell = 17, direction = Direction.ACROSS), message)
    }

    @Test
    fun reactRoundTripsTheSection5Example() {
        val message = pinClientFrame(ReactMessage.serializer(), "react")
        assertEquals(ReactMessage(emoji = "🎉", cell = 17), message)
    }

    @Test
    fun checkPuzzleRoundTrips() {
        // §5, §10 (D27): the room-wide check carries only its commandId; the confirmed intent is
        // the command, and the server needs no further ceremony.
        val message = pinClientFrame(CheckPuzzleMessage.serializer(), "checkPuzzle")
        assertEquals(CheckPuzzleMessage(commandId = "c3"), message)
    }

    @Test
    fun heartbeatRoundTrips() {
        pinClientFrame(HeartbeatMessage.serializer(), "heartbeat")
    }

    @Test
    fun requestSyncRoundTrips() {
        pinClientFrame(RequestSyncMessage.serializer(), "requestSync")
    }

    // --- Sequenced events (PROTOCOL.md §6) ---

    @Test
    fun cellSetRoundTripsTheSection6Example() {
        val event = pinServerFrame(CellSetMessage.serializer(), "cellSet")
        assertEquals(413, event.seq)
        assertEquals("A", event.value)
        assertEquals("c1", event.commandId)
        assertNull(event.firstFillAt, "only the first-fill cellSet carries firstFillAt (§6)")
    }

    @Test
    fun cellSetClearKeepsTheExplicitNullValueOnReencode() {
        // A clear is `"value": null`, present on the wire; dropping the key on re-encode would
        // change the frame's meaning. The round trip pins the explicit null.
        val event = pinServerFrame(CellSetMessage.serializer(), "cellSet-clear")
        assertNull(event.value)
        val reencoded = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(CellSetMessage.serializer(), event),
        ).jsonObject
        assertEquals(JsonNull, reencoded["value"])
    }

    @Test
    fun cellSetFirstFillCarriesTheTimerOrigin() {
        val event = pinServerFrame(CellSetMessage.serializer(), "cellSet-firstFill")
        assertEquals("2026-07-07T19:02:11Z", event.firstFillAt)
        assertEquals(event.at, event.firstFillAt, "§6: the same server timestamp")
    }

    @Test
    fun gameCompletedRoundTripsTheSection6Example() {
        val event = pinServerFrame(GameCompletedMessage.serializer(), "gameCompleted")
        assertEquals(900, event.seq)
        // §6 example, D29: the session fills activeSolveSeconds and sittingCount at completion beside
        // the wall-clock solveTimeSeconds; the example's solve was one sitting, so the active seconds
        // equal the wall seconds.
        assertEquals(
            Stats(
                solveTimeSeconds = 2272, totalEvents = 899, participantCount = 4, checkCount = 2,
                activeSolveSeconds = 2272, sittingCount = 1,
            ),
            event.stats,
        )
    }

    @Test
    fun puzzleCheckedRoundTripsTheSection6Example() {
        // §6, §10 (D27): sequenced (an accepted check mutates the standing marks and the permanent
        // count) and deliberately neutral: no `by` ever crosses the wire; the sender recognizes its
        // own commandId echo, which is all a client needs (INV-6).
        val event = pinServerFrame(PuzzleCheckedMessage.serializer(), "puzzleChecked")
        assertEquals(
            PuzzleCheckedMessage(
                seq = 742, wrongCells = listOf(3, 17, 44), checkCount = 2, commandId = "c4",
                at = "2026-07-07T19:31:40Z",
            ),
            event,
        )
    }

    @Test
    fun gameAbandonedRoundTripsTheSection6Example() {
        val event = pinServerFrame(GameAbandonedMessage.serializer(), "gameAbandoned")
        assertEquals(GameAbandonedMessage(seq = 641, at = "2026-07-07T19:41:00Z", by = "u1"), event)
    }

    // --- Ephemeral notices (PROTOCOL.md §6) ---

    @Test
    fun playerConnectedRoundTrips() {
        val notice = pinServerFrame(PlayerConnectedMessage.serializer(), "playerConnected")
        assertEquals(
            PlayerConnectedMessage(userId = "u2", displayName = "Bo", color = "#33AA88", role = Role.SOLVER),
            notice,
        )
    }

    @Test
    fun playerDisconnectedRoundTrips() {
        val notice = pinServerFrame(PlayerDisconnectedMessage.serializer(), "playerDisconnected")
        assertEquals(PlayerDisconnectedMessage(userId = "u2"), notice)
    }

    @Test
    fun cursorRoundTrips() {
        val notice = pinServerFrame(CursorMessage.serializer(), "cursor")
        assertEquals(CursorMessage(userId = "u2", cell = 5, direction = Direction.DOWN), notice)
    }

    @Test
    fun reactionRoundTrips() {
        // §6, §9: the fan-out notice carries the sender, the grapheme, and the cell; the same shape
        // rule the outbound react enforces (receive-any, one rule both directions).
        val notice = pinServerFrame(ReactionMessage.serializer(), "reaction")
        assertEquals(ReactionMessage(userId = "u2", emoji = "🎉", cell = 5), notice)
    }

    @Test
    fun kickedRoundTrips() {
        val notice = pinServerFrame(KickedMessage.serializer(), "kicked")
        assertEquals(KickedMessage(reason = "removed by host"), notice)
    }

    @Test
    fun errorNonFatalCarriesTheOffendingCommandId() {
        // §8/INV-10: the commandId is what lets the client clear the overlay entry.
        val error = pinServerFrame(ErrorMessage.serializer(), "error-nonfatal")
        assertEquals(ErrorCode.INVALID_VALUE, error.code)
        assertFalse(error.fatal)
        assertEquals("c1", error.commandId)
    }

    @Test
    fun errorFatalOmitsCommandIdAndStaysAbsentOnReencode() {
        val error = pinServerFrame(ErrorMessage.serializer(), "error-fatal")
        assertEquals(ErrorCode.PROTOCOL_VERSION_UNSUPPORTED, error.code)
        assertTrue(error.fatal)
        assertNull(error.commandId)
        val reencoded = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(ErrorMessage.serializer(), error),
        ).jsonObject
        assertFalse(reencoded.containsKey("commandId"))
    }

    // --- The §6 split (INV-2) ---

    @Test
    fun sequencedEventsExposeSeqAndEphemeralNoticesDoNot_INV2() {
        // INV-2: `seq` is the total order; the §7 gap check keys on exactly the sequenced
        // messages. ServerMessage.seq is the split as one accessor.
        val sequenced = listOf(
            "cellSet", "cellSet-clear", "cellSet-firstFill", "gameCompleted", "puzzleChecked", "gameAbandoned",
        )
        for (name in sequenced) {
            val message = ProtocolJson.decodeFromString(ServerMessageSerializer, Fixtures.text(FixtureGroup.WIRE, name))
            assertTrue(message.seq != null, "$name is a sequenced event (§6)")
        }
        val ephemeral = listOf(
            "welcome", "sync", "sync-completed", "playerConnected", "playerDisconnected",
            "cursor", "reaction", "kicked", "error-nonfatal", "error-fatal",
        )
        for (name in ephemeral) {
            val message = ProtocolJson.decodeFromString(ServerMessageSerializer, Fixtures.text(FixtureGroup.WIRE, name))
            assertNull(message.seq, "$name is an ephemeral notice (§6)")
        }
    }
}
