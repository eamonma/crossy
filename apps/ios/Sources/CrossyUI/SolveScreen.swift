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
                    clusterHandedOff: chrome.isRosterOpen,
                    onTapPucks: toggleRoster
                )
                .reportChromeFrame(.roomBar)
                .padding(.horizontal, ChromeLayout.inset)
                .padding(.top, 6)

                CrossyGridView(
                    store: store, puzzle: puzzle, ground: ground,
                    selection: model.selection,
                    mosaicStartedAt: completion.mosaicStartedAt,
                    onSwipe: { model.swipe($0) },
                    onPlaceCursor: { model.tap(cell: $0) })
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
                    completedZone
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
                    onPrevious: { model.swipe(.previousWord) },
                    onNext: { model.swipe(.nextWord) },
                    onJump: { model.jump(to: ClueBrowserList.jumpTarget($0)) })
            }

            // The roster's tap-away catcher: dismissal only, no scrim, the room
            // never dims dead (DESIGN.md §4). It sits above the clue chrome so a
            // touch there closes the roster instead of opening a second panel:
            // one glass layer, structurally (the never-list).
            if chrome.isRosterOpen {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { chrome.settleRoster(open: false, animated: !reduceMotion) }
            }

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

            // The stats card (EXPERIENCE.md Completed), a custom overlay panel
            // like the roster: a tap-away catcher for dismissal back to the
            // frozen room, no scrim, one glass layer.
            if completion.isStatsOpen {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { completion.isStatsOpen = false }
                VStack {
                    StatsCardPanel(ground: ground, content: statsContent)
                        .frame(maxWidth: 340)
                        .transition(
                            reduceMotion
                                ? .opacity
                                : .scale(scale: 0.94, anchor: .top).combined(with: .opacity))
                    Spacer()
                }
                .padding(.horizontal, ChromeLayout.inset)
                .padding(.top, statsCardTop)
            }
        }
        .coordinateSpace(name: ChromeLayout.roomSpace)
        .onPreferenceChange(ChromeFramesKey.self) { frames = $0 }
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // Celebration overshoot is sanctioned (DESIGN.md §7); Reduce Motion
        // crossfades instead.
        .animation(
            reduceMotion
                ? .easeInOut(duration: 0.2)
                : .spring(
                    response: Motion.Springs.celebrationResponse,
                    dampingFraction: Motion.Springs.celebrationDampingFraction),
            value: completion.isStatsOpen
        )
        // The clarity beat (DESIGN.md §4, §8): every standing surface reads the
        // flag through the environment; below iOS 26 the fallback stays inert.
        .environment(\.chromeClarified, completion.isClarityBeat)
        .onChange(of: model.selection) { _, selection in
            relayCursor(selection, spectating: spectating)
        }
        // The celebration derives from store TRANSITIONS, observed here and
        // seeded once on appear, never from render (INV-3; the gate is the
        // exactly-once fold). Both observers feed the same gate because either
        // fact can move alone; the gate is idempotent on repeats.
        .onChange(of: store.status) { _, _ in observeRoomState() }
        .onChange(of: store.sync) { _, _ in observeRoomState() }
        .onAppear { observeRoomState() }
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

    /// The card hangs where an open panel does: under the room bar.
    private var statsCardTop: CGFloat {
        (frames[.roomBar]?.maxY ?? ChromeLayout.barHeight) + ChromeLayout.panelTopGap
    }

    private func observeRoomState() {
        completion.observe(
            status: roomStatus,
            live: store.sync == .live,
            reduceMotion: reduceMotion)
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

    /// The roster: rest is the puck cluster's own frame; open is a small panel
    /// hanging from the room bar's trailing edge, sized to its people.
    private func rosterMorph(members: [RosterMember], spectating: Bool) -> GlassMorph? {
        guard let cluster = frames[.puckCluster], let roomBar = frames[.roomBar],
            let slot = frames[.clueBarSlot]
        else { return nil }
        let width = min(roomBar.width, 320)
        let content =
            CGFloat(members.count) * RosterRideLayout.rowHeight
            + RosterRideLayout.topPadding * 2 + (spectating ? 56 : 0)
        let available = slot.minY - roomBar.maxY - ChromeLayout.panelTopGap * 2
        let height = max(ChromeLayout.barHeight, min(content, available))
        return GlassMorph(
            rest: cluster,
            open: CGRect(
                x: roomBar.maxX - width,
                y: roomBar.maxY + ChromeLayout.panelTopGap,
                width: width, height: height),
            restCornerRadius: cluster.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    // MARK: - Intents

    private func toggleRoster() {
        let animated = !reduceMotion
        if chrome.isRosterOpen {
            chrome.settleRoster(open: false, animated: animated)
        } else {
            chrome.settleMelt(open: false, animated: animated)
            chrome.settleRoster(open: true, animated: animated)
        }
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

    /// The completed room (EXPERIENCE.md Completed): a finished object. The deck
    /// is gone; the lexicon word stands where it was, and the stats card is one
    /// tap away again after dismissal.
    private var completedZone: some View {
        VStack(spacing: 10) {
            Text(verbatim: RoomTerminal.completedNotice)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.number))
            Button(action: { completion.isStatsOpen = true }) {
                Text(verbatim: RoomTerminal.statsWord)
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
