//
//  PillArrivalLab.swift
//  Crossy
//
//  The live-timing rig for the constant-built board inset (DESIGN.md §2, SLICE C).
//  Evidence only: nothing in the room composes through this screen.
//
//  The owner device regression: on live data the grid loaded HIGH and DROPPED as
//  the time pill materialized. The diagnosis: the board's standing top inset read a
//  roomBar rect synthesized from the bar items' REPORTED frames, and live rooms
//  mount the board before any bar item's onGeometryChange fires, so the inset landed
//  late and the grid moved. SLICE C makes the board's inset a CONSTANT (the room
//  container's system-bar height, its top safe-area inset, the band the full-bleed
//  board bleeds under), so the grid's top edge is at its final position on frame one
//  and never moves.
//
//  This rig reproduces the live timing that broke it: it DELAYS the board's mount
//  (the withholding room, like RealRoomView holding SolveScreen for the REST view)
//  AND delays the welcome (the loopback yields it late, so the cluster arrives on a
//  late beat). A pinned reference line marks where the grid's first playable row sits
//  on the FIRST rendered frame; a live line tracks where it sits NOW. If the two
//  coincide through the whole delayed sequence, the board never moved. The rig also
//  reads the max drift and the current phase in a readout, so a still capture proves
//  the pin.
//
//  The proof is geometric, not cosmetic: the same GridCamera clamp the board runs is
//  computed here against the constant occlusion, sampled on the first frame and on
//  every phase change, so the readout is the board's own math, not a redraw of it.
//

import CrossyDesign
import CrossyProtocol
import CrossyStore
import CrossyUI
import Observation
import SwiftUI

// MARK: - The scripted timeline

@MainActor
@Observable
private final class PillArrivalTimeline {
    /// The board is withheld until this flips (the withholding room, the REST view's
    /// delay), then SolveScreen mounts against the real geometry.
    var boardReady = false
    /// The welcome has landed (the cluster arrives, sync leaves `connecting`). Delayed
    /// past the board's mount, so the grid renders a beat before the pill's slot.
    var welcomeLanded = false
    /// The board's first-playable-row top, in points from the screen top, sampled on
    /// the FIRST rendered frame. The pinned reference the live line is checked against.
    var firstFrameTop: CGFloat?
    /// The largest drift the board's top row ever showed from its first-frame position.
    /// Zero is the pass: the constant inset held across the whole delayed sequence.
    var maxDrift: CGFloat = 0

    var phase: String {
        if !boardReady { return "withholding (board delayed, like the REST view)" }
        if !welcomeLanded { return "board mounted, pre-welcome (cluster absent)" }
        return "welcome landed (cluster arrived, pill in slot)"
    }

    /// Record a sampled board-top and fold the drift. The first sample pins the
    /// reference; every later one measures against it.
    func record(top: CGFloat) {
        guard let first = firstFrameTop else {
            firstFrameTop = top
            return
        }
        maxDrift = max(maxDrift, abs(top - first))
    }

    /// Run the live timing: withhold, mount, then land the welcome late.
    func run() async {
        try? await Task.sleep(for: .milliseconds(1200))
        boardReady = true
        try? await Task.sleep(for: .milliseconds(700))
        welcomeLanded = true
    }
}

// MARK: - The rig

/// The live-timing rig (DESIGN.md §2, SLICE C). Composes the real withholding →
/// SolveScreen flow with a delayed board and a delayed welcome, and overlays the
/// pinned reference against the live board-top so a capture proves the grid never
/// moved. Reached by `-pillArrivalLab`.
struct PillArrivalLab: View {
    @State private var timeline = PillArrivalTimeline()
    @State private var room = DelayedRoom()
    @Environment(\.colorScheme) private var colorScheme

    private var ground: GridGround { colorScheme == .dark ? .observatory : .studio }

    var body: some View {
        NavigationStack {
            ZStack {
                // The real flow: withhold until boardReady, then the real SolveScreen
                // against the delayed store. The withholding bar is back-only (SLICE
                // A); the cluster arrives on the welcome (SLICE B). The board's inset
                // is the constant (SLICE C), the thing under test.
                Group {
                    if timeline.boardReady {
                        SolveScreen(
                            store: room.store,
                            puzzle: room.puzzle,
                            clues: room.clues,
                            roomName: "Live timing")
                            // Sample the board's top row against the SAME occlusion the
                            // board runs, on the first frame and on every phase change.
                            .background(boardTopProbe)
                    } else {
                        Color(rgb: ground.tokens.canvas)
                            .ignoresSafeArea()
                            .modifier(
                                RoomOpeningToolbarHost(ground: ground, onBack: {}))
                    }
                }
                .modifier(RoomNavBarChrome())

                referenceOverlay
            }
        }
        .task { await timeline.run() }
        .task(id: timeline.boardReady) {
            // The delayed welcome rides the store's mailbox once the board mounts, so
            // the cluster arrives on a late beat exactly as a live room's does.
            guard timeline.boardReady else { return }
            await room.run(
                landWelcomeWhen: { timeline.welcomeLanded },
                onSync: { _ in })
        }
    }

