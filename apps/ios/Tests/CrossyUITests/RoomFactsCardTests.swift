import CoreGraphics
import Foundation
import XCTest

@testable import CrossyUI

// The room-facts card (owner ruling 2026-07-10: the time pill is the room's
// facts; at completion the card is the stats card, ID-2 unchanged). Pinned like
// every morph: the geometry is pure math, the words derive once as plain
// strings, and the headline clock is one rule shared with the bar's own
// arithmetic, so the hand-off on both ends is exact by construction.

final class FactsRideLayoutTests: XCTestCase {
    /// A facts-shaped morph: rest is the time pill's frame; open is the card
    /// hanging under the room bar, at the no-detail height.
    private let morph = GlassMorph(
        rest: CGRect(x: 230, y: 10, width: 66, height: 44),
        open: CGRect(x: 26, y: 62, width: 340, height: 112),
        restCornerRadius: 22,
        openCornerRadius: 24)

    /// The clock's center inside the rest pill: right of the pill's middle,
    /// because the weather sits beside the clock (owner ruling 2026-07-10).
    private let clockCenter = CGPoint(x: 275, y: 32)

    func test_panelHeight_isSlotArithmetic() {
        XCTAssertEqual(FactsRideLayout.panelHeight(hasDetail: false), 112)
        XCTAssertEqual(FactsRideLayout.panelHeight(hasDetail: true), 134)
    }

    // The rider launches from the glyphs it left (DESIGN.md §4: content rides
    // the morph and hands off from the chrome it left): the rest point is the
    // pill clock's own reported center, not the pill's middle, now that the
    // weather shares the pill.
    func test_rider_atRest_sitsExactlyOnThePillsClock_ID2() {
        let center = FactsRideLayout.timeCenter(
            morph: morph, restCenter: clockCenter, progress: 0)
        XCTAssertEqual(center.x, clockCenter.x - morph.rest.minX, accuracy: 0.0001)
        XCTAssertEqual(center.y, clockCenter.y - morph.rest.minY, accuracy: 0.0001)
    }

    func test_rider_atOpen_landsExactlyInTheHeadlineSlot_ID2() {
        let center = FactsRideLayout.timeCenter(
            morph: morph, restCenter: clockCenter, progress: 1)
        XCTAssertEqual(center.x, morph.open.width / 2, accuracy: 0.0001)
        XCTAssertEqual(center.y, FactsRideLayout.timeCenterY(), accuracy: 0.0001)
        XCTAssertEqual(FactsRideLayout.timeCenterY(), 66)
    }

    func test_fontSize_walksPillClockToHeadline() {
        XCTAssertEqual(FactsRideLayout.fontSize(at: 0), 13)
        XCTAssertEqual(FactsRideLayout.fontSize(at: 1), 40)
        XCTAssertEqual(FactsRideLayout.fontSize(at: 0.5), 26.5)
    }

    func test_rider_midMorph_staysInsideTheInterpolatedSurface() {
        for progress in stride(from: CGFloat(0), through: 1, by: 0.1) {
            let frame = morph.frame(at: progress)
            let center = FactsRideLayout.timeCenter(
                morph: morph, restCenter: clockCenter, progress: progress)
            XCTAssertTrue(center.x >= 0 && center.x <= frame.width)
            XCTAssertTrue(center.y >= 0 && center.y <= frame.height)
        }
    }

    // Row text takes the open card's CONSTANT content width, so truncation is
    // computed once and a mid-morph width never re-truncates a line (owner
    // device finding 2026-07-10, the stats pour-back).
    func test_contentWidth_isConstantAgainstTheOpenCard_section4() {
        XCTAssertEqual(FactsRideLayout.contentWidth(openWidth: 340), 300)
        XCTAssertEqual(FactsRideLayout.contentWidth(openWidth: 10), 0)
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

    // Mid-solve the headline is the live ambient clock: the card never stops
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

// The card's words (EXPERIENCE.md Completed; owner ruling 2026-07-10 for the
// mid-solve facts): derived once as plain strings so the card renders no
// arithmetic, and the detail line carries what exists rather than zeros.

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

    // At completion the same surface is the stats card, unchanged (ID-2): the
    // lexicon word leads and the server's stats fill the detail.
    func test_completed_isTheStatsCard_ID5() {
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

    func test_completed_singularWordsForOne_ID5() {
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

// The mid-solve facts popover's operations (owner ruling 2026-07-10): only what
// the API already supports (PROTOCOL.md §12). Copy the invite code (a member
// holds it), and for the host, end the game (host abandon, a FORBIDDEN for a
// non-host). Kick is not here; it lives on the roster menu. The derivation is
// pure, so the popover renders no policy.

final class FactsOperationsTests: XCTestCase {
    func test_host_seesCopyAndEndGame() {
        let ops = FactsOperations.make(inviteCode: "TIDECOVE", isHost: true)
        XCTAssertEqual(ops.inviteCode, "TIDECOVE")
        XCTAssertTrue(ops.canEndGame)
        XCTAssertTrue(ops.hasAny)
    }

    // A non-host still copies the code (every member holds it, §12) but is never
    // offered the destructive end-game; the server refuses a non-host abandon,
    // and the popover simply does not show it.
    func test_nonHost_copiesButNeverEndsGame() {
        let ops = FactsOperations.make(inviteCode: "TIDECOVE", isHost: false)
        XCTAssertEqual(ops.inviteCode, "TIDECOVE")
        XCTAssertFalse(ops.canEndGame)
        XCTAssertTrue(ops.hasAny)
    }

    // The copy row drops when the client holds no code: a blank or absent code
    // leaves the row out (the ruling accepts facts-alone when nothing is
    // available).
    func test_missingCode_dropsTheCopyRow() {
        XCTAssertNil(FactsOperations.make(inviteCode: nil, isHost: false).inviteCode)
        XCTAssertNil(FactsOperations.make(inviteCode: "", isHost: false).inviteCode)
        XCTAssertNil(FactsOperations.make(inviteCode: "   ", isHost: false).inviteCode)
    }

    // A non-host with no code in hand has no operations at all: the popover
    // then shows facts alone, which the ruling accepts.
    func test_nonHostNoCode_hasNoOperations() {
        let ops = FactsOperations.make(inviteCode: nil, isHost: false)
        XCTAssertFalse(ops.hasAny)
        XCTAssertNil(ops.inviteCode)
        XCTAssertFalse(ops.canEndGame)
    }

    // A whitespace-padded code is trimmed to its usable value (the room view
    // carries a clean code, but the derivation is defensive).
    func test_code_isTrimmed() {
        XCTAssertEqual(
            FactsOperations.make(inviteCode: " TIDECOVE ", isHost: false).inviteCode,
            "TIDECOVE")
    }
}
