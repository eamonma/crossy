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
import CrossyStore
import SwiftUI

/// Whether the time pill stands in the bar yet (DESIGN.md §4 toolbar amendment):
/// the pill ARRIVES once the room is live. Before the first `welcome` lands the
/// store is `connecting`, so the trailing cluster is share + players only, both
/// width-stable from the open frame; the welcome flips `sync` off `connecting`
/// and the pill materializes as its own bar-item insertion, so the open frame's
/// cluster no longer settles its slots after the #132 zoom push. The insert
/// itself carries NO animation (device rig 2026-07-12: the nav bar's slot pass is
/// UIKit's own and joins no SwiftUI transaction, so the pill just appears); a
/// content-only fade was weighed and rejected, because the system draws the glass
/// capsule from the item's mere presence, not its content (the empty-capsule
/// finding), so fading the content in would reveal it inside an already-standing
/// EMPTY capsule, the one thing §4 forbids. The honest arrival is the bare insert.
/// A terminal room's sealed pill arrives the same way, on its welcome's beat: any
/// state but `connecting` means a welcome landed and a board exists. Pure so a
/// test pins it, the RoomWeather.from(sync:) discipline.
@available(iOS 17.0, macOS 14.0, *)
enum TimePillPresence {
    /// True once the first welcome has landed (the room is live). Keyed on the
    /// store's honest existing fact (`connecting` is the only pre-welcome state,
    /// GameStore's SyncState), never a new flag.
    static func isLive(sync: SyncState) -> Bool {
        sync != .connecting
    }
}

/// A bar item's system glass capsule, gated so it is never conjured empty
/// (DESIGN.md §4). The nav bar draws the capsule from the item's mere PRESENCE,
/// not its content (the empty-capsule finding, rig 2026-07-12), so a handed-off
/// item whose content sits at opacity 0 would stand a hollow capsule. The rule is
/// one fact: the capsule's shared background hides exactly while the item is
/// handed off, and the item stays present so its frame keeps reporting. Pure so a
/// test pins the "no empty capsule" contract, applied at every glass bar item.
@available(iOS 17.0, macOS 14.0, *)
enum BarItemGlass {
    /// True when a SYSTEM-glass item's shared background must hide (the item is
    /// handed off, so its content is invisible and the capsule would otherwise stand
    /// empty). The back button and the Menus ride this rule: their glass is the bar's,
    /// visible at rest, suppressed only on the yield.
    static func backgroundHidden(handedOff: Bool) -> Bool {
        handedOff
    }

