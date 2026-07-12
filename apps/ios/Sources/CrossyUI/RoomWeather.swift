// Honest weather (apps/ios/DESIGN.md §8): three connection states, three registers
// (PROTOCOL.md §7). Live is a calm dot; resyncing is a breathing dot and nothing
// else changes (the snapshot applies wholesale when it lands, the board keeps its
// last truth); reconnecting dims the room with a quiet countdown and names itself,
// because a person lost something mid-solve. Never a modal, never a spinner over the
// grid. The client-local `connecting` state (pre-first-welcome, no board truth yet) is
// the QUIET register: the dimmed dot beside the clock, no word and no countdown, since
// a first join has lost nothing (redesign 2026-07-11, the terse first-connect pill).
// The board still dims, mirroring the web's de-emphasized pre-welcome grid.
// The mapping is a pure function of the store's SyncState so tests pin it; the dot
// itself is achromatic (people are the only color, DESIGN.md §3).

import CrossyStore
import Foundation

/// What the room renders for one connection state: the dot's register on the
/// chrome, and whether the board dims. Countdown presence is reconnecting-only.
public struct RoomWeather: Equatable, Sendable {
    public enum Dot: Equatable, Sendable {
        /// A quiet, steady dot: the room is live.
        case calm
        /// The dot breathes (a slow opacity pulse): a gap was seen, a snapshot is
        /// on its way. Chrome-only; the board does not change.
        case breathing
        /// The dot holds hollow while the room is dimmed: the socket is gone.
        case dimmed
    }

    public let dot: Dot
    /// True dims the board under the chrome (reconnecting and the pre-welcome
    /// connecting state). The dim is a paper wash, never a modal or a spinner.
    public let boardDimmed: Bool
    /// True shows the quiet countdown to the next dial (reconnecting only).
    public let showsCountdown: Bool
    /// The plain word for the state, nil when the room needs no word (ID-5: common
    /// words, nothing precious).
    public let label: String?

    public init(dot: Dot, boardDimmed: Bool, showsCountdown: Bool, label: String?) {
        self.dot = dot
        self.boardDimmed = boardDimmed
        self.showsCountdown = showsCountdown
        self.label = label
    }

    /// The one mapping (PROTOCOL.md §7 states plus the client-local connecting).
    public static func from(sync: SyncState) -> RoomWeather {
        switch sync {
        case .live:
            return RoomWeather(dot: .calm, boardDimmed: false, showsCountdown: false, label: nil)
        case .resyncing:
            return RoomWeather(dot: .breathing, boardDimmed: false, showsCountdown: false, label: nil)
        case .reconnecting:
            return RoomWeather(
                dot: .dimmed, boardDimmed: true, showsCountdown: true, label: "Reconnecting")
        case .connecting:
            // The FIRST connect is quiet (DESIGN.md §8: never a spinner; the room's law
            // is a hush, not a status word). A reconnect exists because a person LOST
            // something mid-solve, so it names itself and counts down; a first join has
            // lost nothing, so the pill carries only the dimmed dot beside the clock, no
            // word and no countdown. The board still dims (the room is honestly not live
            // yet), mirroring the web's de-emphasized pre-welcome grid.
            return RoomWeather(
                dot: .dimmed, boardDimmed: true, showsCountdown: false, label: nil)
        }
    }

    /// The board's paper wash opacity when dimmed: strong enough to read as an
    /// honest hush, light enough that the room never dims dead.
    public static let boardDimOpacity: Double = 0.45

    /// Whole seconds until the next dial, floored at zero; nil when there is no
    /// deadline to count toward (the adapter has not scheduled one).
    public static func countdownSeconds(retryAt: Date?, now: Date) -> Int? {
        guard let retryAt else { return nil }
        return max(0, Int(retryAt.timeIntervalSince(now).rounded(.up)))
    }

    /// The countdown line, ID-5 plain and warm: "Back in 3s" while a dial is
    /// scheduled, the bare state word otherwise.
    public static func reconnectLine(retryAt: Date?, now: Date) -> String {
        guard let seconds = countdownSeconds(retryAt: retryAt, now: now), seconds > 0 else {
            return "Reconnecting"
        }
        return "Back in \(seconds)s"
    }
}
