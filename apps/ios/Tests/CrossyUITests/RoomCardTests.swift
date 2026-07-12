import XCTest

@testable import CrossyUI

// The room card's derivations (EXPERIENCE.md §3 Rooms): headline precedence (name,
// then puzzle title, then honest geometry), the subline that never repeats, and the
// member-dot arithmetic (cards sell people, not progress).

final class RoomCardTests: XCTestCase {
    private func model(
        name: String? = nil, title: String? = nil, members: Int = 2,
        gameId: String = "g1", createdAt: String = "2026-07-01T00:00:00.000Z",
        completedAt: String? = nil, lastActivityAt: String? = nil
    ) -> RoomCardModel {
        RoomCardModel(
            gameId: gameId, name: name, puzzleTitle: title,
            rows: 15, cols: 15, memberCount: members, createdBy: "u1",
            createdAt: createdAt, completedAt: completedAt, lastActivityAt: lastActivityAt)
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

    func test_isSolvedReadsTheCompletedFact_PROTOCOL12() {
        // §12: completedAt is the one lifecycle fact the home needs; a non-null time is solved,
        // null (ongoing, or an abandoned game that never completed) is not.
        XCTAssertTrue(model(completedAt: "2026-07-08T20:11:47.000Z").isSolved)
        XCTAssertFalse(model(completedAt: nil).isSolved, "ongoing (and abandoned) read as not solved")
    }

    func test_shelved_partitionsLiveFromSolved_PROTOCOL12() {
        // The web's shelf grammar (Home.tsx GamesList): live rooms lead, solved gather trailing.
        let live1 = model(gameId: "a", completedAt: nil)
        let solved1 = model(gameId: "b", completedAt: "2026-07-08T20:11:47.000Z")
        let live2 = model(gameId: "c", completedAt: nil)
        let solved2 = model(gameId: "d", completedAt: "2026-07-09T09:00:00.000Z")

        let shelved = RoomCardModel.shelved([live1, solved1, live2, solved2])
        XCTAssertEqual(shelved.live.map(\.gameId), ["a", "c"])
        XCTAssertEqual(shelved.solved.map(\.gameId), ["b", "d"])
    }

    func test_shelved_preservesOrderWithinEachGroup_PROTOCOL12() {
        // Partition never re-sorts: each group keeps the input order (the caller already
        // ordered by activity, and pages append never globally re-sort, §12 pagination).
        let rooms = [
            model(gameId: "s1", completedAt: "2026-07-09T00:00:00.000Z"),
            model(gameId: "l1", completedAt: nil),
            model(gameId: "s2", completedAt: "2026-07-08T00:00:00.000Z"),
            model(gameId: "l2", completedAt: nil),
            model(gameId: "s3", completedAt: "2026-07-07T00:00:00.000Z"),
        ]
        let shelved = RoomCardModel.shelved(rooms)
        XCTAssertEqual(shelved.live.map(\.gameId), ["l1", "l2"], "live order preserved")
        XCTAssertEqual(shelved.solved.map(\.gameId), ["s1", "s2", "s3"], "solved order preserved")
    }

    func test_shelved_allLiveGivesEmptySolved_PROTOCOL12() {
        // When nothing is solved the trailing section does not render (the web's all-live shelf
        // carries no empty header); the helper reports an empty solved group.
        let rooms = [model(gameId: "a"), model(gameId: "b")]
        let shelved = RoomCardModel.shelved(rooms)
        XCTAssertEqual(shelved.live.map(\.gameId), ["a", "b"])
        XCTAssertTrue(shelved.solved.isEmpty)
    }

    func test_shelved_allSolvedGivesEmptyLive_PROTOCOL12() {
        let rooms = [
            model(gameId: "a", completedAt: "2026-07-08T00:00:00.000Z"),
            model(gameId: "b", completedAt: "2026-07-09T00:00:00.000Z"),
        ]
        let shelved = RoomCardModel.shelved(rooms)
        XCTAssertTrue(shelved.live.isEmpty)
        XCTAssertEqual(shelved.solved.map(\.gameId), ["a", "b"])
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