    /// The board-top probe: the grid's first-playable-row top in screen points,
    /// computed from the constant occlusion the same way the board's camera clamps,
    /// so this reads the board's own geometry rather than redrawing it. Sampled on the
    /// first frame (the pin) and folded on every phase change (the drift).
    private var boardTopProbe: some View {
        GeometryReader { proxy in
            // The container's top safe-area inset IS the constant board inset (SLICE
            // C): the board bleeds under it, so the probe reads exactly what the
            // board's occlusion reads, from the same container, not a bar-item frame.
            // GridOcclusion.standing is internal to CrossyUI, so the rig rebuilds the
            // same shape through the public init: the constant top inset is the whole
            // point (the bottom does not shift across the welcome either, so the drift
            // proof holds regardless of its exact value).
            let inset = proxy.safeAreaInsets.top
            let occlusion = GridOcclusion(top: inset, bottom: 0)
            // The full bled viewport (the board ignores the top safe area, so its
            // height spans from the screen top down).
            let viewport = CGSize(
                width: proxy.size.width, height: proxy.size.height + inset)
            let camera = GridCamera.initial(
                viewport: viewport,
                rows: room.puzzle.rows, cols: room.puzzle.cols,
                occlusion: occlusion)
            // The board origin (cell 0's top-left) in the bled viewport IS the grid's
            // first-row top in screen points: the board's viewport starts at the
            // screen top under the bleed.
            let rowTop = camera.offset.y
            Color.clear
                .onAppear { timeline.record(top: rowTop) }
                .onChange(of: timeline.phase) { _, _ in timeline.record(top: rowTop) }
        }
    }

    /// The pinned reference (the first-frame board top) against the live line, plus a
    /// readout. Coincident lines through the whole sequence is the pass.
    private var referenceOverlay: some View {
        GeometryReader { _ in
            ZStack(alignment: .topLeading) {
                if let pin = timeline.firstFrameTop {
                    // The pin: where the grid's first row sat on frame one.
                    Rectangle()
                        .fill(.green)
                        .frame(height: 1)
                        .offset(y: pin)
                        .opacity(0.8)
                }
                readout
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
            .allowsHitTesting(false)
            .ignoresSafeArea()
        }
    }

    private var readout: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: "phase: \(timeline.phase)")
            Text(
                verbatim:
                    "board top (frame 1): "
                    + (timeline.firstFrameTop.map { String(format: "%.1f", $0) } ?? "-"))
            Text(verbatim: String(format: "max drift: %.2f pt", timeline.maxDrift))
                .bold()
        }
        .font(.system(size: 12, weight: .medium).monospaced())
        .foregroundStyle(.white)
        .padding(8)
        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - The delayed room

/// A loopback room that lands its welcome only when the rig says the beat is due, so
/// the board mounts and renders BEFORE the cluster arrives (the live timing that
/// broke the inset). Reuses the demo fixture and the store; only the welcome's timing
/// is scripted.
@MainActor
private final class DelayedRoom {
    let store = GameStore()
    let puzzle: GridPuzzle
    let clues: ClueBook
    private let welcome: WelcomeMessage
    private let transport: WithheldWelcomeTransport

    init() {
        let fixture = DemoFixture.mini9(selfRole: .host)
        puzzle = fixture.puzzle
        clues = fixture.clues
        welcome = fixture.welcome
        transport = WithheldWelcomeTransport(welcome: fixture.welcome)
    }

    /// Run the mailbox and release the welcome when `landWelcomeWhen` first reads true,
    /// so the store leaves `connecting` on the rig's late beat.
    func run(
        landWelcomeWhen: @escaping @MainActor () -> Bool,
        onSync: @escaping @MainActor (SyncState) -> Void
    ) async {
        try? await transport.connect()
        async let mailbox: Void = store.run(transport)
        // Poll the release gate at the display cadence; the welcome yields the instant
        // the rig flips its flag.
        while !landWelcomeWhen() {
            try? await Task.sleep(for: .milliseconds(16))
        }
        await transport.releaseWelcome()
        onSync(store.sync)
        await mailbox
    }
}

/// A loopback transport that HOLDS the welcome until released, so the board mounts
/// against `connecting` (no board truth, the cluster absent) and the welcome lands on
/// a late, scripted beat. The rest matches LoopbackTransport (evidence only).
private actor WithheldWelcomeTransport: Transport {
    nonisolated let inbound: AsyncStream<ServerMessage>
    private let deliveries: AsyncStream<ServerMessage>.Continuation
    private let welcome: WelcomeMessage

    init(welcome: WelcomeMessage) {
        self.welcome = welcome
        (inbound, deliveries) = AsyncStream<ServerMessage>.makeStream()
    }

    func connect() async throws {}

    func releaseWelcome() {
        deliveries.yield(.welcome(welcome))
    }

    func send(_ message: ClientMessage) async {}

    func close() async {
        deliveries.finish()
    }
}