    /// The time pill's shared background hides ALWAYS (the timer's self-owned glass
    /// carve-out, DESIGN.md §4, the SLICE 2 redesign). The pill's item PERMANENTLY
    /// suppresses the system capsule and its content carries ITS OWN real glass
    /// (ChromeGlassSurface / the pre-#140 register), so the arrival can ride the chrome
    /// spring: opacity plus a slight scale settle reads as MATERIALIZE, and no frame is
    /// ever empty glass because the glass rides the content (a system capsule would
    /// stand from the item's presence a beat before the content, the very hollow the
    /// escape hatch closes). The Q3 rig finding: `.sharedBackgroundVisibility(.hidden)`
    /// suppresses the item's system capsule while the item stays present, so the pill
    /// keeps reporting its frame (the facts card's rest) with no system glass behind
    /// it. On the yield, opacity 0 hides glass and content together (no capsule to
    /// suppress separately, unlike the system-glass items above).
    static let timePillBackgroundHidden = true
}

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
    /// Whether the time pill stands in the bar yet (TimePillPresence, DESIGN.md
    /// §4 toolbar amendment): false before the first welcome, so the open frame's
    /// trailing cluster is share + players only and the pill arrives as its own
    /// insertion when the room goes live.
    let showsTimePill: Bool
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
            // The eclipsed back button leaves no empty capsule either (the same
            // §4 rule, the empty-capsule finding): its content goes to opacity 0
            // on a narrow-layout eclipse, and the system capsule would otherwise
            // stand hollow, so the shared background hides for the eclipse's life.
            .sharedBackgroundVisibility(
                BarItemGlass.backgroundHidden(handedOff: inputs.backHandedOff)
                    ? .hidden : .automatic)
            // The time pill ARRIVES once the room is live (DESIGN.md §4 toolbar
            // amendment): before the first welcome the trailing cluster is share
            // + players only, both width-stable from the open frame, so the pill's
            // insertion carries no slot snap after the #132 zoom push. Its trailing
            // spacer rides with it (a spacer splits two pills; without the pill
            // there is nothing to split from).
            if inputs.showsTimePill {
                ToolbarItem(placement: .topBarTrailing) {
                    RoomTimePill(
                        ground: inputs.ground, weather: inputs.weather,
                        reconnectRetryAt: inputs.reconnectRetryAt,
                        firstFillAt: inputs.firstFillAt, completedAt: inputs.completedAt,
                        status: inputs.status, handedOff: inputs.timeHandedOff,
                        onTap: inputs.onTapTimePill, reportFrame: inputs.reportFrame)
                }
                // The timer's self-owned glass carve-out (DESIGN.md §4, the SLICE 2
                // redesign): the pill's item PERMANENTLY suppresses the system capsule
                // and its content carries ITS OWN real glass, so the arrival rides the
                // chrome spring as a materialize (opacity + a slight scale settle) with
                // no frame ever empty glass. The item stays present, so its frame keeps
                // reporting (the facts card's rest, the pour-back's read). The yield is
                // just opacity 0 on the content now (glass and content together), no
                // separate capsule to suppress. Hidden ALWAYS, never gated on handoff.
                .sharedBackgroundVisibility(
                    BarItemGlass.timePillBackgroundHidden ? .hidden : .automatic)
                // A fixed spacer between every trailing pill so the cluster reads
                // as SEPARATE glass pills, not one fused "..." capsule (the
                // room-bar cluster law, DESIGN.md §4: back / time / share /
                // players, each its own object). One spacer per gap.
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
            }
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
        // The time pill arrives on the welcome's beat here too (DESIGN.md §4
        // toolbar amendment): before the room is live the fallback bar carries
        // back + the Menus only. The bar's own item insertion is the system's,
        // Reduce Motion included.
        if inputs.showsTimePill {
            ToolbarItem(placement: BarPlacement.trailing) {
                RoomTimePill(
                    ground: inputs.ground, weather: inputs.weather,
                    reconnectRetryAt: inputs.reconnectRetryAt,
                    firstFillAt: inputs.firstFillAt, completedAt: inputs.completedAt,
                    status: inputs.status, handedOff: inputs.timeHandedOff,
                    onTap: inputs.onTapTimePill, reportFrame: inputs.reportFrame)
            }
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

// MARK: - The withholding room's bar (the live-data birth rule, DESIGN.md §4)

/// The chrome the WITHHOLDING room carries before the board (DESIGN.md §4, the
/// live-data birth rule). On live data RealRoomView withholds SolveScreen until the
/// REST view lands (the I3f quiet canvas), so the full RoomToolbar has no host yet;
/// without a bar during the #132 zoom push there is NOTHING to goo into, and every
/// item pops at REST-mount (owner device finding: on live data share and players do
/// not animate, only the fixture's instant SolveScreen looked right). This carries the
/// pieces that CAN stand pre-REST so the push goos them in place: OUR back button
/// always (the way out, onBack/kicked-exit semantics), and the players pill seeded
/// from the tapped card's count (RoomArrivalSeed, count-true placeholder pucks). The
/// time pill and the share pill do NOT stand here: both are REST-gated (the pill
/// arrives on the welcome's beat, TimePillPresence; the share menu's rows bake the
/// invite code, which only GET /games/{id} carries, so it cannot defer cleanly and
/// stays a REST-gated item, never a dead control). The pieces reuse RoomBackButton and
/// RosterMenu in the SAME placements the full bar uses, so the nav bar keeps their
/// identity across the withheld→ready branch swap and nothing re-inserts.
#if os(iOS)
    @available(iOS 26.0, *)
    @MainActor
    struct RoomOpeningToolbar: ToolbarContent {
        let ground: GridGround
        let members: [RosterMember]
        let backHandedOff: Bool
        let onBack: () -> Void

        var body: some ToolbarContent {
            ToolbarItem(placement: .topBarLeading) {
                // The withholding room opens no panel, so the back button reports no
                // frame here (nothing reads it yet, PanelEclipse is idle); the full
                // bar re-attaches the report when SolveScreen mounts.
                RoomBackButton(
                    ground: ground, handedOff: backHandedOff,
                    onBack: onBack, reportFrame: { _, _ in })
            }
            // The eclipsed back button leaves no empty capsule (the #149 arrangement,
            // BarItemGlass): idle here (no panel eclipses it in the withholding room),
            // but kept so the item's disposition matches the full bar exactly and the
            // nav bar keeps its identity across the withheld→ready swap.
            .sharedBackgroundVisibility(
                BarItemGlass.backgroundHidden(handedOff: backHandedOff)
                    ? .hidden : .automatic)
            // The seeded players pill: the count is honest from the card's list row
            // (placeholder pucks, the achromatic floor), so the pill stands at true
            // width and the push goos into it. Its roster menu is inert pre-REST (no
            // self identity, no live cursors, no host actions yet), so its closures
            // no-op and selfUserId is nil; the REST roster fills identities and the
            // welcome fills presence, the beats that add detail.
            ToolbarItem(placement: .topBarTrailing) {
                RosterMenu(
                    ground: ground, members: members,
                    selfUserId: nil, onJoinIn: {}, onKick: { _ in }, onGoTo: { _ in })
            }
        }
    }
#endif

/// The below-26 fallback (and the macOS test host) for the withholding room's bar:
/// the same pieces (back + seeded players), no ToolbarSpacer (26-only), the plain bar
/// material (the §4 one-fallback rule).
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct RoomOpeningToolbarFallback: ToolbarContent {
    let ground: GridGround
    let members: [RosterMember]
    let backHandedOff: Bool
    let onBack: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: BarPlacement.leading) {
            RoomBackButton(
                ground: ground, handedOff: backHandedOff,
                onBack: onBack, reportFrame: { _, _ in })
        }
        ToolbarItem(placement: BarPlacement.trailing) {
            RosterMenu(
                ground: ground, members: members,
                selfUserId: nil, onJoinIn: {}, onKick: { _ in }, onGoTo: { _ in })
        }
    }
}

