// The room (roadmap I2c): room bar over the grid (a back button, the time pill
// carrying the weather and the ambient clock, the players pill; owner ruling
// 2026-07-10), the clue bar as its own glass over a separate key deck (owner
// ruling 2026-07-10; SP-i5), the clue browser as a custom overlay panel morphing
// from its chrome (SP-i1's single surface), the roster as a system Menu flowing
// out of the players pill (RosterMenu, the Mail mechanism), the room-facts card
// morphing from the time pill (the time pill is the room's facts; at completion
// it is the stats card, ID-2), weather per DESIGN.md §8, and the spectator edge
// with its one affordance, Join in. Ground follows system appearance through
// CrossyDesign tokens (ID-3: two renders of one drawing, never two code paths).
// Composition roots hand in a store, a mapped puzzle, a clue book, and a room
// name; the transport behind the store is the only thing that changes between
// the demo room and I3's real connection.

import CrossyDesign
import CrossyStore
import SwiftUI

@available(iOS 18.0, macOS 14.0, *)
@MainActor
public struct SolveScreen: View {
    private let store: GameStore
    private let puzzle: GridPuzzle
    /// The one-host arrival (DESIGN.md §4, the mid-transition paint finding): the
    /// live room mounts this screen WITH the push and never swaps it, so the bar
    /// is hosted exactly once. `opening` withholds the board and the deck (the
    /// puzzle is still the composition root's stand-in; no true geometry exists
    /// until REST lands) while the toolbar host stays mounted underneath.
    /// `barSettled` is the push's settle beat: until it is true, the bar's ITEM
    /// SET is frozen at its birth shape (presence computes against `connecting`),
    /// because an item inserted or re-hosted while the zoom is in flight is
    /// measured but never composited (the hollow-capsule finding). Steady-state
    /// compositions (the demo, the labs) pass neither and keep today's behavior.
    private let opening: Bool
    private let barSettled: Bool
    private let clues: ClueBook
    private let roomName: String
    private let puzzleTitle: String?
    private let puzzleAuthor: String?
    private let puzzleDate: String?
    /// The room's invite code, held client-side (PROTOCOL.md §12: `GET
    /// /games/{id}` returns it to any member). Feeds the share menu's titled
    /// read-aloud header and gates the share pill (with the link); nil while a
    /// room has no code in hand yet.
    private let inviteCode: String?
    /// The room's shareable link (ShareInvite.url, built by the composition
    /// root, which owns the game id). The share pill stands only when this and
    /// the code exist: never a dead control (the share surface).
    private let shareUrl: URL?
    private let onBack: () -> Void
    private let onJoinIn: () -> Void
    private let onExit: () -> Void
    /// Copy the share LINK to the clipboard (the share menu's Copy link row;
    /// the composition root owns the platform pasteboard, CrossyUI reports the
    /// intent only). This is where invite copying lives now (owner ruling
    /// 2026-07-11: the facts card's copy-code row retired).
    private let onCopyShareLink: () -> Void
    /// Hand the link to the system share surface (UIActivityViewController
    /// lives in the app target, AD-2; the card only reports the intent).
    private let onShareInvite: () -> Void
    /// End the game, host abandon (`POST /games/{id}/abandon`, PROTOCOL.md §12).
    /// Confirmed in the facts card, then reported here.
    private let onEndGame: () -> Void
    /// Kick a member, host only (`DELETE /games/{id}/members/{userId}`,
    /// PROTOCOL.md §12). Confirmed in the roster menu, then reported here.
    private let onKick: (String) -> Void
    /// The post-game analysis fetch, injected by the composition root (it closes
    /// over the REST client and the game id, keeping CrossyUI out of the REST ring,
    /// AD-2). Nil for compositions with no analysis (labs, some previews): there the
    /// completion keeps the old last-writer bloom and no panel summons.
    private let fetchAnalysis: (() async -> RoomAnalysis?)?
    /// Where the reaction fan stands (Wave 7.5): the clue-bar corner by default,
    /// the deck-edge alternate behind the lab toggle so the owner picks on device.
    private let reactionFanPlacement: ReactionFanPlacement
    @State private var model: SelectionModel
    @State private var chrome: RoomChromeModel
    @State private var completion = CompletionModel()
    @State private var analysis = AnalysisModel()
    @State private var terminalPourBack = TerminalPourBackGate()
    @State private var hapticFold = SolveHapticFold()
    /// Room-space frames reported inside the room hierarchy (the board, the clue
    /// slot). The bar items report globally and merge in through `chromeFrames`
    /// below (the toolbar-adoption ruling, DESIGN.md §4).
    @State private var frames: [ChromePiece: CGRect] = [:]
    /// The bar items' GLOBAL frames (back button, time pill): the toolbar lives
    /// outside the room's coordinate space, so these convert into room space
    /// against `roomOrigin` (BarItemFrames). The facts card's rest and the
    /// eclipse test read the converted values through `chromeFrames`.
    @State private var barItemFrames: [ChromePiece: CGRect] = [:]
    /// The room's own global origin, for the conversion above. nil until the
    /// room lays out; the morph geometry withholds until then.
    @State private var roomOrigin: CGPoint?
    /// The room container's top safe-area inset: the system bar's standing height
    /// (the band the full-bleed board bleeds under), read off the room's own
    /// container, not any bar item's reported frame (DESIGN.md §2, the constant-
    /// built board inset, SLICE C). This is the grid's STANDING top occlusion, so
    /// the board's top edge is at its final position on frame one and never moves
    /// when the pill arrives. Seeded 0; the container reports it before the first
    /// paint (it is layout, not a welcome-gated bar item), so the grid never sits
    /// high waiting for it. The facts card and the clue-bar melt still read the
    /// reported bar-item frames (post-welcome, live); only the board goes constant.
    @State private var roomTopInset: CGFloat = 0
    /// The facts surface: a system sheet out of the time pill (2026-07-12,
    /// replacing the inflate-from-the-pill morph). A mid-solve surface only, so
    /// openFacts gates it to `ongoing` and a terminal transition dismisses it.
    @State private var factsPresented = false
    @State private var relay = CursorRelayThrottle()
    @State private var relayTrailing: Task<Void, Never>?
    /// The reaction sticker book (Wave 7.5; PROTOCOL.md §9): beside the store, never
    /// inside it (D24). The grid renders it; the fan and the store's fan-out feed it.
    @State private var reactions = ReactionModel()
    /// The fan's grammar (pure; ReactionFanModel). Owned here so the room's one
    /// dismissal seam can close a standing fan like any transient.
    @State private var fan = ReactionFanModel()
    /// One avatar cache for the room's live pucks (the pill cluster), url-keyed so a
    /// shared avatar fetches once and the 1 Hz clock tick never re-hits the network
    /// (AvatarImage.swift). Injected into the environment below. A composition root may
    /// pass in the same instance it hands `.solveActivity`, so the island snapshot reads
    /// the images the room already resolved; otherwise a fresh one is made in init.
    @State private var avatarCache: AvatarImageCache
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `model` lets a composition root own the selection; `chrome` likewise owns
    /// the room's overlay state (the demo room scripts both for screenshots).
    /// `puzzleTitle`/`puzzleAuthor`/`puzzleDate` are render params for the facts
    /// card: the wire types carry no puzzle metadata yet, so composition roots
    /// pass what they know (the wire hookup is a follow-on). `onBack` is the
    /// back button's way out, wired by the arrival flow when it exists;
    /// `onJoinIn` is the spectator's seat-change intent, wired to the real
    /// endpoint in I3; `onExit` is the kicked exit's way back to Rooms, wired
    /// when Rooms exists (I3).
    public init(
        store: GameStore,
        puzzle: GridPuzzle,
        clues: ClueBook = .empty,
        roomName: String = "",
        puzzleTitle: String? = nil,
        puzzleAuthor: String? = nil,
        puzzleDate: String? = nil,
        inviteCode: String? = nil,
        shareUrl: URL? = nil,
        model: SelectionModel? = nil,
        chrome: RoomChromeModel? = nil,
        avatarCache: AvatarImageCache? = nil,
        opening: Bool = false,
        barSettled: Bool = true,
        onBack: @escaping () -> Void = {},
        onJoinIn: @escaping () -> Void = {},
        onExit: @escaping () -> Void = {},
        onCopyShareLink: @escaping () -> Void = {},
        onShareInvite: @escaping () -> Void = {},
        onEndGame: @escaping () -> Void = {},
        onKick: @escaping (String) -> Void = { _ in },
        fetchAnalysis: (() async -> RoomAnalysis?)? = nil,
        reactionFanPlacement: ReactionFanPlacement = .clueBarCorner
    ) {
        self.store = store
        self.puzzle = puzzle
        self.clues = clues
        self.roomName = roomName
        self.puzzleTitle = puzzleTitle
        self.puzzleAuthor = puzzleAuthor
        self.puzzleDate = puzzleDate
        self.inviteCode = inviteCode
        self.shareUrl = shareUrl
        self.opening = opening
        self.barSettled = barSettled
        self.onBack = onBack
        self.onJoinIn = onJoinIn
        self.onExit = onExit
        self.onCopyShareLink = onCopyShareLink
        self.onShareInvite = onShareInvite
        self.onEndGame = onEndGame
        self.onKick = onKick
        self.fetchAnalysis = fetchAnalysis
        self.reactionFanPlacement = reactionFanPlacement
        _model = State(initialValue: model ?? SelectionModel(store: store, puzzle: puzzle))
        _chrome = State(initialValue: chrome ?? RoomChromeModel())
        // A composition root that also drives the island snapshot passes the SAME cache it
        // hands `.solveActivity`, so the island writer reads the very images the room already
        // resolved (no second fetch). A lone caller passes nil and gets a fresh cache.
        _avatarCache = State(initialValue: avatarCache ?? AvatarImageCache())
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        // The kicked exit replaces the room outright (EXPERIENCE.md: the room
        // exits with one honest sentence); there is no board left to browse.
        if chrome.kicked {
            KickedExit(ground: ground, onExit: onExit)
        } else {
            room
        }
    }

