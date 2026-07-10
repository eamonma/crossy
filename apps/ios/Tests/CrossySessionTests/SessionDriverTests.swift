// The driver against scripted transports and a stepping clock (AD-6; PROTOCOL.md §5,
// §7, §9). What these pin: the driver executes exactly the delays the store's
// BackoffSchedule decides (jitter included, via the policy's injected RNG), reports
// survival so the schedule resets in the store and never resets it itself, runs the
// heartbeat on the policy's 15 s number through the store's one outbound path, and
// stops cleanly on cancellation and on signed-out. Every number asserted here has a
// twin in ReconnectPolicyTests, so drift between decider and executor is visible.

import CrossyProtocol
import CrossyStore
import Foundation
import XCTest

@testable import CrossySession

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class SessionDriverTests: XCTestCase {
    private func board(seq: Int = 0) -> Board {
        Board(
            seq: seq,
            status: .ongoing,
            firstFillAt: nil,
            completedAt: nil,
            abandonedAt: nil,
            cells: Array(repeating: Cell(v: nil, by: nil), count: 4),
            participants: [],
            cursors: [],
            recentCommandIds: [],
            stats: nil)
    }

    private func welcome(seq: Int = 0) -> ServerMessage {
        .welcome(
            WelcomeMessage(
                protocolVersion: 1,
                selfIdentity: WelcomeMessage.SelfIdentity(userId: "me", role: .solver),
                board: board(seq: seq)))
    }

    private func makeDriver(
        random: @escaping @Sendable () -> Double = { 1.0 },
        transports: [ScriptedTransport]
    ) -> (driver: SessionDriver, store: GameStore, clock: FakeClock, script: TransportScript) {
        let store = GameStore(backoff: BackoffSchedule(random: random))
        let clock = FakeClock()
        let script = TransportScript(transports)
        let driver = SessionDriver(store: store, clock: clock) { script.next() }
        return (driver, store, clock, script)
    }

    private enum DialFailure: Error { case refused }

    private func failing() -> ScriptedTransport {
        ScriptedTransport(connect: .fail(DialFailure.refused))
    }

    // MARK: - Backoff execution (AD-6: the store decides, the driver sleeps and dials)

    func test_dialsImmediatelyThenSleepsThePolicyWalkBetweenFailedAttempts_AD6_PROTOCOL7() async throws {
        // unitRandom pinned to 1.0 exposes the undithered bases: 0, 1, 2, 4, 8.
        let (driver, _, clock, script) = makeDriver(
            transports: [failing(), failing(), failing(), failing(), failing()])
        let task = Task { await driver.run() }

        for _ in 0..<5 {
            try await waitUntil("driver parks on a backoff sleep") { clock.waiterCount == 1 }
            clock.resumeNext()
        }
        await task.value  // the exhausted script answers signed-out: a deliberate stop

        XCTAssertEqual(clock.sleeps, [0, 1, 2, 4, 8], "the section 7 walk, executed verbatim")
        XCTAssertEqual(script.made.count, 6, "one fresh transport per attempt, dialed first")
    }

    func test_jitterComesFromThePolicysInjectedRNGNotTheDriver_PROTOCOL7() async throws {
        // A 0.5 draw halves each base: full jitter is the policy's math, the driver
        // just sleeps whatever number it is handed.
        let (driver, _, clock, _) = makeDriver(
            random: { 0.5 },
            transports: [failing(), failing(), failing()])
        let task = Task { await driver.run() }

        for _ in 0..<3 {
            try await waitUntil("driver parks on a backoff sleep") { clock.waiterCount == 1 }
            clock.resumeNext()
        }
        await task.value

        XCTAssertEqual(clock.sleeps, [0, 0.5, 1.0])
    }

    func test_failedDialsNeverReportSurvivalSoTheWalkNeverResets_PROTOCOL7() async throws {
        // The web onclose guard, mirrored: wall-clock time passing between failed
        // attempts must not read as survival, or a dead server would busy-loop at 0 s.
        let (driver, _, clock, _) = makeDriver(
            transports: [failing(), failing(), failing()])
        let task = Task { await driver.run() }

        for _ in 0..<3 {
            try await waitUntil("driver parks on a backoff sleep") { clock.waiterCount == 1 }
            clock.advance(by: 100)  // plenty of time passes; none of it was a connection
            clock.resumeNext()
        }
        await task.value

        XCTAssertEqual(clock.sleeps, [0, 1, 2], "the walk kept escalating: no false reset")
    }

    // MARK: - Survival reporting (PROTOCOL.md §7: reset after 30 s, decided in the store)

    func test_thirtySecondSurvivalReportedToTheStoreResetsTheWalk_PROTOCOL7() async throws {
        let live = ScriptedTransport()
        let (driver, store, clock, _) = makeDriver(
            transports: [failing(), failing(), live])
        let task = Task { await driver.run() }

        // Two failures walk the schedule to attempt 2.
        for _ in 0..<2 {
            try await waitUntil("driver parks on a backoff sleep") { clock.waiterCount == 1 }
            clock.resumeNext()
        }
        // The third attempt opens; the store goes live on the welcome, and the
        // heartbeat timer parks on its first 15 s tick (sleeps grows to 3).
        live.deliver(welcome())
        try await waitUntil("store goes live") { store.sync == .live }
        try await waitUntil("heartbeat timer parks") {
            clock.waiterCount == 1 && clock.sleeps.count == 3
        }
        // The connection lives 30 s, then drops. The drop cancels the parked
        // heartbeat, so the one waiter left is the backoff sleep (sleeps grows to 4).
        clock.advance(by: 30)
        live.finish()
        try await waitUntil("driver parks on the backoff walk after the drop") {
            clock.waiterCount == 1 && clock.sleeps.count == 4
        }
        clock.resumeNext()
        await task.value

        XCTAssertEqual(
            clock.sleeps, [0, 1, 15, 0],
            "after the heartbeat's one 15 s tick, connectionSurvived(30) reset the walk"
                + " in the store: the post-drop delay is attempt 0 again")
    }

    func test_shortLivedConnectionDoesNotResetTheWalk_PROTOCOL7() async throws {
        let live = ScriptedTransport()
        let (driver, store, clock, _) = makeDriver(
            transports: [failing(), failing(), live])
        let task = Task { await driver.run() }

        for _ in 0..<2 {
            try await waitUntil("driver parks on a backoff sleep") { clock.waiterCount == 1 }
            clock.resumeNext()
        }
        live.deliver(welcome())
        try await waitUntil("store goes live") { store.sync == .live }
        try await waitUntil("heartbeat timer parks") {
            clock.waiterCount == 1 && clock.sleeps.count == 3
        }
        clock.advance(by: 29.9)  // just under the reset threshold
        live.finish()
        try await waitUntil("driver parks on the backoff walk after the drop") {
            clock.waiterCount == 1 && clock.sleeps.count == 4
        }
        clock.resumeNext()
        await task.value

        XCTAssertEqual(
            clock.sleeps, [0, 1, 15, 2],
            "a 29.9 s life continues the walk where it left off (the store's rule);"
                + " the 15 is the heartbeat's one parked tick while live")
    }

    // MARK: - Heartbeat (PROTOCOL.md §5, §9: every 15 s while live, the policy's number)

    func test_heartbeatsEveryFifteenSecondsThroughTheStoreWhileLive_PROTOCOL9() async throws {
        let live = ScriptedTransport()
        let (driver, store, clock, _) = makeDriver(transports: [live])
        let task = Task { await driver.run() }

        live.deliver(welcome())
        try await waitUntil("store goes live") { store.sync == .live }

        // Step the heartbeat timer twice; each tick flows store -> pump -> transport.
        try await waitUntil("heartbeat timer parks") { clock.waiterCount == 1 }
        clock.resumeNext()
        try await waitUntil("first heartbeat sent") { await live.sentCount == 1 }
        try await waitUntil("heartbeat timer parks again") { clock.waiterCount == 1 }
        clock.resumeNext()
        try await waitUntil("second heartbeat sent") { await live.sentCount == 2 }
        try await waitUntil("heartbeat timer parks a third time") { clock.waiterCount == 1 }

        let sent = await live.sent
        XCTAssertEqual(
            sent, [.heartbeat(HeartbeatMessage()), .heartbeat(HeartbeatMessage())],
            "heartbeats go through the store's one ordered outbound path")
        XCTAssertEqual(
            clock.sleeps, Array(repeating: ReconnectPolicy.heartbeatIntervalSeconds, count: 3),
            "the cadence is the policy's 15 s, never a number of the driver's own")

        // The drop cancels the heartbeat with the connection; the next sleep is the
        // backoff walk, not another tick.
        live.finish()
        try await waitUntil("driver parks on the backoff walk") {
            clock.waiterCount == 1 && clock.sleeps.count == 4
        }
        XCTAssertEqual(clock.sleeps.last, 0, "attempt 0 of the walk follows the drop")
        let sentAfterDrop = await live.sentCount
        XCTAssertEqual(sentAfterDrop, 2, "no heartbeat outlives its socket")

        task.cancel()
        await task.value
    }

    // MARK: - Deliberate teardown

    func test_cancellationClosesTheLiveTransportAndStopsTheLoop_PROTOCOL2() async throws {
        let live = ScriptedTransport()
        let (driver, store, clock, script) = makeDriver(transports: [live])
        let task = Task { await driver.run() }

        live.deliver(welcome())
        try await waitUntil("store goes live") { store.sync == .live }

        task.cancel()
        await task.value

        let closeCalls = await live.closeCalls
        XCTAssertEqual(closeCalls, 1, "deliberate teardown closes the socket")
        XCTAssertEqual(script.made.count, 1, "no redial after a deliberate stop")
        XCTAssertEqual(clock.waiterCount, 0, "no sleeper left behind")
    }

    func test_signedOutStopsTheLoopInsteadOfBusyLooping_PROTOCOL2() async throws {
        let (driver, _, clock, script) = makeDriver(
            transports: [ScriptedTransport(connect: .fail(WebSocketTransportError.signedOut))])
        let task = Task { await driver.run() }
        await task.value

        XCTAssertEqual(script.made.count, 1, "one attempt, then a deliberate stop")
        XCTAssertEqual(clock.sleeps, [], "no backoff sleep: this is a stop, not a retry")
    }
}
