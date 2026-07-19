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
            RoomFactsSheetLayout.height(
                hasDetail: false, hasCheckedLine: false, operationRows: 0),
            152)
        XCTAssertEqual(
            RoomFactsSheetLayout.height(
                hasDetail: true, hasCheckedLine: false, operationRows: 0),
            180)
    }

    // Mid-solve the sheet carries the §12 operations under a one-point hairline:
    // each row adds its fixed height, and the hairline block appears exactly
    // once, only when rows exist. Two rows is the full mid-solve set now (check
    // above end-game), so the arithmetic is exercised where the sheet lives (R7).
    func test_height_operationRowsAddExactly_section12() {
        let bare = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: false, operationRows: 0)
        let one = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: false, operationRows: 1)
        let two = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: false, operationRows: 2)
        let block =
            RoomFactsSheetLayout.operationsAirAbove + RoomFactsSheetLayout.dividerHeight
            + RoomFactsSheetLayout.operationsAirBelow
        XCTAssertEqual(one, bare + block + RoomFactsSheetLayout.operationRowHeight)
        XCTAssertEqual(two, one + RoomFactsSheetLayout.operationRowHeight)
    }

    // The checked-count facts line is its own honest slot (R7: undercounting a
    // conditional clips the sheet): gap plus height, added exactly once, and
    // independent of the operations block.
    func test_height_checkedLineAddsItsOwnSlot_R7() {
        let without = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: false, operationRows: 2)
        let with = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: true, operationRows: 2)
        XCTAssertEqual(
            with,
            without + RoomFactsSheetLayout.checkedLineGap
                + RoomFactsSheetLayout.checkedLineHeight)
        // Bare of every other conditional the slot still counts once.
        let bareWith = RoomFactsSheetLayout.height(
            hasDetail: false, hasCheckedLine: true, operationRows: 0)
        XCTAssertEqual(
            bareWith,
            152 + RoomFactsSheetLayout.checkedLineGap
                + RoomFactsSheetLayout.checkedLineHeight)
    }

    // The multiplayer check row is the 48 pt hold-to-propose control, not a 44 pt list
    // row: the detent must count the control's real height, plus the hint's gap and line
    // when the grid is short, or the sheet clips its last row by ~25 pt (R7: every
    // conditional counted honestly; the Wave 15.10 fix, measured on device in the audit).
    func test_height_holdProposeRowCountsItsControlHonestly_R7() {
        let plain = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: false, operationRows: 2)
        let hold = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: false, operationRows: 2,
            holdCheckRow: true, holdHint: false)
        XCTAssertEqual(
            hold,
            plain - RoomFactsSheetLayout.operationRowHeight
                + RoomFactsSheetLayout.holdControlHeight)
        let hinted = RoomFactsSheetLayout.height(
            hasDetail: true, hasCheckedLine: false, operationRows: 2,
            holdCheckRow: true, holdHint: true)
        XCTAssertEqual(
            hinted,
            hold + RoomFactsSheetLayout.holdHintGap + RoomFactsSheetLayout.holdHintHeight)
    }

    // Without a check row the hold flags are inert: the arithmetic cannot invent a slot.
    func test_height_holdFlagsAreInertWithoutRows_R7() {
        XCTAssertEqual(
            RoomFactsSheetLayout.height(
                hasDetail: true, hasCheckedLine: false, operationRows: 0,
                holdCheckRow: true, holdHint: true),
            RoomFactsSheetLayout.height(
                hasDetail: true, hasCheckedLine: false, operationRows: 0))
    }
}