/// Attaches the withholding room's bar (DESIGN.md §4, the live-data birth rule),
/// gating the 26-only path from the below-26 fallback exactly as RoomToolbarHost does.
/// Public so the app target's RealRoomView (the composition root that owns the
/// withholding, AD-2) can carry it over the RoomOpening and RoomOpenFailure branches:
/// the bar is born with the push, so back always stands and the seeded players pill
/// stands at true count, and the failure branch keeps the back button as a way out.
/// The members come from the store's seeded roster (placeholder pucks pre-REST); the
/// withholding room opens no panel, so no frame is reported here (the full bar
/// re-attaches the report when SolveScreen mounts).
@available(iOS 18.0, macOS 14.0, *)
public struct RoomOpeningToolbarHost: ViewModifier {
    let ground: GridGround
    let members: [RosterMember]
    let backHandedOff: Bool
    let onBack: () -> Void

    public init(
        ground: GridGround,
        members: [RosterMember],
        backHandedOff: Bool = false,
        onBack: @escaping () -> Void
    ) {
        self.ground = ground
        self.members = members
        self.backHandedOff = backHandedOff
        self.onBack = onBack
    }

    public func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.toolbar {
                    RoomOpeningToolbar(
                        ground: ground, members: members, backHandedOff: backHandedOff,
                        onBack: onBack)
                }
            } else {
                content.toolbar {
                    RoomOpeningToolbarFallback(
                        ground: ground, members: members, backHandedOff: backHandedOff,
                        onBack: onBack)
                }
            }
        #else
            content.toolbar {
                RoomOpeningToolbarFallback(
                    ground: ground, members: members, backHandedOff: backHandedOff,
                    onBack: onBack)
            }
        #endif
    }
}

