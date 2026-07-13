import CoreGraphics
import Foundation
import XCTest

@testable import CrossyUI

// The room-facts sheet (owner ruling 2026-07-10: the time pill is the room's
// facts; the tap-opened surface is a plain system sheet, 2026-07-12). Pinned
// like the ShareQRSheet: the detent height is pure slot arithmetic (the
// operations block included), the words derive once as plain strings, and the
// headline clock is one rule shared with the bar's own arithmetic, so the frozen
// pill and the sheet always agree.

final class RoomFactsSheetLayoutTests: XCTestCase {
    // The detent height is arithmetic, never font metrics (the ShareQRSheetLayout
    // discipline): slots plus padding, the detail and the operation rows adding
    // their exact heights.
    func test_height_isSlotArithmetic() {
        XCTAssertEqual(
            RoomFactsSheetLayout.height(hasDetail: false, operationRows: 0), 152)
        XCTAssertEqual(
            RoomFactsSheetLayout.height(hasDetail: true, operationRows: 0), 180)
    }

    // Mid-solve the sheet carries the §12 operations under a one-point hairline:
    // each row adds its fixed height, and the hairline block appears exactly
    // once, only when rows exist.
    func test_height_operationRowsAddExactly_section12() {
        let bare = RoomFactsSheetLayout.height(hasDetail: true, operationRows: 0)
        let one = RoomFactsSheetLayout.height(hasDetail: true, operationRows: 1)
        let two = RoomFactsSheetLayout.height(hasDetail: true, operationRows: 2)
        let block =
            RoomFactsSheetLayout.operationsAirAbove + RoomFactsSheetLayout.dividerHeight
            + RoomFactsSheetLayout.operationsAirBelow
        XCTAssertEqual(one, bare + block + RoomFactsSheetLayout.operationRowHeight)
        XCTAssertEqual(two, one + RoomFactsSheetLayout.operationRowHeight)
    }
}

// The headline clock: one pure rule, the server's stat first (stats arrive only
// with gameCompleted, PROTOCOL.md §6), the ambient clock's value otherwise,
// which ticks mid-solve and freezes at the terminal instant (ID-2).

final class RoomFactsClockTests: XCTestCase {
    func test_headline_serverStatLeads_ID2() {
        let time = RoomFactsClock.headline(
            solveTimeSeconds: 763,
            firstFillAt: "2026-07-07T19:00:00Z",
            completedAt: "2026-07-07T19:40:03Z",
            now: Date(timeIntervalSinceReferenceDate: 0))
        XCTAssertEqual(time, "12:43")
    }

    // Without server stats (a snapshot that carried none), the headline is the
    // ambient clock's frozen value (ID-2: frozen at the terminal instant),
    // whatever now says.
    func test_headline_frozenClockFallbackWhenStatsAbsent_ID2() {
        let anyNow = AmbientClock.parse("2026-07-08T09:00:00Z")!
        let time = RoomFactsClock.headline(
            solveTimeSeconds: nil,
            firstFillAt: "2026-07-07T19:00:00Z",
            completedAt: "2026-07-07T19:12:34Z",
            now: anyNow)
        XCTAssertEqual(time, "12:34")
    }

    // Mid-solve the headline is the live ambient clock: the sheet never stops
    // the room's time (the time pill is the room's facts, owner ruling
    // 2026-07-10).
    func test_headline_ticksWithNowWhileTheRoomRuns_ID2() {
        let firstFill = "2026-07-07T19:00:00Z"
        let early = RoomFactsClock.headline(
            solveTimeSeconds: nil, firstFillAt: firstFill, completedAt: nil,
            now: AmbientClock.parse("2026-07-07T19:05:00Z")!)
        let later = RoomFactsClock.headline(
            solveTimeSeconds: nil, firstFillAt: firstFill, completedAt: nil,
            now: AmbientClock.parse("2026-07-07T19:05:01Z")!)
        XCTAssertEqual(early, "5:00")
        XCTAssertEqual(later, "5:01")
    }
}

// The sheet's words (owner ruling 2026-07-10 for the mid-solve facts): derived
// once as plain strings so the view renders no arithmetic, and the detail line
// carries what exists rather than zeros. The completed branch is a pure
// derivation kept for coverage; the live sheet never opens on a completed room
// (the pill seals instead, owner ruling 2026-07-12: not at game end).