    private var room: some View {
        let weather = RoomWeather.from(sync: store.sync)
        let members = rosterMembers
        let spectating = RosterList.selfIsSpectator(members, selfUserId: store.selfUserId)
        let status = roomStatus
        // The bar's item set freezes until the push settles (the mid-transition
        // paint finding, DESIGN.md §4): presence computes against `connecting`
        // until then, so nothing inserts into a bar the system will not
        // composite. The seeded players and share pills predate the freeze (they
        // are the birth shape, standing from the push's first frame); only the
        // timer and the unseeded cluster wait out the settle beat.
        let barSync: SyncState = barSettled ? store.sync : .connecting

        return ZStack {
            // The room's own bounds in its coordinate space (owner ask
            // 2026-07-13): a clear, inert layer whose reported frame gives the
            // completed clue melt the room's full width and its safe-area bottom
            // (meltMorph then bleeds past that edge). A flexible child accepting
            // the proposed size, so it never resizes the ZStack; the board and
            // slot frames are untouched.
            Color.clear
                .allowsHitTesting(false)
                .reportChromeFrame(.roomContainer)

            // The base layer: the full-bleed board over the deck (the owner's
            // full-bleed ruling, 2026-07-10). The board runs from the screen's
            // top edge to the deck's top and never under the deck (ID-4: the
            // deck sits over solid canvas, never over the grid); the room bar
            // and the clue bar float over it as separate layers, so neither
            // bar's height is the board's business.
            VStack(spacing: 0) {
                if opening {
                    // The withheld birth (the one-host arrival): no true geometry
                    // exists before REST, so the board and the deck stand down and
                    // the canvas holds the frame. The toolbar host below stays
                    // mounted throughout, which is the whole point: the bar is
                    // born once with the push and its content is never re-hosted.
                    Color.clear
                } else {
                    // The board's arrival is a fade IN PLACE: its top edge is
                    // layout truth from frame one (the constant-built inset,
                    // DESIGN.md §2) and must not move on any data beat, so the
                    // grid may only gain presence, never position.
                    boardArea(weather: weather)
                        .transition(.opacity)

                    // A terminal status retires the deck for everyone, spectator or
                    // not (RoomTerminal.deckRetired; a frozen room has no seat worth
                    // upgrading): mutations were already refused by the store and
                    // InputActions, this is the rendered truth. Selection stays for
                    // browsing; taps and swipes are pure navigation after the freeze.
                    Group {
                        switch status {
                        case .completed:
                            // The finished room breathes (owner ruling 2026-07-10,
                            // removing the first build's Solved-together zone and its
                            // Stats button): the deck just leaves, the board keeps the
                            // space, and the stats live behind the frozen clock.
                            Color.clear.frame(height: 12)
                        case .abandoned:
                            abandonedZone
                        case .ongoing:
                            if spectating {
                                watchingZone
                            } else {
                                deckZone
                            }
                        }
                    }
                    // The deck arrives the way a keyboard does: rising from the
                    // bottom edge (with the fade), the system's own grammar for
                    // this surface. Removal keeps the quiet crossfade a terminal
                    // status has always used (the deck "just leaves").
                    .transition(
                        .asymmetric(
                            insertion: .move(edge: .bottom).combined(with: .opacity),
                            removal: .opacity))
                    // The ALTERNATE fan placement (Wave 7.5, behind the lab
                    // toggle): floating astride the deck's top edge, trailing.
                    // Kept through every bottom zone, so the completed room still
                    // reacts (§9: reactions on the finished grid are intended).
                    .overlay(alignment: .topTrailing) {
                        if reactionFanPlacement == .deckEdge {
                            ReactionFan(fan: $fan, ground: ground, onFire: fireReaction)
                                .padding(.trailing, ChromeLayout.inset + 6)
                                .offset(y: -(ReactionFan.buttonSize / 2))
                        }
                    }
                }
            }
            // Transient panels yield to intent (DESIGN.md §4): every touch
            // below the bar dismisses an open roster or stats card AND
            // lands (simultaneous, so grid taps, deck presses, and the
            // zones' buttons all keep firing). The panels sit above this
            // layer and their inner blockers keep panel taps inside.
            .simultaneousGesture(TapGesture().onEnded { dismissTransients() })
            // A terminal status reshapes the room (the deck leaves, the board
            // takes its space): the board rides the layout change on the chrome
            // spring instead of jumping (owner finding 2026-07-10). Reduce
            // Motion cuts.
            .animation(reduceMotion ? nil : .crossyChrome, value: status)
            // The withheld birth's settle beat rides the same spring (the
            // one-host arrival): the grid fades in place, the deck rises. Reduce
            // Motion cuts, leaving the honest instant swap.
            .animation(reduceMotion ? nil : .crossyChrome, value: opening)

            // The completion confetti (owner ask 2026-07-11): a restrained
            // roster-colored drift riding the celebration's instant, between
            // paper and glass (§1: people between) so the chrome above stays
            // legible. The model owns its clock: never set under Reduce Motion,
            // nilled when the drift ends, so this layer simply unmounts.
            if let confettiStart = completion.confettiStartedAt {
                ConfettiOverlay(field: confettiField, startedAt: confettiStart)
            }

            // The room's top chrome is the system navigation bar's items now
            // (the toolbar-adoption ruling, DESIGN.md §4): the pieces goo into
            // the Rooms Join item across the #132 zoom push. The hand-drawn
            // overlay retired; the toolbar is attached at the bottom of `room`
            // (`.modifier(RoomToolbarHost(...))`), because ToolbarContent binds
            // to the navigation container, not this ZStack. No cluster
            // tap-catcher is needed here: the bar items report frames globally
            // and the room's base layer already yields any outside touch
            // (dismissTransients).

            if let morph = meltMorph {
                ClueChrome(
                    ground: ground,
                    morph: morph,
                    current: clues.current(for: model.selection),
                    acrossRows: ClueBrowserList.rows(
                        clues.across, selection: model.selection, filled: filledCells,
                        referenced: referencedIds),
                    downRows: ClueBrowserList.rows(
                        clues.down, selection: model.selection, filled: filledCells,
                        referenced: referencedIds),
                    glintMarks: glintMarks,
                    chrome: chrome,
                    // Completion turns the browser into the tabbed analysis surface
                    // (owner ruling 2026-07-13); mid-solve these are inert.
                    completed: status == .completed,
                    analysisPhase: analysis.phase,
                    analysisMembers: members,
                    selfUserId: store.selfUserId,
                    onDismissTransients: dismissTransients,
                    onPrevious: { model.swipe(.previousWord) },
                    onNext: { model.swipe(.nextWord) },
                    onJump: { model.jump(to: ClueBrowserList.jumpTarget($0)) },
                    // The fan rides the bar's corner (Wave 7.5) in the default
                    // placement; the deck-edge alternate hosts it below instead.
                    reactionFan: reactionFanPlacement == .clueBarCorner ? $fan : nil,
                    onReactionFire: { fireReaction($0) })
                    // The clue bar joins the settle beat's fade: it mounts one
                    // frame after the board (its rest slot is a reported frame),
                    // so it rides its own presence on the same spring instead of
                    // popping against the grid's fade.
                    .transition(.opacity)
                    // The completed melt pours to the phone's bottom edge as a
                    // sheet (owner ask 2026-07-13): let the surface draw past the
                    // bottom safe area so the glass reaches the true edge and the
                    // display's own corners clip it. Mid-solve the surface rests
                    // well above this, so it is inert then.
                    .ignoresSafeArea(.container, edges: .bottom)
            }

            // No tap-away catchers anywhere (DESIGN.md §4: transient panels
            // yield to intent): a touch outside an open panel dismisses it
            // through the surfaces it lands on, and still lands. The panels'
            // own inner tap blockers are the only thing keeping a touch from
            // falling through them. The roster is not here: it is a system
            // presentation out of the players pill (RosterMenu), so the system
            // owns its stage, its dismissal, and its stacking.

            // The room-facts surface is a system sheet now (owner ruling
            // 2026-07-12: the time pill's tap presents RoomFactsSheet, the
            // ShareQRSheet register, replacing the inflate-from-the-pill morph
            // the owner read as ad-hoc goo). Presented as a `.sheet` off the
            // room container below, so like the roster and share menus the
            // system owns its stage, its dismissal, and its stacking; nothing
            // custom stands here.

            // The share surface is a system Menu now (owner ruling
            // 2026-07-11), presented out of the share pill in the bar
            // (ShareMenuPill), so no custom panel stands here: the system
            // owns its stage, its dismissal, and its stacking, exactly as
            // the roster menu does.
        }
        // The clue bar's arrival scope (see its `.transition` above): its
        // presence flips when the rest slot's frame first reports, one frame
        // after `opening` flips, so it needs its own animation value.
        .animation(reduceMotion ? nil : .crossyChrome, value: meltMorph != nil)
        .coordinateSpace(name: ChromeLayout.roomSpace)
        // The room container's top safe-area inset: the system bar's standing
        // height, the band the full-bleed board bleeds under (DESIGN.md §2, the
        // constant-built board inset, SLICE C). Read off the room's OWN container
        // here (the ZStack under the visible, transparent nav bar), so the grid's
        // standing top occlusion is layout truth, not a welcome-gated bar item's
        // reported frame. The container reports this before the first paint, so the
        // board's top edge is final on frame one and never moves when the pill
        // arrives. `.onGeometryChange` is iOS 18 / macOS 15; older floors and the
        // macOS test host (14) keep the 0 seed (the room never renders on macOS;
        // tests read the pure GridOcclusion seam directly).
        .modifier(RoomTopInsetReader { roomTopInset = $0 })
        // The room's global origin, for converting the bar items' global frames
        // into room space (the toolbar-adoption ruling, DESIGN.md §4). Read off
        // the same ZStack the coordinate space is named on, so the origin IS the
        // room space's zero.
        .background(
            GeometryReader { proxy in
                Color.clear.preference(
                    key: RoomOriginKey.self, value: proxy.frame(in: .global).origin)
            }
        )
        .onPreferenceChange(ChromeFramesKey.self) { frames = $0 }
        // The bar items report through a closure (RoomBarInputs.reportFrame), not
        // a preference: a preference set inside a ToolbarItem never crosses the
        // UIKit nav-bar boundary (the integration trap, DESIGN.md §4). The room
        // origin is reported inside THIS hierarchy, so it stays a preference.
        .onPreferenceChange(RoomOriginKey.self) { roomOrigin = $0 }
        // The room's top chrome as the system nav bar's items (the
        // toolbar-adoption ruling, DESIGN.md §4). Attached here so the content
        // binds to the navigation container; the composition root leaves the bar
        // visible, title-less, and the system back hidden. On 26 the RoomToolbar
        // carries the ToolbarSpacer split; below 26 (and the macOS test host) the
        // fallback carries the same pieces plainly (the §4 one-fallback rule).
        .modifier(
            RoomToolbarHost(
                inputs: RoomBarInputs(
                    ground: ground,
                    weather: weather,
                    reconnectRetryAt: chrome.reconnectRetryAt,
                    firstFillAt: store.firstFillAt,
                    // The clock freezes at either terminal instant: completion
                    // freezes it by design (ID-2), and an abandoned room is
                    // terminal and quiet (EXPERIENCE.md), so its clock stops at
                    // the abandonment rather than ticking over a dead board.
                    completedAt: store.completedAt ?? store.abandonedAt,
                    members: members,
                    // No custom panel stands over the bar anymore (the facts
                    // card became a system sheet, which dims the room rather
                    // than burying a pill in our glass), so no pill is ever
                    // eclipsed: both stand for the sheet's life.
                    backHandedOff: false,
                    timeHandedOff: false,
                    // Each trailing piece gates per the seeded-birth rule (DESIGN.md
                    // §4 toolbar amendment, §12): the timer waits for the welcome on
                    // both paths (its clock needs the welcome), while the players and
                    // share pills stand from the push's first frame when the room was
                    // born with a seed (chrome.seeded), so a card-tap arrival keeps
                    // them standing across the withheld→ready swap and the goo plays
                    // on live data. Unseeded, all three wait for the welcome (the
                    // one-beat fallback). ClusterPresence is the one pure seam; share
                    // keeps `hasShare` on top for its payload gate.
                    showsTimer: ClusterPresence.showsTimer(sync: barSync),
                    showsPlayers: ClusterPresence.showsPlayers(
                        sync: barSync, seeded: chrome.seeded),
                    showsShare: ClusterPresence.showsShare(
                        sync: barSync, seeded: chrome.seeded),
                    hasShare: shareable != nil,
                    onBack: onBack,
                    // The tap presents the facts sheet (2026-07-12), mid-solve
                    // only: openFacts gates the summon to `ongoing`, so a tap on
                    // a sealed terminal pill does nothing.
                    onTapTimePill: { openFacts() },
                    // The share surface ships as the native menu (owner ruling
                    // 2026-07-11): the code for the titled section, the link the
                    // QR and copy rows carry, and the app-target seams.
                    shareCode: shareable?.code,
                    shareUrlString: shareable?.url.absoluteString,
                    onCopyShareLink: onCopyShareLink,
                    onShareInvite: onShareInvite,
                    status: status,
                    selfUserId: store.selfUserId,
                    onJoinIn: onJoinIn,
                    onKick: onKick,
                    onGoTo: { member in
                        guard let cursor = member.cursor else { return }
                        dismissTransients()
                        model.jump(
                            to: GridSelection(
                                cell: cursor.cell, isAcross: cursor.isAcross))
                    },
                    // The bar items hand their global frames here, escaping the
                    // toolbar's preference boundary (the integration trap): the
                    // melt reads the converted values through `chromeFrames`.
                    reportFrame: { piece, global in barItemFrames[piece] = global }))
        )
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // The facts sheet (owner ruling 2026-07-12): the time pill's tap presents
        // it, the ShareQRSheet register. A mid-solve surface only, so openFacts
        // gates the summon to `ongoing` and a terminal transition dismisses it.
        .sheet(isPresented: $factsPresented) {
            RoomFactsSheet(
                ground: ground,
                content: factsContent,
                operations: factsPanelOperations,
                solveTimeSeconds: store.stats?.solveTimeSeconds,
                firstFillAt: store.firstFillAt,
                completedAt: store.completedAt ?? store.abandonedAt,
                // The abandon's terminal transition dismisses the sheet through
                // observeRoomState anyway; closing here too keeps it prompt.
                onEndGame: {
                    onEndGame()
                    factsPresented = false
                })
        }
        // The clarity beat (DESIGN.md §4, §8): every standing surface reads the
        // flag through the environment; below iOS 26 the fallback stays inert.
        .environment(\.chromeClarified, completion.isClarityBeat)
        // The room's live pucks read the avatar cache here (the pill cluster); a
        // null or unresolved url just shows the initial (PROTOCOL.md §4).
        .environment(\.avatarImageCache, avatarCache)
        .onChange(of: model.selection) { _, selection in
            relayCursor(selection, spectating: spectating)
            observeHaptics()
        }
        // The board's haptic moments (DESIGN.md §7): selection above and the
        // filled composite here feed one fold with whole current state, so the
        // observers can fire in either order or collapse into one
        // (SolveHapticFold derives whose hand moved from the delta).
        .onChange(of: filledCells) { _, _ in observeHaptics() }
        // The gate's one firing (INV-3) carries the §7 completion haptic. The
        // facts surface no longer auto-summons at completion (owner ruling
        // 2026-07-12: not at game end): the pill seals and stands as the record,
        // and post-game stats move to the clue-panel analysis surface.
        .onChange(of: completion.celebrationFiredAt) { _, fired in
            guard fired != nil else { return }
            SolveHaptics.shared.play(.completion)
            // With no analysis fetch wired (labs, previews), keep the old instant
            // bloom: last-writer colors, no panel. With a fetch, the bloom waits for
            // the bundle (observed on analysis.phase below), so the color is
            // first-correct truth (owner ruling 2026-07-13).
            if fetchAnalysis == nil {
                completion.startMosaic(summonOnSettle: false, reduceMotion: reduceMotion)
            }
        }
        // The bloom paints first-correct owners, so it waits for the fetch (owner
        // ruling 2026-07-13). Only the LIVE completion edge blooms (the gate fired,
        // celebrationFiredAt set): a ready bundle blooms in first-correct color and
        // arms the panel summon; an absent bundle falls back to the last-writer bloom
        // with no summon. A reconnect into a completed room fetched for the tab but
        // never blooms or summons (the celebration is a live-edge moment, INV-3).
        .onChange(of: analysis.phase) { _, phase in
            guard completion.celebrationFiredAt != nil else { return }
            switch phase {
            case .ready:
                completion.startMosaic(summonOnSettle: true, reduceMotion: reduceMotion)
            case .absent:
                completion.startMosaic(summonOnSettle: false, reduceMotion: reduceMotion)
            case .idle, .loading:
                break
            }
        }
        // The panel arrives AFTER the bloom settles (owner ruling 2026-07-13): melt
        // the chrome open on the Analysis tab. The melt walk yields to a live finger
        // (SP-i1), and Reduce Motion cuts straight to the open state.
        .onChange(of: completion.summonToken) { _, token in
            guard token > 0 else { return }
            chrome.analysisTab = .analysis
            chrome.settleMelt(open: true, animated: !reduceMotion)
        }
        // The celebration derives from store TRANSITIONS, observed here and
        // seeded once on appear, never from render (INV-3; the gate is the
        // exactly-once fold). Both observers feed the same gate because either
        // fact can move alone; the gate is idempotent on repeats.
        .onChange(of: store.status) { _, _ in observeRoomState() }
        .onChange(of: store.sync) { _, _ in observeRoomState() }
        .onAppear {
            observeRoomState()
            // Seed the haptic fold (the first observation never buzzes) and
            // keep the generators warm (the KeyHaptics discipline).
            observeHaptics()
            SolveHaptics.shared.prepare()
            wireReactionSink()
        }
        // The sink closes over the grid it validates against, so the live room's
        // retarget from the 1x1 stand-in must re-wire it (the stand-in would drop
        // every reaction as out of range forever).
        .onChange(of: puzzle) { _, _ in wireReactionSink() }
        .onDisappear {
            relayTrailing?.cancel()
            relay.trailingCancelled()
        }
    }

