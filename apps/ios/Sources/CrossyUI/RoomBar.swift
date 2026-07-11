// The room bar (apps/ios/DESIGN.md §4): a cluster of glass pills, not one bar
// (owner ruling 2026-07-10). A back button leads, circular standing glass in the
// compact-toolbar register; the time pill carries the room's vital signs (the
// weather dot, the reconnect countdown, the ambient clock) and is always
// tappable, because the time pill is the room's facts (owner ruling 2026-07-10:
// mid-solve it opens the room-facts card, at completion the same surface is the
// stats card, ID-2 unchanged); the players pill presents the roster as a system
// Menu (RosterMenu, the Mail mechanism). The leading pill retired with the same
// ruling: the room name lives in the facts card now. On iOS 26+ the back button
// and the time pill share one GlassEffectContainer at a spacing below the
// metaball fuse (SP-i1, DESIGN.md §10) while the menu-bearing pill stands
// outside it (a Menu inside a container breaks its morph on 26.1); below 26 the
// same layout renders as separate blur-material capsules through
// ChromeGlassSurface, the §4 one-fallback rule.
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
struct RoomBar<FactsPopover: View>: View {
    let ground: GridGround
    let weather: RoomWeather
    let reconnectRetryAt: Date?
    let firstFillAt: String?
    let completedAt: String?
    let members: [RosterMember]
    /// True while an open panel eclipses the back button (PanelEclipse): no
    /// morph rests here, but buried glass refracts through a panel's surface,
    /// so the button yields for the panel's life. Layout and reporting stay.
    let backHandedOff: Bool
    /// True while the facts card exists: the time pill is the card at rest,
    /// so the whole pill, glass, weather, and clock, hands off and yields.
    /// Layout and frame reporting stay; the visual goes with the morph.
    let timeHandedOff: Bool
    /// The way out of the room. The arrival flow wires the destination; the
    /// bar only reports the intent.
    let onBack: () -> Void
    /// The time pill's summon (always live: the time pill is the room's
    /// facts). Mid-solve it raises the facts popover; at completion the frozen
    /// clock summons the stats card morph back (ID-2). Routing is the caller's.
    let onTapTimePill: () -> Void
    /// True once the room completes, for the pill's spoken label (the visual
    /// is one surface either way).
    let completed: Bool
    /// The roster menu's needs: who the local user is (the spectator edge and
    /// the host's kick gate) and the Join in intent (ID-5), passed through to
    /// RosterMenu, plus the host's kick (owner ruling 2026-07-10).
    let selfUserId: String?
    let onJoinIn: () -> Void
    let onKick: (String) -> Void
    /// The mid-solve facts popover flowing out of the time pill (owner ruling
    /// 2026-07-10, MorphLab variant C). A binding the pill's `.popover` reads,
    /// so the system owns placement, stacking, and dismissal; the content is
    /// the caller's (the facts and the §12 operations).
    @Binding var factsPopoverPresented: Bool
    @ViewBuilder let factsPopover: () -> FactsPopover

    var body: some View {
        HStack(spacing: ChromeLayout.pillGap) {
            // One container so the standing pills read as one system of glass;
            // the blend spacing stays below the metaball threshold so they
            // never fuse at rest (SP-i1's caution, DESIGN.md §10). The players
            // pill stands OUTSIDE: its menu is a system presentation, and a
            // Menu inside a GlassEffectContainer breaks the morph on 26.1.
            // macOS test builds and iOS below 26 take the same layout with no
            // container (KeyDeck's gating).
            #if os(iOS)
                if #available(iOS 26.0, *) {
                    GlassEffectContainer(spacing: ChromeLayout.pillClusterBlend) {
                        timedPills
                    }
                } else {
                    timedPills
                }
            #else
                timedPills
            #endif
            RosterMenu(
                ground: ground, members: members,
                selfUserId: selfUserId, onJoinIn: onJoinIn, onKick: onKick)
        }
    }

    // MARK: The cluster

    private var timedPills: some View {
        HStack(spacing: ChromeLayout.pillGap) {
            backButton
            Spacer(minLength: 0)
            // The 1 Hz timeline drives the clock and the countdown; at rest
            // it is the only thing in the room that ticks. Scoped to the time
            // pill: the back button never re-renders on a tick.
            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                timePill(now: timeline.date)
            }
        }
    }

    // MARK: The back button

    /// Circular standing glass in the compact-toolbar register (owner ruling
    /// 2026-07-10): the chevron is ink, never a color (§3). The open facts
    /// card can reach this edge on narrow layouts, so the button hands off
    /// while eclipsed exactly as the retired leading pill did (PanelEclipse).
    private var backButton: some View {
        Button(action: onBack) {
            Image(systemName: "chevron.backward")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .frame(width: ChromeLayout.pillHeight, height: ChromeLayout.pillHeight)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        .accessibilityLabel(Text(verbatim: "Back"))
        .opacity(backHandedOff ? 0 : 1)
        // The eclipse yield includes touch, the handed-off pill rule.
        .allowsHitTesting(!backHandedOff)
        .reportChromeFrame(.backButton)
    }

    // MARK: The time pill (the room's vital signs, and its facts)

    /// The weather and the ambient clock in one pill: the status dot, during a
    /// reconnect the quiet countdown next to it (DESIGN.md §8: never a modal,
    /// never a spinner over the grid), and the clock (ID-2). Always tappable:
    /// the time pill is the room's facts (owner ruling 2026-07-10), so a tap
    /// opens the facts card mid-solve and the stats card once the room
    /// completes. The clock reports its own frame: it is the card's rider, and
    /// the rider launches from the glyphs it left, not from the pill's center
    /// (the weather sits beside the clock now).
    private func timePill(now: Date) -> some View {
        Button(action: onTapTimePill) {
            HStack(spacing: 8) {
                weatherCluster(now: now)
                Text(
                    verbatim: AmbientClock.display(
                        firstFillAt: firstFillAt, completedAt: completedAt, now: now)
                )
                .font(.system(size: 13, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(Color(rgb: ground.tokens.number))
                .reportChromeFrame(.timePillClock)
            }
            .padding(.horizontal, 12)
            .frame(height: ChromeLayout.pillHeight)
            .contentShape(
                RoundedRectangle(
                    cornerRadius: ChromeLayout.pillCornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        .accessibilityLabel(Text(verbatim: timePillAccessibilityLabel))
        .opacity(timeHandedOff ? 0 : 1)
        // The yield includes touch (DESIGN.md §4: transient panels yield to
        // intent): a tap on the handed-off pill's ghost is a touch outside the
        // panel, so it falls to the bar's dismiss layer instead of the button.
        .allowsHitTesting(!timeHandedOff)
        .reportChromeFrame(.timePill)
        // The mid-solve facts popover flows out of this pill (owner ruling
        // 2026-07-10). MorphLab variant D proved a popover from a pill inside
        // the cluster's GlassEffectContainer presents cleanly, so the pill
        // stays inside the container and the popover attaches here. The system
        // owns placement and dismissal; the completion path never sets this
        // (it keeps the clock-rider morph, ID-2).
        .popover(isPresented: $factsPopoverPresented) { factsPopover() }
    }

    /// ID-2's grammar at completion, the facts card's summon otherwise. The
    /// weather's spoken words are RoomWeather's own, unchanged.
    private var timePillAccessibilityLabel: String {
        completed
            ? "Solved together, show stats"
            : "Shared time, \(weatherAccessibilityLabel), show room facts"
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
