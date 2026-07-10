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
    @State private var model: SelectionModel
    @State private var chrome: RoomChromeModel
    @State private var frames: [ChromePiece: CGRect] = [:]
    @State private var relay = CursorRelayThrottle()
    @State private var relayTrailing: Task<Void, Never>?
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `model` lets a composition root own the selection; `chrome` likewise owns
    /// the room's overlay state (the demo room scripts both for screenshots).
    /// `onJoinIn` is the spectator's seat-change intent, wired to the real
    /// endpoint in I3.
    public init(
        store: GameStore,
        puzzle: GridPuzzle,
        clues: ClueBook = .empty,
        roomName: String = "",
        model: SelectionModel? = nil,
        chrome: RoomChromeModel? = nil,
        onJoinIn: @escaping () -> Void = {}
    ) {
        self.store = store
        self.puzzle = puzzle
        self.clues = clues
        self.roomName = roomName
        self.onJoinIn = onJoinIn
        _model = State(initialValue: model ?? SelectionModel(store: store, puzzle: puzzle))
        _chrome = State(initialValue: chrome ?? RoomChromeModel())
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        let weather = RoomWeather.from(sync: store.sync)
        let members = rosterMembers
        let spectating = RosterList.selfIsSpectator(members, selfUserId: store.selfUserId)

        ZStack {
            VStack(spacing: 0) {
                RoomBar(
                    roomName: roomName,
                    ground: ground,
                    weather: weather,
                    reconnectRetryAt: chrome.reconnectRetryAt,
                    firstFillAt: store.firstFillAt,
                    completedAt: store.completedAt,
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

                if spectating {
                    watchingZone
                } else {
                    deckZone
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
        }
        .coordinateSpace(name: ChromeLayout.roomSpace)
        .onPreferenceChange(ChromeFramesKey.self) { frames = $0 }
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        .onChange(of: model.selection) { _, selection in
            relayCursor(selection, spectating: spectating)
        }
        .onDisappear {
            relayTrailing?.cancel()
            relay.trailingCancelled()
        }
    }

    // MARK: - Derived render inputs

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
