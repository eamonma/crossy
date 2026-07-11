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
//  attributes below stay the PRE-FIRST-PUSH fallback: until the first push lands the
//  content-state's pucks are empty, and the island renders this frozen snapshot with
//  progress HIDDEN, so the pre-push island looks exactly like it did before the push
//  track (owner ruling 2026-07-11).
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
    /// status, and completion stamp. Empty (`IslandContentState()`) until the first push,
    /// which is the pre-push fallback signal.
    typealias ContentState = IslandContentState

    /// One roster puck in the immutable snapshot, resolved at request time for the
    /// island's black glass: the member's dark-ground roster color as 8-bit sRGB
    /// components (the CrossyDesign RGBColor shape, apps/ios/DESIGN.md §3) and the
    /// ASCII-uppercased initial (INV-1). This is the frozen pre-push cluster; the live
    /// cluster rides the content-state (IslandPuck) so a member who joins after the
    /// activity started still appears.
    struct Puck: Codable, Hashable {
        let initial: String
        let red: UInt8
        let green: UInt8
        let blue: UInt8
    }

    /// The shared timer's origin (root DESIGN.md D15: derived from the event log,
    /// starts at first fill). The island never exists without it (ID-2).
    let firstFillAt: Date
    /// The room's name, as the room bar shows it.
    let roomName: String
    /// The puck cluster snapshot in presence order (RosterList.cluster), at most four.
    /// The pre-push fallback; superseded by the content-state cluster once a push lands.
    let pucks: [Puck]
}
