import XCTest

@testable import CrossyUI

// The terminal states' rendered truth: the deck retires on completed and
// abandoned (mutation was already refused by the store and InputActions; this is
// what the room shows), and the copy is the EXPERIENCE.md §5 lexicon verbatim
// (ID-5: plain and warm). The stats card's derivations moved with the card into
// the room-facts card (RoomFactsCardTests).

final class RoomTerminalTests: XCTestCase {
    // MARK: - The frozen deck

    func test_deckRetiresOnTerminalStatus_selectionStaysForBrowsing_section8() {
        XCTAssertFalse(RoomTerminal.deckRetired(status: .ongoing))
        XCTAssertTrue(RoomTerminal.deckRetired(status: .completed))
        XCTAssertTrue(RoomTerminal.deckRetired(status: .abandoned))
    }

    // MARK: - The lexicon (ID-5, EXPERIENCE.md §5 verbatim)

    func test_kickedExitSpeaksTheOneHonestSentence_ID5() {
        XCTAssertEqual(RoomTerminal.kickedNotice, "The host removed you from this room")
        XCTAssertEqual(RoomTerminal.kickedExitWord, "Back to Rooms")
    }

    func test_abandonedNoticeIsTheLexiconLine_ID5() {
        XCTAssertEqual(RoomTerminal.abandonedNotice, "The host ended this game")
    }

    func test_completionWordIsSolvedTogether_ID5() {
        XCTAssertEqual(RoomTerminal.completedNotice, "Solved together")
    }
}
