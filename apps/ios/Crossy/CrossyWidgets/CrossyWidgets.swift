//
//  CrossyWidgets.swift
//  CrossyWidgets
//
//  The island is the room bar condensed (apps/ios/DESIGN.md §8): pucks leading, the
//  derived timer trailing, black glass. The timer renders natively from the fixed
//  `firstFillAt` and ticks with zero ActivityKit updates, surviving app death (root
//  DESIGN.md D15; proven in reports/spikes/sp-i3-island.md). The timer text is greedy,
//  so every presentation caps it with a trailing frame or it shoves the leading region
//  (SP-i3).
//
//  The push track (phase 2a; owner rulings 2026-07-11) adds what the content-state feeds:
//  a progress ring by the compact clock, the ringed puck in minimal, the sealed crew and
//  a ticked meter in the expanded island, the meter underline on the lock screen, the
//  terminal flip, and the stale-weather law. Every rule reads from one place:
//
//    IslandRender.frame(state:attributes:isStale:) folds the pushed content-state, the
//    immutable attributes, and context.isStale into a render-ready frame. Black glass is
//    always; chrome is achromatic; color belongs to the pucks alone (owner ruling). If
//    the content-state carries no cluster yet (pre-push) OR no grid (total 0), progress
//    is hidden and the frozen attributes cluster renders: the pre-push island looks
//    exactly like it did before this track. When the content-state is stale, everything
//    push-fed drops to the away register (0.38) while the timer stays full white: it is
//    computed on device and cannot lie.
//
//  The payload model (IslandContentState) and the ring, meter, and frozen-time math
//  (IslandPresentation) come from CrossyProtocol, the one package product this
//  extension links; both are pinned headlessly in CrossyProtocolTests against
//  vectors/live-activity.
//

import ActivityKit
import CrossyProtocol
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
            // The lock screen banner and the pull-down cover sheet: the room bar's whole
            // line on black glass, with the ticked meter as a baseline rule under it.
            SolveLockScreenView(frame: IslandRender.frame(context: context))
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let frame = IslandRender.frame(context: context)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    // The crew reading: the cluster grows, away members drop to the away
                    // register (owner ruling), terminal brings everyone to full. The
                    // vertical padding is deliberate mass: the expanded island shrink-wraps
                    // its content, and a shallow row reads as a thin pill instead of the
                    // full card (owner device report 2026-07-11). The crew at 44 with air
                    // claims the Music-scale rectangle.
                    PuckCluster(pucks: frame.pucks, diameter: 44, overlap: -12)
                        .padding(.leading, 6)
                        .padding(.vertical, 10)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TimerLabel(frame: frame, size: 32, weight: .semibold, maxWidth: 96)
                        .padding(.trailing, 6)
                        .padding(.vertical, 10)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottom(frame: frame)
                }
            } compactLeading: {
                // 16pt pucks balance the trailing clock-plus-ring so the pill reads
                // symmetrical around the sensor (owner device report 2026-07-11).
                PuckCluster(pucks: Array(frame.pucks.prefix(3)), diameter: 16, overlap: -6)
            } compactTrailing: {
                // Timer, then a small progress ring between it and the island's trailing
                // edge. The ring only appears once progress exists (post-push). The cap
                // hugs the ruled MM:SS form (never three sections); past the hour the
                // live format is the recorded 2b gap, not this frame's problem.
                HStack(spacing: 4) {
                    TimerLabel(frame: frame, size: 13, weight: .semibold, maxWidth: 40)
                    if let fraction = frame.fraction {
                        ProgressRing(fraction: fraction, diameter: 12, stroke: 2, dim: frame.dim)
                    }
                }
            } minimal: {
                // One slot: the §8 order leads with a person. Post-push, that puck rides
                // inside a 2 pt progress arc at the slot's edge; pre-push it is bare.
                MinimalRingedPuck(frame: frame)
            }
        }
    }
}

// MARK: - The render frame (the one fold every presentation reads)

