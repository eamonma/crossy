import Foundation
import XCTest

import CrossyProtocol

// Contract snapshots for every WebSocket message (PROTOCOL.md §§2, 4, 5, 6), the Swift
// half of packages/protocol/src/codec.test.ts: the fixtures are the same PROTOCOL.md
// examples, so both twins are pinned to the same normative bytes and drift between them
// fails CI on whichever side moved (D04).

final class WireSnapshotTests: XCTestCase {
    // MARK: - Handshake (PROTOCOL.md §2)

    func test_helloRoundTripsTheSection2ExampleWithResumeFromSeq() throws {
        let hello = try pinClientFrame(HelloMessage.self, "hello")
        XCTAssertEqual(hello.protocolVersion, 1)
        XCTAssertEqual(hello.token, "<access JWT>")
        XCTAssertEqual(hello.resumeFromSeq, 123)
    }

    func test_helloWithoutResumeFromSeqStaysAbsentOnReencode() throws {
        let hello = try pinClientFrame(HelloMessage.self, "hello-minimal")
        XCTAssertNil(hello.resumeFromSeq)
        let reencoded = try JSONEncoder().encode(hello)
        let keys = try XCTUnwrap(try jsonObject(reencoded) as? NSDictionary).allKeys
        XCTAssertFalse(
            keys.contains { $0 as? String == "resumeFromSeq" },
            "an absent optional must stay off the wire, never become null (§2, §3)")
    }

    func test_welcomeRoundTripsWithEmbeddedBoardAndSelfKey() throws {
        // `self` is the one wire key a Swift property cannot spell; CodingKeys pins it.
        let welcome = try pinServerFrame(WelcomeMessage.self, "welcome")
        XCTAssertEqual(welcome.protocolVersion, 1)
        XCTAssertEqual(welcome.selfIdentity.userId, "u1")
        XCTAssertEqual(welcome.selfIdentity.role, .solver)
        XCTAssertEqual(welcome.board.seq, 412)
    }

    // MARK: - Board payload (PROTOCOL.md §4)

    func test_syncRoundTripsTheSection4BoardExample() throws {
        let sync = try pinServerFrame(SyncMessage.self, "sync")
        let board = sync.board
        XCTAssertEqual(board.status, .ongoing)
        XCTAssertEqual(board.firstFillAt, "2026-07-07T19:02:11Z")
        XCTAssertNil(board.completedAt)
        XCTAssertNil(board.stats)
        XCTAssertEqual(board.recentCommandIds, ["cmd-1", "cmd-2"])
        // §4 cell attribution: {v:null,by:null} is a black square or never-written cell;
        // {v:null,by:"u2"} is a cell a writer cleared. Both survive the round trip.
        XCTAssertEqual(board.cells[1], Cell(v: nil, by: nil))
        XCTAssertEqual(board.cells[2], Cell(v: nil, by: "u2"))
        XCTAssertEqual(board.cursors, [Cursor(userId: "u1", cell: 17, direction: .across)])
        // §4/§10: standing room-check marks and the permanent count ride every snapshot,
        // so reconnect and resync heal the marks with no delta replay (D27).
        XCTAssertEqual(board.checkedWrongCells, [0])
        XCTAssertEqual(board.checkCount, 1)
    }

    func test_syncCompletedBoardCarriesNonNullStats() throws {
        let sync = try pinServerFrame(SyncMessage.self, "sync-completed")
        XCTAssertEqual(sync.board.status, .completed)
        XCTAssertEqual(
            sync.board.stats,
            Stats(solveTimeSeconds: 2272, totalEvents: 899, participantCount: 4, checkCount: 2))
        XCTAssertEqual(sync.board.completedAt, "2026-07-07T19:40:03Z")
        // §4/§10: a completed board froze its permanent count into stats.checkCount (D27).
        XCTAssertEqual(sync.board.checkCount, sync.board.stats?.checkCount)
    }

