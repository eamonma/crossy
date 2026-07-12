// The room bar (apps/ios/DESIGN.md §4): a cluster of glass pills, not one bar
// (owner ruling 2026-07-10). Since the toolbar-adoption ruling (2026-07-11,
// SP-i6, Route 1) the cluster IS the system navigation bar's item set on the
// Rooms→room seam: the hand-drawn overlay retired so the #132 zoom push can goo
// the pieces in place (Mail's Edit → Select + "..." grammar). A back button
// leads (OUR back item, not the system's, preserving onBack/kicked-exit
// semantics); the time pill carries the room's vital signs while the room runs
// (the weather dot, the reconnect countdown, the ambient clock) and turns into
// its record at a terminal status (TimePillRegister, redesign 2026-07-11: a
// quiet check seals the frozen clock at completion; an abandoned room keeps the
// bare frozen clock). The pill is always tappable, because the time pill is the
// room's facts (owner ruling 2026-07-10): one tap, one mechanism, the pill
// inflated into the facts card (mid-solve with the §12 operations, at completion
// the stats card, ID-2). The players and share pills present as system Menus
// (RosterMenu / ShareMenuPill, the Mail mechanism), hosted directly as bar items
// now; a ToolbarSpacer splits every trailing pill so the cluster reads as
// separate pills (back / time / share / players). Below 26 the bar items render
// as the system's plain material (the §4 one-fallback rule, RoomToolbarFallback);
// the macOS test host (14) gates the 26-only API exactly as KeyDeck does.
//
// The clock is ID-2's: small, tabular, quiet, 0:00 before the first fill, frozen
// at completion, ticking natively from `firstFillAt` with no store updates (root
// DESIGN.md D15). The ongoing-to-terminal swap rides the chrome spring as a
// crossfade, no overshoot (§7); Reduce Motion cuts it. Pills keep the capsule
// register the island shares (DESIGN.md §8; I5 condenses the room into it, this
// shape must not preclude that). Chrome carries no color of its own (§3); the
// pucks are the people.
//
// The facts card launches from the time pill's REPORTED frame and the pill
// yields (timeHandedOff) for the card's life; a bar-hosted item reports its
// GLOBAL frame (reportBarItemFrame, an action closure that escapes the toolbar's
// preference boundary), which the solve screen converts into the room's
// coordinate space, because a ToolbarItem lives outside that space (the
// integration trap, DESIGN.md §4 toolbar amendment). MetaballPanelSurface is
// self-contained, so it does not share a container with the bar-hosted pill; the
// pill only reports accurately and yields while the card is open.

import CrossyDesign
import SwiftUI

/// The bar's item placements, gated for the macOS test host: `.topBarLeading`
/// and `.topBarTrailing` are iOS-only (unavailable on macOS), so the test host
/// takes the cross-platform equivalents. The toolbar never renders meaningfully
/// on macOS (tests are pure); this only keeps the fallback compiling there, the
/// KeyDeck gating discipline.
@available(iOS 17.0, macOS 14.0, *)
enum BarPlacement {
    static var leading: ToolbarItemPlacement {
        #if os(iOS)
            .topBarLeading
        #else
            .cancellationAction
        #endif
    }
    static var trailing: ToolbarItemPlacement {
        #if os(iOS)
            .topBarTrailing
        #else
            .primaryAction
        #endif
    }
}

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

/// Everything the room's top chrome takes, threaded once so the two toolbar
/// paths (26 and the below-26 fallback) share one payload. The solve screen
/// builds this and hands it to whichever path the floor allows.
@available(iOS 17.0, macOS 14.0, *)
struct RoomBarInputs {
    let ground: GridGround
    let weather: RoomWeather
    let reconnectRetryAt: Date?
    let firstFillAt: String?
    let completedAt: String?
    let members: [RosterMember]
    let backHandedOff: Bool
    let timeHandedOff: Bool
    let hasShare: Bool
    let onBack: () -> Void
    let onTapTimePill: () -> Void
    let shareCode: String?
    let shareUrlString: String?
    let onCopyShareLink: () -> Void
    let onShareInvite: () -> Void
    let status: RoomStatus
    let selfUserId: String?
    let onJoinIn: () -> Void
    let onKick: (String) -> Void
    let onGoTo: (RosterMember) -> Void
    /// The bar items' frame sink (the integration trap, DESIGN.md §4): the back
    /// button and the time pill hand their GLOBAL frames here, escaping the
    /// toolbar's preference boundary, and the solve screen converts them into
    /// room space. Without this the facts card never learns where the pill is.
    let reportFrame: (ChromePiece, CGRect) -> Void
}

