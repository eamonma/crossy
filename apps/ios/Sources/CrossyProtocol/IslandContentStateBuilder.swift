// The born-live builder for the Live Activity's first frame (PROTOCOL.md §12a). The
// island no longer starts on an empty content-state and waits up to ~20s for the first
// server push; it is born carrying the room's real state at the moment of backgrounding,
// so it renders live data at zero seconds. The server takes over over APNs from there.
//
// This is pure, headless, and store-free: the composition root has already resolved the
// cluster (RosterList's presence order and cap, colors to the dark ground) and read the
// counts off the store and the puzzle, and it hands those facts here as plain data. The
// builder maps them to the same IslandContentState shape the emitter pushes, so frame one
// and push two speak the identical payload. It lives beside that payload, in the one
// package the widget links, and CrossyProtocolTests pins every mapping rule without
// ActivityKit or a device.
//
// The store's own types never cross into this package (the layering: apps import
// packages, never the reverse). The controller's ring owns the cluster rule and the
// store; only render-ready values arrive here.

import Foundation

extension IslandContentState {
    /// One cluster member, render-ready for the island's dark ground: the ASCII-uppercased
    /// initial (INV-1, already cased upstream), the dark-ground sRGB components, and the
    /// live `connected` flag that drives the away register. A 1:1 pre-image of `IslandPuck`,
    /// carried as its own type so no store or UI type crosses the package boundary.
    public struct ClusterMember: Sendable, Hashable {
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
    }

    /// The first frame the island is born carrying (PROTOCOL.md §12a): the resolved cluster,
    /// the confirmed fill counts, the lifecycle status, and the completion stamp, mapped to
    /// the content-state the emitter pushes. Callers pass a cluster already in presence order
    /// and already capped (RosterList.cluster), so this maps it verbatim: no re-ordering, no
    /// re-casing (INV-1), no re-capping. `total` is the grid's playable-cell count (cells
    /// minus blocks), which agrees with the server's BoardFacts; `completedAt` is the wire
    /// string, set only for a completed room.
    public static func bornLive(
        cluster: [ClusterMember],
        filled: Int,
        total: Int,
        status: IslandStatus,
        completedAt: String?
    ) -> IslandContentState {
        IslandContentState(
            pucks: cluster.map {
                IslandPuck(
                    initial: $0.initial, red: $0.red, green: $0.green, blue: $0.blue,
                    connected: $0.connected)
            },
            filled: filled,
            total: total,
            status: status,
            completedAt: completedAt)
    }
}
