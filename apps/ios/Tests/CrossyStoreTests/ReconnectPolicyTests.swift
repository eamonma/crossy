// The reconnect schedule as pure, clock-free store logic (AD-6; PROTOCOL.md §7, §9).
// These pin the numbers the transport adapter (Phase I1c) will sleep and dial with,
// mirroring apps/web/src/net/backoff.test.ts so the two clients cannot drift.

import CrossyStore
import XCTest

final class ReconnectPolicyTests: XCTestCase {
    func test_backoffWalksZeroOneTwoFourEightSixteenThirtyThenCapsAtThirty_PROTOCOL7() {
        // unitRandom pinned to 1.0 exposes the undithered bases.
        var schedule = BackoffSchedule(random: { 1.0 })
        let delays = (0..<9).map { _ in schedule.nextDelaySeconds() }
        XCTAssertEqual(delays, [0, 1, 2, 4, 8, 16, 30, 30, 30])
    }

    func test_fullJitterDrawsUniformlyInZeroToBase_PROTOCOL7() {
        var schedule = BackoffSchedule(random: { 0.5 })
        XCTAssertEqual(schedule.nextDelaySeconds(), 0)  // base 0
        XCTAssertEqual(schedule.nextDelaySeconds(), 0.5)  // base 1
        XCTAssertEqual(schedule.nextDelaySeconds(), 1.0)  // base 2
        // The zero draw is a legal full-jitter outcome at every attempt.
        var floor = BackoffSchedule(random: { 0.0 })
        XCTAssertEqual((0..<7).map { _ in floor.nextDelaySeconds() }, [0, 0, 0, 0, 0, 0, 0])
    }

    func test_thirtySecondSurvivalResetsTheWalk_PROTOCOL7() {
        var schedule = BackoffSchedule(random: { 1.0 })
        for _ in 0..<5 { _ = schedule.nextDelaySeconds() }
        schedule.connectionSurvived(seconds: 30)
        XCTAssertEqual(schedule.attempt, 0)
        XCTAssertEqual(schedule.nextDelaySeconds(), 0, "a reset walk starts over at 0 s")
    }

    func test_shortLivedConnectionDoesNotResetTheWalk_PROTOCOL7() {
        var schedule = BackoffSchedule(random: { 1.0 })
        for _ in 0..<3 { _ = schedule.nextDelaySeconds() }
        schedule.connectionSurvived(seconds: 29.9)
        XCTAssertEqual(schedule.attempt, 3)
        XCTAssertEqual(schedule.nextDelaySeconds(), 4, "the walk continues where it left off")
    }

    func test_policyConstantsMatchProtocol_PROTOCOL7_PROTOCOL9() {
        XCTAssertEqual(ReconnectPolicy.backoffBaseSeconds, [0, 1, 2, 4, 8, 16, 30])
        XCTAssertEqual(ReconnectPolicy.resetAfterSeconds, 30)
        XCTAssertEqual(ReconnectPolicy.heartbeatIntervalSeconds, 15)
    }

    func test_baseDelayClampsAttemptIntoTheTable_PROTOCOL7() {
        XCTAssertEqual(ReconnectPolicy.baseDelaySeconds(attempt: -1), 0)
        XCTAssertEqual(ReconnectPolicy.baseDelaySeconds(attempt: 0), 0)
        XCTAssertEqual(ReconnectPolicy.baseDelaySeconds(attempt: 6), 30)
        XCTAssertEqual(ReconnectPolicy.baseDelaySeconds(attempt: 99), 30)
        // A draw outside [0, 1] cannot push a delay past the cap or below zero.
        XCTAssertEqual(ReconnectPolicy.delaySeconds(attempt: 6, unitRandom: 2.0), 30)
        XCTAssertEqual(ReconnectPolicy.delaySeconds(attempt: 6, unitRandom: -1.0), 0)
    }
}