// MARK: - The system-bar item set (the toolbar-adoption ruling, DESIGN.md §4)

/// The room's top chrome as the system navigation bar's items (SP-i6, Route 1):
/// back leading; the time pill, a ToolbarSpacer, then the share and players
/// Menus trailing (Mail's "..." grammar, each pill split so the cluster reads as
/// separate objects). The pieces goo into the Rooms Join item across the #132
/// zoom push, in the bar's persistent layer. The piece content views (below)
/// hold the register; this only lays them out. ToolbarSpacer is 26-only, so this
/// whole path is 26+; below 26 the fallback carries the same pieces. iOS-only:
/// the nav-bar placements do not exist on the macOS test host, which takes the
/// fallback.
#if os(iOS)
    @available(iOS 26.0, *)
    @MainActor
    struct RoomToolbar: ToolbarContent {
        let inputs: RoomBarInputs

        var body: some ToolbarContent {
            // OUR back button as a leading item, never the system back: the
            // composition root hides the system back and this carries the intent
            // (onBack), so the kicked-exit semantics survive the move.
            ToolbarItem(placement: .topBarLeading) {
                RoomBackButton(
                    ground: inputs.ground, handedOff: inputs.backHandedOff,
                    onBack: inputs.onBack, reportFrame: inputs.reportFrame)
            }
            ToolbarItem(placement: .topBarTrailing) {
                RoomTimePill(
                    ground: inputs.ground, weather: inputs.weather,
                    reconnectRetryAt: inputs.reconnectRetryAt,
                    firstFillAt: inputs.firstFillAt, completedAt: inputs.completedAt,
                    status: inputs.status, handedOff: inputs.timeHandedOff,
                    onTap: inputs.onTapTimePill, reportFrame: inputs.reportFrame)
            }
            // A fixed spacer between every trailing pill so the cluster reads as
            // SEPARATE glass pills, not one fused "..." capsule (the room-bar
            // cluster law, DESIGN.md §4: back / time / share / players, each its
            // own object). One spacer per gap.
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            if inputs.hasShare, let code = inputs.shareCode,
                let url = inputs.shareUrlString
            {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareMenuPill(
                        ground: inputs.ground, code: code, urlString: url,
                        onCopyLink: inputs.onCopyShareLink,
                        onShare: inputs.onShareInvite)
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
            }
            ToolbarItem(placement: .topBarTrailing) {
                RosterMenu(
                    ground: inputs.ground, members: inputs.members,
                    selfUserId: inputs.selfUserId, onJoinIn: inputs.onJoinIn,
                    onKick: inputs.onKick, onGoTo: inputs.onGoTo)
            }
        }
    }
#endif

/// The below-26 fallback (and the macOS test host): the same pieces as bar
/// items, but no ToolbarSpacer (26-only). The pills render the plain bar
/// material (the §4 one-fallback rule); RosterMenu and ShareMenuPill carry their
/// own fallback labels, and the system's default item spacing keeps them apart.
/// Back leads; the time pill, then the Menus, trail.
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct RoomToolbarFallback: ToolbarContent {
    let inputs: RoomBarInputs

    var body: some ToolbarContent {
        ToolbarItem(placement: BarPlacement.leading) {
            RoomBackButton(
                ground: inputs.ground, handedOff: inputs.backHandedOff,
                onBack: inputs.onBack, reportFrame: inputs.reportFrame)
        }
        ToolbarItem(placement: BarPlacement.trailing) {
            RoomTimePill(
                ground: inputs.ground, weather: inputs.weather,
                reconnectRetryAt: inputs.reconnectRetryAt,
                firstFillAt: inputs.firstFillAt, completedAt: inputs.completedAt,
                status: inputs.status, handedOff: inputs.timeHandedOff,
                onTap: inputs.onTapTimePill, reportFrame: inputs.reportFrame)
        }
        if inputs.hasShare, let code = inputs.shareCode,
            let url = inputs.shareUrlString
        {
            ToolbarItem(placement: BarPlacement.trailing) {
                ShareMenuPill(
                    ground: inputs.ground, code: code, urlString: url,
                    onCopyLink: inputs.onCopyShareLink,
                    onShare: inputs.onShareInvite)
            }
        }
        ToolbarItem(placement: BarPlacement.trailing) {
            RosterMenu(
                ground: inputs.ground, members: inputs.members,
                selfUserId: inputs.selfUserId, onJoinIn: inputs.onJoinIn,
                onKick: inputs.onKick, onGoTo: inputs.onGoTo)
        }
    }
}