    // MARK: - The full-bleed board

    /// The board and the clue bar's floating rest slot, one layer (the
    /// full-bleed ruling, owner ask 2026-07-10). The grid is the base, bled to
    /// the screen's top edge; the slot rides the board's bottom edge with the
    /// feather washing up beneath it, so a wrapping clue grows the slot upward
    /// on the chrome spring and the board underneath never moves. The camera,
    /// not the layout, keeps the selected cell readable: the standing insets
    /// clamp (GridOcclusion.standing, constant under clue growth) and the live
    /// slot only rescues the occluded cell (keepClear).
    private func boardArea(weather: RoomWeather) -> some View {
        // The bar freezes to a fixed single-line height on the completed Analysis
        // tab (owner ruling 2026-07-13): the door shows no clue, so the slot must not
        // breathe to the (invisible) clue's wrap. On the Clues tab and mid-solve it
        // still sizes to the clue.
        let analysisResting = roomStatus == .completed && chrome.analysisTab == .analysis
        let restingClue = analysisResting ? nil : clues.current(for: model.selection)
        return ZStack(alignment: .bottom) {
            CrossyGridView(
                store: store, puzzle: puzzle, ground: ground,
                selection: model.selection,
                // The cells the current clue names get a faint tint relative to the
                // selection: the same referencedIds that light the browser rows below,
                // mapped to their cells, so board and browser never disagree on what
                // the current clue names. A pure function of the same clue book and
                // selection, kept next to those derivations.
                crossReference: clues.cells(of: referencedIds),
                reactions: reactions,
                mosaicStartedAt: completion.mosaicStartedAt,
                // The bloom's colors are first-correct owners once GET /analysis
                // lands (owner ruling 2026-07-13); nil until then, where the grid
                // falls back to the event log's last writer (the absent fallback).
                mosaicOwners: analysis.bundle?.owners,
                // The BOARD's standing occlusion is constant-built (DESIGN.md §2,
                // SLICE C): the top inset is the room container's system-bar height
                // (roomTopInset, read off the room's own container), never the
                // synthesized bar-item frame, so the grid's top edge is final on
                // frame one and does not move when the pill arrives.
                occlusion: .standing(
                    board: chromeFrames[.board], topInset: roomTopInset),
                keepClear: .keepClear(
                    board: chromeFrames[.board], topInset: roomTopInset,
                    clueSlot: chromeFrames[.clueBarSlot]),
                // A swipe never becomes a tap, so the yield law needs
                // its own hook here (DESIGN.md §4): panels pour back,
                // the swipe still navigates.
                onSwipe: { intent in
                    dismissTransients()
                    model.swipe(intent)
                },
                onPlaceCursor: { cell in
                    dismissTransients()
                    model.tap(cell: cell)
                })
                .overlay {
                    // Reconnecting dims the room (DESIGN.md §8): a paper wash,
                    // never a modal, never a spinner. Input stays live; the
                    // store holds it gracefully (PROTOCOL.md §8).
                    if weather.boardDimmed {
                        Color(rgb: ground.tokens.canvas)
                            .opacity(RoomWeather.boardDimOpacity)
                            .allowsHitTesting(false)
                    }
                }
                .animation(.crossyChrome, value: weather.boardDimmed)
                // Reported BEFORE the safe-area bleed, so the frame rides the
                // expansion and the occlusion insets convert into the board's
                // real coordinates (reported after, the frame stays the safe
                // slot and the top inset comes up a safe-area short; measured
                // on the 17 Pro sim, 2026-07-10).
                .reportChromeFrame(.board)
                .ignoresSafeArea(edges: .top)

            // The clue bar's rest slot: the melting surface renders in the
            // outer overlay at exactly this frame, so layout owns the geometry
            // and the morph only borrows it. The slot is the row's invisible
            // twin (ClueBarSizer), bottom edge pinned to the board's floor, so
            // a wrapping clue grows the bar UP over the board and nothing else
            // re-lays out. The height change between clues rides the chrome
            // spring (the terminal-reshape precedent, owner finding
            // 2026-07-10); Reduce Motion cuts. Keyed on the clue, so mid-word
            // cursor moves never enter an animated transaction. The feather
            // rides as the slot's background, sized by the same layout.
            ClueBarSizer(
                ground: ground, current: restingClue,
                reservesFanSlot: reactionFanPlacement == .clueBarCorner
            )
                .reportChromeFrame(.clueBarSlot)
                .padding(.horizontal, ChromeLayout.inset)
                .background(alignment: .bottom) {
                    ClueFeatherWash(ground: ground)
                        .padding(.top, -ClueFeather.extent)
                }
                .animation(
                    reduceMotion || analysisResting ? nil : .crossyChrome,
                    value: restingClue?.tag)
        }
    }

