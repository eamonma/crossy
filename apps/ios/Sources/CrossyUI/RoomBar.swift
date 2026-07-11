// The room bar (apps/ios/DESIGN.md §4): a cluster of glass pills, not one bar
// (owner ruling 2026-07-10). A back button leads, circular standing glass in the
// compact-toolbar register; the time pill carries the room's vital signs while
// the room runs (the weather dot, the reconnect countdown, the ambient clock)
// and turns into its record at a terminal status (TimePillRegister, redesign
// 2026-07-11: a quiet check seals the frozen clock at completion; an abandoned
// room keeps the bare frozen clock). The pill is always tappable, because the
// time pill is the room's facts (owner ruling 2026-07-10): one tap, one
// mechanism, the pill inflated into the facts card (mid-solve with the §12
// operations, at completion the stats card, ID-2). The players pill presents
// the roster as a system Menu (RosterMenu, the Mail mechanism). On iOS 26+ the
// back button and the time pill share one GlassEffectContainer at a spacing
// below the metaball fuse (SP-i1, DESIGN.md §10) while the menu-bearing pill
// stands outside it (a Menu inside a container breaks its morph on 26.1);
// below 26 the same layout renders as separate blur-material capsules through
// ChromeGlassSurface, the §4 one-fallback rule.
//
// The clock is ID-2's: small, tabular, quiet, 0:00 before the first fill, frozen
// at completion, ticking natively from `firstFillAt` with no store updates (root
// DESIGN.md D15). The ongoing-to-terminal swap rides the chrome spring as a
// crossfade, no overshoot (§7); Reduce Motion cuts it. Pills keep the capsule
// register the island shares (DESIGN.md §8; I5 condenses the room into it, this
// shape must not preclude that). Chrome carries no color of its own (§3); the
// pucks are the people.

import CrossyDesign
import SwiftUI

/// The time pill's register, derived from the room's status (pure, pinned).
/// Mid-solve the pill is the room's vital signs: the weather beside the live
/// clock. A completed room seals the pill: a quiet check beside the frozen
/// clock, the record of the solve. An abandoned room retires the weather and
/// keeps the frozen clock alone, terminal and quiet (EXPERIENCE.md). Either
/// way the clock freezes at the terminal instant (ID-2) and the tap still
/// summons the facts card.
public enum TimePillRegister: Equatable, Sendable {
    case vital
    case sealed
    case quiet

    public static func from(status: RoomStatus) -> TimePillRegister {
        switch status {
        case .ongoing: return .vital
        case .completed: return .sealed
        case .abandoned: return .quiet
        }
    }

