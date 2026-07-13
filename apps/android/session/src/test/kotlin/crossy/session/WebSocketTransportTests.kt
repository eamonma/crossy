// The OkHttp WebSocket transport against a real in-process socket (MockWebServer). The Swift twin
// scripts a fake socket behind a seam; here the round trip is genuine, which is what the task's
// "unit tests with MockWebServer" asks for. Pins the PROTOCOL.md §2 handshake ordering, §3
// ignore-and-log for unknown types (via the codec's WireDecodingException.UnknownType), §11
// drop-and-log for malformed frames, the §7 drop signal (the inbound flow completing), and
// best-effort send, all against the same wire fixtures the codec twins pin
// (:protocol test resources, read from the source tree).
//
// Teardown discipline (StackServer.shutdown() otherwise stalls on a lingering socket): every case
// runs through [stackTest], which cancels the reader and closes the client transport before it
// shuts the server down, and the server completes the close handshake (StackServer.onClosing).

package crossy.session

import crossy.protocol.CheckRequestMessage
import crossy.protocol.ClearCellMessage
import crossy.protocol.ClientMessage
import crossy.protocol.Direction
import crossy.protocol.HeartbeatMessage
import crossy.protocol.MoveCursorMessage
import crossy.protocol.PlaceLetterMessage
import crossy.protocol.RequestSyncMessage
import crossy.protocol.ServerMessage
import kotlinx.coroutines.runBlocking
import okio.ByteString.Companion.encodeUtf8
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test

class WebSocketTransportTests {
    private class Stack(
        val server: StackServer,
        val transport: WebSocketTransport,
        val reader: InboundReader,
        val log: LogProbe,
    )

    private fun stackTest(
        token: String? = "jwt",
        tokenThrows: Boolean = false,
        resumeFromSeq: Int? = null,
        body: suspend Stack.() -> Unit,
    ) = runBlocking {
        val server = StackServer()
        val log = LogProbe()
        val transport =
            WebSocketTransport(
                url = server.wsUrl,
                tokenProvider = {
                    if (tokenThrows) throw IllegalStateException("provider blew up")
                    token
                },
                resumeFromSeq = resumeFromSeq,
                log = log::record,
            )
        val reader = InboundReader(transport)
        try {
            Stack(server, transport, reader, log).body()
        } finally {
            reader.cancel()
            runCatching { transport.close() }
            server.shutdown()
        }
    }

    // MARK: - Handshake (PROTOCOL.md §2)

    @Test
    fun connectSendsHelloAsTheFirstFrameCarryingVersionAndToken_PROTOCOL2() = stackTest {
        transport.connect() // token "jwt", no resumeFromSeq
        val frames = server.awaitReceived(1)
        // The first frame from the client MUST be hello (PROTOCOL.md §2), byte-equivalent to the
        // normative minimal fixture (protocolVersion 1, the token, no resumeFromSeq).
        assertJsonEquivalent(WireFixtures.text("hello-minimal"), frames[0], "first frame is hello")
    }

    @Test
    fun helloCarriesTheTokenAndOptionalResumeFromSeq_PROTOCOL2() =
        stackTest(token = "<access JWT>", resumeFromSeq = 123) {
            transport.connect()
            val frames = server.awaitReceived(1)
            // The full hello fixture: protocolVersion 1, the token, resumeFromSeq 123.
            assertJsonEquivalent(WireFixtures.text("hello"), frames[0], "hello carries resumeFromSeq")
        }

    @Test
    fun nilTokenThrowsSignedOutWithoutDialing_PROTOCOL2() = stackTest(token = null) {
        try {
            transport.connect()
            fail("connect must throw when the provider says signed out")
        } catch (_: WebSocketTransportException.SignedOut) {
            // Expected: no hello the server would refuse UNAUTHORIZED.
        }
        assertTrue(reader.awaitCompletion(), "a spent transport's stream is finished")
    }

    @Test
    fun throwingTokenProviderFoldsToSignedOut_PROTOCOL2() = stackTest(tokenThrows = true) {
        try {
            transport.connect()
            fail("connect must throw when the provider throws")
        } catch (_: WebSocketTransportException.SignedOut) {
            // The web transport folds a throwing provider into signed-out; mirrored.
        }
    }

    @Test
    fun connectOnAUsedTransportThrows_oneValueOneAttempt() = stackTest {
        transport.connect()
        try {
            transport.connect()
            fail("one Transport value serves one connection attempt (Ports.kt)")
        } catch (_: WebSocketTransportException.AlreadyUsed) {
            // Expected.
        }
    }

    // MARK: - Typed delivery (AAD-2; PROTOCOL.md §2, §6)

    @Test
    fun welcomeAndLaterFramesArriveTypedInArrivalOrder_PROTOCOL2() = stackTest {
        transport.connect()
        val socket = server.serverSocket()
        socket.send(WireFixtures.text("welcome"))
        socket.send(WireFixtures.text("cellSet"))

        val welcome = reader.next()
        assertTrue(welcome is ServerMessage.Welcome, "the welcome is delivered through the flow")
        welcome as ServerMessage.Welcome
        assertEquals("u1", welcome.message.self.userId)
        assertEquals(412, welcome.message.board.seq)

        val event = reader.next()
        assertTrue(event is ServerMessage.CellSet, "frames after the welcome flow through the same flow")
        event as ServerMessage.CellSet
        assertEquals(413, event.message.seq)
        assertEquals("A", event.message.value)
    }

