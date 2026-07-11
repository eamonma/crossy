// The Live Activity content-state payload (PROTOCOL.md §12a; vectors/live-activity).
// One JSON object rides inside the APNs Live Activity envelope as `aps.content-state`:
// the session emitter (a later slice in apps/session) encodes it, the iOS widget
// decodes it. This is the Swift half of the D04 hand-kept twin: the normative shape is
// pinned by vectors/live-activity/content-state.json, and CrossyProtocolTests decodes
// every fixture here so the two ports cannot drift.
//
// Two rules govern the decode (PROTOCOL.md §12a, §14):
//   - Unknown keys are ignored. The server grows the payload by expand/contract and the
//     widget ships on the App Store's clock, so an installed widget must tolerate a
//     field it has never seen. Codable's keyed containers already drop unknown keys.
//   - Every field decodes with a sensible default when absent (decodeIfPresent), so an
//     older payload, or the pre-push empty state, still yields a valid value rather
//     than throwing. `IslandContentState()` constructs the empty state (no pucks, 0/0,
//     ongoing, no completion), which the pre-push island renders as the attributes
//     fallback.
//
// It carries counts only, never a letter or a cell coordinate (INV-6): the lock screen
// shows how full the grid is, never what fills it. Puck initials are single
// ASCII-uppercased letters resolved server-side (INV-1); this port does not re-case
// them, it renders what the wire resolved.
//
// ActivityKit itself stays out of the packages, whose tests build on macOS. The app's
// SolveActivityAttributes adopts this type as its ContentState by typealias, and the
// widget extension links this package product, so the one definition serves the
// activity, the widget's render, and the headless vector tests.

import Foundation

/// The terminal register of a room (PROTOCOL.md §12a, mirroring §4). An unknown status
/// on the wire decodes to `.ongoing`: a lagging widget treats a status it does not know
/// as "still going" rather than failing to decode.
public enum IslandStatus: String, Sendable, Hashable, Codable {
    case ongoing
    case completed
    case abandoned

    /// Tolerant decode: an unrecognized status is `.ongoing`, never a throw (§12a).
    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = IslandStatus(rawValue: raw) ?? .ongoing
    }
}

/// One roster puck, render-ready for the island's dark ground (PROTOCOL.md §12a).
/// `initial` is a single ASCII-uppercased letter (INV-1); `red`/`green`/`blue` are 8-bit
/// sRGB components resolved server-side; `connected` drives the away register. The
/// cluster rides the content-state, not the immutable attributes, so a member who joins
/// after the activity started still appears.
public struct IslandPuck: Sendable, Hashable, Codable {
    public let initial: String
    public let red: Int
    public let green: Int
    public let blue: Int
    public let connected: Bool

    public init(initial: String, red: Int, green: Int, blue: Int, connected: Bool) {
        self.initial = initial
        self.red = red
        self.green = green
        self.blue = blue
        self.connected = connected
    }

    private enum CodingKeys: String, CodingKey {
        case initial, red, green, blue, connected
    }

    /// Every field decodeIfPresent with a floor, so a puck missing a component still
    /// decodes (a black, disconnected, letterless puck) rather than throwing (§12a).
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        initial = try container.decodeIfPresent(String.self, forKey: .initial) ?? ""
        red = try container.decodeIfPresent(Int.self, forKey: .red) ?? 0
        green = try container.decodeIfPresent(Int.self, forKey: .green) ?? 0
        blue = try container.decodeIfPresent(Int.self, forKey: .blue) ?? 0
        connected = try container.decodeIfPresent(Bool.self, forKey: .connected) ?? false
    }
}

/// The flat Live Activity content-state (PROTOCOL.md §12a). Decodes tolerantly (unknown
/// keys ignored, every field defaulted when absent); `IslandContentState()` is the empty
/// pre-push state.
public struct IslandContentState: Sendable, Hashable, Codable {
    /// The live cluster in presence order, at most four (§12a). Empty means no push has
    /// landed yet: the island renders the attributes snapshot and hides progress.
    public let pucks: [IslandPuck]
    /// Filled cells. Counts only, never coordinates (INV-6).
    public let filled: Int
    /// Total playable cells. `0` means no progress to show: no meter, no ring.
    public let total: Int
    public let status: IslandStatus
    /// ISO 8601 UTC, set exactly when `status == .completed`, else nil (§12a). The frozen
    /// solve time is `completedAt - firstFillAt`, computed on the device from this and
    /// the attributes' anchor.
    public let completedAt: String?

    /// The empty pre-push state: no cluster, no progress, still ongoing. Existing
    /// `Activity.request` sites construct this unchanged.
    public init(
        pucks: [IslandPuck] = [],
        filled: Int = 0,
        total: Int = 0,
        status: IslandStatus = .ongoing,
        completedAt: String? = nil
    ) {
        self.pucks = pucks
        self.filled = filled
        self.total = total
        self.status = status
        self.completedAt = completedAt
    }

    private enum CodingKeys: String, CodingKey {
        case pucks, filled, total, status, completedAt
    }

    /// Tolerant decode (§12a): unknown keys are dropped by the keyed container, and every
    /// field falls back to the empty-state default when absent, so a payload the server
    /// grew still decodes against a widget that lags.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        pucks = try container.decodeIfPresent([IslandPuck].self, forKey: .pucks) ?? []
        filled = try container.decodeIfPresent(Int.self, forKey: .filled) ?? 0
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
        status = try container.decodeIfPresent(IslandStatus.self, forKey: .status) ?? .ongoing
        completedAt = try container.decodeIfPresent(String.self, forKey: .completedAt)
    }
}
