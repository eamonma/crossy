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
    @State private var model: SelectionModel
    @State private var chrome: RoomChromeModel
    @State private var completion = CompletionModel()
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
    @State private var relay = CursorRelayThrottle()
    @State private var relayTrailing: Task<Void, Never>?
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
        onBack: @escaping () -> Void = {},
        onJoinIn: @escaping () -> Void = {},
        onExit: @escaping () -> Void = {},
        onCopyShareLink: @escaping () -> Void = {},
        onShareInvite: @escaping () -> Void = {},
        onEndGame: @escaping () -> Void = {},
        onKick: @escaping (String) -> Void = { _ in }
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
        self.onBack = onBack
        self.onJoinIn = onJoinIn
        self.onExit = onExit
        self.onCopyShareLink = onCopyShareLink
        self.onShareInvite = onShareInvite
        self.onEndGame = onEndGame
        self.onKick = onKick
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

        return ZStack {
            // The base layer: the full-bleed board over the deck (the owner's
            // full-bleed ruling, 2026-07-10). The board runs from the screen's
            // top edge to the deck's top and never under the deck (ID-4: the
            // deck sits over solid canvas, never over the grid); the room bar
            // and the clue bar float over it as separate layers, so neither
            // bar's height is the board's business.
            VStack(spacing: 0) {
                boardArea(weather: weather)

                // A terminal status retires the deck for everyone, spectator or
                // not (RoomTerminal.deckRetired; a frozen room has no seat worth
                // upgrading): mutations were already refused by the store and
                // InputActions, this is the rendered truth. Selection stays for
                // browsing; taps and swipes are pure navigation after the freeze.
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
                    onDismissTransients: dismissTransients,
                    onPrevious: { model.swipe(.previousWord) },
                    onNext: { model.swipe(.nextWord) },
                    onJump: { model.jump(to: ClueBrowserList.jumpTarget($0)) })
            }

            // No tap-away catchers anywhere (DESIGN.md §4: transient panels
            // yield to intent): a touch outside an open panel dismisses it
            // through the surfaces it lands on, and still lands. The panels'
            // own inner tap blockers are the only thing keeping a touch from
            // falling through them. The roster is not here: it is a system
            // presentation out of the players pill (RosterMenu), so the system
            // owns its stage, its dismissal, and its stacking.

            // The room-facts card (owner ruling 2026-07-10: the time pill is
            // the room's facts): the time pill, inflated. Mid-solve it carries
            // the crossword's facts and the host's end-game (redesign
            // 2026-07-11, one mechanism for both moments; copy invite code
            // moved to the share menu); at completion it is the stats card
            // (ID-2; DESIGN.md §4 morph grammar). On iOS 26+ the tap open
            // rides the system metaball materialize (owner ruling 2026-07-11);
            // below 26 the clean frame-interpolation melt. Any outside touch
            // pours it back and lands, no scrim, one glass layer.
            if chrome.isFactsOpen, let morph = factsMorph {
                RoomFactsPanel(
                    ground: ground,
                    morph: morph,
                    content: factsContent,
                    operations: factsPanelOperations,
                    solveTimeSeconds: store.stats?.solveTimeSeconds,
                    firstFillAt: store.firstFillAt,
                    completedAt: store.completedAt ?? store.abandonedAt,
                    chrome: chrome,
                    // The end-game's terminal transition pours the room's
                    // transients back anyway; the card closes as it acts.
                    onEndGame: {
                        onEndGame()
                        chrome.settleFacts(open: false, animated: !reduceMotion)
                    })
            }

            // The share surface is a system Menu now (owner ruling
            // 2026-07-11), presented out of the share pill in the bar
            // (ShareMenuPill), so no custom panel stands here: the system
            // owns its stage, its dismissal, and its stacking, exactly as
            // the roster menu does.
        }
        .coordinateSpace(name: ChromeLayout.roomSpace)
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
                    // A pill hands off when its own panel opens, and when any
                    // open panel eclipses it (PanelEclipse: buried glass
                    // refracts through a panel's surface).
                    backHandedOff: pillEclipsed(.backButton),
                    timeHandedOff: chrome.isFactsOpen || pillEclipsed(.timePill),
                    // The whole trailing cluster arrives when the room is live
                    // (DESIGN.md §4 toolbar amendment, SLICE B: one arrival beat):
                    // before the first welcome the store is `connecting`, so the
                    // cluster is absent and the bar is back-only; the welcome flips
                    // sync and timer, share, and players materialize together, each
                    // everything true at once. A terminal room's sealed cluster
                    // arrives the same way, on its welcome's beat (ClusterPresence,
                    // the honest sync fact).
                    showsCluster: ClusterPresence.isLive(sync: store.sync),
                    hasShare: shareable != nil,
                    onBack: onBack,
                    // One mechanism for both moments (redesign 2026-07-11): the
                    // tap inflates the pill into the facts card, mid-solve with
                    // the §12 operations, at completion the stats card (ID-2).
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
                    // facts card's rest and the eclipse test read the converted
                    // values through `chromeFrames`.
                    reportFrame: { piece, global in barItemFrames[piece] = global }))
        )
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
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
        // The gate's one firing (INV-3) carries the one-shot riders: the §7
        // completion pattern, and the card's arrival with the celebration
        // (owner ruling 2026-07-10), never the muteable mosaic clock (ID-1).
        .onChange(of: completion.celebrationFiredAt) { _, fired in
            guard fired != nil else { return }
            SolveHaptics.shared.play(.completion)
            openFacts()
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
        }
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
        ZStack(alignment: .bottom) {
            CrossyGridView(
                store: store, puzzle: puzzle, ground: ground,
                selection: model.selection,
                // The cells the current clue names get a faint tint relative to the
                // selection: the same referencedIds that light the browser rows below,
                // mapped to their cells, so board and browser never disagree on what
                // the current clue names. A pure function of the same clue book and
                // selection, kept next to those derivations.
                crossReference: clues.cells(of: referencedIds),
                mosaicStartedAt: completion.mosaicStartedAt,
                occlusion: .standing(
                    board: chromeFrames[.board], roomBar: chromeFrames[.roomBar]),
                keepClear: .keepClear(
                    board: chromeFrames[.board], roomBar: chromeFrames[.roomBar],
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
            ClueBarSizer(ground: ground, current: clues.current(for: model.selection))
                .reportChromeFrame(.clueBarSlot)
                .padding(.horizontal, ChromeLayout.inset)
                .background(alignment: .bottom) {
                    ClueFeatherWash(ground: ground)
                        .padding(.top, -ClueFeather.extent)
                }
                .animation(
                    reduceMotion ? nil : .crossyChrome,
                    value: clues.current(for: model.selection)?.tag)
        }
    }

    // MARK: - Derived render inputs

    /// The one frame map the room's geometry reads (the toolbar-adoption ruling,
    /// DESIGN.md §4). The room-space frames (the board, the clue slot) merge with
    /// the bar items' global frames converted into room space (the back button,
    /// the time pill), plus a synthesized `roomBar` frame for the occlusion clamp
    /// and the facts-card span. Withheld pieces (not yet measured) stay absent,
    /// and the morphs withhold until the geometry is real, exactly as before.
    private var chromeFrames: [ChromePiece: CGRect] {
        var merged = frames
        let converted = BarItemFrames.inRoomSpace(barItemFrames, roomOrigin: roomOrigin)
        merged.merge(converted) { _, bar in bar }
        if let bar = synthesizedRoomBar(from: merged) {
            merged[.roomBar] = bar
        }
        return merged
    }

    /// The synthesized `roomBar` frame (the toolbar-adoption ruling; the pure seam
    /// is BarItemFrames.synthesizedRoomBar, tested against §2 and §4). Anchored on
    /// the back button, which stands in the bar row from frame one, so the band
    /// holds identical before and after the time pill arrives and the board never
    /// moves on the welcome beat (§2). The morphs withhold until the anchor and the
    /// board land.
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

    /// The facts morph: rest is the TIME PILL's reported frame (the card is
    /// the pill, inflated; DESIGN.md §4). Open grows leftward over the pill's
    /// own footprint, top and trailing edges shared (the Mail-button rule,
    /// owner ruling 2026-07-10: a panel covers the pill it grew from, never
    /// hangs beside it), sized by FactsCardLayout's fixed slots (the operation
    /// rows included, mid-solve) and clamped inside the bar's span; on narrow
    /// layouts it can reach the back button, which then hands off
    /// (PanelEclipse).
    private var factsMorph: GlassMorph? {
        let f = chromeFrames
        guard let pill = f[.timePill], let roomBar = f[.roomBar]
        else { return nil }
        let width = min(roomBar.width, FactsCardLayout.panelMaxWidth)
        let height = FactsCardLayout.panelHeight(
            hasDetail: factsContent.detail != nil,
            operationRows: factsPanelOperations.rowCount)
        return GlassMorph(
            rest: pill,
            open: CGRect(
                x: max(roomBar.minX, min(pill.maxX, roomBar.maxX) - width),
                y: pill.minY,
                width: width, height: height),
            restCornerRadius: pill.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    private func observeRoomState() {
        // The room's own moments yield like any touch (DESIGN.md §4): the one
        // observed transition into a terminal status pours back the melt, and
        // on completion the stats card then owns the stage. A fold, not a
        // render fact, so a reconnect into an already-terminal room never
        // replays the pour-back. (An open roster menu is the system's; it
        // holds until a touch, which is how Mail behaves too.)
        if terminalPourBack.observe(roomStatus) {
            // Never rip the melt from a live finger (SP-i1: the finger owns
            // progress): a melt mid-drag when the room turns terminal stays
            // with the finger, and the release settles it as usual.
            chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
            // An open mid-solve facts card pours back with the melt: its
            // operations just died with the room, and its open height is about
            // to change. Completion re-summons the card as the stats card from
            // fresh geometry (the celebration's rider below); an abandonment
            // leaves the room quiet.
            chrome.settleFacts(open: false, animated: !reduceMotion)
            // The share menu is the system's now: it dismisses on any touch,
            // Mail's own behavior, so there is nothing here to pour back.
        }
        completion.observe(
            status: roomStatus,
            live: store.sync == .live,
            reduceMotion: reduceMotion)
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
        return GlassMorph(
            rest: rest,
            open: CGRect(x: rest.minX, y: top, width: rest.width, height: rest.maxY - top),
            // Half the slot's height, not the bar constant: a wrapped clue
            // grows the bar and the capsule register holds (DESIGN.md §5).
            restCornerRadius: rest.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    // MARK: - Intents

    /// The open custom panels' frames (the facts card), for the eclipse test.
    /// The roster and the share menu are system presentations: they never
    /// stand glass of ours over the bar.
    private var openPanelFrames: [CGRect] {
        var panels: [CGRect] = []
        if chrome.isFactsOpen, let morph = factsMorph { panels.append(morph.open) }
        return panels
    }

    /// Whether any open panel eclipses a standing pill's reported frame
    /// (PanelEclipse, DESIGN.md §4).
    private func pillEclipsed(_ piece: ChromePiece) -> Bool {
        guard let pill = chromeFrames[piece] else { return false }
        return openPanelFrames.contains { PanelEclipse.eclipses(panel: $0, pill: pill) }
    }

    /// The one dismissal path (DESIGN.md §4: transient panels yield to
    /// intent). A touch outside an open card dismisses it and still lands,
    /// so every outside surface routes here before its own action. The
    /// melt is not a tap-away transient (a gesture owns it); it pours back
    /// only when another panel opens or the room turns terminal. The roster
    /// menu dismisses itself: the system swallows the outside touch, Mail's
    /// own behavior.
    private func dismissTransients() {
        if chrome.isFactsOpen {
            chrome.settleFacts(open: false, animated: !reduceMotion)
        }
    }

    /// The facts card's summon, one mechanism for both moments (redesign
    /// 2026-07-11: the pill inflates into the card, mid-solve or terminal).
    /// The pill's tap and the celebration's auto-summon both land here; a
    /// tap-opened morph animates on the chrome spring's walk, and no animation
    /// ever writes the drag-scrubbed melt (SP-i1), which pours back first so
    /// the two surfaces never stand together.
    private func openFacts() {
        chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
        chrome.settleFacts(open: true, animated: !reduceMotion)
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
        .padding(.bottom, 6)
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
