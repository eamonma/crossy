//
//  CrossyWidgets.swift
//  CrossyWidgets
//
//  The island is the room bar condensed (apps/ios/DESIGN.md §8): pucks leading,
//  the derived timer trailing, black glass. The timer renders natively from the
//  fixed `firstFillAt` and ticks with zero ActivityKit updates, surviving app
//  death (root DESIGN.md D15; proven in reports/spikes/sp-i3-island.md). The
//  timer text is greedy, so every presentation caps it with a trailing frame or
//  it shoves the leading region (SP-i3).
//

import ActivityKit
import SwiftUI
import WidgetKit

@main
struct CrossyWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SolveActivityWidget()
    }
}

struct SolveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SolveActivityAttributes.self) { context in
            // The lock screen banner and the pull-down cover sheet: the room
            // bar's whole line on black glass.
            SolveLockScreenView(attributes: context.attributes)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    PuckCluster(pucks: context.attributes.pucks, diameter: 22, overlap: -6)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    SolveTimer(anchor: context.attributes.firstFillAt)
                        .font(.system(size: 22, weight: .semibold))
                        .frame(maxWidth: 96, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // The room line (SP-i3: the bottom region is the room's).
                    Text(verbatim: context.attributes.roomName)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.65))
                        .lineLimit(1)
                }
            } compactLeading: {
                PuckCluster(
                    pucks: Array(context.attributes.pucks.prefix(3)), diameter: 14, overlap: -5)
            } compactTrailing: {
                SolveTimer(anchor: context.attributes.firstFillAt)
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: 56, alignment: .trailing)
            } minimal: {
                // One slot: lead with a person, the §8 order (pucks before timer).
                PuckCluster(
                    pucks: Array(context.attributes.pucks.prefix(1)), diameter: 16, overlap: 0)
            }
        }
    }
}

/// The shared clock, rendered and ticked by the system from the fixed anchor
/// (D15: zero updates, no process needed). `countsDown: false` counts up from
/// the first fill; the 24 h horizon sits comfortably past the 8 h island cap
/// (12 h lock screen), so the system retires the activity long before the range
/// could end and freeze the timer (SP-i3).
private struct SolveTimer: View {
    let anchor: Date

    var body: some View {
        Text(
            timerInterval: anchor...anchor.addingTimeInterval(24 * 3600),
            countsDown: false
        )
        .monospacedDigit()
        .foregroundStyle(.white)
    }
}

/// The roster pucks, the room bar's cluster condensed. Colors arrived resolved
/// for the dark ground at request time: the island is always black glass, so no
/// ground selection happens here.
private struct PuckCluster: View {
    let pucks: [SolveActivityAttributes.Puck]
    let diameter: CGFloat
    let overlap: CGFloat

    var body: some View {
        HStack(spacing: overlap) {
            ForEach(Array(pucks.enumerated()), id: \.offset) { _, puck in
                PuckView(puck: puck, diameter: diameter)
            }
        }
    }
}

/// One puck: the member's roster color, the initial in the Observatory cell tone
/// (RosterPuckView's rule on the dark ground; the value mirrors Ground.observatory
/// cell, 0x201F27). The ring is black: on black glass the seam between stacked
/// pucks is the glass itself showing through.
private struct PuckView: View {
    let puck: SolveActivityAttributes.Puck
    let diameter: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(
                Color(
                    red: Double(puck.red) / 255,
                    green: Double(puck.green) / 255,
                    blue: Double(puck.blue) / 255))
            if diameter >= 14 {
                Text(verbatim: puck.initial)
                    .font(.system(size: diameter * 0.42, weight: .bold))
                    .foregroundStyle(Color(red: 0x20 / 255, green: 0x1F / 255, blue: 0x27 / 255))
            }
        }
        .frame(width: diameter, height: diameter)
        .overlay(Circle().stroke(.black, lineWidth: diameter >= 20 ? 1.5 : 1))
    }
}

/// The lock screen presentation: name leading the line like the room bar, pucks
/// and the ticking clock trailing, black glass via the activity background tint.
private struct SolveLockScreenView: View {
    let attributes: SolveActivityAttributes

    var body: some View {
        HStack(spacing: 10) {
            PuckCluster(pucks: attributes.pucks, diameter: 24, overlap: -7)
            Text(verbatim: attributes.roomName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 6)
            SolveTimer(anchor: attributes.firstFillAt)
                .font(.system(size: 17, weight: .semibold))
                .frame(maxWidth: 80, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}
