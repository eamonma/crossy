import XCTest

@testable import CrossyUI

// The cursor relay throttle (PROTOCOL.md §9: at most 10 moveCursor per second per
// client), mirroring the web's posture: a leading send plus one coalesced trailing
// send, so the room sees a hop at once, a run of hops collapses to the cap, and
// the final position always goes out. Pure over injected times.

final class CursorRelayThrottleTests: XCTestCase {
    func test_capIsTheWiresTenPerSecond_protocol9() {
        XCTAssertEqual(CursorRelayThrottle.capSeconds, 0.1)
    }

    func test_firstChangeSendsImmediately_leadingEdge() {
        var throttle = CursorRelayThrottle()
        XCTAssertEqual(throttle.selectionChanged(now: 5.0), .send)
    }

    func test_changeInsideTheWindowSchedulesOneTrailingSend() {
        var throttle = CursorRelayThrottle()
        XCTAssertEqual(throttle.selectionChanged(now: 5.0), .send)
        // 30 ms later: too soon, schedule the remainder of the window.
        guard case .scheduleTrailing(let after) = throttle.selectionChanged(now: 5.03) else {
            return XCTFail("expected a trailing schedule")
        }
        XCTAssertEqual(after, 0.07, accuracy: 0.0001)
        // Further changes coalesce into the pending trailing send.
        XCTAssertEqual(throttle.selectionChanged(now: 5.05), .coalesce)
        XCTAssertEqual(throttle.selectionChanged(now: 5.09), .coalesce)
    }

    func test_trailingFireRestartsTheWindow_protocol9() {
        var throttle = CursorRelayThrottle()
        XCTAssertEqual(throttle.selectionChanged(now: 5.0), .send)
        _ = throttle.selectionChanged(now: 5.03)
        throttle.trailingFired(now: 5.1)
        // 50 ms after the trailing send is still inside the window.
        guard case .scheduleTrailing(let after) = throttle.selectionChanged(now: 5.15) else {
            return XCTFail("expected a trailing schedule")
        }
        XCTAssertEqual(after, 0.05, accuracy: 0.0001)
    }

    func test_changePastTheWindowSendsAgain() {
        var throttle = CursorRelayThrottle()
        XCTAssertEqual(throttle.selectionChanged(now: 5.0), .send)
        XCTAssertEqual(throttle.selectionChanged(now: 5.2), .send)
    }

    func test_cancelledTrailingAllowsANewSchedule() {
        var throttle = CursorRelayThrottle()
        XCTAssertEqual(throttle.selectionChanged(now: 5.0), .send)
        _ = throttle.selectionChanged(now: 5.03)
        throttle.trailingCancelled()
        guard case .scheduleTrailing = throttle.selectionChanged(now: 5.05) else {
            return XCTFail("a cancelled trailing send must not block the next one")
        }
    }
}
