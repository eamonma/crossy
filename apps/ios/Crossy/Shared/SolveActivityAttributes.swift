//
//  SolveActivityAttributes.swift
//  Crossy
//
//  The Live Activity's immutable facts (roadmap I5a, per SP-i3): the timer anchor,
//  the room name, and the puck cluster snapshot the island renders (apps/ios/DESIGN.md
//  §8: pucks leading, timer trailing, black glass). The system ticks the timer natively
//  from `firstFillAt` with zero updates and the activity outlives the app (root
//  DESIGN.md D15).
//
//  ContentState is the push payload (push track, phase 2a): it is IslandContentState,
//  the flat content-state the session emitter pushes over APNs (PROTOCOL.md §12a). The
//  island is BORN LIVE: the controller requests carrying the room's real state at the
//  moment of backgrounding (the resolved cluster, the confirmed fill counts, the live
//  presence flags), so the first frame renders live data at zero seconds and the server
//  takes over over APNs from there. The attributes below stay the frozen cluster fallback,
//  the frame ActivityKit falls back to when it has no content-state to render (a decode it
//  cannot make, an empty state): initial and color per member, resolved once at request
//  time, so even the fallback reads as the same people.
//
//  This file compiles into the app target and the widget extension through the Shared/
//  synchronized folder: ActivityKit stays out of the packages, whose tests build on
//  macOS, so the ActivityAttributes conformance lives here while the payload model it
//  adopts (CrossyProtocol.IslandContentState) stays package-resident, defined once and
//  pinned to vectors/live-activity by headless tests. Both targets link the
//  CrossyProtocol product, so the typealias resolves in both.
//

import ActivityKit
import CrossyProtocol
import Foundation

struct SolveActivityAttributes: ActivityAttributes {
    /// The pushed content-state (PROTOCOL.md §12a): the live cluster, fill counts,
    /// status, and completion stamp. Born live at request time (the room's real state at
    /// backgrounding), then driven by the server over APNs; `IslandContentState()` is the
    /// empty state ActivityKit still tolerates as a decode floor.
    typealias ContentState = IslandContentState

    /// One roster puck in the immutable snapshot, resolved at request time for the
    /// island's black glass: the member's dark-ground roster color as 8-bit sRGB
    /// components (the CrossyDesign RGBColor shape, apps/ios/DESIGN.md §3), the
    /// ASCII-uppercased initial (INV-1), and the opaque avatar disk key (nil when the member
    /// has no avatar). This is the frozen fallback cluster; the live cluster rides the
    /// content-state (IslandPuck, born live at request time and driven by the server after)
    /// so a member who joins after the activity started still appears. The `userId` rides the
    /// fallback too, so the pre-push frame can also show avatar pucks off the same container.
    struct Puck: Codable, Hashable {
        let initial: String
        let red: UInt8
        let green: UInt8
        let blue: UInt8
        /// The opaque avatar disk key for `avatar-<userId>.png` in the shared container, nil
        /// when the member has no avatar. Default-nil in the memberwise init so existing
        /// construction stays source-compatible.
        var userId: String? = nil
    }

    /// The shared timer's origin (root DESIGN.md D15: derived from the event log,
    /// starts at first fill). The island never exists without it (ID-2).
    let firstFillAt: Date
    /// The room's name, as the room bar shows it.
    let roomName: String
    /// The puck cluster snapshot in presence order (RosterList.cluster), at most four.
    /// The frozen fallback; the born-live content-state carries the same cluster with live
    /// presence, and the server drives it after.
    let pucks: [Puck]
}
