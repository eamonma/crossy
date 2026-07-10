// The room bar (apps/ios/DESIGN.md §4): a cluster of glass pills, not one bar
// (owner ruling 2026-07-10). A leading pill carries the name and the weather, a
// time pill the ambient clock, a players pill the pucks; small standing chrome in
// the compact-toolbar register. Each morph-bearing pill is its own morph rest:
// the players pill inflates into the roster sheet and the time pill into the
// stats card, so a panel is always the pill reshaped, never new glass conjured
// over old (the glass-on-glass moment the cluster replaces). On iOS 26+ the
// pills share one GlassEffectContainer at a spacing below the metaball fuse
// (SP-i1, DESIGN.md §10); below 26 the same layout renders as separate
// blur-material capsules through ChromeGlassSurface, the §4 one-fallback rule.
//
// The clock is ID-2's: small, tabular, quiet, 0:00 before the first fill, frozen
// at completion, ticking natively from `firstFillAt` with no store updates (root
// DESIGN.md D15). Pills keep the capsule register the island shares (DESIGN.md
// §8; I5 condenses the room into it, this shape must not preclude that). Chrome
// carries no color of its own (§3); the pucks are the people.

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
    /// True while the roster panel exists: the players pill is the panel at
    /// rest (DESIGN.md §4), so the whole pill, glass and pucks, hands off and
    /// yields. Layout and frame reporting stay; the visual goes with the morph.
    let playersHandedOff: Bool
    /// True while the stats card exists: the time pill is the card at rest
    /// (ID-2), so the whole pill yields, same rule as the players pill.
    let timeHandedOff: Bool
    /// Non-nil once the room completes: tapping the frozen clock summons the
    /// stats card back (the card is the pill, inflated).
    let onTapClock: (() -> Void)?
    let onTapPucks: () -> Void

    var body: some View {
        // One container so the cluster reads as one system of glass; the blend
        // spacing stays below the metaball threshold so the pills never fuse at
        // rest (SP-i1's caution, DESIGN.md §10). macOS test builds and iOS
        // below 26 take the same layout with no container (KeyDeck's gating).
        #if os(iOS)
            if #available(iOS 26.0, *) {
                GlassEffectContainer(spacing: ChromeLayout.pillClusterBlend) {
                    pills
                }
            } else {
                pills
            }
        #else
            pills
        #endif
    }

    // MARK: The cluster

    private var pills: some View {
        HStack(spacing: ChromeLayout.pillGap) {
            // The 1 Hz timeline drives both the clock and the countdown; at
            // rest it is the only thing in the room that ticks.
            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                HStack(spacing: ChromeLayout.pillGap) {
                    leadingPill(now: timeline.date)
                    Spacer(minLength: 0)
                    timePill(now: timeline.date)
                }
            }
            playersPill
        }
    }

    // MARK: The leading pill (name and weather)

    /// The room's name with its weather: the dot, and during a reconnect the
    /// quiet countdown next to it (DESIGN.md §8: never a modal, never a
    /// spinner over the grid).
    private func leadingPill(now: Date) -> some View {
        HStack(spacing: 8) {
            Text(verbatim: roomName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .lineLimit(1)
                .truncationMode(.tail)
            weatherCluster(now: now)
        }
        .padding(.horizontal, 14)
        .frame(height: ChromeLayout.pillHeight)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
    }

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

    // MARK: The time pill

    /// The ambient clock (ID-2) as its own pill, and the stats morph's rest:
    /// the whole pill's frame is reported for the card's geometry, its
    /// rendering yields while the card exists (the time rides the card from
    /// the pill's center), and the frozen value takes a tap to summon the card
    /// back.
    @ViewBuilder
    private func timePill(now: Date) -> some View {
        let display = Text(
            verbatim: AmbientClock.display(
                firstFillAt: firstFillAt, completedAt: completedAt, now: now)
        )
        .font(.system(size: 13, weight: .medium))
        .monospacedDigit()
        .foregroundStyle(Color(rgb: ground.tokens.number))

        Group {
            if let onTapClock {
                Button(action: onTapClock) { display.contentShape(Rectangle()) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: "Solved together, show stats"))
            } else {
                display.accessibilityLabel(Text(verbatim: "Shared time"))
            }
        }
        .padding(.horizontal, 12)
        .frame(height: ChromeLayout.pillHeight)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        .opacity(timeHandedOff ? 0 : 1)
        // The yield includes touch (DESIGN.md §4: transient panels yield to
        // intent): a tap on the handed-off pill's ghost is a touch outside the
        // panel, so it falls to the bar's dismiss layer instead of the button.
        .allowsHitTesting(!timeHandedOff)
        .reportChromeFrame(.timePill)
    }

    // MARK: The players pill

    private var playersPill: some View {
        let cluster = RosterList.cluster(members)
        return Button(action: onTapPucks) {
            HStack(spacing: 4) {
                HStack(spacing: -7) {
                    ForEach(cluster.pucks) { member in
                        RosterPuckView(member: member, ground: ground, diameter: 24)
                            .reportChromeFrame(.puck(member.userId))
                    }
                }
                if cluster.overflow > 0 {
                    Text(verbatim: "+\(cluster.overflow)")
                        .font(.system(size: 11, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                }
            }
            .padding(.horizontal, 10)
            .frame(height: ChromeLayout.pillHeight)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        .opacity(playersHandedOff ? 0 : 1)
        // Same touch yield as the time pill: while the roster is open, the
        // ghost area dismisses through the bar rather than re-toggling.
        .allowsHitTesting(!playersHandedOff)
        .reportChromeFrame(.playersPill)
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