final class RoomFactsContentTests: XCTestCase {
    func test_midSolve_theLabelIsTheRoomAndTheDetailThePuzzlesFacts() {
        let content = RoomFactsContent.make(
            roomName: "Tuesday evening",
            puzzleTitle: "Midsummer Crossings",
            puzzleAuthor: "Wren Ellery",
            puzzleDate: "July 8, 2026",
            completed: false,
            totalEvents: nil,
            participantCount: nil)
        XCTAssertEqual(content.label, "Tuesday evening")
        XCTAssertEqual(content.detail, "Midsummer Crossings · Wren Ellery · July 8, 2026")
    }

    // The wire carries no puzzle metadata yet (the render params are the
    // stopgap): absent or empty facts collapse instead of leaving separators.
    func test_midSolve_missingMetadataCollapses() {
        let partial = RoomFactsContent.make(
            roomName: "Tuesday evening",
            puzzleTitle: "Midsummer Crossings",
            puzzleAuthor: nil,
            puzzleDate: "",
            completed: false,
            totalEvents: nil,
            participantCount: nil)
        XCTAssertEqual(partial.detail, "Midsummer Crossings")
        let none = RoomFactsContent.make(
            roomName: "Tuesday evening",
            puzzleTitle: nil,
            puzzleAuthor: nil,
            puzzleDate: nil,
            completed: false,
            totalEvents: nil,
            participantCount: nil)
        XCTAssertNil(none.detail)
    }

    // The completed derivation (kept for coverage): the lexicon word leads and
    // the server's stats fill the detail.
    func test_completed_derivesTheStatsWords() {
        let content = RoomFactsContent.make(
            roomName: "Tuesday evening",
            puzzleTitle: "Midsummer Crossings",
            puzzleAuthor: "Wren Ellery",
            puzzleDate: "July 8, 2026",
            completed: true,
            totalEvents: 143,
            participantCount: 3)
        XCTAssertEqual(content.label, "Solved together")
        XCTAssertEqual(content.detail, "143 entries · 3 solvers")
    }

    func test_completed_singularWordsForOne() {
        let content = RoomFactsContent.make(
            roomName: "solo", puzzleTitle: nil, puzzleAuthor: nil, puzzleDate: nil,
            completed: true, totalEvents: 1, participantCount: 1)
        XCTAssertEqual(content.detail, "1 entry · 1 solver")
    }

    func test_completed_partialStatsCarryWhatExists() {
        let content = RoomFactsContent.make(
            roomName: "trio", puzzleTitle: nil, puzzleAuthor: nil, puzzleDate: nil,
            completed: true, totalEvents: nil, participantCount: 3)
        XCTAssertEqual(content.detail, "3 solvers")
    }

    // A completed room with no stats shows no zeros: the detail vanishes and
    // the headline falls back to the frozen clock (RoomFactsClockTests).
    func test_completed_noStatsMeansNoDetail() {
        let content = RoomFactsContent.make(
            roomName: "quiet", puzzleTitle: nil, puzzleAuthor: nil, puzzleDate: nil,
            completed: true, totalEvents: nil, participantCount: nil)
        XCTAssertEqual(content.label, "Solved together")
        XCTAssertNil(content.detail)
    }
}

// The sheet's operations (owner ruling 2026-07-10). Copy invite code retired
// 2026-07-11 (the share surface, now a native menu, owns invite copying: its
// Section header carries the code, Copy link the URL). So the only operation
// left is the host's end-game (host abandon, a FORBIDDEN for a non-host,
// PROTOCOL.md §12). Kick is not here; it lives on the roster menu. The
// derivation is pure, so the view renders no policy, and rowCount feeds the
// sheet-height arithmetic.

final class FactsOperationsTests: XCTestCase {
    func test_host_seesEndGame() {
        let ops = FactsOperations.make(isHost: true)
        XCTAssertTrue(ops.canEndGame)
        XCTAssertTrue(ops.hasAny)
        XCTAssertEqual(ops.rowCount, 1)
    }

    // The empty set renders no hairline, no rows, and adds nothing to the
    // sheet height.
    func test_none_isTheEmptySet() {
        XCTAssertEqual(FactsOperations.none.rowCount, 0)
        XCTAssertFalse(FactsOperations.none.hasAny)
        XCTAssertFalse(FactsOperations.none.canEndGame)
    }

    // A non-host is never offered the destructive end-game; the server refuses
    // a non-host abandon, and the sheet simply does not show it. With copy-code
    // retired, a non-host mid-solve has no operations at all: the sheet shows
    // facts alone, which the ruling accepts.
    func test_nonHost_hasNoOperations() {
        let ops = FactsOperations.make(isHost: false)
        XCTAssertFalse(ops.canEndGame)
        XCTAssertFalse(ops.hasAny)
        XCTAssertEqual(ops.rowCount, 0)
    }
}