    @Test
    fun dataFramesDecodeByContentLikeTextFrames_PROTOCOL2() = stackTest {
        transport.connect()
        val socket = server.serverSocket()
        socket.send(WireFixtures.text("cursor").encodeUtf8())

        val cursor = reader.next()
        assertTrue(cursor is ServerMessage.Cursor, "a data frame with valid JSON content still decodes")
        cursor as ServerMessage.Cursor
        assertEquals("u2", cursor.message.userId)
    }

    // MARK: - Unknown type: ignore and log (PROTOCOL.md §3)

    @Test
    fun unknownMessageTypeIsIgnoredAndLoggedNeverDelivered_PROTOCOL3() = stackTest {
        transport.connect()
        val socket = server.serverSocket()
        // A recognizable-but-unknown type (forward compatibility): the codec's
        // WireDecodingException.UnknownType, distinct from a malformed frame.
        socket.send("""{"type":"confetti","seq":99}""")
        socket.send(WireFixtures.text("cursor"))

        val cursor = reader.next()
        assertTrue(cursor is ServerMessage.Cursor, "the flow skips the unknown frame and keeps delivering")
        val logged = log.awaitLogged(1)
        assertEquals(1, logged.size, "ignored, but logged (PROTOCOL.md §3)")
        assertTrue(
            logged[0].contains("confetti") && logged[0].contains("unknown type"),
            "the log names the unknown type: $logged",
        )
    }

    // MARK: - Malformed frames: drop and log (PROTOCOL.md §11)

    @Test
    fun malformedFramesAreDroppedAndLoggedNeverACrash_PROTOCOL11() = stackTest {
        transport.connect()
        val socket = server.serverSocket()
        socket.send("not json at all") // not valid JSON
        socket.send("""{"seq":1}""") // no type to key on
        socket.send("""{"type":42}""") // type is not a string
        socket.send("""{"type":"cellSet","seq":"nope"}""") // known type, broken body
        socket.send(WireFixtures.text("cursor"))

        val cursor = reader.next()
        assertTrue(cursor is ServerMessage.Cursor, "only the valid frame is delivered")
        val logged = log.awaitLogged(4)
        assertEquals(4, logged.size, "each malformed frame drops with a log line")
        assertTrue(
            logged.all { it.contains("malformed") },
            "the malformed posture is distinct from unknown-type: $logged",
        )
    }

    // MARK: - Send: best-effort, fixture-exact encoding (PROTOCOL.md §2, §5, §8)

    @Test
    fun sendEncodesEachCommandAsOneFixtureExactTextFrame_PROTOCOL2_PROTOCOL5() = stackTest {
        transport.connect()
        transport.send(ClientMessage.PlaceLetter(PlaceLetterMessage("c1", 17, "A")))
        transport.send(ClientMessage.ClearCell(ClearCellMessage("c2", 17)))
        transport.send(ClientMessage.MoveCursor(MoveCursorMessage(17, Direction.ACROSS)))
        transport.send(ClientMessage.CheckRequest(CheckRequestMessage("c3")))
        transport.send(ClientMessage.Heartbeat(HeartbeatMessage()))
        transport.send(ClientMessage.RequestSync(RequestSyncMessage()))

        val frames = server.awaitReceived(7)
        assertEquals(7, frames.size, "hello plus the six commands")
        assertJsonEquivalent(WireFixtures.text("placeLetter"), frames[1], "placeLetter")
        assertJsonEquivalent(WireFixtures.text("clearCell"), frames[2], "clearCell")
        assertJsonEquivalent(WireFixtures.text("moveCursor"), frames[3], "moveCursor")
        assertJsonEquivalent(WireFixtures.text("checkRequest"), frames[4], "checkRequest")
        assertJsonEquivalent(WireFixtures.text("heartbeat"), frames[5], "heartbeat")
        assertJsonEquivalent(WireFixtures.text("requestSync"), frames[6], "requestSync")
    }

    // MARK: - Drop and close (PROTOCOL.md §2, §7)

    @Test
    fun inboundCompletesWhenTheSocketDrops_theDropSignal_PROTOCOL7() = stackTest {
        transport.connect()
        val socket = server.serverSocket()
        socket.send(WireFixtures.text("cursor"))
        val cursor = reader.next()
        assertTrue(cursor is ServerMessage.Cursor, "frames before the drop still deliver")

        socket.close(1000, "bye")
        assertTrue(reader.awaitCompletion(), "the flow completing IS the drop signal (Ports.kt)")
        assertTrue(reader.completed)
        assertNull(reader.next(500), "nothing after completion")
    }

    @Test
    fun closeFinishesTheStreamAndDropsLaterSends_PROTOCOL2() = stackTest {
        transport.connect()
        server.awaitReceived(1) // the hello landed
        transport.close() // deliberate teardown: close 1000, stream finished

        assertTrue(reader.awaitCompletion(), "close finishes the inbound flow")
        transport.send(ClientMessage.Heartbeat(HeartbeatMessage()))
        // A closed transport drops sends: the server still only ever saw the hello.
        assertEquals(1, server.received.size, "a closed transport drops sends")
    }
}
