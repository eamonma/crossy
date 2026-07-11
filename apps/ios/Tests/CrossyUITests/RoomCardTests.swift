import XCTest

@testable import CrossyUI

// The room card's derivations (EXPERIENCE.md §3 Rooms): headline precedence (name,
// then puzzle title, then honest geometry), the subline that never repeats, and the
// member-dot arithmetic (cards sell people, not progress).

final class RoomCardTests: XCTestCase {
    private func model(
        name: String? = nil, title: String? = nil, members: Int = 2,
        gameId: String = "g1", createdAt: String = "2026-07-01T00:00:00.000Z",
        lastActivityAt: String? = nil
    ) -> RoomCardModel {
        RoomCardModel(
            gameId: gameId, name: name, puzzleTitle: title,
            rows: 15, cols: 15, memberCount: members, createdBy: "u1",
            createdAt: createdAt, lastActivityAt: lastActivityAt)
    }

    func test_orderedByActivity_matchesTheServersWithinPageOrder_PROTOCOL12() {
        // Most recently active first; a played room outranks an unplayed one; unplayed rooms fall
        // back to createdAt (newest first). The rule mirrors the server's page order (§12).
        let played1 = model(
            gameId: "a", createdAt: "2026-01-01T00:00:00.000Z",
            lastActivityAt: "2026-06-01T00:00:00.000Z")
        let played2 = model(
            gameId: "b", createdAt: "2026-02-01T00:00:00.000Z",
            lastActivityAt: "2026-06-05T00:00:00.000Z")
        let unplayedOld = model(
            gameId: "c", createdAt: "2026-03-01T00:00:00.000Z", lastActivityAt: nil)
        let unplayedNew = model(
            gameId: "d", createdAt: "2026-05-01T00:00:00.000Z", lastActivityAt: nil)

        let ordered = RoomCardModel.orderedByActivity([
            unplayedOld, played1, unplayedNew, played2,
        ])
        // Played by activity (b then a), then unplayed by createdAt (d then c).
        XCTAssertEqual(ordered.map(\.gameId), ["b", "a", "d", "c"])
    }

    func test_orderedByActivity_isStableAndTotalOnTies() {
        // Same activity: fall back to createdAt, then gameId, so the order is total and stable.
        let x = model(
            gameId: "x", createdAt: "2026-04-02T00:00:00.000Z",
            lastActivityAt: "2026-06-01T00:00:00.000Z")
        let y = model(
            gameId: "y", createdAt: "2026-04-01T00:00:00.000Z",
            lastActivityAt: "2026-06-01T00:00:00.000Z")
        // Equal activity, x created later, so x leads.
        XCTAssertEqual(RoomCardModel.orderedByActivity([y, x]).map(\.gameId), ["x", "y"])
    }

    func test_headlinePrefersTheGameNameThenTheTitleThenGeometry() {
        XCTAssertEqual(model(name: "Tuesday evening", title: "Themeless").headline, "Tuesday evening")
        XCTAssertEqual(model(title: "Themeless").headline, "Themeless")
        // Display metadata is nullable (§12); the fallback is the honest geometry.
        XCTAssertEqual(model().headline, "15\u{00D7}15 crossword")
        XCTAssertEqual(model(name: "").headline, "15\u{00D7}15 crossword", "empty reads as unnamed (§12)")
    }

    func test_theSublineCarriesTheTitleOnlyUnderANameAndNeverRepeats() {
        XCTAssertEqual(model(name: "Tuesday evening", title: "Themeless").subline, "Themeless")
        XCTAssertNil(model(title: "Themeless").subline, "the title is already the headline")
        XCTAssertNil(model(name: "Same", title: "Same").subline)
        XCTAssertNil(model(name: "Tuesday evening").subline)
    }

    func test_memberDotsCapAtFourWithAnOverflowCount() {
        // The count-badge vocabulary (root DESIGN.md §10): at most four dots, the
        // rest a +N.
        XCTAssertEqual(RoomCardDots.counts(memberCount: 1).dots, 1)
        XCTAssertEqual(RoomCardDots.counts(memberCount: 1).overflow, 0)
        XCTAssertEqual(RoomCardDots.counts(memberCount: 4).dots, 4)
        XCTAssertEqual(RoomCardDots.counts(memberCount: 4).overflow, 0)
        XCTAssertEqual(RoomCardDots.counts(memberCount: 7).dots, 4)
        XCTAssertEqual(RoomCardDots.counts(memberCount: 7).overflow, 3)
        XCTAssertEqual(RoomCardDots.counts(memberCount: 0).dots, 0, "no invented people")
        XCTAssertEqual(RoomCardDots.counts(memberCount: -1).dots, 0)
    }
}