    /// The pill's spoken line (the visual is one surface throughout). The
    /// weather's words render only while the weather does.
    public func accessibilityLabel(weather: String) -> String {
        switch self {
        case .vital: return "Shared time, \(weather), show room facts"
        case .sealed: return "Solved together, show stats"
        case .quiet: return "Final time, show room facts"
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RoomBar: View {
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
    /// Whether the room has an invite in hand (a share URL built from the
    /// invite code): the share pill stands only when there is something to
    /// share, never as a dead control.
    let hasShare: Bool
    /// True while the share card exists or another panel eclipses the pill
    /// (PanelEclipse): the card is the pill reshaped, so the pill yields.
    let shareHandedOff: Bool
    /// The way out of the room. The arrival flow wires the destination; the
    /// bar only reports the intent.
    let onBack: () -> Void
    /// The time pill's summon (always live: the time pill is the room's
    /// facts). One mechanism for both moments (redesign 2026-07-11): the tap
    /// inflates the pill into the facts card. Routing is the caller's.
    let onTapTimePill: () -> Void
    /// The share pill's summon: the tap inflates the pill into the share
    /// card (the facts card's grammar). Routing is the caller's.
    let onTapShare: () -> Void
    /// The room's lifecycle, for the pill's register (TimePillRegister) and
    /// its spoken label.
    let status: RoomStatus
    /// The roster menu's needs: who the local user is (the spectator edge and
    /// the host's kick gate) and the Join in intent (ID-5), passed through to
    /// RosterMenu, plus the host's kick (owner ruling 2026-07-10) and the
    /// per-member camera jump (Go to, gated on a live cursor).
    let selfUserId: String?
    let onJoinIn: () -> Void
    let onKick: (String) -> Void
    /// Jump the camera to a member's live cursor (RosterMenu's Go to action).
    let onGoTo: (RosterMember) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                selfUserId: selfUserId, onJoinIn: onJoinIn, onKick: onKick,
                onGoTo: onGoTo)
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
            // The share pill stands between the room's facts and the room's
            // people: the invite is the door between them. Inside the
            // container (its panel is a custom morph, not a Menu, so the
            // 26.1 break does not apply); the players pill keeps the corner,
            // because the people are the bar's color and the island's lead.
            if hasShare {
                sharePill
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

    // MARK: The share pill (the room's invite, owner ask 2026-07-11)

    /// A round standing pill in the back button's register: the share glyph
    /// in ink, no color (§3). Its tap inflates it into the share card (the
    /// facts card's one-surface grammar); while the card stands, or another
    /// panel eclipses it, the pill hands off exactly as the time pill does.
    private var sharePill: some View {
        Button(action: onTapShare) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                // The glyph's arrow rides high; a hair of lift centers the
                // boxed weight optically in the circle.
                .offset(y: -1)
                .frame(width: ChromeLayout.pillHeight, height: ChromeLayout.pillHeight)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        .accessibilityLabel(Text(verbatim: "Invite someone, show the share card"))
        .opacity(shareHandedOff ? 0 : 1)
        // The yield includes touch (the handed-off pill rule): a tap on the
        // ghost falls to the bar's dismiss layer, never re-summons.
        .allowsHitTesting(!shareHandedOff)
        .reportChromeFrame(.sharePill)
    }

    // MARK: The time pill (the room's vital signs, then its record)

    /// While the room runs: the weather and the ambient clock in one pill, the
    /// status dot, during a reconnect the quiet countdown next to it
    /// (DESIGN.md §8: never a modal, never a spinner over the grid), and the
    /// clock (ID-2). At a terminal status the vital signs stand down: a
    /// completed room seals the pill with a quiet check beside the frozen
    /// clock, an abandoned room keeps the frozen clock alone. The swap is a
    /// crossfade on the chrome spring, the pill's width settling with it, no
    /// overshoot (§7); Reduce Motion cuts. Always tappable: the time pill is
    /// the room's facts (owner ruling 2026-07-10), so a tap inflates it into
    /// the facts card in every state.
    private func timePill(now: Date) -> some View {
        let register = TimePillRegister.from(status: status)
        return Button(action: onTapTimePill) {
            HStack(spacing: 8) {
                switch register {
                case .vital:
                    weatherCluster(now: now)
                case .sealed:
                    sealMark
                case .quiet:
                    EmptyView()
                }
                Text(
                    verbatim: AmbientClock.display(
                        firstFillAt: firstFillAt, completedAt: completedAt, now: now)
                )
                .font(.system(size: 13, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(Color(rgb: ground.tokens.number))
            }
            // The one implicit animation here, keyed on the register alone
            // (never a tick, never drag geometry, SP-i1 untouched): the
            // ongoing-to-terminal swap crossfades on the chrome spring.
            .animation(reduceMotion ? nil : .crossyChrome, value: register)
            .padding(.horizontal, 12)
            .frame(height: ChromeLayout.pillHeight)
            .contentShape(
                RoundedRectangle(
                    cornerRadius: ChromeLayout.pillCornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        .accessibilityLabel(
            Text(verbatim: register.accessibilityLabel(weather: weatherAccessibilityLabel))
        )
        .opacity(timeHandedOff ? 0 : 1)
        // The yield includes touch (DESIGN.md §4: transient panels yield to
        // intent): a tap on the handed-off pill's ghost is a touch outside the
        // panel, so it falls to the bar's dismiss layer instead of the button.
        .allowsHitTesting(!timeHandedOff)
        .reportChromeFrame(.timePill)
    }

    /// The solved seal (redesign 2026-07-11): a quiet check in the weather's
    /// tone, the record that the room finished. Achromatic like all chrome
    /// (§3); the celebration's color belongs to the mosaic, never the pill.
    private var sealMark: some View {
        Image(systemName: "checkmark")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color(rgb: ground.tokens.number))
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