/// The withholding room's roster, mapped from the store's seeded participants
/// (DESIGN.md §4, the live-data birth rule). The composition root owns the store, so
/// the app target reads `store.participants` and hands a plain closure here; this pure
/// helper keeps the placeholder rule (RoomArrivalSeed.isPlaceholderID) in ONE place,
/// the same rule SolveScreen's rosterMembers applies once the board mounts, so the
/// seeded pill and the live pill read identically. Pinned in tests.
@available(iOS 17.0, macOS 14.0, *)
public enum RoomOpeningRoster {
    /// One seeded participant's plain facts as the roster needs them. The app target
    /// passes the store participant's fields (it sees CrossyProtocol's Participant;
    /// CrossyUI does not), so this takes the bare tuple and applies the placeholder
    /// rule. `connected` and the role flags ride through for parity with the live
    /// mapping, though a placeholder puck reads none of them (it renders the floor).
    public static func member(
        userId: String, displayName: String, wireColor: String, avatarUrl: String?,
        isHost: Bool, isSpectator: Bool, connected: Bool
    ) -> RosterMember {
        RosterMember(
            userId: userId, displayName: displayName, wireColor: wireColor,
            avatarUrl: avatarUrl, isHost: isHost, isSpectator: isSpectator,
            connected: connected,
            placeholder: RoomArrivalSeed.isPlaceholderID(userId))
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
    /// The arrival materialize (the timer's self-owned glass carve-out, DESIGN.md §4,
    /// SLICE 2): false for the first frame the pill mounts, flipped true on appear so
    /// the content (glass included) settles in on the chrome spring, opacity plus a
    /// slight scale reading as materialize. The pill mounts only when the room goes
    /// live (TimePillPresence gates the item's presence), so this fires exactly on the
    /// welcome's beat, once. Reduce Motion starts it already arrived, so there is no
    /// animation and no empty frame.
    @State private var arrived = false

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
            // The self-owned glass register, recovered from the pre-#140 pill (its
            // horizontal padding 12, pillHeight, contentShape): the pill carries its
            // OWN glass now (ChromeGlassSurface, `.regular` on 26 / the blur material
            // below), because the item's system capsule is permanently suppressed
            // (BarItemGlass.timePillBackgroundHidden), so the arrival can ride the
            // content instead of the bar drawing a capsule a beat early.
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
        // The arrival materialize (SLICE 2): content and glass fade and settle in
        // together on the chrome spring, no frame ever empty glass (the glass rides
        // the content). The yield simplifies to opacity 0 for this item now: hiding
        // the content hides the glass with it, and there is no system capsule to leave
        // hollow (unlike the back button and the Menus). Reduce Motion holds it
        // arrived from the first frame, so the pill snaps in with no animation.
        .scaleEffect(arrivalScale)
        .opacity(handedOff ? 0 : (arrived ? 1 : 0))
        .animation(reduceMotion ? nil : .crossyChrome, value: arrived)
        .onAppear { arrived = true }
        // The yield includes touch (DESIGN.md §4: transient panels yield to
        // intent): a tap on the handed-off pill's ghost is a touch outside the
        // panel, so it falls through to the room's dismiss layer instead of
        // the button (the bar's own catcher retired with the overlay).
        .allowsHitTesting(!handedOff)
        .reportBarItemFrame(.timePill, into: reportFrame)
    }

    /// The arrival's slight scale settle (SLICE 2): a hair under full size before the
    /// pill has arrived, so the content settles UP into place on the chrome spring and
    /// reads as materialize rather than a hard cut. Full size once arrived and while
    /// handed off (a yielded pill does not re-shrink; it just fades out). Reduce Motion
    /// starts arrived, so this is always 1 there.
    private var arrivalScale: CGFloat {
        arrived ? 1 : 0.92
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
