// The WebSocket transport against a scripted socket (no network; the real socket is
// Phase I1e's integration harness). Pins the PROTOCOL.md §2 handshake ordering, §3
// ignore-and-log for unknown types (via CrossyProtocol's WireDecodingError
// distinction), §11 drop-and-log for malformed frames, the §7 drop signal (the stream
// finishing), and best-effort send against the same wire fixtures the codec twins pin
// (Tests/CrossyProtocolTests/Fixtures/wire).

import CrossyProtocol
import CrossyStore
import Foundation
import XCTest

@testable import CrossySession

@available(iOS 17.0, macOS 14.0, *)
final class WebSocketTransportTests: XCTestCase {
    // MARK: - Handshake (PROTOCOL.md §2)

    func test_connectSendsHelloAsTheFirstFrameBeforeAnythingElse_PROTOCOL2() async throws {
        let harness = makeTransport(token: "jwt")
        // A frame sent before connect is a best-effort drop, never a hello overtaker.
        await harness.transport.send(.heartbeat(HeartbeatMessage()))
        XCTAssertEqual(harness.probe.socketsMade, 0, "no dial happened yet")

        try await harness.transport.connect()
        await harness.transport.send(.heartbeat(HeartbeatMessage()))

        let sent = harness.socket.sentTexts
        XCTAssertEqual(sent.count, 2)
        // The first frame from the client MUST be hello (PROTOCOL.md §2), and it is
        // byte-equivalent to the normative minimal fixture.
        try assertJSONEqual(sent[0], fixture: "hello-minimal")
        XCTAssertEqual(harness.socket.resumeCount, 1)
    }

    func test_helloCarriesTheTokenAndOptionalResumeFromSeq_PROTOCOL2() async throws {
        let harness = makeTransport(token: "<access JWT>", resumeFromSeq: 123)
        try await harness.transport.connect()
        // The full hello fixture: protocolVersion 1, the token, resumeFromSeq 123.
        try assertJSONEqual(harness.socket.sentTexts[0], fixture: "hello")
    }

    func test_nilTokenThrowsSignedOutWithoutDialing_PROTOCOL2() async throws {
        let harness = makeTransport(token: nil)
        do {
            try await harness.transport.connect()
            XCTFail("connect must throw when the provider says signed out")
        } catch WebSocketTransportError.signedOut {
            // Expected: no hello the server would refuse UNAUTHORIZED.
        }
        XCTAssertEqual(harness.probe.socketsMade, 0, "signed out never dials")
        var frames = harness.transport.inbound.makeAsyncIterator()
        let next = await frames.next()
        XCTAssertNil(next, "a spent transport's stream is finished")
    }

    func test_throwingTokenProviderFoldsToSignedOut_PROTOCOL2() async throws {
        let harness = makeTransport(tokenThrows: true)
        do {
            try await harness.transport.connect()
            XCTFail("connect must throw when the provider throws")
        } catch WebSocketTransportError.signedOut {
            // The web transport folds a throwing provider into signed-out; mirrored.
        }
        XCTAssertEqual(harness.probe.socketsMade, 0)
    }

    func test_helloSendFailureThrowsDialFailedAndFinishesTheStream_PROTOCOL7() async throws {
        let harness = makeTransport()
        harness.socket.refuseSends()
        do {
            try await harness.transport.connect()
            XCTFail("connect must throw when the attempt fails (Ports.swift)")
        } catch WebSocketTransportError.dialFailed {
            // Retryable through the store's backoff walk.
        }
        var frames = harness.transport.inbound.makeAsyncIterator()
        let next = await frames.next()
        XCTAssertNil(next, "a failed attempt's stream finishes; the driver redials")
    }

