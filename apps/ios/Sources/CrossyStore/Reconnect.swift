// The PROTOCOL.md §7 reconnect backoff as pure store logic (AD-6): delays of 0, 1, 2,
// 4, 8, 16, then 30 seconds, capped at 30, each with full jitter; reset after a
// connection survives 30 seconds. Twin of apps/web/src/net/backoff.ts. Pure and
// clock-free (the INV-9 ethos applied to the store): randomness is injected, durations
// arrive as data, and the transport adapter owns the timers — it only sleeps, jitters,
// and dials with the numbers decided here.

/// The schedule's fixed numbers, pinned where unit tests can read them.
public enum ReconnectPolicy {
    /// PROTOCOL.md §7: 0, 1, 2, 4, 8, 16, then 30 seconds, capped at 30.
    public static let backoffBaseSeconds: [Double] = [0, 1, 2, 4, 8, 16, 30]

    /// A connection that survives this long resets the schedule (PROTOCOL.md §7).
    public static let resetAfterSeconds: Double = 30

    /// Clients send `heartbeat` every 15 s (PROTOCOL.md §5, §9). The adapter schedules
    /// the timer; this is the number it schedules with.
    public static let heartbeatIntervalSeconds: Double = 15

    /// The undithered base delay for one attempt (0-based), clamped at the cap.
    public static func baseDelaySeconds(attempt: Int) -> Double {
        let index = min(max(attempt, 0), backoffBaseSeconds.count - 1)
        return backoffBaseSeconds[index]
    }

    /// Full jitter: uniform in [0, base]. `unitRandom` is a draw in [0, 1].
    public static func delaySeconds(attempt: Int, unitRandom: Double) -> Double {
        baseDelaySeconds(attempt: attempt) * min(max(unitRandom, 0), 1)
    }
}

/// The reconnect walk. A value type owned by the store (the state machine's attempt
/// counter is store state); the adapter consumes delays and reports survival times.
public struct BackoffSchedule: Sendable {
    public private(set) var attempt: Int = 0
    private let random: @Sendable () -> Double

    /// `random` draws uniformly in [0, 1); injectable so tests pin the walk exactly.
    public init(random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) }) {
        self.random = random
    }

    /// The next reconnect delay in seconds, consuming one attempt.
    public mutating func nextDelaySeconds() -> Double {
        let delay = ReconnectPolicy.delaySeconds(attempt: attempt, unitRandom: random())
        attempt += 1
        return delay
    }

    public mutating func reset() {
        attempt = 0
    }

    /// Report how long the last connection lived; a long-enough life resets the walk.
    public mutating func connectionSurvived(seconds: Double) {
        if seconds >= ReconnectPolicy.resetAfterSeconds {
            reset()
        }
    }
}
