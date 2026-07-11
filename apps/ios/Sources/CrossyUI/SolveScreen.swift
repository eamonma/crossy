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
    /// /games/{id}` returns it to any member). The facts popover offers a copy
    /// row when it is present; nil leaves the row out (a room that has no code
    /// in hand yet).
    private let inviteCode: String?
    private let onBack: () -> Void
    private let onJoinIn: () -> Void
    private let onExit: () -> Void
    /// Copy the invite code to the clipboard (the composition root owns the
    /// platform pasteboard; CrossyUI reports the intent only).
    private let onCopyInviteCode: () -> Void
    /// End the game, host abandon (`POST /games/{id}/abandon`, PROTOCOL.md §12).
    /// Confirmed in the popover, then reported here.
    private let onEndGame: () -> Void
    /// Kick a member, host only (`DELETE /games/{id}/members/{userId}`,
    /// PROTOCOL.md §12). Confirmed in the roster menu, then reported here.
    private let onKick: (String) -> Void
    @State private var model: SelectionModel
    @State private var chrome: RoomChromeModel
    @State private var completion = CompletionModel()
    @State private var terminalPourBack = TerminalPourBackGate()
    @State private var hapticFold = SolveHapticFold()
    @State private var frames: [ChromePiece: CGRect] = [:]
    @State private var relay = CursorRelayThrottle()
    @State private var relayTrailing: Task<Void, Never>?
    /// One avatar cache for the room's live pucks (the pill cluster), url-keyed so a
    /// shared avatar fetches once and the 1 Hz clock tick never re-hits the network
    /// (AvatarImage.swift). Injected into the environment below.
    @State private var avatarCache = AvatarImageCache()
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
        model: SelectionModel? = nil,
        chrome: RoomChromeModel? = nil,
        onBack: @escaping () -> Void = {},
        onJoinIn: @escaping () -> Void = {},
        onExit: @escaping () -> Void = {},
        onCopyInviteCode: @escaping () -> Void = {},
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
        self.onBack = onBack
        self.onJoinIn = onJoinIn
        self.onExit = onExit
        self.onCopyInviteCode = onCopyInviteCode
        self.onEndGame = onEndGame
        self.onKick = onKick
        _model = State(initialValue: model ?? SelectionModel(store: store, puzzle: puzzle))
        _chrome = State(initialValue: chrome ?? RoomChromeModel())
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

            // The room bar floats over the board, its own glass layer (the
            // full-bleed ruling): layout above never moves the board below.
            VStack(spacing: 0) {
                RoomBar(
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
                    onBack: onBack,
                    // Mid-solve the tap raises the facts popover (owner ruling
                    // 2026-07-10); at completion it keeps the clock-rider morph
                    // stats card (ID-2, byte-identical). The routing lives here
                    // so the pill stays a plain reporter of intent.
                    onTapTimePill: { tapTimePill(status: status) },
                    completed: status == .completed,
                    selfUserId: store.selfUserId,
                    onJoinIn: onJoinIn,
                    onKick: onKick,
                    factsPopoverPresented: $chrome.factsPopoverPresented,
                    factsPopover: {
                        RoomFactsPopover(
                            ground: ground,
                            content: factsContent,
                            operations: factsOperations,
                            firstFillAt: store.firstFillAt,
                            completedAt: store.completedAt ?? store.abandonedAt,
                            onCopyInviteCode: {
                                onCopyInviteCode()
                                chrome.factsPopoverPresented = false
                            },
                            onEndGame: {
                                onEndGame()
                                chrome.factsPopoverPresented = false
                            })
                    }
                )
                .reportChromeFrame(.roomBar)
                // Transient panels yield to intent (DESIGN.md §4): a touch on
                // the bar outside its pills dismisses too. A plain tap cannot
                // double-fire an opening pill: the pills' buttons outrank it,
                // and a handed-off pill drops hit-testing so its ghost area
                // lands here instead of re-summoning.
                .contentShape(Rectangle())
                .onTapGesture { dismissTransients() }
                .padding(.horizontal, ChromeLayout.inset)
                .padding(.top, 6)

                Spacer(minLength: 0)
            }

            if let morph = meltMorph {
                ClueChrome(
                    ground: ground,
                    morph: morph,
                    current: clues.current(for: model.selection),
                    acrossRows: ClueBrowserList.rows(
                        clues.across, selection: model.selection, filled: filledCells),
                    downRows: ClueBrowserList.rows(
                        clues.down, selection: model.selection, filled: filledCells),
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
            // the crossword's facts; at completion it is the stats card (ID-2;
            // DESIGN.md §4 morph grammar). Any outside touch pours it back and
            // lands, no scrim, one glass layer.
            if chrome.isFactsOpen, let morph = factsMorph {
                RoomFactsPanel(
                    ground: ground,
                    morph: morph,
                    restTimeCenter: restTimeCenter(morph: morph),
                    content: factsContent,
                    solveTimeSeconds: store.stats?.solveTimeSeconds,
                    firstFillAt: store.firstFillAt,
                    completedAt: store.completedAt ?? store.abandonedAt,
                    chrome: chrome)
            }
        }
        .coordinateSpace(name: ChromeLayout.roomSpace)
        .onPreferenceChange(ChromeFramesKey.self) { frames = $0 }
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
                mosaicStartedAt: completion.mosaicStartedAt,
                occlusion: .standing(
                    board: frames[.board], roomBar: frames[.roomBar]),
                keepClear: .keepClear(
                    board: frames[.board], roomBar: frames[.roomBar],
                    clueSlot: frames[.clueBarSlot]),
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

    /// The mid-solve facts popover's operations (FactsOperations pins the rule):
    /// only what §12 already supports. The copy row rides the invite code the
    /// room view carries; the destructive end-game renders only for the host
    /// (the local participant's own row in the roster). The server enforces
    /// host-only anyway; the client simply does not offer it to a non-host.
    private var factsOperations: FactsOperations {
        let selfIsHost =
            rosterMembers.first { $0.userId == store.selfUserId }?.isHost ?? false
        return FactsOperations.make(inviteCode: inviteCode, isHost: selfIsHost)
    }

    /// The facts morph: rest is the TIME PILL's reported frame (the card is
    /// the pill, inflated; DESIGN.md §4). Open grows leftward over the pill's
    /// own footprint, top and trailing edges shared (the Mail-button rule,
    /// owner ruling 2026-07-10: a panel covers the pill it grew from, never
    /// hangs beside it), sized by FactsRideLayout's fixed slots and clamped
    /// inside the bar's span; on narrow layouts it can reach the back button,
    /// which then hands off (PanelEclipse).
    private var factsMorph: GlassMorph? {
        guard let pill = frames[.timePill], let roomBar = frames[.roomBar]
        else { return nil }
        let width = min(roomBar.width, FactsRideLayout.panelMaxWidth)
        let height = FactsRideLayout.panelHeight(hasDetail: factsContent.detail != nil)
        return GlassMorph(
            rest: pill,
            open: CGRect(
                x: max(roomBar.minX, min(pill.maxX, roomBar.maxX) - width),
                y: pill.minY,
                width: width, height: height),
            restCornerRadius: pill.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    /// The rider's launch point: the pill clock's own reported center (the
    /// weather sits beside the clock now, so the pill's middle is not the
    /// clock's; the hand-off stays exact by construction). The pill's center
    /// is the honest fallback before the first preference pass lands.
    private func restTimeCenter(morph: GlassMorph) -> CGPoint {
        guard let clock = frames[.timePillClock] else {
            return CGPoint(x: morph.rest.midX, y: morph.rest.midY)
        }
        return CGPoint(x: clock.midX, y: clock.midY)
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
            // The mid-solve facts popover is the running room's surface only;
            // the stats card owns completion (ID-2). A room that completes with
            // the popover open dismisses it, so the two never stack.
            chrome.factsPopoverPresented = false
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
    /// the view maps, the types stay in their rings).
    private var rosterMembers: [RosterMember] {
        store.participants.map {
            RosterMember(
                userId: $0.userId,
                displayName: $0.displayName,
                wireColor: $0.color,
                avatarUrl: $0.avatarUrl,
                isHost: $0.role == .host,
                isSpectator: $0.role == .spectator,
                connected: $0.connected)
        }
    }

    /// Cells rendering non-null (the INV-10 composite), for the browser's
    /// de-emphasis rule.
    private var filledCells: Set<Int> {
        Set((0..<puzzle.cellCount).filter { store.renderValue($0) != nil })
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
        guard let rest = frames[.clueBarSlot], let roomBar = frames[.roomBar],
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

    /// Whether the open facts card eclipses a standing pill's reported frame
    /// (PanelEclipse, DESIGN.md §4). The roster, a system presentation, never
    /// stands glass of ours over the bar.
    private func pillEclipsed(_ piece: ChromePiece) -> Bool {
        guard let pill = frames[piece], chrome.isFactsOpen,
            let panel = factsMorph?.open
        else { return false }
        return PanelEclipse.eclipses(panel: panel, pill: pill)
    }

    /// The one dismissal path (DESIGN.md §4: transient panels yield to
    /// intent). A touch outside the open facts card dismisses it and still
    /// lands, so every outside surface routes here before its own action. The
    /// melt is not a tap-away transient (a gesture owns it); it pours back
    /// only when another panel opens or the room turns terminal. The roster
    /// menu dismisses itself: the system swallows the outside touch, Mail's
    /// own behavior.
    private func dismissTransients() {
        if chrome.isFactsOpen {
            chrome.settleFacts(open: false, animated: !reduceMotion)
        }
    }

    /// The time pill's tap, routed by status (owner ruling 2026-07-10). While
    /// the room runs, the tap raises the facts popover (a system presentation
    /// flowing out of the pill, MorphLab variant C); it carries the §12
    /// operations the morph never could. At a terminal status the tap keeps the
    /// clock-rider morph exactly as it was (ID-2, the completion stats card;
    /// the abandoned room keeps its own morph too), so the completion path is
    /// byte-identical. The two surfaces are mutually exclusive with the melt,
    /// which pours back either way.
    private func tapTimePill(status: RoomStatus) {
        chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
        if status == .ongoing {
            chrome.factsPopoverPresented = true
        } else {
            openFacts()
        }
    }

    /// The completion stats card's summon (ID-2: the frozen clock inflates to
    /// the headline), the clock-rider morph unchanged. Kept for the terminal
    /// tap above and the celebration's auto-summon; a tap-opened morph animates
    /// on the chrome spring's walk, and no animation ever writes the
    /// drag-scrubbed melt (SP-i1).
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
