import Foundation
import XCTest

import CrossyProtocol

// The island's presentation math (push track, phase 2a), pinned headlessly the way the
// lifecycle policy is: pure arithmetic for the progress ring, the ticked meter, and the
// frozen solve time. The math lives in CrossyProtocol beside the payload it interprets,
// because that is the one package product the widget extension links; this suite is why
// it can live anywhere at all, every rule pinned without ActivityKit or a device.

final class IslandPresentationTests: XCTestCase {
    // MARK: - Fraction

    /// The fraction clamps to 0...1 and reports the counts as a ratio.
    func test_fractionIsTheClampedRatio() {
        XCTAssertEqual(IslandPresentation.fraction(filled: 34, total: 78), 34.0 / 78.0)
        XCTAssertEqual(IslandPresentation.fraction(filled: 0, total: 78), 0)
        XCTAssertEqual(IslandPresentation.fraction(filled: 78, total: 78), 1)
    }

    /// A filled past total (a race between completion and the count) clamps to full, never
    /// past 1: the ring cannot overshoot.
    func test_fractionClampsPastFull() {
        XCTAssertEqual(IslandPresentation.fraction(filled: 90, total: 78), 1)
    }

    /// total <= 0 has no progress to show: nil, so the caller HIDES the meter and ring
    /// rather than drawing a zero arc (the pre-push fallback, owner ruling 2026-07-11).
    func test_zeroTotalHidesProgress() {
        XCTAssertNil(IslandPresentation.fraction(filled: 0, total: 0))
        XCTAssertNil(IslandPresentation.fraction(filled: 5, total: 0))
        XCTAssertNil(IslandPresentation.fraction(filled: 0, total: -1))
    }

    // MARK: - Ticks

    /// Nine interior ticks at the tenths (0.1 ... 0.9): the detents, ends excluded because
    /// the track's own edges mark 0 and 1.
    func test_ticksAreTheNineTenths() throws {
        XCTAssertEqual(IslandPresentation.tickFractions.count, 9)
        XCTAssertEqual(try XCTUnwrap(IslandPresentation.tickFractions.first), 0.1, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(IslandPresentation.tickFractions.last), 0.9, accuracy: 1e-9)
        for tick in IslandPresentation.tickFractions {
            XCTAssertGreaterThan(tick, 0)
            XCTAssertLessThan(tick, 1)
        }
    }

    // MARK: - Frozen solve time (owner ruling: MM:SS under an hour, H:MM past, never H:MM:SS)

    /// Under an hour reads MM:SS with a padded seconds field.
    func test_frozenTimeUnderAnHourIsMinutesSeconds() {
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 0), "0:00")
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 9), "0:09")
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 74), "1:14")
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 3599), "59:59")
    }

    /// At or past an hour reads H:MM: the seconds field DROPS rather than becoming a third
    /// section. H:MM:SS is forbidden (owner ruling 2026-07-11: never three sections).
    func test_frozenTimePastAnHourIsHoursMinutes_neverThreeSections() {
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 3600), "1:00")
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 3661), "1:01")
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 3600 + 59 * 60 + 59), "1:59")
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: 2 * 3600 + 5 * 60), "2:05")
        // The forbidden three-section form never appears: exactly one colon past an hour.
        XCTAssertEqual(
            IslandPresentation.frozenSolveTime(seconds: 3661).filter { $0 == ":" }.count, 1)
    }

    /// A negative interval (clock skew between the completion stamp and the anchor) floors
    /// at zero, so the frozen timer never renders a negative solve.
    func test_frozenTimeFloorsAtZero() {
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: -30), "0:00")
    }

    // MARK: - Frozen interval

    /// The frozen interval is completedAt - firstFillAt in whole seconds, floored at zero.
    func test_frozenSecondsIsTheFlooredInterval() {
        let anchor = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(
            IslandPresentation.frozenSeconds(from: anchor, to: anchor.addingTimeInterval(614)), 614)
        XCTAssertEqual(
            IslandPresentation.frozenSeconds(from: anchor, to: anchor.addingTimeInterval(-5)), 0,
            "a completion before the anchor floors at zero")
    }

    /// End to end: a completed room whose interval exceeds an hour renders H:MM. Frozen
    /// times may exceed an hour even though a live island caps at MM:SS territory.
    func test_completedRoomOverAnHourRendersHoursMinutes() {
        let anchor = Date(timeIntervalSince1970: 0)
        let completedAt = anchor.addingTimeInterval(90 * 60 + 12)  // 1h30m12s
        let seconds = IslandPresentation.frozenSeconds(from: anchor, to: completedAt)
        XCTAssertEqual(IslandPresentation.frozenSolveTime(seconds: seconds), "1:30")
    }

    /// The elapsed register coarsens with the room's age (owner ruling 2026-07-11, the
    /// ninety-hour question): under a day ticks natively, a day to a week reads in days
    /// and hours, a week or more is the infinity mark.
    func test_elapsedRegisterCoarsensWithAge() {
        let day = 86_400
        XCTAssertEqual(IslandPresentation.elapsedRegister(ageSeconds: 0), .ticking)
        XCTAssertEqual(IslandPresentation.elapsedRegister(ageSeconds: day - 1), .ticking)
        XCTAssertEqual(IslandPresentation.elapsedRegister(ageSeconds: day), .coarse("1 d"))
        XCTAssertEqual(
            IslandPresentation.elapsedRegister(ageSeconds: 90 * 3600), .coarse("3 d"),
            "the ninety-hour room reads 3 d, days only (owner ruling)")
        XCTAssertEqual(
            IslandPresentation.elapsedRegister(ageSeconds: 7 * day - 1), .coarse("6 d"))
        XCTAssertEqual(IslandPresentation.elapsedRegister(ageSeconds: 7 * day), .infinity)
        XCTAssertEqual(IslandPresentation.elapsedRegister(ageSeconds: 400 * day), .infinity)
    }

    /// A negative age (clock skew: the anchor sits ahead of the device clock) stays in
    /// the ticking register rather than crashing or coarsening.
    func test_elapsedRegisterFloorsNegativeAge() {
        XCTAssertEqual(IslandPresentation.elapsedRegister(ageSeconds: -30), .ticking)
    }
}
