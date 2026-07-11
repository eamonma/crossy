import XCTest

@testable import CrossyUI

// The island's lifecycle rules (roadmap I5a) as a pure fold, the CelebrationGate
// pattern: every ActivityKit-shaped decision pins headlessly here, and the app
// target's controller only executes actions. EXPERIENCE.md §4 stages v1 as
// started-on-backgrounding with the timer native from firstFillAt (root
// DESIGN.md D15); ID-2 keeps the pre-fill 0:00 off the island.

final class SolveActivityPolicyTests: XCTestCase {
    /// Feed the launch-into-foreground observation (its sweep is pinned
    /// separately) so each test starts from a settled foreground room.
    private func settledForeground(
        _ policy: inout SolveActivityPolicy, hasFirstFill: Bool = true
    ) {
        _ = policy.observe(
            phase: .active, status: .ongoing, kicked: false, hasFirstFill: hasFirstFill)
    }

    func test_startsAtTheInactiveTransitionOutOfForeground_EXPERIENCE4() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true),
            .start)
    }

    // ID-2: no anchor, no activity. Before the first fill the room bar reads a
    // quiet 0:00; the island never exists without a timer origin (D15).
    func test_noAnchorNoActivity_ID2() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy, hasFirstFill: false)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: false),
            .none)
        XCTAssertEqual(
            policy.observe(
                phase: .background, status: .ongoing, kicked: false, hasFirstFill: false),
            .none)
    }

    // ActivityKit requires effective foreground at request time (SP-i3): the
    // request happens at the .inactive transition, never after .background, even
    // when the anchor arrives late in the walk.
    func test_requestsAtInactiveNeverAfterBackground_SPi3() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy, hasFirstFill: false)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: false),
            .none)
        XCTAssertEqual(
            policy.observe(phase: .background, status: .ongoing, kicked: false, hasFirstFill: true),
            .none)
    }

    // The push era (PROTOCOL.md 12a): a terminal while the app is away belongs to the
    // server's announcement (alerting update, then end). The client defers: terminal
    // observations off the foreground return .none, and the local end happens only
    // when the scene is effectively foreground again. The old "wherever the scene is"
    // rule killed the island the instant a room completed while the token upload's
    // background assertion kept the socket warm, swallowing the announcement (owner
    // device report 2026-07-11 late).
    func test_completedWhileAwayDefersToThePushChannel_section12a() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true),
            .start)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .completed, kicked: false, hasFirstFill: true),
            .none)
        XCTAssertEqual(
            policy.observe(phase: .background, status: .completed, kicked: false, hasFirstFill: true),
            .none)
        // The foreground return still sweeps whatever the server left standing.
        XCTAssertEqual(
            policy.observe(phase: .active, status: .completed, kicked: false, hasFirstFill: true),
            .end)
    }

    func test_abandonedWhileAwayDefersToThePushChannel_section12a() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        _ = policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true)
        XCTAssertEqual(
            policy.observe(phase: .background, status: .abandoned, kicked: false, hasFirstFill: true),
            .none)
        XCTAssertEqual(
            policy.observe(phase: .active, status: .abandoned, kicked: false, hasFirstFill: true),
            .end)
    }

    func test_kickedWhileAwayDefersToTheServersOwnEnd_section12a() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        _ = policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true)
        // The emitter ends a kicked member's own tokens (12a); locally nothing moves
        // until the foreground return.
        XCTAssertEqual(
            policy.observe(phase: .background, status: .ongoing, kicked: true, hasFirstFill: true),
            .none)
        XCTAssertEqual(
            policy.observe(phase: .active, status: .ongoing, kicked: true, hasFirstFill: true),
            .end)
    }

    // Foreground is different: the room bar owns the moment, so a terminal that
    // arrives while the scene is active ends the island at once.
    func test_terminalAtActiveEndsImmediately_EXPERIENCE4() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        _ = policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true)
        XCTAssertEqual(
            policy.observe(phase: .active, status: .completed, kicked: false, hasFirstFill: true),
            .end)
    }

    // A terminal room never starts an island, whatever the phase walk.
    func test_terminalRoomNeverStarts_EXPERIENCE4() {
        var policy = SolveActivityPolicy()
        _ = policy.observe(phase: .active, status: .completed, kicked: false, hasFirstFill: true)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .completed, kicked: false, hasFirstFill: true),
            .none)
    }

    // DESIGN.md §8: the island is the room bar condensed; when the room bar is
    // back on screen the island retires.
    func test_foregroundReturnEndsTheIsland_section8() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        _ = policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true)
        XCTAssertEqual(
            policy.observe(phase: .active, status: .ongoing, kicked: false, hasFirstFill: true),
            .end)
    }

    // D15: the activity outlives the app, so a killed process leaves the island
    // ticking with nobody accountable. The first foreground observation of a
    // fresh policy sweeps, unconditionally.
    func test_coldLaunchForegroundSweepsStaleActivities_D15() {
        var policy = SolveActivityPolicy()
        XCTAssertEqual(
            policy.observe(phase: .active, status: .ongoing, kicked: false, hasFirstFill: true),
            .end)
    }

    func test_noDoubleStartOnRepeatedInactiveObservations_EXPERIENCE4() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true),
            .start)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true),
            .none)
        XCTAssertEqual(
            policy.observe(phase: .background, status: .ongoing, kicked: false, hasFirstFill: true),
            .none)
    }

    // Each leave gets its island: start, return (end), leave again (start).
    func test_startsAgainOnTheNextLeave_EXPERIENCE4() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true),
            .start)
        XCTAssertEqual(
            policy.observe(phase: .active, status: .ongoing, kicked: false, hasFirstFill: true),
            .end)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true),
            .start)
    }

    // Unlock-return passes through .inactive from .background; that is arriving,
    // not leaving, so nothing starts (EXPERIENCE.md §4: started on backgrounding).
    func test_inactiveOnTheWayBackInNeverStarts_EXPERIENCE4() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy, hasFirstFill: false)
        _ = policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: false)
        _ = policy.observe(phase: .background, status: .ongoing, kicked: false, hasFirstFill: false)
        XCTAssertEqual(
            policy.observe(phase: .inactive, status: .ongoing, kicked: false, hasFirstFill: true),
            .none)
    }

    // The fold is idempotent for repeated identical observations: two onChange
    // observers reading one store can never double-fire an action.
    func test_repeatedIdenticalObservationsAreIdempotent_EXPERIENCE4() {
        var policy = SolveActivityPolicy()
        settledForeground(&policy)
        for _ in 0..<3 {
            XCTAssertEqual(
                policy.observe(
                    phase: .active, status: .ongoing, kicked: false, hasFirstFill: true),
                .none)
        }
    }
}