/// Attaches the room's top chrome as system-bar items, gating the 26-only path
/// (RoomToolbar, with the ToolbarSpacer split) from the below-26 fallback
/// (RoomToolbarFallback). The macOS test host (14) compiles the fallback and
/// never names a 26 symbol, exactly as RoomBar/KeyDeck gate today. On iOS 18-25
/// the toolbar hosts the fallback; below 18 there is no device (the floor is 18).
@available(iOS 18.0, macOS 14.0, *)
struct RoomToolbarHost: ViewModifier {
    let inputs: RoomBarInputs

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.toolbar { RoomToolbar(inputs: inputs) }
            } else {
                content.toolbar { RoomToolbarFallback(inputs: inputs) }
            }
        #else
            content.toolbar { RoomToolbarFallback(inputs: inputs) }
        #endif
    }
}

// MARK: - The back button

/// Circular standing glass in the compact-toolbar register (owner ruling
/// 2026-07-10): the chevron is ink, never a color (§3). OUR back item, so the
/// system back stays hidden and onBack/kicked-exit semantics hold. The open
/// facts card can reach this edge on narrow layouts, so the button hands off
/// while eclipsed exactly as the retired leading pill did (PanelEclipse); its
/// global frame is reported for that test and the eclipse geometry.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RoomBackButton: View {
    let ground: GridGround
    let handedOff: Bool
    let onBack: () -> Void
    let reportFrame: (ChromePiece, CGRect) -> Void

    var body: some View {
        Button(action: onBack) {
            Image(systemName: "chevron.backward")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
        }
        .accessibilityLabel(Text(verbatim: "Back"))
        .opacity(handedOff ? 0 : 1)
        // The eclipse yield includes touch, the handed-off pill rule.
        .allowsHitTesting(!handedOff)
        .reportBarItemFrame(.backButton, into: reportFrame)
    }
}

// MARK: - The time pill (the room's vital signs, then its record)

/// While the room runs: the weather and the ambient clock in one pill, the
/// status dot, during a reconnect the quiet countdown next to it (DESIGN.md §8:
/// never a modal, never a spinner over the grid), and the clock (ID-2). At a
/// terminal status the vital signs stand down: a completed room seals the pill
/// with a quiet check beside the frozen clock, an abandoned room keeps the
/// frozen clock alone. The swap is a crossfade on the chrome spring, no
/// overshoot (§7); Reduce Motion cuts. Always tappable: the time pill is the
/// room's facts (owner ruling 2026-07-10), so a tap inflates it into the facts
/// card in every state. As a bar item it reports its global frame
/// (reportBarItemFrame), the facts card's rest geometry.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RoomTimePill: View {
    let ground: GridGround
    let weather: RoomWeather
    let reconnectRetryAt: Date?
    let firstFillAt: String?
    let completedAt: String?
    let status: RoomStatus
    let handedOff: Bool
    let onTap: () -> Void
    let reportFrame: (ChromePiece, CGRect) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // The 1 Hz timeline drives the clock and the countdown; at rest it is
        // the only thing in the room that ticks.
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            pill(now: timeline.date)
        }
    }

    private func pill(now: Date) -> some View {
        let register = TimePillRegister.from(status: status)
        return Button(action: onTap) {
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
            // ongoing-to-terminal swap crossfades its CONTENT on the chrome
            // spring. The pill's WIDTH does not ride this: a bar item's frame is
            // the system nav bar's to lay out, and it hard-snaps regardless of
            // our transaction (the toolbar amendment's width-snap finding,
            // DESIGN.md §4), so no width-driving value is wrapped here.
            .animation(reduceMotion ? nil : .crossyChrome, value: register)
        }
        .accessibilityLabel(
            Text(verbatim: register.accessibilityLabel(weather: weatherAccessibilityLabel))
        )
        .opacity(handedOff ? 0 : 1)
        // The yield includes touch (DESIGN.md §4: transient panels yield to
        // intent): a tap on the handed-off pill's ghost is a touch outside the
        // panel, so it falls through to the room's dismiss layer instead of
        // the button (the bar's own catcher retired with the overlay).
        .allowsHitTesting(!handedOff)
        .reportBarItemFrame(.timePill, into: reportFrame)
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
        // The dimmed dot is both registers; the visible word is gone for a first
        // connect (the terse pill, redesign 2026-07-11), so the spoken word stays
        // honest by the one fact that separates them: a reconnect counts down, a
        // first connect does not. VoiceOver still hears which is happening.
        case .dimmed: return weather.label ?? (weather.showsCountdown ? "Reconnecting" : "Connecting")
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
