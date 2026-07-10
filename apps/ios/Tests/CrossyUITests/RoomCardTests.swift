import XCTest

@testable import CrossyUI

// The room card's derivations (EXPERIENCE.md §3 Rooms): headline precedence (name,
// then puzzle title, then honest geometry), the subline that never repeats, and the
// member-dot arithmetic (cards sell people, not progress).

final class RoomCardTests: XCTestCase {
    private func model(
        name: String? = nil, title: String? = nil, members: Int = 2
    ) -> RoomCardModel {
        RoomCardModel(
            gameId: "g1", name: name, puzzleTitle: title,
            rows: 15, cols: 15, memberCount: members, createdBy: "u1")
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
