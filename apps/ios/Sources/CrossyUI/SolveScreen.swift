// The room (roadmap I2c): room bar over the grid, the clue bar as its own glass
// over a separate key deck (owner ruling 2026-07-10; SP-i5), the clue browser and
// roster as custom overlay panels morphing from their chrome (SP-i1's single
// surface; never a system sheet), weather per DESIGN.md §8, the ambient clock
// (ID-2), and the spectator edge with its one affordance, Join in. Ground follows
// system appearance through CrossyDesign tokens (ID-3: two renders of one drawing,
// never two code paths). Composition roots hand in a store, a mapped puzzle, a
// clue book, and a room name; the transport behind the store is the only thing
// that changes between the demo room and I3's real connection.

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
    private let onJoinIn: () -> Void
    private let onExit: () -> Void
    @State private var model: SelectionModel
    @State private var chrome: RoomChromeModel
    @State private var completion = CompletionModel()
    @State private var terminalPourBack = TerminalPourBackGate()
    @State private var hapticFold = SolveHapticFold()
    @State private var frames: [ChromePiece: CGRect] = [:]
    @State private var relay = CursorRelayThrottle()
    @State private var relayTrailing: Task<Void, Never>?
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `model` lets a composition root own the selection; `chrome` likewise owns
    /// the room's overlay state (the demo room scripts both for screenshots).
    /// `onJoinIn` is the spectator's seat-change intent, wired to the real
    /// endpoint in I3; `onExit` is the kicked exit's way back to Rooms, wired
    /// when Rooms exists (I3).
    public init(
        store: GameStore,
        puzzle: GridPuzzle,
        clues: ClueBook = .empty,
        roomName: String = "",
        model: SelectionModel? = nil,
        chrome: RoomChromeModel? = nil,
        onJoinIn: @escaping () -> Void = {},
        onExit: @escaping () -> Void = {}
    ) {
        self.store = store
        self.puzzle = puzzle
        self.clues = clues
        self.roomName = roomName
        self.onJoinIn = onJoinIn
        self.onExit = onExit
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
            VStack(spacing: 0) {
                RoomBar(
                    roomName: roomName,
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
                    playersHandedOff: chrome.isRosterOpen,
                    timeHandedOff: chrome.isStatsOpen,
                    onTapClock: status == .completed ? { openStats() } : nil,
                    onTapPucks: toggleRoster
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

                VStack(spacing: 0) {
                    CrossyGridView(
                        store: store, puzzle: puzzle, ground: ground,
                        selection: model.selection,
                        mosaicStartedAt: completion.mosaicStartedAt,
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
                        .padding(.top, 8)

                    // The clue bar's rest slot: the melting surface renders in the
                    // overlay at exactly this frame, so layout owns the geometry and
                    // the morph only borrows it.
                    Color.clear
                        .frame(height: ChromeLayout.barHeight)
                        .reportChromeFrame(.clueBarSlot)
                        .padding(.horizontal, ChromeLayout.inset)
                        .padding(.top, 8)

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
            }
            // A terminal status reshapes the room (the deck leaves, the board
            // takes its space): the grid rides the layout change on the chrome
            // spring instead of jumping (owner finding 2026-07-10). Reduce
            // Motion cuts.
            .animation(reduceMotion ? nil : .crossyChrome, value: status)

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
            // falling through them.

            if chrome.isRosterOpen, let morph = rosterMorph(members: members, spectating: spectating) {
                RosterPanel(
                    ground: ground,
                    morph: morph,
                    members: members,
                    restCenters: clusterPuckCenters,
                    selfUserId: store.selfUserId,
                    chrome: chrome,
                    onJoinIn: onJoinIn)
            }

            // The stats card (EXPERIENCE.md Completed): the time pill, inflated
            // (ID-2; DESIGN.md §4 morph grammar, owner ruling 2026-07-10
            // replacing the first build's transitioned overlay). Any outside
            // touch pours it back and lands, no scrim, one glass layer.
            if chrome.isStatsOpen, let morph = statsMorph {
                StatsMorphPanel(
                    ground: ground,
                    morph: morph,
                    content: statsContent,
                    chrome: chrome)
            }
        }
        .coordinateSpace(name: ChromeLayout.roomSpace)
        .onPreferenceChange(ChromeFramesKey.self) { frames = $0 }
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // The card's presentation fact lives in CompletionModel (the celebration
        // owns WHEN); the morph's geometry progress lives in RoomChromeModel
        // like every other morph, walked on the chrome spring.
        .onChange(of: completion.isStatsOpen) { _, open in
            chrome.settleStats(open: open, animated: !reduceMotion)
        }
        // The clarity beat (DESIGN.md §4, §8): every standing surface reads the
        // flag through the environment; below iOS 26 the fallback stays inert.
        .environment(\.chromeClarified, completion.isClarityBeat)
        .onChange(of: model.selection) { _, selection in
            relayCursor(selection, spectating: spectating)
            observeHaptics()
        }
        // The board's haptic moments (DESIGN.md §7): selection above and the
        // filled composite here feed one fold with whole current state, so the
        // observers can fire in either order or collapse into one
        // (SolveHapticFold derives whose hand moved from the delta).
        .onChange(of: filledCells) { _, _ in observeHaptics() }
        // The §7 completion pattern rides the INV-3 gate's one firing, never
        // the muteable mosaic clock (ID-1).
        .onChange(of: completion.celebrationFiredAt) { _, fired in
            if fired != nil { SolveHaptics.shared.play(.completion) }
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

    /// The stats card's strings: the server's stats first, the ambient clock's
    /// frozen value as the time fallback (StatsCardContent pins the rule).
    private var statsContent: StatsCardContent {
        StatsCardContent.make(
            solveTimeSeconds: store.stats?.solveTimeSeconds,
            totalEvents: store.stats?.totalEvents,
            participantCount: store.stats?.participantCount,
            firstFillAt: store.firstFillAt,
            completedAt: store.completedAt)
    }

    /// The stats morph: rest is the TIME PILL's reported frame (the card is the
    /// pill, inflated; ID-2, DESIGN.md §4). The pill centers its clock, so the
    /// rider's rest center (StatsRideLayout reads morph.rest's middle) is the
    /// clock's own. Open is a card hanging under the room bar, sized by
    /// StatsRideLayout's fixed slots.
    private var statsMorph: GlassMorph? {
        guard let pill = frames[.timePill], let roomBar = frames[.roomBar]
        else { return nil }
        let width = min(roomBar.width, StatsRideLayout.panelMaxWidth)
        let height = StatsRideLayout.panelHeight(hasDetail: statsContent.detail != nil)
        return GlassMorph(
            rest: pill,
            open: CGRect(
                x: roomBar.midX - width / 2,
                y: roomBar.maxY + ChromeLayout.panelTopGap,
                width: width, height: height),
            restCornerRadius: pill.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    private func observeRoomState() {
        // The room's own moments yield like any touch (DESIGN.md §4): the one
        // observed transition into a terminal status pours back the melt and
        // the roster, and on completion the stats card then owns the stage.
        // A fold, not a render fact, so a reconnect into an already-terminal
        // room never replays the pour-back.
        if terminalPourBack.observe(roomStatus) {
            chrome.settleRoster(open: false, animated: !reduceMotion)
            // Never rip the melt from a live finger (SP-i1: the finger owns
            // progress): a melt mid-drag when the room turns terminal stays
            // with the finger, and the release settles it as usual.
            chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
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

    /// Where layout put each cluster puck, by userId: the roster riders' launch
    /// points (DESIGN.md §4: content rides the morph).
    private var clusterPuckCenters: [String: CGPoint] {
        frames.reduce(into: [:]) { centers, entry in
            if case .puck(let userId) = entry.key {
                centers[userId] = CGPoint(x: entry.value.midX, y: entry.value.midY)
            }
        }
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
            restCornerRadius: ChromeLayout.barCornerRadius,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    /// The roster: rest is the PLAYERS PILL's whole frame (DESIGN.md §4: the
    /// players pill inflates into the roster sheet; the per-puck riders keep
    /// their own launch points); open is a small panel hanging from the room
    /// bar's trailing edge, sized to its people.
    private func rosterMorph(members: [RosterMember], spectating: Bool) -> GlassMorph? {
        guard let pill = frames[.playersPill], let roomBar = frames[.roomBar],
            let slot = frames[.clueBarSlot]
        else { return nil }
        let width = min(roomBar.width, 320)
        let content =
            CGFloat(members.count) * RosterRideLayout.rowHeight
            + RosterRideLayout.topPadding * 2 + (spectating ? 56 : 0)
        let available = slot.minY - roomBar.maxY - ChromeLayout.panelTopGap * 2
        let height = max(ChromeLayout.barHeight, min(content, available))
        return GlassMorph(
            rest: pill,
            open: CGRect(
                x: roomBar.maxX - width,
                y: roomBar.maxY + ChromeLayout.panelTopGap,
                width: width, height: height),
            restCornerRadius: pill.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    // MARK: - Intents

    /// The one dismissal path (DESIGN.md §4: transient panels yield to
    /// intent). A touch outside an open roster or stats panel dismisses it
    /// and still lands, so every outside surface routes here before its own
    /// action. The melt is not a tap-away transient (a gesture owns it); it
    /// pours back only when another panel opens or the room turns terminal.
    private func dismissTransients() {
        if chrome.isRosterOpen {
            chrome.settleRoster(open: false, animated: !reduceMotion)
        }
        if completion.isStatsOpen {
            completion.isStatsOpen = false
        }
    }

    private func toggleRoster() {
        let animated = !reduceMotion
        if chrome.isRosterOpen {
            chrome.settleRoster(open: false, animated: animated)
        } else {
            // Panels are mutually exclusive (DESIGN.md §4): opening the
            // roster closes the stats card and pours back a still melt (a
            // dragged melt is the finger's, SP-i1).
            completion.isStatsOpen = false
            chrome.pourBackMeltUnlessDragging(animated: animated)
            chrome.settleRoster(open: true, animated: animated)
        }
    }

    /// The frozen clock's summon (ID-2), mutually exclusive like every panel
    /// (DESIGN.md §4): the card's arrival closes the roster (owner ruling
    /// 2026-07-10) and pours back a still melt.
    private func openStats() {
        chrome.settleRoster(open: false, animated: !reduceMotion)
        chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
        completion.isStatsOpen = true
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
