import Foundation
import XCTest

import CrossyAPI
import CrossyProtocol

// Per-endpoint round trips for the section 12 surface: the request the client puts on
// the wire (method, path, headers, body) asserted against the stub, and the typed
// decode of the canned response, using the shared CrossyProtocolTests fixtures.

private let gameId = "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f"
private let memberId = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"
private let puzzleId = "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c"

@available(macOS 12.0, iOS 15.0, *)
final class EndpointTests: XCTestCase {
    private func stub(_ status: Int, fixture: String) throws {
        let body = try SharedRESTFixtures.data(fixture)
        StubURLProtocol.install { _ in (status, body) }
    }

    private func onlyRequest(file: StaticString = #filePath, line: UInt = #line) throws
        -> RecordedRequest
    {
        let requests = StubURLProtocol.recordedRequests
        XCTAssertEqual(requests.count, 1, "expected exactly one request", file: file, line: line)
        return try XCTUnwrap(requests.first, file: file, line: line)
    }

    // MARK: - Lists (request shape beyond pagination lives in PaginationTests)

    func test_listGames_sendsABearerGETAndDecodesTheFixture() async throws {
        try stub(200, fixture: "games-list")
        let page = try await makeStubbedClient().listGames()

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(request.path, "/games")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
        XCTAssertNil(request.body, "a GET carries no body")
        XCTAssertTrue(request.queryItems.isEmpty, "default paging sends no query")

        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(page.rows[0].role, .host)
        XCTAssertEqual(page.rows[0].memberCount, 3)
        XCTAssertEqual(page.rows[0].puzzle.title, "Themeless Saturday")
        XCTAssertNil(page.rows[1].name)
        // The row member stack and the member-only invite code ride the same decode
        // (section 12); the stack is consistent with the count.
        XCTAssertEqual(page.rows[0].members.count, 3)
        XCTAssertEqual(page.rows[0].members[0].name, "Ana")
        XCTAssertEqual(page.rows[0].inviteCode, "BQ7XKM2A")
    }

    func test_listPuzzles_sendsABearerGETAndDecodesINV6SafeGeometry() async throws {
        // Section 12: list rows carry only INV-6-safe geometry (rows, cols) plus
        // display metadata, never solution content.
        try stub(200, fixture: "puzzles-list")
        let page = try await makeStubbedClient().listPuzzles()

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(request.path, "/puzzles")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")

        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(page.rows[0].rows, 15)
        XCTAssertEqual(page.rows[0].cols, 15)
        XCTAssertEqual(
            page.rows[0].features,
            PuzzleFeatures(rebus: true, circles: true, shadedCircles: false))
        XCTAssertNil(page.rows[1].title)
        XCTAssertNil(page.rows[1].author)
    }

    // MARK: - Game view

    func test_getGame_carriesTheIdInThePathAndDecodesASolutionFreeViewPerINV6() async throws {
        try stub(200, fixture: "game-view")
        let view = try await makeStubbedClient().game(gameId)

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(request.path, "/games/\(gameId)")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")

        XCTAssertEqual(view.gameId, gameId)
        XCTAssertEqual(view.inviteCode, "BQ7XKM2A")
        XCTAssertEqual(view.members.count, 2)
        XCTAssertTrue(view.session.ws.hasPrefix("wss://"))
        // INV-6: the view's puzzle is ClientPuzzle, solution-free by type; nothing the
        // client re-encodes can carry one.
        let reencoded = String(decoding: try JSONEncoder().encode(view), as: UTF8.self)
        XCTAssertFalse(reencoded.contains("solution"))
    }

    // MARK: - Creates

    func test_createPuzzle_uploadsTheDocumentVerbatimAndDecodesThePuzzleView() async throws {
        try stub(201, fixture: "puzzle-view")
        // The XWord Info document is a third-party payload uploaded verbatim (section
        // 12: its schema is ingestion's to pin), so the client must not reshape it.
        let document = Data(#"{"title":"Feline pets","size":{"rows":1,"cols":2}}"#.utf8)
        let view = try await makeStubbedClient().createPuzzle(xwordInfoDocument: document)

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/puzzles")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        XCTAssertEqual(request.body, document, "the document is sent byte for byte")

        XCTAssertEqual(view.puzzleId, puzzleId)
        XCTAssertEqual(view.puzzle.rows, 1)
        XCTAssertEqual(view.puzzle.cols, 2)
    }

    func test_createGame_encodesTheTypedRequestAndDecodesTheResponse() async throws {
        try stub(201, fixture: "create-game-response")
        let response = try await makeStubbedClient().createGame(
            CreateGameRequest(puzzleId: puzzleId, name: "Sunday themeless with the crew"))

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/games")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        XCTAssertEqual(
            try jsonObject(XCTUnwrap(request.body)),
            try jsonObject(SharedRESTFixtures.data("create-game-request")),
            "the body must match the pinned request fixture")

        XCTAssertEqual(response.gameId, gameId)
        XCTAssertEqual(response.role, .host)
        XCTAssertEqual(response.inviteCode, "BQ7XKM2A")
        XCTAssertNil(response.name)
    }

    func test_createGame_withoutANameSendsNoNameKey() async throws {
        try stub(201, fixture: "create-game-response")
        _ = try await makeStubbedClient().createGame(CreateGameRequest(puzzleId: puzzleId))

        let request = try onlyRequest()
        XCTAssertEqual(
            try jsonObject(XCTUnwrap(request.body)),
            try jsonObject(SharedRESTFixtures.data("create-game-request-minimal")),
            "an unnamed create sends the minimal fixture body, no name key")
    }

    // MARK: - Joins

    func test_joinByCodeAlone_postsToGamesJoinAndDecodesTheMembership() async throws {
        try stub(200, fixture: "membership-response")
        let membership = try await makeStubbedClient().joinGame(code: "BQ7XKM2A")

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/games/join")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
        XCTAssertEqual(
            try jsonObject(XCTUnwrap(request.body)),
            try jsonObject(SharedRESTFixtures.data("join-request")))

        XCTAssertEqual(membership.gameId, gameId, "the resolved gameId is the value a code-only caller lacked")
        XCTAssertEqual(membership.role, .solver)
    }

    func test_joinCode_isSentVerbatim_normalizationIsTheServersPerINV1() async throws {
        // INV-1 lives server-side for invite codes (ASCII-only uppercase at lookup);
        // the client must send what was typed and never locale-fold.
        try stub(200, fixture: "membership-response")
        _ = try await makeStubbedClient().joinGame(code: " bq7xkm2a ")

        let request = try onlyRequest()
        let body = try XCTUnwrap(request.body)
        let object = try XCTUnwrap(try jsonObject(body) as? NSDictionary)
        XCTAssertEqual(object["code"] as? String, " bq7xkm2a ")
    }

    func test_joinKnownGame_postsToTheIdJoinPath() async throws {
        try stub(200, fixture: "membership-response")
        let membership = try await makeStubbedClient().joinGame(gameId: gameId, code: "BQ7XKM2A")

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/games/\(gameId)/join")
        XCTAssertEqual(
            try jsonObject(XCTUnwrap(request.body)),
            try jsonObject(SharedRESTFixtures.data("join-request")))
        XCTAssertEqual(membership.role, .solver)
    }

    // MARK: - Membership lifecycle

    func test_changeRole_postsTheTypedRoleRequest() async throws {
        try stub(200, fixture: "membership-response")
        let membership = try await makeStubbedClient().changeRole(gameId: gameId, to: .solver)

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/games/\(gameId)/role")
        XCTAssertEqual(
            try jsonObject(XCTUnwrap(request.body)),
            try jsonObject(SharedRESTFixtures.data("role-request")))
        XCTAssertEqual(membership.role, .solver)
    }

    func test_kick_deletesTheMemberPathAndDecodesTheRemoval() async throws {
        try stub(200, fixture: "kick-response")
        let response = try await makeStubbedClient().kickMember(gameId: gameId, userId: memberId)

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "DELETE")
        XCTAssertEqual(request.path, "/games/\(gameId)/members/\(memberId)")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
        XCTAssertNil(request.body)

        XCTAssertEqual(response.gameId, gameId)
        XCTAssertEqual(response.removed, memberId)
    }