// The hold-to-propose fill under Reduce Motion (U3): the fill is a STEPPED state, never a
// continuous sweep — quarters advancing across the hold, full just before the commit. The
// old binary fill read as armed at touch-down and then did nothing.
final class HoldToProposeSteppedFillTests: XCTestCase {
    func test_reducedMotionFillStepsInQuarters_U3() {
        XCTAssertEqual(HoldToProposeButton.steppedFill(elapsed: 0), 0.25)
        XCTAssertEqual(HoldToProposeButton.steppedFill(elapsed: 0.10), 0.25)
        XCTAssertEqual(HoldToProposeButton.steppedFill(elapsed: 0.16), 0.5)
        XCTAssertEqual(HoldToProposeButton.steppedFill(elapsed: 0.31), 0.75)
        XCTAssertEqual(HoldToProposeButton.steppedFill(elapsed: 0.46), 1.0)
        XCTAssertEqual(HoldToProposeButton.steppedFill(elapsed: 0.9), 1.0, "never past full")
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

    // The check record among the facts (PROTOCOL.md §10, D27; design R10):
    // quiet, neutral, natural casing — "Checked once", then counted — and
    // absent entirely before the first accepted check (no zeros).
    func test_midSolve_checkedLineWording_D27() {
        XCTAssertNil(RoomFactsContent.checkedLine(count: 0))
        XCTAssertEqual(RoomFactsContent.checkedLine(count: 1), "Checked once")
        XCTAssertEqual(RoomFactsContent.checkedLine(count: 2), "Checked 2 times")
        XCTAssertEqual(RoomFactsContent.checkedLine(count: 7), "Checked 7 times")
    }

    func test_midSolve_carriesTheCheckedLine_R10() {
        let content = RoomFactsContent.make(
            roomName: "Tuesday evening", puzzleTitle: nil, puzzleAuthor: nil,
            puzzleDate: nil, completed: false, totalEvents: nil,
            participantCount: nil, checkCount: 3)
        XCTAssertEqual(content.checkedLine, "Checked 3 times")
    }

    // After completion the count's home is stats.checkCount on the analysis
    // surface (R10, deferred deliberately); the completed derivation carries
    // no checked line.
    func test_completed_carriesNoCheckedLine_R10() {
        let content = RoomFactsContent.make(
            roomName: "trio", puzzleTitle: nil, puzzleAuthor: nil, puzzleDate: nil,
            completed: true, totalEvents: 10, participantCount: 2, checkCount: 3)
        XCTAssertNil(content.checkedLine)
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

// The sheet's operations (owner ruling 2026-07-10; the room-actions design,
// D27). Two rows can stand mid-solve: the room check (any host or solver,
// PROTOCOL.md §5, §10) above the host's end-game (host abandon, a FORBIDDEN
// for a non-host, PROTOCOL.md §12). Kick is not here; it lives on the roster
// menu. The derivation is pure, so the view renders no policy, and rowCount
// feeds the sheet-height arithmetic.

final class FactsOperationsTests: XCTestCase {
    func test_host_seesCheckAboveEndGame_D27() {
        let ops = FactsOperations.make(
            isHost: true, isSpectator: false, supportsCheck: true, emptyCells: 0)
        XCTAssertTrue(ops.canEndGame)
        XCTAssertNotNil(ops.check)
        XCTAssertTrue(ops.hasAny)
        XCTAssertEqual(ops.rowCount, 2)
    }

    // The empty set renders no hairline, no rows, and adds nothing to the
    // sheet height.
    func test_none_isTheEmptySet() {
        XCTAssertEqual(FactsOperations.none.rowCount, 0)
        XCTAssertFalse(FactsOperations.none.hasAny)
        XCTAssertFalse(FactsOperations.none.canEndGame)
        XCTAssertNil(FactsOperations.none.check)
    }

    // A non-host solver checks but never ends: end-game stays host-only
    // (PROTOCOL.md §12) while the check is any host or solver (§5).
    func test_solver_seesCheckOnly_PROTOCOL5() {
        let ops = FactsOperations.make(
            isHost: false, isSpectator: false, supportsCheck: true, emptyCells: 3)
        XCTAssertFalse(ops.canEndGame)
        XCTAssertNotNil(ops.check)
        XCTAssertEqual(ops.rowCount, 1)
    }

    // Spectators never see the check row (PROTOCOL.md §5: checkPuzzle is
    // host|solver; the server enforces the role gate regardless).
    func test_spectator_neverSeesCheck_PROTOCOL5() {
        let ops = FactsOperations.make(
            isHost: false, isSpectator: true, supportsCheck: true, emptyCells: 0)
        XCTAssertNil(ops.check)
        XCTAssertFalse(ops.hasAny)
    }

    // Without a check-capable transport the row does not exist at all (design
    // R8): the demo's loopback drops checkPuzzle, so the demo sheet must not
    // grow a row that confirms into a void.
    func test_noLiveTransport_excludesTheCheckRowEntirely_R8() {
        let ops = FactsOperations.make(
            isHost: true, isSpectator: false, supportsCheck: false, emptyCells: 0)
        XCTAssertNil(ops.check)
        XCTAssertEqual(ops.rowCount, 1, "end-game alone; no dead check act")
    }

    // The grid-full gate (PROTOCOL.md §5, §10): enabled at zero empty cells,
    // disabled below full with the quiet remaining-cells hint teaching the gate.
    // Natural casing, no exclamation points; singular at one.
    func test_check_enablesOnlyOnAFullGridAndHintsBelowIt_PROTOCOL10() {
        let full = FactsOperations.Check(emptyCells: 0)
        XCTAssertTrue(full.isEnabled)
        XCTAssertNil(full.hint, "no hint at full: the row simply enables")
        let three = FactsOperations.Check(emptyCells: 3)
        XCTAssertFalse(three.isEnabled)
        XCTAssertEqual(three.hint, "3 empty")
        let one = FactsOperations.Check(emptyCells: 1)
        XCTAssertFalse(one.isEnabled)
        XCTAssertEqual(one.hint, "1 empty")
    }

    // A negative input (a stand-in puzzle racing state) clamps to zero rather
    // than rendering a nonsense hint; R9's derivation is sequenced state only.
    func test_check_clampsNegativeEmptyCounts_R9() {
        let check = FactsOperations.Check(emptyCells: -2)
        XCTAssertEqual(check.emptyCells, 0)
        XCTAssertTrue(check.isEnabled)
    }
}
