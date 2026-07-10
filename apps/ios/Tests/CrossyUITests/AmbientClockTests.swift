import Foundation
import XCTest

@testable import CrossyUI

// The ambient timer (ID-2, apps/ios/DESIGN.md §9): 0:00 quietly before the first
// fill, ticking from `firstFillAt` (root DESIGN.md D15: the origin is wire data,
// zero updates), frozen at completion. The clock is injected, so every case pins an
// exact string.

final class AmbientClockTests: XCTestCase {
    private let origin = "2026-07-10T19:02:11Z"

    private func date(_ iso: String) -> Date {
        AmbientClock.parse(iso)!
    }

    func test_parse_acceptsPlainAndFractionalISO8601_protocol3() {
        let plain = AmbientClock.parse("2026-07-10T19:02:11Z")
        let fractional = AmbientClock.parse("2026-07-10T19:02:11.123Z")
        XCTAssertNotNil(plain)
        XCTAssertNotNil(fractional)
        // The fractional stamp is 123 ms after the plain one.
        XCTAssertEqual(fractional!.timeIntervalSince(plain!), 0.123, accuracy: 0.0001)
        XCTAssertNil(AmbientClock.parse("not a time"))
    }

    func test_beforeFirstFill_readsZeroQuietly_id2() {
        XCTAssertEqual(
            AmbientClock.display(firstFillAt: nil, completedAt: nil, now: date(origin)),
            "0:00")
    }

    func test_ticksFromFirstFillAt_d15() {
        let now = date(origin).addingTimeInterval(754)
        XCTAssertEqual(
            AmbientClock.display(firstFillAt: origin, completedAt: nil, now: now),
            "12:34")
    }

    func test_freezesAtCompletion_id2() {
        let completed = date(origin).addingTimeInterval(100).ISO8601Format()
        let longAfter = date(origin).addingTimeInterval(5000)
        XCTAssertEqual(
            AmbientClock.display(firstFillAt: origin, completedAt: completed, now: longAfter),
            "1:40")
    }

    func test_hourRollover_growsADigitInsteadOfWrapping() {
        XCTAssertEqual(AmbientClock.display(seconds: 3599), "59:59")
        XCTAssertEqual(AmbientClock.display(seconds: 3600), "1:00:00")
        XCTAssertEqual(AmbientClock.display(seconds: 3725), "1:02:05")
    }

    func test_clockSkew_neverShowsNegativeTime() {
        let before = date(origin).addingTimeInterval(-30)
        XCTAssertEqual(
            AmbientClock.display(firstFillAt: origin, completedAt: nil, now: before),
            "0:00")
    }
}