    // MARK: - Derived render inputs

    /// The one frame map the room's geometry reads (the toolbar-adoption ruling,
    /// DESIGN.md §4). The room-space frames (the board, the clue slot) merge with
    /// the bar items' global frames converted into room space (the back button,
    /// the time pill), plus a synthesized `roomBar` frame for the FACTS CARD's span
    /// and the CLUE-BAR MELT's rest (both post-welcome, when the frames are live).
    /// The BOARD's standing occlusion no longer reads this map at all (SLICE C): its
    /// top inset is the room container's constant-built system-bar height
    /// (roomTopInset), so the grid never waits on a reported frame. Withheld pieces
    /// (not yet measured) stay absent, and the card and melt withhold until the
    /// geometry is real, exactly as before.
    private var chromeFrames: [ChromePiece: CGRect] {
        var merged = frames
        let converted = BarItemFrames.inRoomSpace(barItemFrames, roomOrigin: roomOrigin)
        merged.merge(converted) { _, bar in bar }
        if let bar = synthesizedRoomBar(from: merged) {
            merged[.roomBar] = bar
        }
        return merged
    }

    /// The synthesized `roomBar` frame for the FACTS CARD's horizontal span and the
    /// CLUE-BAR MELT's geometry (the toolbar-adoption ruling; the pure seam is
    /// BarItemFrames.synthesizedRoomBar). Anchored on the back button, which stands
    /// in the bar row from frame one, so the span holds identical before and after
    /// the time pill arrives. The board's standing inset is constant-built and does
    /// NOT read this (SLICE C, §2); the card and melt read it only post-welcome,
    /// when their own reported frames (the pill, the clue slot) are live too, so a
    /// pre-welcome value never launches either morph.
    private func synthesizedRoomBar(from merged: [ChromePiece: CGRect]) -> CGRect? {
        BarItemFrames.synthesizedRoomBar(from: merged, inset: ChromeLayout.inset)
    }

