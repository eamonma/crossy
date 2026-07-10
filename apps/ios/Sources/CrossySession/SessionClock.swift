// The driver's only view of time (AD-6 applied to timers): a monotonic now for
// survival measurement and a suspension for the policy's delays. Injected so driver
// tests script every sleep and every elapsed second; durations are plain seconds,
// matching ReconnectPolicy's data.

import Foundation

/// A monotonic clock plus a sleeper. Seconds as `Double` end to end, the same unit
/// `BackoffSchedule` and `ReconnectPolicy` speak.
public protocol SessionClock: Sendable {
    /// Monotonic seconds; only differences are meaningful.
    func now() -> Double
    /// Suspend for `seconds`; throws `CancellationError` when the task is cancelled.
    func sleep(seconds: Double) async throws
}

/// The production clock over `ContinuousClock`: monotonic, suspension-scheduler
/// driven, cancellation propagating.
@available(iOS 17.0, macOS 14.0, *)
public struct ContinuousSessionClock: SessionClock {
    private let clock = ContinuousClock()
    private let origin: ContinuousClock.Instant

    public init() {
        origin = ContinuousClock().now
    }

    public func now() -> Double {
        let elapsed = origin.duration(to: clock.now)
        let parts = elapsed.components
        return Double(parts.seconds) + Double(parts.attoseconds) * 1e-18
    }

    public func sleep(seconds: Double) async throws {
        guard seconds > 0 else {
            try Task.checkCancellation()
            return
        }
        try await clock.sleep(until: clock.now.advanced(by: .seconds(seconds)), tolerance: nil)
    }
}
