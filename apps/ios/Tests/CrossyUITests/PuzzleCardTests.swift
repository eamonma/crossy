import XCTest

@testable import CrossyUI

// The puzzle card's derivations (the library tab): headline precedence (title, then
// honest geometry) and the author subline that never renders empty. No people row by
// design — a puzzle has no members, and people are the only color a card earns
// (RoomCardTests pins the dots; a library has none to pin).

final class PuzzleCardTests: XCTestCase {
    private func model(title: String? = nil, author: String? = nil) -> PuzzleCardModel {
        PuzzleCardModel(puzzleId: "p1", title: title, author: author, rows: 15, cols: 15)
    }

    func test_headlinePrefersTheTitleThenGeometry() {
        XCTAssertEqual(model(title: "A door left ajar").headline, "A door left ajar")
        // Display metadata is nullable (§12); the fallback is the honest geometry.
        XCTAssertEqual(model().headline, "15\u{00D7}15 crossword")
        XCTAssertEqual(model(title: "").headline, "15\u{00D7}15 crossword", "empty reads as untitled (§12)")
    }

    func test_theSublineIsTheAuthorAndNeverRendersEmpty() {
        XCTAssertEqual(model(title: "Themeless", author: "June Park").subline, "June Park")
        XCTAssertNil(model(title: "Themeless").subline)
        XCTAssertNil(model(title: "Themeless", author: "").subline, "empty reads as unauthored (§12)")
        // An untitled, unauthored upload reads as geometry alone, no blank lines.
        XCTAssertNil(model().subline)
    }
}