    func test_boardWithoutCheckFieldsDecodesWithDefaults_PROTOCOL14() throws {
        // §14 additive posture (the avatarUrl pattern): checkedWrongCells and checkCount
        // are always present from a current server (§4), but a pre-check payload still
        // decodes, as no marks and no accepted checks. Decode-only: re-encode from a
        // current client always writes both fields.
        var frame = try XCTUnwrap(
            try jsonObject(fixtureData(.wire, "sync")) as? [String: Any])
        var board = try XCTUnwrap(frame["board"] as? [String: Any])
        board.removeValue(forKey: "checkedWrongCells")
        board.removeValue(forKey: "checkCount")
        frame["board"] = board
        let data = try JSONSerialization.data(withJSONObject: frame)
        let sync = try JSONDecoder().decode(SyncMessage.self, from: data)
        XCTAssertEqual(sync.board.checkedWrongCells, [])
        XCTAssertEqual(sync.board.checkCount, 0)
    }

    // MARK: - Client to server (PROTOCOL.md §5)

    func test_placeLetterRoundTrips() throws {
        let message = try pinClientFrame(PlaceLetterMessage.self, "placeLetter")
        XCTAssertEqual(message, PlaceLetterMessage(commandId: "c1", cell: 17, value: "A"))
    }

    func test_clearCellRoundTrips() throws {
        let message = try pinClientFrame(ClearCellMessage.self, "clearCell")
        XCTAssertEqual(message, ClearCellMessage(commandId: "c2", cell: 17))
    }

    func test_moveCursorRoundTrips() throws {
        let message = try pinClientFrame(MoveCursorMessage.self, "moveCursor")
        XCTAssertEqual(message, MoveCursorMessage(cell: 17, direction: .across))
    }

    func test_reactRoundTrips() throws {
        // §5, §9: the wire carries the emoji grapheme itself, never a symbolic token.
        let message = try pinClientFrame(ReactMessage.self, "react")
        XCTAssertEqual(message, ReactMessage(emoji: "🎉", cell: 17))
    }

    func test_checkPuzzleRoundTrips() throws {
        // §5, §10 (D27): the room-wide check carries only its commandId; the confirmed
        // intent is the command, and the server needs no further ceremony.
        let message = try pinClientFrame(CheckPuzzleMessage.self, "checkPuzzle")
        XCTAssertEqual(message, CheckPuzzleMessage(commandId: "c3"))
    }

    func test_heartbeatRoundTrips() throws {
        try pinClientFrame(HeartbeatMessage.self, "heartbeat")
    }

    func test_requestSyncRoundTrips() throws {
        try pinClientFrame(RequestSyncMessage.self, "requestSync")
    }

    // MARK: - Sequenced events (PROTOCOL.md §6)

    func test_cellSetRoundTripsTheSection6Example() throws {
        let event = try pinServerFrame(CellSetMessage.self, "cellSet")
        XCTAssertEqual(event.seq, 413)
        XCTAssertEqual(event.value, "A")
        XCTAssertEqual(event.commandId, "c1")
        XCTAssertNil(event.firstFillAt, "only the first-fill cellSet carries firstFillAt (§6)")
    }

    func test_cellSetClearKeepsTheExplicitNullValueOnReencode() throws {
        // A clear is `"value": null`, present on the wire; dropping the key on re-encode
        // would change the frame's meaning. The round trip pins the explicit null.
        let event = try pinServerFrame(CellSetMessage.self, "cellSet-clear")
        XCTAssertNil(event.value)
        let reencoded = try XCTUnwrap(
            try jsonObject(JSONEncoder().encode(event)) as? NSDictionary)
        XCTAssertEqual(reencoded["value"] as? NSNull, NSNull())
    }

    func test_cellSetFirstFillCarriesTheTimerOrigin() throws {
        let event = try pinServerFrame(CellSetMessage.self, "cellSet-firstFill")
        XCTAssertEqual(event.firstFillAt, "2026-07-07T19:02:11Z")
        XCTAssertEqual(event.firstFillAt, event.at, "§6: the same server timestamp")
    }

    func test_gameCompletedRoundTripsTheSection6Example() throws {
        let event = try pinServerFrame(GameCompletedMessage.self, "gameCompleted")
        XCTAssertEqual(event.seq, 900)
        XCTAssertEqual(
            event.stats,
            Stats(solveTimeSeconds: 2272, totalEvents: 899, participantCount: 4, checkCount: 2))
    }