/// A render-ready puck: the resolved color, the initial, and the opacity the frame
/// decided (connected, away, terminal-full, or stale-dimmed) so the views carry no logic.
private struct RenderPuck: Identifiable {
    let id: Int
    let color: Color
    let initial: String
    let opacity: Double
}

/// The folded island frame. Everything a presentation needs, decided once: which cluster
/// to show and at what opacities, whether progress exists and its fraction, whether the
/// timer is frozen (terminal) or live, the room line, and the global push-fed dim under
/// stale weather.
private struct IslandFrame {
    let pucks: [RenderPuck]
    /// The room line: the name, or "Solved together" on a completed room.
    let roomLine: String
    /// `filled of total` counts, or nil when progress is hidden (pre-push, no grid).
    let counts: String?
    /// The progress fraction in `0...1`, or nil when progress is hidden.
    let fraction: Double?
    /// The frozen solve string when terminal-completed, else nil (live timer runs).
    let frozenTime: String?
    /// The live timer's anchor (the attributes' first fill).
    let anchor: Date
    /// The push-fed dim: 0.38 under stale weather, 1 otherwise. Applies to pucks, counts,
    /// meter, and ring, never to the timer.
    let dim: Double
    /// Whether the meter and ring should read as fully sealed (a completed room), so a
    /// near-full fraction still closes the ring and fills the meter solid.
    let sealed: Bool
}

private enum IslandRender {
    static func frame(context: ActivityViewContext<SolveActivityAttributes>) -> IslandFrame {
        frame(state: context.state, attributes: context.attributes, isStale: context.isStale)
    }

    /// The one fold. The arithmetic delegates to IslandPresentation (CrossyProtocol),
    /// where CrossyProtocolTests pins it headlessly.
    static func frame(
        state: IslandContentState, attributes: SolveActivityAttributes, isStale: Bool
    ) -> IslandFrame {
        let completed = state.status == .completed
        let abandoned = state.status == .abandoned
        // The away register: stale weather dims everything push-fed to 0.38 (LAW). A
        // completed room seals at full regardless.
        let dim = (isStale && !completed) ? 0.38 : 1

        // Pre-push (empty cluster) or no grid: render the frozen attributes snapshot and
        // hide progress. This is the pre-push island, unchanged from before the track.
        let prePush = state.pucks.isEmpty || state.total == 0

        let pucks: [RenderPuck]
        if prePush {
            pucks = attributes.pucks.enumerated().map { index, puck in
                RenderPuck(
                    id: index,
                    color: Color(
                        red: Double(puck.red) / 255, green: Double(puck.green) / 255,
                        blue: Double(puck.blue) / 255),
                    initial: puck.initial,
                    opacity: 1)
            }
        } else {
            pucks = state.pucks.enumerated().map { index, puck in
                // Terminal completion brings every puck to full brightness regardless of
                // connected; otherwise away (connected == false) is the 0.38 register.
                // Stale weather multiplies the whole cluster down.
                let presence = (completed || puck.connected) ? 1.0 : 0.38
                return RenderPuck(
                    id: index,
                    color: Color(
                        red: Double(puck.red) / 255, green: Double(puck.green) / 255,
                        blue: Double(puck.blue) / 255),
                    initial: puck.initial,
                    opacity: presence * dim)
            }
        }

        let fraction: Double? =
            prePush
            ? nil : IslandPresentation.fraction(filled: state.filled, total: state.total)
        let counts: String? = prePush ? nil : "\(state.filled) of \(state.total)"

        // The room line: a completed solve reads "Solved together"; abandoned keeps the
        // room name (no celebration); ongoing and pre-push keep the name.
        let roomLine = completed ? "Solved together" : attributes.roomName

        // The frozen timer: completed freezes at completedAt - firstFillAt, static. An
        // abandoned room has no completion instant to freeze against, so its native timer
        // shows what it last ticked to while the meter and pucks are frozen by the
        // terminal content-state. Only a completed room renders a static frozen string.
        var frozenTime: String? = nil
        if completed, let completedAtString = state.completedAt,
            let completedAt = parseISO(completedAtString) {
            let seconds = IslandPresentation.frozenSeconds(
                from: attributes.firstFillAt, to: completedAt)
            frozenTime = IslandPresentation.frozenSolveTime(seconds: seconds)
        }

        return IslandFrame(
            pucks: pucks,
            roomLine: roomLine,
            counts: counts,
            fraction: fraction,
            frozenTime: frozenTime,
            anchor: attributes.firstFillAt,
            dim: dim,
            // A completed room seals the meter and ring solid; an abandoned room freezes
            // its partial fill without sealing.
            sealed: completed && !abandoned)
    }

