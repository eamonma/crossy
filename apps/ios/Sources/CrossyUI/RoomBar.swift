// The room bar (apps/ios/DESIGN.md §4): frosted, standing; name, the shared
// ambient clock, the roster pucks, the weather dot. The clock is ID-2's: small,
// tabular, quiet, 0:00 before the first fill, frozen at completion, ticking
// natively from `firstFillAt` with no store updates (root DESIGN.md D15). The bar
// is a capsule because the island is (DESIGN.md §8: backgrounding condenses the
// room bar into the island; I5 builds that, this shape must not preclude it).
// Chrome carries no color of its own (§3); the pucks are the people.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RoomBar: View {
    let roomName: String
    let ground: GridGround
    let weather: RoomWeather
    let reconnectRetryAt: Date?
    let firstFillAt: String?
    let completedAt: String?
    let members: [RosterMember]
    let onTapPucks: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text(verbatim: roomName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 6)
            // The 1 Hz timeline drives both the clock and the countdown; at rest
            // it is the only thing in the room that ticks.
            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                HStack(spacing: 10) {
                    weatherCluster(now: timeline.date)
                    Text(verbatim: AmbientClock.display(
                        firstFillAt: firstFillAt, completedAt: completedAt, now: timeline.date))
                        .font(.system(size: 13, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                        .accessibilityLabel(Text(verbatim: "Shared time"))
                }
            }
            puckCluster
        }
        .padding(.horizontal, 16)
        .frame(height: ChromeLayout.barHeight)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.barCornerRadius))
    }

    // MARK: Weather

    /// The dot, and during a reconnect the quiet countdown next to it
    /// (DESIGN.md §8: never a modal, never a spinner over the grid).
    @ViewBuilder
    private func weatherCluster(now: Date) -> some View {
        HStack(spacing: 5) {
            if let line = weatherLine(now: now) {
                Text(verbatim: line)
                    .font(.system(size: 12, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            }
            WeatherDot(register: weather.dot, ground: ground)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: weatherAccessibilityLabel))
    }

    private func weatherLine(now: Date) -> String? {
        guard weather.label != nil else { return nil }
        if weather.showsCountdown {
            return RoomWeather.reconnectLine(retryAt: reconnectRetryAt, now: now)
        }
        return weather.label
    }

    private var weatherAccessibilityLabel: String {
        switch weather.dot {
        case .calm: return "Connected"
        case .breathing: return "Catching up"
        case .dimmed: return weather.label ?? "Reconnecting"
        }
    }

    // MARK: Pucks

    private var puckCluster: some View {
        let cluster = RosterList.cluster(members)
        return Button(action: onTapPucks) {
            HStack(spacing: 4) {
                HStack(spacing: -7) {
                    ForEach(cluster.pucks) { member in
                        RosterPuckView(member: member, ground: ground, diameter: 24)
                    }
                }
                if cluster.overflow > 0 {
                    Text(verbatim: "+\(cluster.overflow)")
                        .font(.system(size: 11, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                }
            }
        }
        .buttonStyle(.plain)
        .reportChromeFrame(.puckCluster)
        .accessibilityLabel(Text(verbatim: "Roster, \(members.count) in the room"))
    }
}

// MARK: - One puck

/// A participant's puck: their roster color, their initial in the paper's cell
/// tone. Away members sit back; presence is honest, not decorative.
@available(iOS 17.0, macOS 14.0, *)
struct RosterPuckView: View {
    let member: RosterMember
    let ground: GridGround
    let diameter: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(rgb: ground.rosterColor(member.identity)))
            Text(verbatim: member.initial)
                .font(.system(size: diameter * 0.42, weight: .bold))
                .foregroundStyle(Color(rgb: ground.tokens.cell))
        }
        .frame(width: diameter, height: diameter)
        .overlay(
            Circle().stroke(Color(rgb: ground.tokens.cell), lineWidth: 1.5)
        )
        .opacity(member.connected ? 1 : 0.35)
        .accessibilityHidden(true)
    }
}

// MARK: - The weather dot

/// Three registers (DESIGN.md §8): calm, breathing, dimmed-hollow. Achromatic:
/// weather is the room's state, not a person. The breath is a slow opacity pulse;
/// under Reduce Motion it holds at half strength instead of moving (§7).
@available(iOS 17.0, macOS 14.0, *)
private struct WeatherDot: View {
    let register: RoomWeather.Dot
    let ground: GridGround

    @State private var breathing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var tone: Color { Color(rgb: ground.tokens.number) }

    var body: some View {
        Group {
            switch register {
            case .calm:
                Circle().fill(tone)
            case .breathing:
                Circle().fill(tone)
                    .opacity(reduceMotion ? 0.5 : (breathing ? 0.25 : 1))
                    .onAppear {
                        guard !reduceMotion else { return }
                        withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                            breathing = true
                        }
                    }
                    .onDisappear { breathing = false }
            case .dimmed:
                Circle().stroke(tone, lineWidth: 1.5)
            }
        }
        .frame(width: 7, height: 7)
    }
}
