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

/// Whether each trailing piece stands in the bar yet (DESIGN.md §4 toolbar
/// amendment). Two arrival shapes, chosen by whether the room was BORN WITH A SEED
/// (the seeded-birth rule, 2026-07-12): a card-tap arrival records the tapped row's
/// true member stack (PROTOCOL.md §12), so the cluster is born identity-true and
/// the players + share pills STAND from the push's first frame, and the goo plays
/// on live data. The unseeded arrival (deep links, code-joins) has no card, so it
/// keeps the one-beat fallback (SLICE B): the whole trailing cluster arrives
/// together on the welcome's beat.
///
/// The timer is a welcome arrival on BOTH paths: its clock genuinely needs the
/// welcome (`firstFillAt` and the live sync), so it can never stand pre-welcome
/// even seeded. So the split is exactly one axis: the timer waits for the welcome
/// always; the players and share pills stand pre-welcome when a seed exists, and
/// wait for the welcome otherwise. Every decision is pure on the store's honest
/// `sync` (`connecting` is the only pre-welcome state, GameStore's SyncState) and
/// the seeded fact (RoomChromeModel.seeded, set by the composition root at
/// construction), never a view-inline branch. The insert itself carries NO
/// animation (device rig 2026-07-12: the nav bar's slot pass is UIKit's own and
/// joins no SwiftUI transaction, so the items just appear). Share keeps its OWN
/// payload gate on top (the invite code, never a dead control), which the seed
/// satisfies pre-REST (GameSummary carries the member-only code, §12); this is the
/// one presence rule beneath all three.
@available(iOS 17.0, macOS 14.0, *)
enum ClusterPresence {
    /// True once the first welcome has landed (the room is live). Keyed on the
    /// store's honest existing fact (`connecting` is the only pre-welcome state,
    /// GameStore's SyncState), never a new flag. The unseeded whole-cluster gate
    /// and the timer's gate on both paths.
    static func isLive(sync: SyncState) -> Bool {
        sync != .connecting
    }

    /// Whether the TIMER stands. Welcome-gated on both paths (its clock needs the
    /// welcome; a seed cannot stand it early), so this is `isLive` unchanged. A
    /// terminal room's sealed pill arrives the same way, on its welcome's beat.
    static func showsTimer(sync: SyncState) -> Bool {
        isLive(sync: sync)
    }

    /// Whether the PLAYERS pill stands. Seeded: it stands from the push's first
    /// frame, identity-true from the row's member stack (the goo plays on live
    /// data). Unseeded: it waits for the welcome (the one-beat fallback). The pucks
    /// render through the exact same RosterMenu → RosterList.cluster path either
    /// way, so the solvers-only display rule applies to seeded members identically
    /// (spectators seed the store but never widen the pill).
    static func showsPlayers(sync: SyncState, seeded: Bool) -> Bool {
        seeded || isLive(sync: sync)
    }

