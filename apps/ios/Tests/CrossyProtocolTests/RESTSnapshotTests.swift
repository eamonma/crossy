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
            // Display-name rejections (docs/design/name-onboarding.md §7.2): the three
            // NAME_* codes are 422 (a well-formed body whose value violates a rule), and a
            // spent write window is 429.
            "NAME_REQUIRED": 422,
            "NAME_TOO_LONG": 422,
            "NAME_INVALID": 422,
            // Reaction-set rejections (§12; D25): the same 422 lane, the NAME_* style.
            "REACTION_SET_LENGTH": 422,
            "REACTION_SET_INVALID": 422,
            "REACTION_SET_DUPLICATE": 422,
            "RATE_LIMITED": 429,
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

    func test_gamesListCarriesLastActivityAndTheServerCursor() throws {
        // §12 activity ordering: a played game carries its last-activity time, an unplayed one
        // carries null; the response carries the server-computed nextBefore (the page cursor).
        let list = try assertLosslessRoundTrip(GamesListResponse.self, .rest, "games-list")
        XCTAssertEqual(list.games[0].lastActivityAt, "2026-07-09T18:24:03.000Z")
        XCTAssertNil(list.games[1].lastActivityAt, "an unplayed game has null activity")
        // The server sent the cursor key, so hasCursor is true and nextBefore is the page cursor.
        XCTAssertTrue(list.hasCursor)
        XCTAssertEqual(list.nextBefore, "2026-07-07T09:30:00.000Z")
    }

    func test_gamesListCarriesCompletionThroughCompletedAt_PROTOCOL12() throws {
        // §12: GET /games reports completion through `completedAt`, the ISO time a game finished,
        // null while ongoing (and null for an abandoned game). The fixture pins both branches
        // wire-honestly: the first row is solved, its completedAt equal to its lastActivityAt
        // (the completing entry IS the newest board event), the second is ongoing and unplayed
        // (both null). Solved-but-unplayed can never occur on the wire (completion requires
        // board events), so the fixture never shows it.
        let list = try assertLosslessRoundTrip(GamesListResponse.self, .rest, "games-list")
        XCTAssertEqual(
            list.games[0].completedAt, "2026-07-09T18:24:03.000Z",
            "a solved game carries its ISO completion time")
        XCTAssertNil(list.games[1].completedAt, "an ongoing game has null completion")
    }

    func test_gamesListCarriesAbandonmentThroughAbandonedAt_PROTOCOL12() throws {
        // §12: GET /games reports a host-ended game through `abandonedAt`, the twin terminal
        // timestamp, mutually exclusive with `completedAt`. The shared fixture's two rows are
        // solved and ongoing, so both read null abandonment; a non-null branch (an ended game)
        // is pinned inline, decode → re-encode → decode, since the round-trip fixture never shows
        // an abandoned row alongside a solved one.
        let list = try assertLosslessRoundTrip(GamesListResponse.self, .rest, "games-list")
        XCTAssertNil(list.games[0].abandonedAt, "a solved game was not abandoned")
        XCTAssertNil(list.games[1].abandonedAt, "an ongoing game was not abandoned")

        let ended = Data(
            #"""
            {"games":[{"gameId":"g","name":null,"role":"host","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"members":[],"inviteCode":"ENDED009","completedAt":null,"abandonedAt":"2026-07-07T18:52:00.000Z","lastActivityAt":"2026-07-07T18:40:00.000Z","puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null,"mask":[]}}],"nextBefore":null}
            """#.utf8)
        let decoded = try JSONDecoder().decode(GamesListResponse.self, from: ended)
        XCTAssertEqual(
            decoded.games[0].abandonedAt, "2026-07-07T18:52:00.000Z",
            "a host-ended game carries its ISO abandonment time")
        XCTAssertNil(
            decoded.games[0].completedAt,
            "an abandoned game never completed (the two terminal timestamps are exclusive)")
        // Lossless: re-encoding then re-decoding preserves the abandoned row unchanged.
        let reencoded = try JSONEncoder().encode(decoded)
        XCTAssertEqual(try JSONDecoder().decode(GamesListResponse.self, from: reencoded), decoded)
    }

    func test_gamesListDecodesAnOlderServerThatOmitsAbandonedAt_PROTOCOL14() throws {
        // §14 additive tolerance, mirroring completedAt: a server predating the abandonment read
        // omits `abandonedAt`; the twin decodes it as nil (reads as not-ended, §12).
        let legacy = Data(
            #"""
            {"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"completedAt":null,"lastActivityAt":null,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}],"nextBefore":null}
            """#.utf8)
        let decoded = try JSONDecoder().decode(GamesListResponse.self, from: legacy)
        XCTAssertNil(decoded.games[0].abandonedAt, "an omitted abandonedAt reads as not-ended")
    }

    func test_gamesListDecodesAnOlderServerThatOmitsCompletedAt_PROTOCOL14() throws {
        // §14 additive tolerance, mirroring lastActivityAt: a server predating the completion
        // read omits `completedAt`; the twin decodes it as nil (reads as ongoing, §12).
        let legacy = Data(
            #"""
            {"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"lastActivityAt":null,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}],"nextBefore":null}
            """#.utf8)
        let decoded = try JSONDecoder().decode(GamesListResponse.self, from: legacy)
        XCTAssertNil(decoded.games[0].completedAt, "an omitted completedAt reads as ongoing")
    }

    func test_gamesListCarriesTheRowMemberStackAndInviteCode_PROTOCOL12() throws {
        // §12: each row carries its full membership as display identity {userId, name,
        // avatarUrl, role}, join-ordered (first joiner first) and consistent with
        // memberCount, plus the game's inviteCode under the view's member-only rule (the
        // list is member-scoped by construction, so the code travels no wider).
        let list = try assertLosslessRoundTrip(GamesListResponse.self, .rest, "games-list")
        XCTAssertEqual(list.games[0].members.count, list.games[0].memberCount)
        XCTAssertEqual(
            list.games[0].members[0],
            GameSummary.Member(
                userId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
                name: "Ana",
                avatarUrl: "https://cdn.example/avatars/ana.png",
                role: .host),
            "the first joiner (the creator) leads the join-ordered stack")
        XCTAssertNil(
            list.games[0].members[1].avatarUrl,
            "a mirror NULL arrives as an explicit null and reads as none (§4 fallback rule)")
        // The solvers/spectators fact rides `role` alone: a guest seats spectator and
        // there is NO guest flag on the wire (§12).
        XCTAssertEqual(list.games[0].members[2].role, .spectator)
        XCTAssertEqual(list.games[0].inviteCode, "BQ7XKM2A")
        XCTAssertEqual(list.games[1].members.count, list.games[1].memberCount)
        XCTAssertEqual(list.games[1].inviteCode, "JW3PZQ9K")
        // One identity, one mirror value: the same member reads the same name and avatar
        // on every row (the §12 no-drift rule).
        XCTAssertEqual(list.games[1].members[0].name, list.games[0].members[0].name)
        XCTAssertEqual(list.games[1].members[0].avatarUrl, list.games[0].members[0].avatarUrl)
    }

    func test_gamesListDecodesAnOlderServerThatOmitsMembersAndInviteCode_PROTOCOL14() throws {
        // §14 additive tolerance, the completedAt pattern: a server predating the member
        // stack omits both fields; the twin reads an empty stack and no code, failing no
        // decode (absent members is empty, absent inviteCode is none, §12).
        let legacy = Data(
            #"""
            {"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"completedAt":null,"lastActivityAt":null,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}],"nextBefore":null}
            """#.utf8)
        let decoded = try JSONDecoder().decode(GamesListResponse.self, from: legacy)
        XCTAssertEqual(decoded.games[0].members, [], "an omitted stack reads as empty")
        XCTAssertNil(decoded.games[0].inviteCode, "an omitted code reads as none")
        // memberCount stays true even while the stack is absent (the older-server split).
        XCTAssertEqual(decoded.games[0].memberCount, 2)
    }

    func test_gamesListPresentNullCursorMeansExhaustedNotAbsent() throws {
        // A present-null nextBefore (list exhausted) must be distinguishable from an absent key
        // (older server): the client stops on the former and falls back on the latter (§12, §14).
        let present = Data(#"{"games":[],"nextBefore":null}"#.utf8)
        let decodedPresent = try JSONDecoder().decode(GamesListResponse.self, from: present)
        XCTAssertTrue(decodedPresent.hasCursor, "the key is present, even as null")
        XCTAssertNil(decodedPresent.nextBefore)

        let absent = Data(#"{"games":[]}"#.utf8)
        let decodedAbsent = try JSONDecoder().decode(GamesListResponse.self, from: absent)
        XCTAssertFalse(decodedAbsent.hasCursor, "an older server omits the key entirely")
        XCTAssertNil(decodedAbsent.nextBefore)
    }

    func test_gamesListDecodesAnOlderServerThatOmitsActivityAndCursor() throws {
        // §14 additive: a server predating activity ordering sends neither lastActivityAt nor
        // nextBefore; the twin still decodes, reading unplayed activity and no server cursor.
        let legacy = Data(
            #"""
            {"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}]}
            """#.utf8)
        let decoded = try JSONDecoder().decode(GamesListResponse.self, from: legacy)
        XCTAssertNil(decoded.games[0].lastActivityAt)
        XCTAssertFalse(decoded.hasCursor)
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

    // MARK: - Analysis (§12: GET /games/{id}/analysis)

    func test_analysisViewRoundTripsWithOwnersMomentumAndMoments() throws {
        let view = try assertLosslessRoundTrip(AnalysisView.self, .rest, "analysis-view")
        // The owner map arrives as string cell-index keys; ownersByCell parses them back.
        XCTAssertEqual(
            view.ownersByCell,
            [0: "host", 1: "host", 2: "mate", 3: "host"],
            "string cell-index keys parse back to the integer-keyed owner map")
        // The momentum ribbon is always 40 buckets, each peak-normalized into [0, 1].
        XCTAssertEqual(view.momentum.durationSeconds, 60)
        XCTAssertEqual(view.momentum.samples.count, 40, "the ribbon is a fixed 40-bucket curve")
        XCTAssertTrue(
            view.momentum.samples.allSatisfy { (0...1).contains($0) },
            "each sample is peak-normalized into [0, 1]")
        // The three named beats.
        XCTAssertEqual(
            view.moments.firstToFall,
            AnalysisView.Beat(cell: 0, userId: "host", atSeconds: 0))
        XCTAssertEqual(
            view.moments.lastSquare,
            AnalysisView.Beat(cell: 3, userId: "mate", atSeconds: 115))
        XCTAssertEqual(
            view.moments.turningPoint,
            AnalysisView.TurningPoint(stallSeconds: 100, breakSeconds: 110, burst: 2))
    }

    func test_analysisViewKeepsExplicitNullMomentsAcrossTheRoundTrip() throws {
        // A solve too short to have a beat carries an explicit JSON null for each moment;
        // the twin decodes those to nil AND re-encodes the explicit null (not an absent
        // key), so the round trip is lossless (the fixture pins the nulls).
        let view = try assertLosslessRoundTrip(
            AnalysisView.self, .rest, "analysis-view-null-moments")
        XCTAssertNil(view.moments.firstToFall)
        XCTAssertNil(view.moments.lastSquare)
        XCTAssertNil(view.moments.turningPoint)
        // The nulls are present, not absent: re-encoding emits the keys with null values.
        let reencoded = try XCTUnwrap(
            try jsonObject(JSONEncoder().encode(view)) as? [String: Any])
        let moments = try XCTUnwrap(reencoded["moments"] as? [String: Any])
        for key in ["firstToFall", "lastSquare", "turningPoint"] {
            XCTAssertTrue(
                moments[key] is NSNull,
                "\(key) re-encodes as an explicit null, not an absent key")
        }
    }

    func test_analysisViewCanCarryNoLetter_INV6() throws {
        // INV-6: the analysis bundle holds userIds, cells, and numbers only, and has
        // nowhere to put a solution value. Decode a fixture whose owner userIds and cell
        // count would let a naive projection have carried the solved letters, then re-encode
        // and assert no letter survives: the type cannot represent one.
        let view = try assertLosslessRoundTrip(AnalysisView.self, .rest, "analysis-view")
        let json = String(decoding: try JSONEncoder().encode(view), as: UTF8.self)
        XCTAssertFalse(json.contains("solution"), "no solution field can exist on the type")
        // The solved answer of this 4-cell fixture would have been "CATS"; no letter of it,
        // and no whole word, may appear anywhere in the encoded bundle (INV-6).
        for letter in ["\"C\"", "\"A\"", "\"T\"", "\"S\"", "CATS"] {
            XCTAssertFalse(
                json.contains(letter),
                "the encoded analysis bundle carries no solution letter (INV-6)")
        }
    }
}