    /// The store's status as render data (the RosterMember pattern: protocol
    /// types stay in their ring, AD-2).
    private var roomStatus: RoomStatus {
        switch store.status {
        case .ongoing: return .ongoing
        case .completed: return .completed
        case .abandoned: return .abandoned
        }
    }

    /// The facts card's words (RoomFactsContent pins the rule): mid-solve the
    /// room's name and the puzzle's facts, at completion the lexicon word and
    /// the server's stats.
    private var factsContent: RoomFactsContent {
        RoomFactsContent.make(
            roomName: roomName,
            puzzleTitle: puzzleTitle,
            puzzleAuthor: puzzleAuthor,
            puzzleDate: puzzleDate,
            completed: roomStatus == .completed,
            totalEvents: store.stats?.totalEvents,
            participantCount: store.stats?.participantCount)
    }

    /// The facts card's operations (FactsOperations pins the rule): only the
    /// host's end-game now (copying the invite code moved to the share menu,
    /// owner ruling 2026-07-11), and only while the room runs. The destructive
    /// end-game renders only for the host (the server enforces host-only
    /// anyway; the client simply does not offer it to a non-host). A terminal
    /// card carries none: it is the record, not a control surface (ending an
    /// already-ended game is a no-op, INV-4).
    private var factsPanelOperations: FactsOperations {
        guard roomStatus == .ongoing else { return .none }
        let selfIsHost =
            rosterMembers.first { $0.userId == store.selfUserId }?.isHost ?? false
        return FactsOperations.make(isHost: selfIsHost)
    }

