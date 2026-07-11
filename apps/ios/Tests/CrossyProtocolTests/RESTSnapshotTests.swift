import Foundation
import XCTest

import CrossyProtocol

// Contract snapshots for the REST companion (PROTOCOL.md §12): every request and
// response payload plus the error envelope, decode → re-encode → compare against the
// checked-in fixtures. Field lists follow the API's own contract, which §12 defers to
// (apps/api/src/{games,puzzles,identity}/routes.ts, http/errors.ts).

final class RESTSnapshotTests: XCTestCase {
    // MARK: - Error envelope (§12)

    func test_errorEnvelopeRoundTripsAndExposesTheTypedCode() throws {
        let envelope = try assertLosslessRoundTrip(APIErrorEnvelope.self, .rest, "error-envelope")
        XCTAssertEqual(envelope.error, "VALIDATION")
        XCTAssertEqual(envelope.code, .validation)
    }

    func test_aFutureErrorCodeDegradesToAnUntypedStringNotADecodeFailure() throws {
        // §12 names codeless rejections (barred, uniclue) that may gain codes later; a
        // client must keep the stable string and fail no decode when one lands.
        let body = Data(#"{"error":"BARRED","message":"barred grids are unsupported"}"#.utf8)
        let envelope = try JSONDecoder().decode(APIErrorEnvelope.self, from: body)
        XCTAssertEqual(envelope.error, "BARRED")
        XCTAssertNil(envelope.code)
    }

    func test_errorCodesCarryTheSection12HTTPStatuses() throws {
        // Both §12 tables (general vocabulary + named ingestion rejections), verbatim.
        let table: [String: Int] = [
            "UNAUTHORIZED": 401,
            "FULL_ACCOUNT_REQUIRED": 403,
            "NOT_PARTICIPANT": 403,
            "DENIED": 403,
            "FORBIDDEN": 403,
            "GAME_NOT_FOUND": 404,
            "PUZZLE_NOT_FOUND": 404,
            "VALIDATION": 400,
            "INTERNAL": 500,
            "UNSOLVABLE_CELL": 422,
            "REBUS_TOO_LONG": 422,
            "OVERSIZE_GRID": 422,
            "AMBIGUOUS_SOLUTION": 422,
            "DEGENERATE_GRID": 422,
            "DIAGRAMLESS": 422,
        ]
        XCTAssertEqual(Set(APIErrorCode.allCases.map(\.rawValue)), Set(table.keys))
        for code in APIErrorCode.allCases {
            XCTAssertEqual(
                code.httpStatus, table[code.rawValue],
                "\(code.rawValue) status must match PROTOCOL.md §12")
        }
    }

    // MARK: - Puzzles (§12)

    func test_puzzleViewRoundTrips() throws {
        let view = try assertLosslessRoundTrip(PuzzleView.self, .rest, "puzzle-view")
        XCTAssertEqual(view.puzzle.rows, 1)
        XCTAssertEqual(view.puzzle.cols, 2)
        XCTAssertEqual(view.puzzle.blocks, [1])
        XCTAssertNil(view.puzzle.shadedCircles, "absent stays absent")
        XCTAssertEqual(view.puzzle.clues.across.first?.text, "Feline pet")
    }

    func test_puzzlesListRoundTripsWithNullAndNonNullMetadata() throws {
        let list = try assertLosslessRoundTrip(PuzzlesListResponse.self, .rest, "puzzles-list")
        XCTAssertEqual(list.puzzles.count, 2)
        XCTAssertEqual(list.puzzles[0].title, "Themeless Saturday")
        XCTAssertEqual(
            list.puzzles[0].features,
            PuzzleFeatures(rebus: true, circles: true, shadedCircles: false))
        // §12: absent, null, empty all read as null; the wire carries explicit nulls.
        XCTAssertNil(list.puzzles[1].title)
        XCTAssertNil(list.puzzles[1].author)
    }

    // MARK: - Games (§12)

    func test_createGameRequestRoundTripsWithAName() throws {
        let request = try assertLosslessRoundTrip(CreateGameRequest.self, .rest, "create-game-request")
        XCTAssertEqual(request.name, "Sunday themeless with the crew")
    }

    func test_createGameRequestWithoutANameOmitsTheKey() throws {
        let request = try assertLosslessRoundTrip(
            CreateGameRequest.self, .rest, "create-game-request-minimal")
        XCTAssertNil(request.name)
        let reencoded = try XCTUnwrap(
            try jsonObject(JSONEncoder().encode(request)) as? NSDictionary)
        XCTAssertNil(reencoded["name"], "an unnamed create sends no name key")
    }

    func test_createGameResponseKeepsTheExplicitNullName() throws {
        let response = try assertLosslessRoundTrip(
            CreateGameResponse.self, .rest, "create-game-response")
        XCTAssertNil(response.name)
        XCTAssertEqual(response.role, .host)
        XCTAssertEqual(response.inviteCode, "BQ7XKM2A")
    }

    func test_gamesListRoundTripsAndCarriesNoLifecycleStatus() throws {
        let list = try assertLosslessRoundTrip(GamesListResponse.self, .rest, "games-list")
        XCTAssertEqual(list.games.count, 2)
        XCTAssertEqual(list.games[0].role, .host)
        XCTAssertEqual(list.games[0].puzzle.title, "Themeless Saturday")
        XCTAssertEqual(list.games[0].memberCount, 3)
        XCTAssertNil(list.games[1].name)
        XCTAssertNil(list.games[1].puzzle.title)
        // §12: GET /games deliberately omits `status` (session-owned game_state); its
        // future arrival is an additive extension, not a shape this twin invents early.
        let reencoded = try jsonObject(JSONEncoder().encode(list))
        XCTAssertFalse(allJSONKeys(in: reencoded).contains("status"))
    }

    func test_joinRequestRoundTrips() throws {
        let request = try assertLosslessRoundTrip(JoinGameRequest.self, .rest, "join-request")
        XCTAssertEqual(request.code, "BQ7XKM2A")
    }

    func test_membershipResponseRoundTripsForBothJoinsAndTheRoleUpgrade() throws {
        // §12: POST /games/join, /{id}/join, and /{id}/role all answer {gameId, role, userId}.
        let response = try assertLosslessRoundTrip(
            GameMembershipResponse.self, .rest, "membership-response")
        XCTAssertEqual(response.role, .solver)
    }

    func test_roleChangeRequestRoundTrips() throws {
        let request = try assertLosslessRoundTrip(RoleChangeRequest.self, .rest, "role-request")
        XCTAssertEqual(request.role, .solver)
    }

    func test_kickResponseRoundTrips() throws {
        let response = try assertLosslessRoundTrip(KickResponse.self, .rest, "kick-response")
        XCTAssertEqual(response.removed, "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e")
    }

    func test_abandonResponseRoundTrips() throws {
        let response = try assertLosslessRoundTrip(AbandonResponse.self, .rest, "abandon-response")
        XCTAssertEqual(response.status, .abandoned)
    }

    func test_deleteAccountResponseRoundTrips() throws {
        let response = try assertLosslessRoundTrip(
            DeleteAccountResponse.self, .rest, "delete-account-response")
        XCTAssertTrue(response.tombstoned)
        XCTAssertEqual(response.successions, 1)
        XCTAssertEqual(response.abandoned, ["c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f"])
    }

    func test_gameViewRoundTripsWithMembersSessionAndInviteCode() throws {
        let view = try assertLosslessRoundTrip(GameView.self, .rest, "game-view")
        XCTAssertEqual(view.name, "Sunday themeless with the crew")
        XCTAssertEqual(view.inviteCode, "BQ7XKM2A")
        XCTAssertEqual(view.members.count, 2)
        XCTAssertEqual(view.members[1].role, .spectator)
        XCTAssertEqual(view.puzzle.shadedCircles, [2], "present shadedCircles survive")
        XCTAssertTrue(view.session.ws.hasPrefix("wss://"), "§2 endpoint shape")
    }
}