    func test_puzzleCheckedRoundTripsTheSection6Example() throws {
        // §6, §10 (D27): sequenced (an accepted check mutates the standing marks and the
        // permanent count) and deliberately neutral: no `by` ever crosses the wire; the
        // sender recognizes its own commandId echo, which is all a client needs (INV-6).
        let event = try pinServerFrame(PuzzleCheckedMessage.self, "puzzleChecked")
        XCTAssertEqual(
            event,
            PuzzleCheckedMessage(
                seq: 742, wrongCells: [3, 17, 44], checkCount: 2, commandId: "c4",
                at: "2026-07-07T19:31:40Z"))
    }

    func test_gameAbandonedRoundTripsTheSection6Example() throws {
        let event = try pinServerFrame(GameAbandonedMessage.self, "gameAbandoned")
        XCTAssertEqual(event, GameAbandonedMessage(seq: 641, at: "2026-07-07T19:41:00Z", by: "u1"))
    }

    // MARK: - Ephemeral notices (PROTOCOL.md §6)

    func test_playerConnectedRoundTrips() throws {
        let notice = try pinServerFrame(PlayerConnectedMessage.self, "playerConnected")
        XCTAssertEqual(
            notice,
            PlayerConnectedMessage(userId: "u2", displayName: "Bo", color: "#33AA88", role: .solver))
    }

    func test_playerDisconnectedRoundTrips() throws {
        let notice = try pinServerFrame(PlayerDisconnectedMessage.self, "playerDisconnected")
        XCTAssertEqual(notice, PlayerDisconnectedMessage(userId: "u2"))
    }

    func test_cursorRoundTrips() throws {
        let notice = try pinServerFrame(CursorMessage.self, "cursor")
        XCTAssertEqual(notice, CursorMessage(userId: "u2", cell: 5, direction: .down))
    }

    func test_reactionRoundTrips() throws {
        let notice = try pinServerFrame(ReactionMessage.self, "reaction")
        XCTAssertEqual(notice, ReactionMessage(userId: "u2", emoji: "🎉", cell: 5))
    }

    func test_kickedRoundTrips() throws {
        let notice = try pinServerFrame(KickedMessage.self, "kicked")
        XCTAssertEqual(notice, KickedMessage(reason: "removed by host"))
    }

    func test_errorNonFatalCarriesTheOffendingCommandId() throws {
        // §8/INV-10: the commandId is what lets the client clear the overlay entry.
        let error = try pinServerFrame(ErrorMessage.self, "error-nonfatal")
        XCTAssertEqual(error.code, .invalidValue)
        XCTAssertFalse(error.fatal)
        XCTAssertEqual(error.commandId, "c1")
    }

    func test_errorFatalOmitsCommandIdAndStaysAbsentOnReencode() throws {
        let error = try pinServerFrame(ErrorMessage.self, "error-fatal")
        XCTAssertEqual(error.code, .protocolVersionUnsupported)
        XCTAssertTrue(error.fatal)
        XCTAssertNil(error.commandId)
        let reencoded = try XCTUnwrap(
            try jsonObject(JSONEncoder().encode(error)) as? NSDictionary)
        XCTAssertNil(reencoded["commandId"])
    }

    // MARK: - The §6 split

    func test_sequencedEventsExposeSeqAndEphemeralNoticesDoNot_INV2() throws {
        // INV-2: `seq` is the total order; the §7 gap check keys on exactly the
        // sequenced messages. `ServerMessage.seq` is the split as one accessor.
        let sequenced = [
            "cellSet", "cellSet-clear", "cellSet-firstFill", "gameCompleted",
            "puzzleChecked", "gameAbandoned",
        ]
        for name in sequenced {
            let message = try JSONDecoder().decode(
                ServerMessage.self, from: fixtureData(.wire, name))
            XCTAssertNotNil(message.seq, "\(name) is a sequenced event (§6)")
        }
        let ephemeral = [
            "welcome", "sync", "sync-completed", "playerConnected", "playerDisconnected",
            "cursor", "reaction", "kicked", "error-nonfatal", "error-fatal",
        ]
        for name in ephemeral {
            let message = try JSONDecoder().decode(
                ServerMessage.self, from: fixtureData(.wire, name))
            XCTAssertNil(message.seq, "\(name) is an ephemeral notice (§6)")
        }
    }
}