    /// The invite in hand, or nil when there is nothing to share yet: the
    /// share menu requires both the link (the QR row and copy row's payload)
    /// and the code (the menu's titled read-aloud header). The composition
    /// root builds the link FROM the code (ShareInvite.url), so in practice
    /// they arrive together.
    private var shareable: (url: URL, code: String)? {
        guard let shareUrl, let inviteCode, !inviteCode.isEmpty else { return nil }
        return (shareUrl, inviteCode)
    }

    private func observeRoomState() {
        // The room's own moments yield like any touch (DESIGN.md §4): the one
        // observed transition into a terminal status pours back the melt and
        // dismisses the facts sheet. A fold, not a render fact, so a reconnect
        // into an already-terminal room never replays the pour-back. (An open
        // roster menu is the system's; it holds until a touch, which is how
        // Mail behaves too.)
        if terminalPourBack.observe(roomStatus) {
            // Never rip the melt from a live finger (SP-i1: the finger owns
            // progress): a melt mid-drag when the room turns terminal stays
            // with the finger, and the release settles it as usual.
            chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
            // An open mid-solve facts sheet dismisses when the room turns
            // terminal: its operations just died with the room, and the facts
            // surface is not shown at game end (owner ruling 2026-07-12). The
            // sealed pill stands as the record instead.
            factsPresented = false
            // The share menu is the system's now: it dismisses on any touch,
            // Mail's own behavior, so there is nothing here to pour back.
        }
        completion.observe(
            status: roomStatus,
            live: store.sync == .live,
            reduceMotion: reduceMotion)
        // The analysis fetch fires once the room is completed (a live finish OR a
        // reconnect into an already-completed room), so the Analysis tab has data
        // whether or not the celebration played. Idempotent (fetches at most once);
        // a 404 during the completion race retries (AnalysisModel). A composition
        // with no fetch wired stays on the old last-writer bloom (see the
        // celebrationFiredAt observer).
        if roomStatus == .completed, let fetchAnalysis {
            analysis.load(fetchAnalysis)
        }
    }

    /// The board's haptic moments (DESIGN.md §7), derived by the pure fold and
    /// rendered by the player. A frozen room browses silently (the finished
    /// board is an object, not a solve); the completion pattern rides the
    /// INV-3 gate, not this fold.
    private func observeHaptics() {
        guard store.status == .ongoing else { return }
        guard
            let haptic = hapticFold.observe(
                filled: filledCells, selection: model.selection, puzzle: puzzle)
        else { return }
        SolveHaptics.shared.play(haptic)
    }

    /// The store's participants as chrome-shaped data (the GridPresence pattern:
    /// the view maps, the types stay in their rings). Each member's live cursor
    /// (PROTOCOL.md §4, §9) rides along for the roster's Go to action; a
    /// spectator is never in `store.cursors` (client-side suppression, DESIGN.md
    /// §15), so `RosterList.canJump` needs no extra role check.
    private var rosterMembers: [RosterMember] {
        store.participants.map {
            RosterMember(
                userId: $0.userId,
                displayName: $0.displayName,
                wireColor: $0.color,
                avatarUrl: $0.avatarUrl,
                isHost: $0.role == .host,
                isSpectator: $0.role == .spectator,
                connected: $0.connected,
                cursor: store.cursors[$0.userId].map {
                    RosterCursor(cell: $0.cell, isAcross: $0.direction == .across)
                })
        }
    }