    func test_connectOnAUsedTransportThrows_oneValueOneAttempt() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        do {
            try await harness.transport.connect()
            XCTFail("one Transport value serves one connection attempt (Ports.swift)")
        } catch WebSocketTransportError.alreadyUsed {}
    }

    // MARK: - Typed delivery (AD-3; PROTOCOL.md §2, §6)

    func test_welcomeAndLaterFramesArriveTypedInArrivalOrder_PROTOCOL2_AD3() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        harness.socket.feed(text: try WireFixtures.text("welcome"))
        harness.socket.feed(text: try WireFixtures.text("cellSet"))

        var frames = harness.transport.inbound.makeAsyncIterator()
        guard case .welcome(let welcome)? = await frames.next() else {
            return XCTFail("the welcome is delivered through the stream (Ports.swift)")
        }
        XCTAssertEqual(welcome.selfIdentity.userId, "u1")
        XCTAssertEqual(welcome.board.seq, 412)

        guard case .cellSet(let event)? = await frames.next() else {
            return XCTFail("frames after the welcome flow through the same stream")
        }
        XCTAssertEqual(event.seq, 413)
        XCTAssertEqual(event.value, "A")
    }

    func test_dataFramesDecodeByContentLikeTextFrames_PROTOCOL2() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        harness.socket.feed(data: try WireFixtures.data("cursor"))

        var frames = harness.transport.inbound.makeAsyncIterator()
        guard case .cursor(let cursor)? = await frames.next() else {
            return XCTFail("a data frame with valid JSON content still decodes")
        }
        XCTAssertEqual(cursor.userId, "u2")
    }

    // MARK: - Unknown type: ignore and log (PROTOCOL.md §3)

    func test_unknownMessageTypeIsIgnoredAndLoggedNeverDelivered_PROTOCOL3() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        // A recognizable-but-unknown type (forward compatibility): WireDecodingError's
        // unknownType, distinct from a malformed frame.
        harness.socket.feed(text: #"{"type":"confetti","seq":99}"#)
        harness.socket.feed(text: try WireFixtures.text("cursor"))

        var frames = harness.transport.inbound.makeAsyncIterator()
        guard case .cursor? = await frames.next() else {
            return XCTFail("the stream skips the unknown frame and keeps delivering")
        }
        let logged = harness.probe.logged
        XCTAssertEqual(logged.count, 1, "ignored, but logged (PROTOCOL.md section 3)")
        XCTAssertTrue(
            logged[0].contains("confetti") && logged[0].contains("unknown type"),
            "the log names the unknown type: \(logged)")
    }

    // MARK: - Malformed frames: drop and log (PROTOCOL.md §11)

    func test_malformedFramesAreDroppedAndLoggedNeverACrash_PROTOCOL11() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        harness.socket.feed(text: "not json at all")  // not valid JSON
        harness.socket.feed(text: #"{"seq":1}"#)  // no type to key on
        harness.socket.feed(text: #"{"type":42}"#)  // type is not a string
        harness.socket.feed(text: #"{"type":"cellSet","seq":"nope"}"#)  // broken body
        harness.socket.feed(text: try WireFixtures.text("cursor"))

        var frames = harness.transport.inbound.makeAsyncIterator()
        guard case .cursor? = await frames.next() else {
            return XCTFail("only the valid frame is delivered")
        }
        let logged = harness.probe.logged
        XCTAssertEqual(logged.count, 4, "each malformed frame drops with a log line")
        XCTAssertTrue(
            logged.allSatisfy { $0.contains("malformed") },
            "the malformed posture is distinct from unknown-type: \(logged)")
    }

    func test_decodeAndLoggingHappenOffTheMainActor_AD3() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        harness.socket.feed(text: "garbage")
        harness.socket.feed(text: try WireFixtures.text("cursor"))
        var frames = harness.transport.inbound.makeAsyncIterator()
        _ = await frames.next()
        XCTAssertFalse(
            harness.probe.loggedOnMainThread,
            "the pump decodes on the transport actor's executor, never the main actor")
    }

    // MARK: - Send: best-effort, fixture-exact encoding (PROTOCOL.md §2, §5, §8)

    func test_sendEncodesEachCommandAsOneFixtureExactTextFrame_PROTOCOL2_PROTOCOL5() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        await harness.transport.send(
            .placeLetter(PlaceLetterMessage(commandId: "c1", cell: 17, value: "A")))
        await harness.transport.send(.clearCell(ClearCellMessage(commandId: "c2", cell: 17)))
        await harness.transport.send(.moveCursor(MoveCursorMessage(cell: 17, direction: .across)))
        await harness.transport.send(.checkPuzzle(CheckPuzzleMessage(commandId: "c3")))
        await harness.transport.send(.heartbeat(HeartbeatMessage()))
        await harness.transport.send(.requestSync(RequestSyncMessage()))

        let sent = harness.socket.sentTexts
        XCTAssertEqual(sent.count, 7, "hello plus the six commands")
        try assertJSONEqual(sent[1], fixture: "placeLetter")
        try assertJSONEqual(sent[2], fixture: "clearCell")
        try assertJSONEqual(sent[3], fixture: "moveCursor")
        try assertJSONEqual(sent[4], fixture: "checkPuzzle")
        try assertJSONEqual(sent[5], fixture: "heartbeat")
        try assertJSONEqual(sent[6], fixture: "requestSync")
    }

    func test_sendIsBestEffortWhenTheSocketRefuses_PROTOCOL8() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        harness.socket.refuseSends()
        // No throw, no crash: the frame drops; the overlay plus snapshot
        // reconciliation recover a dropped mutation (PROTOCOL.md section 8).
        await harness.transport.send(
            .placeLetter(PlaceLetterMessage(commandId: "c1", cell: 0, value: "A")))
        XCTAssertEqual(harness.socket.sentTexts.count, 1, "only the hello landed")
        XCTAssertEqual(harness.probe.logged.count, 1, "the drop is logged")
    }

    // MARK: - Drop and close (PROTOCOL.md §2, §7)

    func test_inboundFinishesWhenTheSocketDrops_theDropSignal_PROTOCOL7() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        harness.socket.feed(text: try WireFixtures.text("cursor"))
        harness.socket.drop()

        var frames = harness.transport.inbound.makeAsyncIterator()
        guard case .cursor? = await frames.next() else {
            return XCTFail("frames before the drop still deliver")
        }
        let afterDrop = await frames.next()
        XCTAssertNil(afterDrop, "the stream finishing IS the drop signal (Ports.swift)")
    }

    func test_closeClosesWith1000FinishesTheStreamAndDropsLaterSends_PROTOCOL2() async throws {
        let harness = makeTransport()
        try await harness.transport.connect()
        await harness.transport.close()

        XCTAssertEqual(harness.socket.closedWith, [1000], "deliberate teardown is 1000")
        var frames = harness.transport.inbound.makeAsyncIterator()
        let next = await frames.next()
        XCTAssertNil(next)
        await harness.transport.send(.heartbeat(HeartbeatMessage()))
        XCTAssertEqual(harness.socket.sentTexts.count, 1, "a closed transport drops sends")
    }
}