    /// ISO 8601, fractional seconds tolerated (the AmbientClock.parse rule, restated here
    /// because AmbientClock lives in CrossyUI and this extension links only CrossyProtocol).
    private static func parseISO(_ string: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }
}

// MARK: - The timer (live or frozen)

/// The shared clock. Live it renders and ticks natively from the fixed anchor (D15: zero
/// updates); frozen (a completed room) it renders the static solve string, never a live
/// timer and never local now (owner ruling). The timer stays full white even under stale
/// weather: it is computed on device and cannot lie.
private struct TimerLabel: View {
    let frame: IslandFrame
    let size: CGFloat
    let weight: Font.Weight
    let maxWidth: CGFloat

    var body: some View {
        Group {
            if let frozen = frame.frozenTime {
                Text(verbatim: frozen)
            } else {
                Text(
                    timerInterval: frame.anchor...frame.anchor.addingTimeInterval(24 * 3600),
                    countsDown: false)
            }
        }
        .font(.system(size: size, weight: weight))
        .monospacedDigit()
        .foregroundStyle(.white)
        // The auto-updating timer reserves its widest possible width and CENTERS the
        // digits inside it, so the visible time floats left of its own box and dead air
        // opens between the clock and whatever trails it (owner device report
        // 2026-07-11). Trailing text alignment pins the digits to the box's right edge;
        // the frame cap then only bounds the reservation, never pads the glyphs.
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: maxWidth, alignment: .trailing)
    }
}

// MARK: - The progress ring (compact) and the ringed puck (minimal)

/// A thin achromatic progress ring: a white 0.85 arc on a white 0.14 track. Quantized
/// jumps are invisible at this size by design. The stale dim carries through the arc.
private struct ProgressRing: View {
    let fraction: Double
    let diameter: CGFloat
    let stroke: CGFloat
    let dim: Double

    var body: some View {
        ZStack {
            Circle().stroke(.white.opacity(0.14 * dim), lineWidth: stroke)
            Circle()
                .trim(from: 0, to: max(0, min(1, fraction)))
                .stroke(
                    .white.opacity(0.85 * dim),
                    style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: diameter, height: diameter)
    }
}

/// The minimal slot: one puck (the §8 lead), and post-push a 2 pt progress arc at the
/// slot's edge. A completed room closes the arc solid.
private struct MinimalRingedPuck: View {
    let frame: IslandFrame

    var body: some View {
        ZStack {
            if let fraction = frame.fraction {
                ProgressRing(
                    fraction: frame.sealed ? 1 : fraction, diameter: 24, stroke: 2, dim: frame.dim)
            }
            if let puck = frame.pucks.first {
                PuckView(puck: puck, diameter: frame.fraction == nil ? 16 : 14)
            }
        }
        .frame(width: 24, height: 24)
    }
}

// MARK: - The ticked meter (expanded, lock screen)

/// A 2 pt hairline meter: a white 0.14 track, a white 0.85 fill, and nine 1 pt ticks at
/// the tenths (white 0.16, extending 2 pt above the line) so quantized advances land as
/// detents. A completed room fills it solid. The stale dim carries through fill and track.
private struct TickedMeter: View {
    let fraction: Double
    let sealed: Bool
    let dim: Double

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let fill = sealed ? 1 : max(0, min(1, fraction))
            ZStack(alignment: .leading) {
                // The ticks rise 2 pt above the hairline at the tenths.
                ForEach(IslandPresentation.tickFractions, id: \.self) { tick in
                    Rectangle()
                        .fill(.white.opacity(0.16 * dim))
                        .frame(width: 1, height: 4)
                        .offset(x: width * tick - 0.5, y: -2)
                }
                Capsule().fill(.white.opacity(0.14 * dim)).frame(height: 2)
                Capsule().fill(.white.opacity(0.85 * dim)).frame(width: width * fill, height: 2)
            }
            .frame(height: 4, alignment: .bottom)
        }
        .frame(height: 4)
    }
}

