import Foundation
import XCTest

import CrossyAPI
import CrossyProtocol

// Cursor pagination for the two list endpoints (PROTOCOL.md section 12): `limit`
// clamped server-side to [1, 100], `before` an ISO 8601 `createdAt` the page filters
// strictly before, and the client pages by passing the last row's `createdAt` as the
// next `before`. The parameter names `limit` and `before` are the API's own
// (apps/api/src/http/pagination.ts), which section 12 defers to. The wire carries no
// has-more flag, so iteration honestly ends on the first empty page.

@available(macOS 12.0, iOS 15.0, *)
final class PaginationTests: XCTestCase {
    /// A second games page, older than the fixture page's last row.
    private let olderGamesPage = Data(
        #"""
        {
          "games": [
            {
              "gameId": "d4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f8a",
              "name": null,
              "role": "solver",
              "createdAt": "2026-07-06T08:00:00.000Z",
              "createdBy": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
              "memberCount": 2,
              "puzzle": {
                "puzzleId": "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c",
                "rows": 15,
                "cols": 15,
                "title": null
              }
            }
          ]
        }
        """#.utf8)

    func test_listGames_followsTheCreatedAtCursorAcrossTwoPagesAndEndsOnTheEmptyOne()
        async throws
    {
        let firstPage = try SharedRESTFixtures.data("games-list")
        let olderPage = olderGamesPage
        StubURLProtocol.install { request in
            switch request.queryValue("before") {
            case nil: return (200, firstPage)
            case "2026-07-07T09:30:00.000Z": return (200, olderPage)
            case "2026-07-06T08:00:00.000Z": return (200, Data(#"{"games":[]}"#.utf8))
            case let other: throw URLError(.unsupportedURL, userInfo: ["before": other ?? ""])
            }
        }
        let client = makeStubbedClient()

        let page1 = try await client.listGames(limit: 2)
        XCTAssertEqual(page1.rows.count, 2)
        XCTAssertEqual(
            page1.nextBefore, "2026-07-07T09:30:00.000Z",
            "the cursor is the server-computed nextBefore (the page-minimum createdAt)")

        // The older page predates activity ordering (no nextBefore key), so the client falls back
        // to the last row's createdAt: the two paths meet at the same cursor value here.
        let page2 = try await client.listGames(limit: 2, before: page1.nextBefore)
        XCTAssertEqual(page2.rows.count, 1)
        XCTAssertEqual(page2.rows[0].createdAt, "2026-07-06T08:00:00.000Z")
        XCTAssertEqual(page2.nextBefore, "2026-07-06T08:00:00.000Z")

        let page3 = try await client.listGames(limit: 2, before: page2.nextBefore)
        XCTAssertTrue(page3.rows.isEmpty)
        XCTAssertNil(page3.nextBefore, "an empty page ends iteration")

        let requests = StubURLProtocol.recordedRequests
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(requests[0].queryValue("limit"), "2")
        XCTAssertNil(requests[0].queryValue("before"), "the first page sends no cursor")
        XCTAssertEqual(requests[1].queryValue("limit"), "2")
        XCTAssertEqual(requests[1].queryValue("before"), "2026-07-07T09:30:00.000Z")
        XCTAssertEqual(requests[2].queryValue("before"), "2026-07-06T08:00:00.000Z")
        for request in requests {
            XCTAssertEqual(request.path, "/games", "the cursor rides the query, not the path")
        }
    }

    func test_listPuzzles_passesTheCursorThroughAndEndsOnTheEmptyPage() async throws {
        let firstPage = try SharedRESTFixtures.data("puzzles-list")
        StubURLProtocol.install { request in
            if request.queryValue("before") == nil {
                return (200, firstPage)
            }
            return (200, Data(#"{"puzzles":[]}"#.utf8))
        }
        let client = makeStubbedClient()

        let page1 = try await client.listPuzzles()
        XCTAssertEqual(page1.rows.count, 2)
        XCTAssertEqual(page1.nextBefore, "2026-07-07T09:30:00.000Z")

        let page2 = try await client.listPuzzles(before: page1.nextBefore)
        XCTAssertTrue(page2.rows.isEmpty)
        XCTAssertNil(page2.nextBefore)

        let requests = StubURLProtocol.recordedRequests
        XCTAssertEqual(requests.count, 2)
        XCTAssertNil(requests[0].queryValue("before"))
        XCTAssertNil(requests[0].queryValue("limit"), "an unset limit is omitted, not defaulted")
        XCTAssertEqual(requests[1].queryValue("before"), "2026-07-07T09:30:00.000Z")
    }
}
