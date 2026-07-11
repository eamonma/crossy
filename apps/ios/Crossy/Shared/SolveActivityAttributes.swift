//
//  SolveActivityAttributes.swift
//  Crossy
//
//  The Live Activity's immutable facts (roadmap I5a, per SP-i3): the timer anchor
//  and the room condensed to what the island renders (apps/ios/DESIGN.md §8: pucks
//  leading, timer trailing, black glass). ContentState is EMPTY by design: the
//  system ticks the timer natively from `firstFillAt` with zero updates and the
//  activity outlives the app (root DESIGN.md D15); ActivityKit pushes (fill
//  progress, the away-completion moment) are the recorded post-v1 track
//  (EXPERIENCE.md §4). This file compiles into the app target and the widget
//  extension through the Shared/ synchronized folder, never through a SwiftPM
//  package: ActivityKit stays out of the packages, whose tests build on macOS.
//

import ActivityKit
import Foundation

struct SolveActivityAttributes: ActivityAttributes {
    /// Empty until the push track: nothing updates, nothing to push (D15).
    struct ContentState: Codable, Hashable {}

    /// One roster puck, resolved at request time for the island's black glass:
    /// the member's dark-ground roster color as 8-bit sRGB components (the
    /// CrossyDesign RGBColor shape, apps/ios/DESIGN.md §3) and the
    /// ASCII-uppercased initial (INV-1).
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
    /// The puck cluster in presence order (RosterList.cluster), at most four.
    let pucks: [Puck]
}
