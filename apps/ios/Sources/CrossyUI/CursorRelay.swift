// The cursor relay throttle (PROTOCOL.md §9: moveCursor at most 10 per second per
// client; the server MAY drop excess silently). Mirrors the web's posture exactly
// (apps/web/src/LiveApp.tsx): a leading send plus one coalesced trailing send, so a
// hop lands immediately, a fast run of hops collapses to the cap, and the LAST
// position always goes out (the trailing send reads the latest selection when it
// fires; a stale final cursor would lie to the room). Pure state over injected
// times, so tests pin the cadence without a clock; the view owns the actual timer
// and the store refuses sends while `connecting` (GameStore.moveCursor).

import Foundation

public struct CursorRelayThrottle: Sendable, Equatable {
    /// 100 ms between sends: the PROTOCOL.md §9 cap of 10/s, the web's CAP_MS.
    public static let capSeconds: Double = 0.1

    /// What the caller does about one selection change.
    public enum Verdict: Equatable, Sendable {
        /// Send now (the leading edge).
        case send
        /// Schedule one trailing send this far in the future; it must read the
        /// latest selection when it fires.
        case scheduleTrailing(afterSeconds: Double)
        /// A trailing send is already scheduled; it will carry this change.
        case coalesce
    }

    private var lastSentAt: Double?
    private var trailingScheduled = false

    public init() {}

    /// The selection changed at `now` (any monotonic seconds). Decides and records.
    public mutating func selectionChanged(now: Double) -> Verdict {
        let since = lastSentAt.map { now - $0 } ?? .infinity
        if since >= Self.capSeconds {
            lastSentAt = now
            return .send
        }
        if trailingScheduled { return .coalesce }
        trailingScheduled = true
        return .scheduleTrailing(afterSeconds: Self.capSeconds - since)
    }

    /// The scheduled trailing send fired at `now`: the caller sends the latest
    /// selection and the throttle window restarts from here.
    public mutating func trailingFired(now: Double) {
        trailingScheduled = false
        lastSentAt = now
    }

    /// The trailing send was cancelled (the room is closing); nothing was sent.
    public mutating func trailingCancelled() {
        trailingScheduled = false
    }
}