    /// Whether the SHARE pill stands. Same seeded-vs-welcome shape as players; the
    /// bar keeps `hasShare` (the code + link payload) on top of this, which the
    /// seed satisfies pre-REST from the member-only invite code (§12).
    static func showsShare(sync: SyncState, seeded: Bool) -> Bool {
        seeded || isLive(sync: sync)
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
    /// True when a system-glass item's shared background must hide (the item is
    /// handed off, so its content is invisible and the capsule would otherwise stand
    /// empty). EVERY glass bar item rides this one rule now (the time pill, the back
    /// button, the Menus): their glass is the bar's, visible at rest, suppressed only
    /// on the yield. The time pill's self-owned glass carve-out retired 2026-07-12
    /// (SLICE D): inside a width-constrained bar item its own padding + frame +
    /// ChromeGlassSurface wrapped the clock to two lines where the system capsule
    /// never did, so the pill went back to the system capsule and its arrival is the
    /// bare insert on the welcome beat, alongside share and players (SLICE B). The
    /// handoff suppression is the real fix and stays.
    static func backgroundHidden(handedOff: Bool) -> Bool {
        handedOff
    }
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
    /// Whether each trailing piece stands in the bar yet (ClusterPresence, DESIGN.md
    /// §4 toolbar amendment). The timer is welcome-gated on both paths; the players
    /// and share pills stand pre-welcome when the room was born with a seed (the
    /// seeded-birth rule, §12), so a card-tap arrival goos its cluster on live data,
    /// and wait for the welcome otherwise (the one-beat fallback). Share keeps
    /// `hasShare` on top for its own payload gate (the seed satisfies it pre-REST).
    let showsTimer: Bool
    let showsPlayers: Bool
    let showsShare: Bool
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
            // The trailing pieces arrive per the seeded-birth rule (DESIGN.md §4
            // toolbar amendment, §12). Each gates on its own ClusterPresence
            // decision now, not one shared flag: the TIMER waits for the welcome on
            // both paths (its clock needs the welcome), while the players and share
            // pills STAND from the push's first frame when the room was born with a
            // seed, so a card-tap arrival goos them on live data. Trailing order is
            // fixed timer / share / players, so when the timer lands on the welcome
            // it inserts BEFORE a seeded share + players that already stood, and they
            // keep their identity (the same items, never re-inserted). An unseeded
            // room stands nothing trailing until the welcome, when all three insert
            // together (the one-beat fallback).
            if inputs.showsTimer {
                ToolbarItem(placement: .topBarTrailing) {
                    RoomTimePill(
                        ground: inputs.ground, weather: inputs.weather,
                        reconnectRetryAt: inputs.reconnectRetryAt,
                        firstFillAt: inputs.firstFillAt, completedAt: inputs.completedAt,
                        status: inputs.status, handedOff: inputs.timeHandedOff,
                        onTap: inputs.onTapTimePill, reportFrame: inputs.reportFrame)
                }
                // The time pill hands off (facts card open, or an eclipse) with no
                // hollow capsule: the shared background hides exactly while the item
                // is handed off, so the yield leaves no empty glass and the item
                // stays present for its frame to keep reporting (the facts card's
                // rest, the pour-back's read). The #149 arrangement, one rule with
                // the back button and the Menus.
                .sharedBackgroundVisibility(
                    BarItemGlass.backgroundHidden(handedOff: inputs.timeHandedOff)
                        ? .hidden : .automatic)
                // A fixed spacer between every trailing pill so the cluster reads
                // as SEPARATE glass pills, not one fused "..." capsule (the
                // room-bar cluster law, DESIGN.md §4: back / time / share /
                // players, each its own object). One spacer per gap.
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
            }
            // Share keeps its OWN payload gate on top of the presence rule (never a
            // dead control): the Menu's rows bake the invite code, so the item stands
            // only once the code and link exist. A seed carries the member-only code
            // pre-REST (§12), so share stands from the push's first frame on a
            // card-tap arrival; unseeded, it waits for the welcome. A room with no
            // shareable never stands it.
            if inputs.showsShare, inputs.hasShare, let code = inputs.shareCode,
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
            if inputs.showsPlayers {
                ToolbarItem(placement: .topBarTrailing) {
                    RosterMenu(
                        ground: inputs.ground, members: inputs.members,
                        selfUserId: inputs.selfUserId, onJoinIn: inputs.onJoinIn,
                        onKick: inputs.onKick, onGoTo: inputs.onGoTo)
                }
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
        // The trailing pieces gate per the seeded-birth rule here too (DESIGN.md §4
        // toolbar amendment, §12): the timer waits for the welcome, the seeded
        // players and share stand from the push's first frame (unseeded, all three
        // wait for the welcome, the one-beat fallback). No ToolbarSpacer here (it is
        // 26-only); the system's default item spacing keeps the pills apart. The
        // bar's own item insertion is the system's, Reduce Motion included.
        if inputs.showsTimer {
            ToolbarItem(placement: BarPlacement.trailing) {
                RoomTimePill(
                    ground: inputs.ground, weather: inputs.weather,
                    reconnectRetryAt: inputs.reconnectRetryAt,
                    firstFillAt: inputs.firstFillAt, completedAt: inputs.completedAt,
                    status: inputs.status, handedOff: inputs.timeHandedOff,
                    onTap: inputs.onTapTimePill, reportFrame: inputs.reportFrame)
            }
        }
        if inputs.showsShare, inputs.hasShare, let code = inputs.shareCode,
            let url = inputs.shareUrlString
        {
            ToolbarItem(placement: BarPlacement.trailing) {
                ShareMenuPill(
                    ground: inputs.ground, code: code, urlString: url,
                    onCopyLink: inputs.onCopyShareLink,
                    onShare: inputs.onShareInvite)
            }
        }
        if inputs.showsPlayers {
            ToolbarItem(placement: BarPlacement.trailing) {
                RosterMenu(
                    ground: inputs.ground, members: inputs.members,
                    selfUserId: inputs.selfUserId, onJoinIn: inputs.onJoinIn,
                    onKick: inputs.onKick, onGoTo: inputs.onGoTo)
            }
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
/// live-data birth rule, and the seeded-birth rule §12). On live data RealRoomView
/// withholds SolveScreen until the REST view lands (the I3f quiet canvas), so the
/// full RoomToolbar has no host yet; without a bar during the #132 zoom push there is
/// NOTHING to goo into, and every item pops at REST-mount (owner device finding: on
/// live data the trailing cluster did not animate, only the fixture's instant
/// SolveScreen looked right). The rule: THE BAR IS BORN WITH THE PUSH.
///
/// OUR back button always stands (the way out, onBack/kicked-exit semantics). When a
/// SEED exists (a card-tap arrival recorded the row's true member stack, §12), the
/// players pill and the share pill ALSO stand from the push's first frame,
/// identity-true: the players pill through the exact same RosterMenu → RosterList
/// .cluster path the live pill uses (solvers-only, so spectators seed the store but
/// never widen the pill), and the share pill from the seeded invite code (its Menu
/// payload complete pre-REST). The timer stays welcome-gated (its clock needs the
/// welcome), so it never stands here even seeded. This supersedes the deleted
/// placeholder experiment, which was false (count-only, guests miscounted, hollow
/// pucks); this is true data, the difference. The pieces reuse the SAME piece views
/// in the SAME placements the full bar uses (back leading; share then players
/// trailing, split by a ToolbarSpacer), so the nav bar keeps their identity across
/// the withheld→ready branch swap and nothing re-inserts; the welcome then inserts
/// only the timer, before the standing share.
#if os(iOS)
    @available(iOS 26.0, *)
    @MainActor
    struct RoomOpeningToolbar: ToolbarContent {
        let ground: GridGround
        let backHandedOff: Bool
        let onBack: () -> Void
        /// The seeded trailing cluster, present only when the room was born with a
        /// seed. nil on the unseeded path (deep links, code-joins), where the
        /// withholding bar stays back-only and the whole cluster arrives on the
        /// welcome (the one-beat fallback).
        let seed: RoomOpeningSeed?

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
            // The seeded trailing cluster: share then players, split by a spacer, the
            // full bar's trailing order minus the welcome-gated timer. The full bar
            // stands the same two items in the same placements when SolveScreen mounts
            // still pre-welcome, so the identity holds across the swap and only the
            // timer inserts later.
            if let seed {
                if let code = seed.shareCode, let url = seed.shareUrlString {
                    ToolbarItem(placement: .topBarTrailing) {
                        ShareMenuPill(
                            ground: ground, code: code, urlString: url,
                            onCopyLink: seed.onCopyShareLink, onShare: seed.onShareInvite)
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    RosterMenu(
                        ground: ground, members: seed.members,
                        selfUserId: seed.selfUserId, onJoinIn: seed.onJoinIn,
                        onKick: seed.onKick, onGoTo: seed.onGoTo)
                }
            }
        }
    }
#endif

/// The seeded trailing cluster the withholding bar stands (DESIGN.md §4, the
/// seeded-birth rule §12): the identity-true players and share pills, born from the
/// tapped row's member stack and its invite code, so the goo plays on live data with
/// no placeholders. Threaded through RoomOpeningToolbarHost by the composition root,
/// which owns the store→RosterMember map and the share payload; nil on the unseeded
/// path. The members are the SEEDED roster (RosterList.cluster filters spectators
/// out, the solvers-only rule, identically to the live pill), so a spectator seat
/// seeds the store but never widens the pill.
@available(iOS 17.0, macOS 14.0, *)
public struct RoomOpeningSeed {
    let members: [RosterMember]
    let selfUserId: String?
    let shareCode: String?
    let shareUrlString: String?
    let onJoinIn: () -> Void
    let onKick: (String) -> Void
    let onGoTo: (RosterMember) -> Void
    let onCopyShareLink: () -> Void
    let onShareInvite: () -> Void

    public init(
        members: [RosterMember],
        selfUserId: String?,
        shareCode: String?,
        shareUrlString: String?,
        onJoinIn: @escaping () -> Void = {},
        onKick: @escaping (String) -> Void = { _ in },
        onGoTo: @escaping (RosterMember) -> Void = { _ in },
        onCopyShareLink: @escaping () -> Void = {},
        onShareInvite: @escaping () -> Void = {}
    ) {
        self.members = members
        self.selfUserId = selfUserId
        self.shareCode = shareCode
        self.shareUrlString = shareUrlString
        self.onJoinIn = onJoinIn
        self.onKick = onKick
        self.onGoTo = onGoTo
        self.onCopyShareLink = onCopyShareLink
        self.onShareInvite = onShareInvite
    }
}

/// The below-26 fallback (and the macOS test host) for the withholding room's bar:
/// the same pieces as the 26 path, no ToolbarSpacer (26-only), the plain bar
/// material (the §4 one-fallback rule). Back always; the seeded share and players
/// when a seed exists (the seeded-birth rule §12).
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct RoomOpeningToolbarFallback: ToolbarContent {
    let ground: GridGround
    let backHandedOff: Bool
    let onBack: () -> Void
    let seed: RoomOpeningSeed?

    var body: some ToolbarContent {
        ToolbarItem(placement: BarPlacement.leading) {
            RoomBackButton(
                ground: ground, handedOff: backHandedOff,
                onBack: onBack, reportFrame: { _, _ in })
        }
        if let seed {
            if let code = seed.shareCode, let url = seed.shareUrlString {
                ToolbarItem(placement: BarPlacement.trailing) {
                    ShareMenuPill(
                        ground: ground, code: code, urlString: url,
                        onCopyLink: seed.onCopyShareLink, onShare: seed.onShareInvite)
                }
            }
            ToolbarItem(placement: BarPlacement.trailing) {
                RosterMenu(
                    ground: ground, members: seed.members,
                    selfUserId: seed.selfUserId, onJoinIn: seed.onJoinIn,
                    onKick: seed.onKick, onGoTo: seed.onGoTo)
            }
        }
    }
}

/// Attaches the withholding room's bar (DESIGN.md §4, the live-data birth rule and
/// the seeded-birth rule §12), gating the 26-only path from the below-26 fallback
/// exactly as RoomToolbarHost does. Public so the app target's RealRoomView (the
/// composition root that owns the withholding, AD-2) can carry it over the
/// RoomOpening and RoomOpenFailure branches: the bar is born with the push, so OUR
/// back button always stands (the way out on the failure branch too). When the room
/// was born with a seed, the composition root hands a RoomOpeningSeed and the
/// identity-true players + share pills stand from the push's first frame; the timer
/// stays welcome-gated, arriving when SolveScreen mounts and the welcome lands. The
/// withholding room opens no panel, so no frame is reported here (the full bar
/// re-attaches the report when SolveScreen mounts).
@available(iOS 18.0, macOS 14.0, *)
public struct RoomOpeningToolbarHost: ViewModifier {
    let ground: GridGround
    let backHandedOff: Bool
    let onBack: () -> Void
    let seed: RoomOpeningSeed?

    public init(
        ground: GridGround,
        backHandedOff: Bool = false,
        seed: RoomOpeningSeed? = nil,
        onBack: @escaping () -> Void
    ) {
        self.ground = ground
        self.backHandedOff = backHandedOff
        self.seed = seed
        self.onBack = onBack
    }

    public func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.toolbar {
                    RoomOpeningToolbar(
                        ground: ground, backHandedOff: backHandedOff,
                        onBack: onBack, seed: seed)
                }
            } else {
                content.toolbar {
                    RoomOpeningToolbarFallback(
                        ground: ground, backHandedOff: backHandedOff,
                        onBack: onBack, seed: seed)
                }
            }
        #else
            content.toolbar {
                RoomOpeningToolbarFallback(
                    ground: ground, backHandedOff: backHandedOff,
                    onBack: onBack, seed: seed)
            }
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
                // The hit surface is the LABEL's bounds, and a bare chevron is
                // ~10pt wide — the owner had to aim for it (report 2026-07-12).
                // Grow the label toward the capsule the system draws anyway and
                // make the whole area tappable; the capsule's minimum diameter
                // absorbs the growth, so the circle does not change size.
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
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
        // The pill is a bare system-capsule bar item again (SLICE D, 2026-07-12):
        // the self-owned glass carve-out (its own padding + frame +
        // ChromeGlassSurface) wrapped the clock to two lines inside a
        // width-constrained bar item, where the system capsule never did. The
        // system draws the glass from the item's presence and sizes the capsule to
        // the content on ITS pass, so the plain button just carries the content and
        // the nav bar owns the glass and the geometry. The arrival is the bare
        // insert on the welcome's beat, one beat now alongside share and players
        // (SLICE B). No scale, no self-glass, no arrival state.
        .buttonStyle(.plain)
        .accessibilityLabel(
            Text(verbatim: register.accessibilityLabel(weather: weatherAccessibilityLabel))
        )
        // The yield hides the content (the facts card is open, or an eclipse); the
        // system capsule is suppressed in lockstep at the item's
        // sharedBackgroundVisibility (BarItemGlass, the #149 handoff fix, kept), so
        // no hollow capsule floats where the pill stood.
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
