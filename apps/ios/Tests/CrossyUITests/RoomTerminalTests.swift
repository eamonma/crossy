import XCTest

@testable import CrossyUI

// The terminal states' rendered truth: the deck retires on completed and
// abandoned (mutation was already refused by the store and InputActions; this is
// what the room shows), the copy is the EXPERIENCE.md §5 lexicon verbatim (ID-5:
// plain and warm), and the stats card derives its strings once.

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

    // MARK: - The stats card (EXPERIENCE.md Completed: solve time, entries, solvers)

    func test_statsCard_serverStatsLeadTheCard() {
        let content = StatsCardContent.make(
            solveTimeSeconds: 763,
            totalEvents: 143,
            participantCount: 3,
            firstFillAt: "2026-07-07T19:00:00Z",
            completedAt: "2026-07-07T19:40:03Z")
        XCTAssertEqual(content.time, "12:43")
        XCTAssertEqual(content.detail, "143 entries · 3 solvers")
    }

    // Without server stats (a snapshot that carried none), the time is the
    // ambient clock's frozen value (ID-2: frozen at completedAt), and the detail
    // line vanishes rather than showing zeros.
    func test_statsCard_frozenClockFallbackWhenStatsAbsent() {
        let content = StatsCardContent.make(
            solveTimeSeconds: nil,
            totalEvents: nil,
            participantCount: nil,
            firstFillAt: "2026-07-07T19:00:00Z",
            completedAt: "2026-07-07T19:12:34Z")
        XCTAssertEqual(content.time, "12:34")
        XCTAssertNil(content.detail)
    }

    func test_statsCard_singularWordsForOne_ID5() {
        let content = StatsCardContent.make(
            solveTimeSeconds: 61,
            totalEvents: 1,
            participantCount: 1,
            firstFillAt: nil,
            completedAt: nil)
        XCTAssertEqual(content.time, "1:01")
        XCTAssertEqual(content.detail, "1 entry · 1 solver")
    }

    func test_statsCard_partialStatsCarryWhatExists() {
        let content = StatsCardContent.make(
            solveTimeSeconds: 3600,
            totalEvents: nil,
            participantCount: 3,
            firstFillAt: nil,
            completedAt: nil)
        XCTAssertEqual(content.time, "1:00:00")
        XCTAssertEqual(content.detail, "3 solvers")
    }
}