    /// Cells rendering non-null (the INV-10 composite), for the browser's
    /// de-emphasis rule.
    private var filledCells: Set<Int> {
        Set((0..<puzzle.cellCount).filter { store.renderValue($0) != nil })
    }

    /// The entry ids the current clue cross-references, filtered to real rows and
    /// self-excluded (ClueBook.referencedIds, the web's LiveApp memo). One parse feeds
    /// both the browser's faint row wash and the board's referencedCells tint, so the
    /// two never disagree on what the current clue names. A pure function of the clue
    /// book and the selection, exactly like filledCells above it.
    private var referencedIds: Set<String> {
        clues.referencedIds(for: clues.current(for: model.selection))
    }

    /// The confetti's palette: the room's writers in their roster colors (the
    /// people are the only color, DESIGN.md §1), spectators lending none, mapped
    /// through the ground so both grounds drift in their own registers.
    /// Deterministically seeded, so the field is stable across the few renders
    /// it lives through.
    private var confettiField: ConfettiField {
        let colors = store.participants
            .filter { $0.role != .spectator }
            .map {
                ground.rosterColor(
                    GridPresence.rosterColor(wireColor: $0.color, userId: $0.userId))
            }
        return ConfettiField.make(colors: colors)
    }

    /// Teammates whose cursors sit under the bar's clue: presence marks (already
    /// filtered of self and spectators, colored for the ground) on the current
    /// word's cells, ordered for deterministic glint attribution.
    private var glintMarks: [PresenceMark] {
        let word = puzzle.wordCells(
            through: model.selection.cell, isAcross: model.selection.isAcross)
        guard !word.isEmpty, !store.cursors.isEmpty else { return [] }
        let marks = GridPresence.marks(
            cursors: store.cursors.values.map {
                GridPresence.CursorInput(
                    userId: $0.userId, cell: $0.cell, isAcross: $0.direction == .across)
            },
            participants: store.participants.map {
                GridPresence.ParticipantInput(
                    userId: $0.userId, displayName: $0.displayName, color: $0.color,
                    isSpectator: $0.role == .spectator)
            },
            selfUserId: store.selfUserId,
            ground: ground)
        return word.sorted().flatMap { marks[$0] ?? [] }
    }

    // MARK: - Morph geometry