    func test_abandon_postsWithNoBodyAndDecodesTheTerminalStatus() async throws {
        try stub(200, fixture: "abandon-response")
        let response = try await makeStubbedClient().abandonGame(gameId: gameId)

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/games/\(gameId)/abandon")
        XCTAssertNil(request.body, "the route reads no body, so none is sent")
        XCTAssertNil(request.headers["Content-Type"], "no body, no content type")

        XCTAssertEqual(response.status, .abandoned)
    }

    func test_deleteAccount_deletesTheAccountPathAndDecodesTheTombstone() async throws {
        try stub(200, fixture: "delete-account-response")
        let response = try await makeStubbedClient().deleteAccount()

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "DELETE")
        XCTAssertEqual(request.path, "/account")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")

        XCTAssertTrue(response.tombstoned)
        XCTAssertEqual(response.successions, 1)
        XCTAssertEqual(response.abandoned, ["c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f"])
        XCTAssertTrue(response.vendorDeleted)
    }

    // MARK: - Live Activity push tokens (PROTOCOL.md section 12a)

    func test_registerLiveActivityToken_postsTheBodyAndAcceptsA204() async throws {
        // Section 12a: the register route answers 204 (no body). A 204 with no payload
        // must not surface as a decode failure, so the client accepts the empty success.
        StubURLProtocol.install { _ in (204, Data()) }
        let path = ["games", gameId, "live-activity-tokens"]
        let body = LiveActivityTokenRegistration(token: "deadbeef", environment: .sandbox)
        try await makeStubbedClient().registerLiveActivityToken(path: path, body)

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/games/\(gameId)/live-activity-tokens")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        XCTAssertEqual(
            try jsonObject(XCTUnwrap(request.body)) as? [String: String],
            ["token": "deadbeef", "environment": "sandbox"])
    }

    func test_unregisterLiveActivityToken_deletesTheTokenPathAndAcceptsA204() async throws {
        // Section 12a: the delete carries the token in the path and answers 204 whether or
        // not the row existed (idempotent). No body is sent and none is decoded.
        StubURLProtocol.install { _ in (204, Data()) }
        let path = ["games", gameId, "live-activity-tokens", "deadbeef"]
        try await makeStubbedClient().unregisterLiveActivityToken(path: path)

        let request = try onlyRequest()
        XCTAssertEqual(request.method, "DELETE")
        XCTAssertEqual(request.path, "/games/\(gameId)/live-activity-tokens/deadbeef")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
        XCTAssertNil(request.body, "the delete carries no body")
    }

    func test_registerLiveActivityToken_surfacesTheTypedEnvelopeOnANon2xx() async throws {
        // A non-member is NOT_PARTICIPANT (403), a missing token or bad environment
        // VALIDATION (400): the no-content path still splits on status and throws the
        // typed section 12 envelope, exactly like the body-carrying routes.
        let envelope = Data(#"{"error":"NOT_PARTICIPANT","message":"not a member"}"#.utf8)
        StubURLProtocol.install { _ in (403, envelope) }
        let path = ["games", gameId, "live-activity-tokens"]
        let body = LiveActivityTokenRegistration(token: "deadbeef", environment: .production)
        do {
            try await makeStubbedClient().registerLiveActivityToken(path: path, body)
            XCTFail("a 403 must throw")
        } catch let CrossyAPIError.api(status, envelope) {
            XCTAssertEqual(status, 403)
            XCTAssertEqual(envelope.error, "NOT_PARTICIPANT")
        }
    }

    // MARK: - Auth sweep

    func test_everySection12MethodAttachesTheBearerHeader() async throws {
        // Every JSON route in the section 12 table is bearer-authenticated (the only
        // public route, GET /g/{code}, is an HTML unfurler shell, not a client API).
        let bodies: [String: Data] = [
            "puzzle-view": try SharedRESTFixtures.data("puzzle-view"),
            "puzzles-list": try SharedRESTFixtures.data("puzzles-list"),
            "create-game-response": try SharedRESTFixtures.data("create-game-response"),
            "games-list": try SharedRESTFixtures.data("games-list"),
            "membership-response": try SharedRESTFixtures.data("membership-response"),
            "game-view": try SharedRESTFixtures.data("game-view"),
            "kick-response": try SharedRESTFixtures.data("kick-response"),
            "abandon-response": try SharedRESTFixtures.data("abandon-response"),
            "delete-account-response": try SharedRESTFixtures.data("delete-account-response"),
        ]
        StubURLProtocol.install { request in
            switch (request.method, request.path) {
            case ("POST", "/puzzles"): return (201, bodies["puzzle-view"]!)
            case ("GET", "/puzzles"): return (200, bodies["puzzles-list"]!)
            case ("POST", "/games"): return (201, bodies["create-game-response"]!)
            case ("GET", "/games"): return (200, bodies["games-list"]!)
            case ("POST", "/games/join"), ("POST", "/games/\(gameId)/join"),
                ("POST", "/games/\(gameId)/role"):
                return (200, bodies["membership-response"]!)
            case ("GET", "/games/\(gameId)"): return (200, bodies["game-view"]!)
            case ("DELETE", "/games/\(gameId)/members/\(memberId)"):
                return (200, bodies["kick-response"]!)
            case ("POST", "/games/\(gameId)/abandon"):
                return (200, bodies["abandon-response"]!)
            case ("DELETE", "/account"):
                return (200, bodies["delete-account-response"]!)
            default:
                throw URLError(.unsupportedURL)
            }
        }

        let client = makeStubbedClient()
        _ = try await client.createPuzzle(xwordInfoDocument: Data("{}".utf8))
        _ = try await client.listPuzzles()
        _ = try await client.createGame(CreateGameRequest(puzzleId: puzzleId))
        _ = try await client.listGames()
        _ = try await client.joinGame(code: "BQ7XKM2A")
        _ = try await client.joinGame(gameId: gameId, code: "BQ7XKM2A")
        _ = try await client.game(gameId)
        _ = try await client.changeRole(gameId: gameId, to: .solver)
        _ = try await client.kickMember(gameId: gameId, userId: memberId)
        _ = try await client.abandonGame(gameId: gameId)
        _ = try await client.deleteAccount()

        let requests = StubURLProtocol.recordedRequests
        XCTAssertEqual(requests.count, 11, "the full section 12 surface")
        for request in requests {
            XCTAssertEqual(
                request.headers["Authorization"], "Bearer test-token",
                "\(request.method) \(request.path) must be bearer-authenticated")
        }
    }
}