// MARK: - Expanded bottom, lock screen

/// The expanded bottom region: the room line leading, the counts trailing (quieter white,
/// tabular), and the ticked meter beneath the whole row. Progress hides pre-push.
private struct ExpandedBottom: View {
    let frame: IslandFrame

    var body: some View {
        // Card-scale air (owner device report 2026-07-11): the bottom region carries the
        // mass that turns the shrink-wrapped pill into the full rectangle. Type steps up
        // to 15, the meter gets room above and below, and the region pads itself instead
        // of hugging the sensor row.
        VStack(spacing: 12) {
            HStack {
                Text(verbatim: frame.roomLine)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.65))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let counts = frame.counts {
                    Text(verbatim: counts)
                        .font(.system(size: 15, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.45 * frame.dim))
                }
            }
            if let fraction = frame.fraction {
                TickedMeter(fraction: fraction, sealed: frame.sealed, dim: frame.dim)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }
}

/// The lock screen presentation: pucks, room name, and timer on one line like the room
/// bar, with the same ticked meter as a baseline rule under it. Counts sit quietly under
/// the room name where they read without crowding the line.
private struct SolveLockScreenView: View {
    let frame: IslandFrame

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                PuckCluster(pucks: frame.pucks, diameter: 24, overlap: -7)
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: frame.roomLine)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if let counts = frame.counts {
                        Text(verbatim: counts)
                            .font(.system(size: 11, weight: .medium))
                            .monospacedDigit()
                            .foregroundStyle(.white.opacity(0.45 * frame.dim))
                    }
                }
                Spacer(minLength: 6)
                TimerLabel(frame: frame, size: 17, weight: .semibold, maxWidth: 92)
            }
            if let fraction = frame.fraction {
                TickedMeter(fraction: fraction, sealed: frame.sealed, dim: frame.dim)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - Pucks

/// The roster pucks, the room bar's cluster condensed. Colors arrived resolved for the
/// dark ground at request or push time: the island is always black glass, so no ground
/// selection happens here. The frame already decided each puck's opacity (presence, away,
/// terminal-full, or stale).
private struct PuckCluster: View {
    let pucks: [RenderPuck]
    let diameter: CGFloat
    let overlap: CGFloat

    var body: some View {
        HStack(spacing: overlap) {
            ForEach(pucks) { puck in
                PuckView(puck: puck, diameter: diameter)
            }
        }
    }
}

/// One puck: the member's roster color at the frame's opacity, the initial in the
/// Observatory cell tone (the value mirrors Ground.observatory cell, 0x201F27). The ring
/// is black: on black glass the seam between stacked pucks is the glass showing through.
private struct PuckView: View {
    let puck: RenderPuck
    let diameter: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(puck.color)
            if diameter >= 14 {
                Text(verbatim: puck.initial)
                    .font(.system(size: diameter * 0.42, weight: .bold))
                    .foregroundStyle(Color(red: 0x20 / 255, green: 0x1F / 255, blue: 0x27 / 255))
            }
        }
        .frame(width: diameter, height: diameter)
        .opacity(puck.opacity)
        .overlay(Circle().stroke(.black, lineWidth: diameter >= 20 ? 1.5 : 1))
    }
}