    /// The melt: rest is the bar's layout slot; open grows the top edge to just
    /// under the room bar, bottom edge anchored, so the surface never overlaps
    /// the deck or the room bar (glass never stacks, DESIGN.md §4).
    private var meltMorph: GlassMorph? {
        let f = chromeFrames
        guard let rest = f[.clueBarSlot], let roomBar = f[.roomBar],
            rest.height > 0
        else { return nil }
        let top = roomBar.maxY + ChromeLayout.panelTopGap
        guard rest.maxY > top else { return nil }

        // A completed room opens the melt as a bottom sheet (owner ask
        // 2026-07-13): the deck is retired, so the surface pours to the phone's
        // true edges (full width, past the bottom safe area) with its top corners
        // only, the door capsule unfolding into a sheet. Mid-solve it stays the
        // inset card that clears the live deck (glass never stacks, ID-4), so the
        // sheet geometry is gated on `.completed` and borrows the full-bleed
        // container frame the room reports for exactly this.
        if roomStatus == .completed, let container = f[.roomContainer] {
            // container is the room's SAFE-AREA rect, so bleed the panel past its
            // bottom by more than any home-indicator inset; the display's own
            // corners clip the overrun, leaving the glass flush to the phone's
            // true edge with its square bottom corners hidden below it.
            let open = CGRect(
                x: container.minX, y: top,
                width: container.width,
                height: container.maxY + ChromeLayout.sheetBottomBleed - top)
            return GlassMorph(
                rest: rest,
                open: open,
                restCornerRadius: rest.height / 2,
                openCornerRadius: ChromeLayout.sheetTopCornerRadius)
        }

        return GlassMorph(
            rest: rest,
            open: CGRect(x: rest.minX, y: top, width: rest.width, height: rest.maxY - top),
            // Half the slot's height, not the bar constant: a wrapped clue
            // grows the bar and the capsule register holds (DESIGN.md §5).
            restCornerRadius: rest.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    // MARK: - Intents

    /// The one dismissal seam (DESIGN.md §4: transient surfaces yield to
    /// intent). It dismisses the facts sheet, so every outside surface routes
    /// here before its own action; in practice the sheet dims the room and
    /// dismisses itself on an outside touch, so this only closes it for the
    /// callers that act without a preceding touch (a swipe, a jump). The melt is
    /// not a tap-away transient (a gesture owns it): it pours back only when
    /// another surface opens or the room turns terminal.
    private func dismissTransients() {
        factsPresented = false
        // A standing (tap-opened) fan yields to intent like any transient (DESIGN.md
        // §4): the touch closes it AND lands. The fan's own surface never routes
        // here (its overlay stands outside the chrome's dismiss gestures).
        withAnimation(reduceMotion ? nil : .crossyChrome) { fan.tapAway() }
    }

    /// The facts sheet's summon (2026-07-12: the pill's tap presents
    /// RoomFactsSheet). A mid-solve surface only: a tap on a sealed terminal
    /// pill does nothing (owner ruling: not at game end). The drag-scrubbed melt
    /// pours back first (SP-i1) so the two surfaces never stand together.
    private func openFacts() {
        guard roomStatus == .ongoing else { return }
        chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
        factsPresented = true
    }

    /// The cursor relay (deferred from I2b): every selection change goes to the
    /// room, throttled to the wire's 10/s cap with a leading send and one
    /// coalesced trailing send that always carries the latest position (the web's
    /// posture, PROTOCOL.md §9). Spectators never send (their cursors are
    /// suppressed by default, root DESIGN.md §15); the store refuses sends while
    /// `connecting`.
    private func relayCursor(_ selection: GridSelection, spectating: Bool) {
        if spectating { return }
        switch relay.selectionChanged(now: Date.now.timeIntervalSinceReferenceDate) {
        case .send:
            sendCursor(selection)
        case .scheduleTrailing(let afterSeconds):
            relayTrailing = Task { @MainActor in
                try? await Task.sleep(for: .seconds(afterSeconds))
                guard !Task.isCancelled else { return }
                relay.trailingFired(now: Date.now.timeIntervalSinceReferenceDate)
                sendCursor(model.selection)
            }
        case .coalesce:
            break
        }
    }

    private func sendCursor(_ selection: GridSelection) {
        store.moveCursor(
            cell: selection.cell, direction: selection.isAcross ? .across : .down)
    }

    // MARK: - Reactions (Wave 7.5; PROTOCOL.md §9, D24)

    /// The fan fired: send-gate on the client's set (§9: only sending is gated),
    /// echo locally through the model (which owns the 5/s cap), and put the frame on
    /// the wire at the CURSOR cell — the reaction is anchored where you stand. A
    /// capped attempt sends nothing anywhere. Spectators react by design (§9), so
    /// unlike the cursor relay nothing here checks the seat.
    private func fireReaction(_ emoji: String) {
        guard ReactionPolicy.sendSet.contains(emoji) else { return }
        let cell = model.selection.cell
        guard
            reactions.send(
                userId: store.selfUserId ?? "you", emoji: emoji, cell: cell,
                at: Date().timeIntervalSinceReferenceDate)
        else { return }
        store.react(emoji: emoji, cell: cell)
        SolveHaptics.shared.play(.reactionSent)
    }

    /// Inbound reactions land here (GameStore.onReaction, the onConflictFlash
    /// pattern): render any well-formed emoji (receive-any, §9) whose cell exists on
    /// this grid, and tap softly when it lands on or beside the active word (the
    /// proximity gate; toggleable, default on). Re-wired on a puzzle change because
    /// the closure captures the grid it validates against (the live room retargets
    /// from the 1x1 stand-in when REST lands).
    private func wireReactionSink() {
        let puzzle = self.puzzle
        store.onReaction = { notice in
            guard notice.cell >= 0, notice.cell < puzzle.cellCount,
                !puzzle.blocks.contains(notice.cell)
            else { return }
            reactions.receive(
                userId: notice.userId, emoji: notice.emoji, cell: notice.cell,
                at: Date().timeIntervalSinceReferenceDate)
            if ReactionSettings.receiveHapticsEnabled,
                ReactionProximity.landsNearActiveWord(
                    cell: notice.cell, selection: model.selection, puzzle: puzzle)
            {
                SolveHaptics.shared.play(.reactionLanded)
            }
        }
    }

    // MARK: - The deck zone

    /// The deck over solid canvas (ID-4), the rebus inline field surfacing above it
    /// while an entry is open (EXPERIENCE.md baseline; the exhale bubble is I4).
    private var deckZone: some View {
        VStack(spacing: 10) {
            if let buffer = model.rebusBuffer {
                RebusField(buffer: buffer, ground: ground)
            }
            KeyDeck(ground: ground, isRebusActive: model.isRebusActive) { key in
                // A press is intent (DESIGN.md §4): panels yield at touch-down
                // (the deck presses on first contact), the letter still lands.
                dismissTransients()
                model.press(key)
            }
        }
        .padding(.horizontal, ChromeLayout.inset)
        .padding(.top, 10)
        // The deck's lift off the bottom safe-area line (owner on-device ruling):
        // the original tight gap read bottom-stuck on the tall Max screen, so the
        // keys rise off the home indicator.
        .padding(.bottom, 30)
        .background(Color(rgb: ground.tokens.canvas))
        .animation(
            .spring(
                response: Motion.Springs.chromeResponse,
                dampingFraction: Motion.Springs.chromeDampingFraction),
            value: model.isRebusActive)
    }

    /// The abandoned room (EXPERIENCE.md: terminal and quiet): the board freezes
    /// with a one-line notice, nothing else. Browsing stays live above.
    private var abandonedZone: some View {
        Text(verbatim: RoomTerminal.abandonedNotice)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .frame(maxWidth: .infinity)
            .padding(.top, 16)
            .padding(.bottom, 18)
            .background(Color(rgb: ground.tokens.canvas))
    }

    /// The spectator edge (EXPERIENCE.md Watching): the full live room, read-only,
    /// one affordance. The deck leaves; the words are plain (ID-5).
    private var watchingZone: some View {
        VStack(spacing: 10) {
            Text(verbatim: "Watching")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.number))
            Button(action: onJoinIn) {
                Text(verbatim: "Join in")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .modifier(ChromeGlassSurface(cornerRadius: 23))
        }
        .padding(.horizontal, ChromeLayout.inset)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(Color(rgb: ground.tokens.canvas))
    }
}

// MARK: - The feather

/// The feather: the clue bar floats over live cells now (the full-bleed
/// ruling, owner ask 2026-07-10), so the ground's canvas washes up from the
/// board's bottom edge, full strength behind the glass and fading to nothing
/// over ClueFeather.extent above it. No hard edge anywhere; Studio and
/// Observatory differ only by token (ID-3). Inert to touch: cells under the
/// feather still take taps.
@available(iOS 17.0, macOS 14.0, *)
struct ClueFeatherWash: View {
    let ground: GridGround

    var body: some View {
        let canvas = Color(rgb: ground.tokens.canvas)
        VStack(spacing: 0) {
            LinearGradient(
                stops: [
                    .init(color: canvas.opacity(0), location: 0),
                    .init(
                        color: canvas.opacity(ClueFeather.kneeAlpha),
                        location: ClueFeather.kneeLocation),
                    .init(color: canvas.opacity(ClueFeather.barAlpha), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: ClueFeather.extent)
            canvas.opacity(ClueFeather.barAlpha)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - The rebus inline field

/// The baseline rebus entry (EXPERIENCE.md §6: a plain inline field qualifies): the
/// buffer as it grows, committed as one value by the deck's rebus key. Clear glass,
/// the momentary register (DESIGN.md §4), with the §4 blur fallback below iOS 26.
/// Chrome stays achromatic (DESIGN.md §3), so the caret is ink.
@MainActor
struct RebusField: View {
    let buffer: String
    let ground: GridGround

    var body: some View {
        HStack(spacing: 3) {
            if buffer.isEmpty {
                Text(verbatim: "Rebus")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            } else {
                Text(verbatim: buffer)
                    .font(.system(size: 17, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
            }
            RoundedRectangle(cornerRadius: 1)
                .fill(Color(rgb: ground.tokens.ink))
                .frame(width: 2, height: 18)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .modifier(RebusSurface())
        .accessibilityLabel(
            Text(verbatim: buffer.isEmpty ? "Rebus entry" : "Rebus entry \(buffer)"))
    }
}

/// Clear glass on iOS 26+; the one blur-material fallback below (DESIGN.md §4).
private struct RebusSurface: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.glassEffect(.clear, in: .capsule)
            } else {
                content.background(Capsule().fill(.regularMaterial))
            }
        #else
            content.background(Capsule().fill(.regularMaterial))
        #endif
    }
}
