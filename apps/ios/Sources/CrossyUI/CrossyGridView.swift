// The board (apps/ios/DESIGN.md §2): paper, solid and high-contrast on both grounds;
// Liquid Glass never touches it (root DESIGN.md D06). One SwiftUI Canvas draw pass
// over the visible cell window, no per-cell views: a 25x25 board is 625 cells and
// must pan at 120 Hz. The view is a pure function of the store's render surface
// (INV-10): it snapshots a GridFrame in body, where @Observable tracking registers,
// and draws exactly that. Intents flow out through one closure (ARCHITECTURE.md §3:
// intents in, render models out); local selection is owned by the input layer (I2b)
// and arrives as data.

import CrossyDesign
import CrossyStore
import SwiftUI

@MainActor
public struct CrossyGridView: View {
    /// A coordinate space pinned to the board's own frame, stable under the
    /// zoom: the Canvas transforms internally through its GraphicsContext, so
    /// this frame never scales, and a pinch measured here cannot feed its own
    /// output back and spasm (the SP-i1 melt law's spirit for scrubbed
    /// geometry). All pinch centroids are read in this one space.
    private static let boardSpace = "crossy.grid.board"

    private let store: GameStore
    private let puzzle: GridPuzzle
    private let ground: GridGround
    private let selection: GridSelection?
    /// The cells the current clue cross-references, faintly tinted relative to the
    /// selection (ClueBook.referencedCells). Empty by default: a caller without clue
    /// text passes nothing and the board tints no cross-reference.
    private let crossReference: Set<Int>
    private let mosaicStartedAt: TimeInterval?
    /// The completion mosaic's writers when they are first-correct truth from GET
    /// /analysis (owner ruling 2026-07-13): cell to the userId who solved it first,
    /// the same attribution the web mosaic and legend paint. Nil falls the bloom
    /// back to the event log's last writer (sequencedWriters): the fallback when the
    /// fetch is absent, and every non-completion caller.
    private let mosaicOwners: [Int: String]?
    /// True once the mosaic's envelope has landed (CompletionModel.mosaicSettled):
    /// the record is a constant now (the blurred field standing, letters back in
    /// ink), so the draw pass skips the clock and the timeline pauses. The
    /// settled field is the completed board's record — it never reverts to plain
    /// ink (the flash-then-disappear fix; web parity: the reveal arc ends
    /// standing).
    private let mosaicSettled: Bool
    /// The isolation filter over the settled record (CompletionModel.isolation):
    /// a tapped legend row hides the blurred field and returns crisp per-cell
    /// tints, that solver's at the settled weight, everyone else's recessed
    /// toward paper. Presentation only — it exists only once the record has
    /// settled (the model gates the toggle), and nil is the full blurred field.
    private let mosaicIsolation: MosaicIsolation?
    /// The completed Analysis tab's directional loupe. It is a clear glass view above the Canvas,
    /// never a grid fill; the caller gates it to the settled post-game mosaic.
    private let showsWordLoupe: Bool
    /// The reaction sticker book (PROTOCOL.md §9), rendered by the view overlay
    /// above the draw pass (ReactionStickerLayer; the entry-shake fix keeps
    /// stickers out of the per-frame Canvas). Nil for callers without reactions
    /// (previews, older rigs): the overlay never mounts then.
    private let reactions: ReactionModel?
    /// The ReactionLab's Reduce Motion preview (the system environment value is the
    /// system's to set; a rig cannot). True renders the sticker layer upright and
    /// fade-only exactly as the real setting would; the room always passes false.
    private let simulatesReduceMotion: Bool
    /// The standing chrome's cover over the full-bleed board (the clamp's
    /// scroll-inset window): constant under clue growth by construction, so the
    /// board never moves with clue length.
    private let occlusion: GridOcclusion
    /// The live cover the selected cell must escape (the wrapped bar plus
    /// feather): feeds only the follow pan.
    private let keepClear: GridOcclusion
    /// How readily a drag the camera could not spend reads as a swipe (the person's
    /// per-device preference, resolved to thresholds). Standard is the pre-preference
    /// behavior; the composition root threads the live value from Settings.
    private let swipeTuning: SwipeTuning
    private let onSwipe: ((SwipeIntent) -> Void)?
    private let onPlaceCursor: (Int) -> Void

    /// nil until the first layout pass sizes the initial camera.
    @State private var camera: GridCamera?
    /// The camera frozen at gesture start, so a pinch or drag composes against a
    /// stable base instead of its own partial output. One base for both, because
    /// pinch and pan are one gesture now (they solve together, not in a race).
    @State private var dragBase: GridCamera?
    /// The pinch centroid at gesture start, in `boardSpace`. A live pinch pins
    /// the board point under this to the drifting live centroid (Photos/Maps),
    /// so the two-finger drag pans the zoom instead of racing it. nil when no
    /// pinch is live; set by whichever of magnify/drag fires first.
    @State private var pinchStartCentroid: CGPoint?
    @State private var flashes = FlashBook()
    /// True while an isolation toggle's crossfade runs: the settled timeline
    /// unpauses for just the fade's window, then rests again (a settled mosaic
    /// must keep costing no frames). Flipped by the toggle's onChange; the task
    /// is the flash sweep's retire pattern.
    @State private var isolationFading = false
    @State private var isolationFadeTask: Task<Void, Never>?
    /// The camera-follow animator (I2c): Canvas draws through context transforms,
    /// which SwiftUI cannot animate, so the follow pan interpolates by hand.
    @State private var followTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `initialCamera` seeds the first camera (nil opens at the clamp, centered):
    /// the hook for restoring a solver's zoom across scene changes. Every camera is
    /// re-clamped in body, so no seed can start the board offscreen or blurred.
    /// `onSwipe` receives drags the camera could not spend (the board fits, pan is
    /// inert), classified per root DESIGN.md §5; a drag that panned stays a pan.
    /// `mosaicStartedAt` is the completion celebration's trigger instant
    /// (CompletionModel); while non-nil the board plays the mosaic (DESIGN.md §8).
    /// `occlusion`/`keepClear` are the floating chrome's cover (GridOcclusion:
    /// standing insets clamp, the live bar only rescues the selected cell).
    public init(
        store: GameStore,
        puzzle: GridPuzzle,
        ground: GridGround,
        selection: GridSelection?,
        crossReference: Set<Int> = [],
        initialCamera: GridCamera? = nil,
        reactions: ReactionModel? = nil,
        simulatesReduceMotion: Bool = false,
        mosaicStartedAt: TimeInterval? = nil,
        mosaicOwners: [Int: String]? = nil,
        mosaicSettled: Bool = false,
        mosaicIsolation: MosaicIsolation? = nil,
        showsWordLoupe: Bool = false,
        occlusion: GridOcclusion = .none,
        keepClear: GridOcclusion? = nil,
        swipeTuning: SwipeTuning = .standard,
        onSwipe: ((SwipeIntent) -> Void)? = nil,
        onPlaceCursor: @escaping (Int) -> Void
    ) {
        self.store = store
        self.puzzle = puzzle
        self.ground = ground
        self.selection = selection
        self.crossReference = crossReference
        self.reactions = reactions
        self.simulatesReduceMotion = simulatesReduceMotion
        self.mosaicStartedAt = mosaicStartedAt
        self.mosaicOwners = mosaicOwners
        self.mosaicSettled = mosaicSettled
        self.mosaicIsolation = mosaicIsolation
        self.showsWordLoupe = showsWordLoupe
        self.occlusion = occlusion
        self.keepClear = keepClear ?? occlusion
        self.swipeTuning = swipeTuning
        self.onSwipe = onSwipe
        self.onPlaceCursor = onPlaceCursor
        _camera = State(initialValue: initialCamera)
    }

    public var body: some View {
        GeometryReader { proxy in
            let viewport = proxy.size
            let camera = (self.camera
                ?? GridCamera.initial(
                    viewport: viewport, rows: puzzle.rows, cols: puzzle.cols,
                    occlusion: occlusion))
                .clamped(
                    viewport: viewport, rows: puzzle.rows, cols: puzzle.cols,
                    occlusion: occlusion)
            let frame = GridFrame(
                store: store, puzzle: puzzle,
                // Completed Analysis replaces the paper tint with the glass loupe and its etched
                // focus square. Every other grid keeps the established fill precedence.
                selection: showsWordLoupe ? nil : selection, ground: ground,
                crossReference: crossReference)
            // The mosaic snapshot (DESIGN.md §8): palette from the first-correct
            // owners when GET /analysis has landed (owner ruling 2026-07-13),
            // falling back to the sequenced event log's last writer otherwise. ID-1
            // gated inside GridMosaic. Snapshotted in body like GridFrame so
            // @Observable registers the reads.
            let mosaic: MosaicWash? = mosaicStartedAt.map { startedAt in
                let writers =
                    mosaicOwners ?? Self.sequencedWriters(store: store, puzzle: puzzle)
                return MosaicWash(
                    colors: GridMosaic.colors(
                        writers: writers,
                        participants: store.participants.map {
                            GridPresence.ParticipantInput(
                                userId: $0.userId, displayName: $0.displayName,
                                color: $0.color, isSpectator: $0.role == .spectator)
                        },
                        ground: ground),
                    writers: writers,
                    startedAt: startedAt,
                    settled: mosaicSettled,
                    isolation: mosaicIsolation)
            }
            // The timeline drives redraws only while a flash decays, the mosaic
            // BLOOMS, or an isolation toggle crossfades; a settled mosaic is a
            // constant field, so it pauses like rest
            // (the Canvas redraws only when the snapshot inputs change).
            // Reaction stickers deliberately do NOT ride this Canvas: per-frame
            // Canvas redraws re-rasterize the emoji at every intermediate scale,
            // which read as entry shake on device (owner finding 2026-07-14). They
            // live in the view overlay below, where Core Animation transforms each
            // glyph's one rasterized layer (ReactionStickerLayer).
            TimelineView(
                .animation(
                    minimumInterval: nil,
                    paused: flashes.isEmpty && (mosaic?.settled ?? true)
                        && !isolationFading)
            ) { timeline in
                let now = timeline.date.timeIntervalSinceReferenceDate
                Canvas { context, size in
                    Self.draw(
                        frame: frame, camera: camera, ground: ground,
                        flashes: flashes, mosaic: mosaic, now: now,
                        context: &context, viewport: size)
                }
            }
            .background(Color(rgb: ground.tokens.canvas))
            // The word loupe is glass ABOVE paper, not a new Canvas role. It tracks the same camera
            // projection as the draw pass, including pan and zoom, and deliberately mounts before
            // reactions so celebration stickers remain the topmost board paint.
            .overlay {
                if showsWordLoupe, let selection {
                    WordLoupeOverlay(
                        puzzle: puzzle, selection: selection,
                        camera: camera, ground: ground)
                }
            }
            // The sticker layer, a view overlay above the whole draw pass (mosaic
            // included, so completed-grid reactions paint over the bloom exactly as
            // the web overlay paints above its SVG). Its own view, so sticker
            // mutations re-evaluate only its body, never this one; hit-inert, so
            // the grid keeps every touch.
            .overlay {
                if let reactions {
                    ReactionStickerLayer(
                        reactions: reactions, puzzle: puzzle, camera: camera,
                        reduceMotion: reduceMotion || simulatesReduceMotion)
                }
            }
            .gesture(
                SpatialTapGesture().onEnded { value in
                    guard
                        let cell = camera.cell(
                            at: value.location, rows: puzzle.rows, cols: puzzle.cols),
                        !puzzle.blocks.contains(cell)
                    else { return }
                    onPlaceCursor(cell)
                }
            )
            // Pinch and pan are ONE gesture, so a two-finger pinch solves scale
            // and centroid-pan together off one frozen base, never two gestures
            // racing the same camera against separate bases. The drag reports the
            // touch centroid, measured in `boardSpace` (stable under the zoom);
            // the magnify reports the scalar scale. Both closures write raw here,
            // no animation on the scrubbed camera (SP-i1): springs only settle
            // the follow pan, after the fingers lift.
            .coordinateSpace(name: Self.boardSpace)
            .simultaneousGesture(
                MagnifyGesture()
                    .simultaneously(
                        with: DragGesture(
                            minimumDistance: 1, coordinateSpace: .named(Self.boardSpace)))
                    .onChanged { value in
                        followTask?.cancel()
                        let base = dragBase ?? camera
                        dragBase = base
                        if let magnify = value.first {
                            // A pinch: pin the board point under the start centroid
                            // to the live centroid at the new scale, so a drifting
                            // centroid pans and the zoom anchors on the fingers
                            // (Photos/Maps). The start centroid is frozen with the
                            // base; the live centroid rides the drag. Both are read
                            // in `boardSpace`; the magnify's own start location
                            // (same origin, that space is on this view) fills the
                            // first frame before the drag clears its 1 pt slop.
                            let start = pinchStartCentroid
                                ?? value.second?.startLocation ?? magnify.startLocation
                            pinchStartCentroid = start
                            let centroid = value.second?.location ?? start
                            self.camera = base.pinched(
                                by: magnify.magnification,
                                startCentroid: start, centroid: centroid,
                                viewport: viewport, rows: puzzle.rows, cols: puzzle.cols,
                                occlusion: occlusion)
                        } else if let drag = value.second {
                            // One finger, no scale: a plain pan.
                            self.camera = base.panned(
                                by: drag.translation,
                                viewport: viewport, rows: puzzle.rows, cols: puzzle.cols,
                                occlusion: occlusion)
                        }
                    }
                    .onEnded { value in
                        let base = dragBase
                        dragBase = nil
                        pinchStartCentroid = nil
                        // A drag the camera spent is a pan; only a one-finger drag
                        // the clamp held inert (the board fits the viewport) reads
                        // as a swipe, so pan and swipe never double-fire. A pinch
                        // (scale present) is never a swipe. Along the solving
                        // direction is next/previous word, across it toggles (root
                        // DESIGN.md §5); the classifier is pure and pinned in tests.
                        // Flick assist consults the drag's predicted end translation
                        // when the actual travel falls short, so a fast, short flick
                        // still turns the page (the iOS sluggish-swipes fix); the
                        // person's sensitivity preference sets the thresholds.
                        guard value.first == nil, let onSwipe, let base,
                            let drag = value.second, base == self.camera,
                            let intent = SwipeClassifier.classify(
                                translation: drag.translation,
                                predicted: drag.predictedEndTranslation,
                                isAcross: selection?.isAcross ?? true,
                                tuning: swipeTuning)
                        else { return }
                        onSwipe(intent)
                    }
            )
            .onChange(of: viewport) { _, size in
                self.camera = self.camera?.clamped(
                    viewport: size, rows: puzzle.rows, cols: puzzle.cols,
                    occlusion: occlusion)
            }
            // The standing insets change only with real layout (rotation, a
            // terminal reshape): re-clamp in place, exactly like a viewport
            // change, and never while a gesture owns the camera.
            .onChange(of: occlusion) { _, next in
                guard dragBase == nil else { return }
                self.camera = self.camera?.clamped(
                    viewport: viewport, rows: puzzle.rows, cols: puzzle.cols,
                    occlusion: next)
            }
            // Camera follow (I2c): a jump to a new clue (a clue-browser tap, a Tab
            // past the viewport edge) pans the minimal distance that frames the
            // whole WORD, not just the landed cell (owner 2026-07-12: advancing a
            // clue should show the word you are about to solve). A word wider than
            // the zoomed window keeps the cursor on screen and reveals the word
            // from there. Only real jumps move anything: a word already framed
            // returns nil from `following`, and a live pinch or drag owns the
            // camera unchallenged.
            .onChange(of: selection) { _, next in
                guard let next, dragBase == nil,
                    let target = camera.following(
                        word: puzzle.wordCells(
                            through: next.cell, isAcross: next.isAcross),
                        cursor: next.cell, viewport: viewport,
                        rows: puzzle.rows, cols: puzzle.cols,
                        occlusion: occlusion, keepClear: keepClear)
                else { return }
                followCamera(from: camera, to: target)
            }
            // The bar breathes (a wrapped clue grows keepClear): pan the one
            // selected cell out from under it, on the chrome spring, never
            // during a live pinch or drag (the full-bleed ruling: the board
            // stays put; only the occluded cell is rescued). The keep-clear
            // frame ticks through the bar's own spring, so each tick re-aims
            // the walk and the pan rides the growth.
            .onChange(of: keepClear) { _, _ in
                guard let selection, dragBase == nil,
                    let target = camera.following(
                        cell: selection.cell, viewport: viewport,
                        rows: puzzle.rows, cols: puzzle.cols,
                        occlusion: occlusion, keepClear: keepClear)
                else { return }
                followCamera(from: camera, to: target)
            }
            .onAppear { wireFlashSink() }
            // An isolation toggle (a legend-row tap over the settled record): run
            // the timeline just long enough for the quiet crossfade, then let it
            // pause again. A rapid retoggle cancels and re-arms the retire, so a
            // fade in flight is never cut short; the small margin past the
            // envelope makes the pause frame draw the exact resting target.
            .onChange(of: mosaicIsolation) { _, next in
                guard next != nil else { return }
                isolationFading = true
                isolationFadeTask?.cancel()
                isolationFadeTask = Task { @MainActor in
                    try? await Task.sleep(
                        for: .seconds(GridMosaic.isolationFadeDuration + 0.05))
                    guard !Task.isCancelled else { return }
                    isolationFading = false
                }
            }
            .onDisappear {
                followTask?.cancel()
                isolationFadeTask?.cancel()
            }
            // The edge-pop gutter (owner report 2026-07-12): the camera drag
            // claims any touch that moves one point, so a back swipe from the
            // leading edge never reached the system's interactive pop — the
            // zoom scrub the grammar was chosen for. This strip stands ABOVE
            // the drag surface with no drag gesture of its own: a tap still
            // places the cursor (the same resolution the grid's tap runs), but
            // a pan that starts here belongs to the system recognizers on the
            // ancestor hosting views, the way home. `.leading` flips with RTL,
            // matching the pop gesture's own edge.
            .overlay(alignment: .leading) {
                Color.clear
                    .frame(width: Self.popGutterWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(
                        SpatialTapGesture().onEnded { value in
                            guard
                                let cell = camera.cell(
                                    at: value.location, rows: puzzle.rows,
                                    cols: puzzle.cols),
                                !puzzle.blocks.contains(cell)
                            else { return }
                            onPlaceCursor(cell)
                        }
                    )
            }
        }
        .accessibilityLabel(
            Text(verbatim: "\(puzzle.cols) by \(puzzle.rows) crossword grid"))
    }

    /// The leading strip the camera's drag never claims, so the system's
    /// interactive pop can (the edge-pop gutter above). Sized to the system's
    /// own edge-gesture band.
    private static let popGutterWidth: CGFloat = 24

    /// The follow pan, interpolated by hand at display cadence: the Canvas draws
    /// through context transforms, so `withAnimation` on the camera state would
    /// snap, not glide. The curve is the chrome spring itself (ChromeSettleCurve,
    /// DESIGN.md §7: no overshoot; a cubic ease-out stops instead of settling,
    /// owner finding 2026-07-10), stepped once per real display frame on iOS
    /// (FrameTicker: a slept interval jitters against ProMotion). Reduce Motion
    /// cuts straight to the target. Gestures cancel the task and take the camera
    /// back mid-flight.
    private func followCamera(from start: GridCamera, to target: GridCamera) {
        followTask?.cancel()
        if reduceMotion {
            camera = target
            return
        }
        followTask = Task { @MainActor in
            let began = Date.now
            #if os(iOS)
                let ticker = FrameTicker()
                defer { ticker.stop() }
                for await _ in ticker.frames() {
                    if Task.isCancelled { return }
                    let fraction = ChromeSettleCurve.fraction(
                        at: Date.now.timeIntervalSince(began))
                    camera = start.interpolated(to: target, fraction: fraction)
                    if fraction >= 1 { return }
                }
            #else
                while !Task.isCancelled {
                    let fraction = ChromeSettleCurve.fraction(
                        at: Date.now.timeIntervalSince(began))
                    camera = start.interpolated(to: target, fraction: fraction)
                    if fraction >= 1 { return }
                    try? await Task.sleep(for: .milliseconds(8))
                }
            #endif
        }
    }

    /// The store detects the conflict trigger; the view animates the ~300 ms flash
    /// in the writer's color (PROTOCOL.md §8, D02). Recording is ID-1 gated inside
    /// FlashBook. The sweep task retires the entry after the envelope so the
    /// timeline can pause again.
    private func wireFlashSink() {
        store.onConflictFlash = { flash in
            let identity = store.participants
                .first(where: { $0.userId == flash.by })
                .map { GridPresence.rosterColor(wireColor: $0.color, userId: flash.by) }
                ?? IdentityRoster.color(for: flash.by)
            flashes.record(
                cell: flash.cell,
                color: ground.rosterColor(identity),
                at: Date().timeIntervalSinceReferenceDate)
            Task {
                try? await Task.sleep(for: .milliseconds(400))
                flashes.sweep(at: Date().timeIntervalSinceReferenceDate)
            }
        }
    }
}

// MARK: - The draw pass

extension CrossyGridView {
    /// Highlight alphas over the cell fill: surface treatment, one set for both
    /// grounds (the tokens carry the ground difference, never the code path).
    private enum Paint {
        static let currentAlpha: Double = 0.32
        static let wordAlpha: Double = 0.14
        static let teammateAlpha: Double = 0.12
        /// Half the active-word wash: the cross-reference mark exists only relative to
        /// your selection, so it speaks the selection's color, quieter than the word
        /// you are on (owner will tune on device).
        static let crossReferenceAlpha: Double = 0.07
    }

    /// Everything below draws from plain values. `nonisolated`: the Canvas renderer
    /// closure is not actor-isolated, and the snapshot means it needs nothing that is.
    private nonisolated static func draw(
        frame: GridFrame, camera: GridCamera, ground: GridGround,
        flashes: FlashBook, mosaic: MosaicWash?, now: TimeInterval,
        context: inout GraphicsContext, viewport: CGSize
    ) {
        let puzzle = frame.puzzle
        let tokens = ground.tokens
        context.translateBy(x: camera.offset.x, y: camera.offset.y)
        context.scaleBy(x: camera.scale, y: camera.scale)
        let visible = camera.visibleCells(
            viewport: viewport, rows: puzzle.rows, cols: puzzle.cols)

        drawFills(frame, visible, tokens, &context)
        // The settled record's blurred color field lives UNDER everything that
        // must stay crisp: blocks (redrawn inside the field pass), hairlines,
        // numbers, letters, and the closing frame all draw after it.
        if let mosaic {
            drawMosaicField(frame, visible, mosaic, now, tokens, &context)
        }
        drawLines(puzzle, visible, tokens, &context)
        drawCellContent(frame, visible, ground, &context)
        if let mosaic {
            drawMosaic(frame, visible, mosaic, now, ground, &context)
        }
        drawFlashes(puzzle, visible, flashes, now, &context)

        // The closing frame: a quiet 2-unit rule over the hairlines (web parity).
        let board = GridCamera.boardSize(rows: puzzle.rows, cols: puzzle.cols)
        context.stroke(
            Path(CGRect(origin: .zero, size: board).insetBy(
                dx: GridModule.frameStroke / 2, dy: GridModule.frameStroke / 2)),
            with: .color(Color(rgb: tokens.gridLine)),
            lineWidth: GridModule.frameStroke)
    }

    /// Background precedence per cell (root DESIGN.md §10, resolved by CellFill):
    /// a base coat, then the highlight level's tint over it.
    private nonisolated static func drawFills(
        _ frame: GridFrame, _ visible: (rows: Range<Int>, cols: Range<Int>),
        _ tokens: GroundTokens, _ context: inout GraphicsContext
    ) {
        for row in visible.rows {
            for col in visible.cols {
                let cell = row * frame.puzzle.cols + col
                let rect = GridModule.cellRect(cell, cols: frame.puzzle.cols)
                let fill = frame.fill(cell)
                let base = fill == .block ? tokens.block : tokens.cell
                context.fill(Path(rect), with: .color(Color(rgb: base)))
                switch fill {
                case .check:
                    // The room's shared mark (PROTOCOL.md §10, D27): the check
                    // coat replaces the paper outright, a token per ground, never
                    // a personal color — the marks are room state, identical for
                    // every member.
                    context.fill(Path(rect), with: .color(Color(rgb: tokens.check)))
                case .current:
                    context.fill(
                        Path(rect),
                        with: .color(Color(rgb: frame.cursorTint).opacity(Paint.currentAlpha)))
                case .crossReference:
                    context.fill(
                        Path(rect),
                        with: .color(
                            Color(rgb: frame.cursorTint).opacity(Paint.crossReferenceAlpha)))
                case .activeWord:
                    context.fill(
                        Path(rect),
                        with: .color(Color(rgb: frame.cursorTint).opacity(Paint.wordAlpha)))
                case .teammate:
                    if let mark = frame.presence[cell]?.first {
                        context.fill(
                            Path(rect),
                            with: .color(Color(rgb: mark.color).opacity(Paint.teammateAlpha)))
                    }
                case .block, .base:
                    break
                }
            }
        }
    }

    /// One hairline lattice over the visible window, stroked once.
    private nonisolated static func drawLines(
        _ puzzle: GridPuzzle, _ visible: (rows: Range<Int>, cols: Range<Int>),
        _ tokens: GroundTokens, _ context: inout GraphicsContext
    ) {
        guard !visible.rows.isEmpty, !visible.cols.isEmpty else { return }
        var lines = Path()
        let unit = GridModule.unit
        let top = CGFloat(visible.rows.lowerBound) * unit
        let bottom = CGFloat(visible.rows.upperBound) * unit
        let leading = CGFloat(visible.cols.lowerBound) * unit
        let trailing = CGFloat(visible.cols.upperBound) * unit
        for col in visible.cols.lowerBound...visible.cols.upperBound {
            lines.move(to: CGPoint(x: CGFloat(col) * unit, y: top))
            lines.addLine(to: CGPoint(x: CGFloat(col) * unit, y: bottom))
        }
        for row in visible.rows.lowerBound...visible.rows.upperBound {
            lines.move(to: CGPoint(x: leading, y: CGFloat(row) * unit))
            lines.addLine(to: CGPoint(x: trailing, y: CGFloat(row) * unit))
        }
        context.stroke(
            lines, with: .color(Color(rgb: tokens.gridLine)), lineWidth: GridModule.hairline)
    }

    /// Circles, numbers, glyphs, presence: the module contract (GridModule, Wave 2.1d).
    private nonisolated static func drawCellContent(
        _ frame: GridFrame, _ visible: (rows: Range<Int>, cols: Range<Int>),
        _ ground: GridGround, _ context: inout GraphicsContext
    ) {
        let puzzle = frame.puzzle
        let tokens = ground.tokens
        for row in visible.rows {
            for col in visible.cols {
                let cell = row * puzzle.cols + col
                if puzzle.blocks.contains(cell) { continue }
                let origin = GridModule.cellOrigin(cell, cols: puzzle.cols)
                let marks = frame.presence[cell] ?? []

                // Circles as inset rings; shaded circles as a soft achromatic wash
                // (people are the only color, apps/ios/DESIGN.md §3).
                if puzzle.shadedCircles.contains(cell) {
                    context.fill(
                        Path(ellipseIn: circleRect(origin)),
                        with: .color(Color(rgb: tokens.number).opacity(GridModule.shadeAlpha)))
                } else if puzzle.circles.contains(cell) {
                    context.stroke(
                        Path(ellipseIn: circleRect(origin)),
                        with: .color(Color(rgb: tokens.number)),
                        lineWidth: GridModule.circleStroke)
                }

                // Clue number, top-left.
                if let number = puzzle.numbers[cell] {
                    context.draw(
                        Text(verbatim: "\(number)")
                            .font(.system(size: GridModule.numberFontSize, weight: .semibold))
                            .foregroundStyle(Color(rgb: tokens.number)),
                        at: CGPoint(
                            x: origin.x + GridModule.numberLeading,
                            y: origin.y + GridModule.capCenterY(
                                baseline: GridModule.numberBaseline,
                                fontSize: GridModule.numberFontSize)),
                        anchor: .leading)
                }

                // The entry glyph: ink, centered, stepped clear of a presence stack,
                // rebus strings scaled to fit (GridModule.glyphSize).
                if let value = frame.values[cell] {
                    let size = GridModule.glyphSize(forLength: value.count)
                    let shift = marks.isEmpty ? 0 : GridModule.glyphPresenceShift
                    context.draw(
                        Text(verbatim: value)
                            .font(.system(size: size, weight: Font.Weight(cssAxis: ground.glyphWeight)))
                            .foregroundStyle(Color(rgb: tokens.ink)),
                        at: CGPoint(
                            x: origin.x + GridModule.glyphCenterX + shift,
                            y: origin.y + GridModule.capCenterY(
                                baseline: GridModule.glyphBaseline,
                                fontSize: GridModule.glyphFontSize)),
                        anchor: .center)
                }

                drawPresence(marks, at: origin, tokens: tokens, &context)
            }
        }
    }

    /// The Wave 2.1d presence stack: one teammate is a direction arrow top-right
    /// plus an avatar puck bottom-right; several collapse to a count badge in the
    /// same bottom-right slot, never the colliding top-right one.
    private nonisolated static func drawPresence(
        _ marks: [PresenceMark], at origin: CGPoint, tokens: GroundTokens,
        _ context: inout GraphicsContext
    ) {
        if marks.count == 1, let mark = marks.first {
            context.fill(
                arrowPath(isAcross: mark.isAcross, at: origin),
                with: .color(Color(rgb: mark.color)))
            let center = CGPoint(
                x: origin.x + GridModule.avatarCenter.x,
                y: origin.y + GridModule.avatarCenter.y)
            context.fill(
                Path(ellipseIn: rect(center: center, radius: GridModule.avatarRadius)),
                with: .color(Color(rgb: mark.color)))
            context.draw(
                Text(verbatim: mark.initial)
                    .font(.system(size: GridModule.avatarInitialFontSize, weight: .bold))
                    .foregroundStyle(Color(rgb: tokens.cell)),
                at: center, anchor: .center)
        } else if marks.count > 1 {
            let center = CGPoint(
                x: origin.x + GridModule.badgeCenter.x,
                y: origin.y + GridModule.badgeCenter.y)
            context.fill(
                Path(ellipseIn: rect(center: center, radius: GridModule.badgeRadius)),
                with: .color(Color(rgb: tokens.number)))
            context.draw(
                Text(verbatim: "\(marks.count)")
                    .font(.system(size: GridModule.badgeCountFontSize, weight: .bold))
                    .foregroundStyle(Color(rgb: tokens.cell)),
                at: center, anchor: .center)
        }
    }

    /// The settled record's color field (apps/ios/DESIGN.md §8, ratified
    /// 2026-07-17, the wash-blur study): the owner tints render at FULL
    /// saturation into one layer, gaussian-blurred at the module-scaled radius
    /// and composited over the paper at the settled weight — a soft field
    /// flowing under the ink and behind the block grid (blocks redraw crisp
    /// here; hairlines, numbers, letters, and the frame draw after this pass).
    /// Edge cells overscan past the frame and the layer clips back to the
    /// board, so the field holds its saturation at the edge. The field breathes
    /// in across the settle (MosaicEnvelope.fieldIntensity, the melt) and
    /// yields to the crisp spotlight while a solver is isolated — a blurred
    /// single hand has no shape to read — crossfading on the isolation's own
    /// clock. The spotlight's crisp tints draw here too, under the ink. A
    /// settled mosaic skips every clock, so the paused timeline's frozen date
    /// draws the exact resting weights.
    private nonisolated static func drawMosaicField(
        _ frame: GridFrame, _ visible: (rows: Range<Int>, cols: Range<Int>),
        _ mosaic: MosaicWash, _ now: TimeInterval, _ tokens: GroundTokens,
        _ context: inout GraphicsContext
    ) {
        let puzzle = frame.puzzle
        let melt =
            mosaic.settled
            ? 1 : MosaicEnvelope.fieldIntensity(elapsed: now - mosaic.startedAt)
        var fieldAlpha = GridMosaic.settledAlpha * melt
        if let isolation = mosaic.isolation {
            fieldAlpha *= GridMosaic.fieldMultiplier(
                isolation: isolation, elapsed: now - isolation.changedAt)
        }
        if fieldAlpha > 0 {
            let board = CGRect(
                origin: .zero,
                size: GridCamera.boardSize(rows: puzzle.rows, cols: puzzle.cols))
            // One layer for every colored cell, visible or not: the blur bleeds
            // across the visible window's edge, and the board clip bounds the
            // filter's work either way. Full saturation inside the layer; the
            // settled weight composites it whole.
            var field = context
            field.clip(to: Path(board))
            field.opacity = fieldAlpha
            field.addFilter(.blur(radius: GridMosaic.fieldBlurRadius))
            field.drawLayer { layer in
                for (cell, color) in mosaic.colors {
                    layer.fill(
                        Path(
                            GridMosaic.fieldRect(
                                cell, rows: puzzle.rows, cols: puzzle.cols)),
                        with: .color(Color(rgb: color)))
                }
            }
            // Blocks redraw crisp above the field, so the color reads as
            // flowing behind the block grid, never fogging it.
            for row in visible.rows {
                for col in visible.cols {
                    let cell = row * puzzle.cols + col
                    guard puzzle.blocks.contains(cell) else { continue }
                    context.fill(
                        Path(GridModule.cellRect(cell, cols: puzzle.cols)),
                        with: .color(Color(rgb: tokens.block)))
                }
            }
        }
        // The isolation spotlight (a legend-row tap over the settled record):
        // crisp per-cell tints return, the isolated solver's at the settled
        // weight, every other hand at the dim floor — a lower alpha over the
        // ground IS the recessive step, on both grounds by construction.
        // Settled only: the model gates the toggle.
        guard mosaic.settled, let isolation = mosaic.isolation else { return }
        let isolationElapsed = now - isolation.changedAt
        for row in visible.rows {
            for col in visible.cols {
                let cell = row * puzzle.cols + col
                guard let color = mosaic.colors[cell], let owner = mosaic.writers[cell]
                else { continue }
                let alpha =
                    GridMosaic.settledAlpha
                    * GridMosaic.spotlightMultiplier(
                        owner: owner, isolation: isolation, elapsed: isolationElapsed)
                guard alpha > 0 else { continue }
                context.fill(
                    Path(GridModule.cellRect(cell, cols: puzzle.cols)),
                    with: .color(Color(rgb: color).opacity(alpha)))
            }
        }
    }

    /// The bloom (apps/ios/DESIGN.md §8): every letter tints to its writer's
    /// color while the paper beneath it washes in the same color, one clock for
    /// both — and on the settle both let go together, the glyph back to ink and
    /// the crisp wash melting into the blurred field (drawMosaicField, under
    /// the ink). A settled mosaic draws nothing here: the standing record lives
    /// in the field pass, so the paused timeline's frozen date cannot misdraw
    /// it. Painted over the ink pass: the tinted glyph crossfades in over the
    /// ink one and back out on the settle, and a cell without a mosaic color
    /// (empty, or cleared with no letter) never tints.
    private nonisolated static func drawMosaic(
        _ frame: GridFrame, _ visible: (rows: Range<Int>, cols: Range<Int>),
        _ mosaic: MosaicWash, _ now: TimeInterval, _ ground: GridGround,
        _ context: inout GraphicsContext
    ) {
        guard !mosaic.settled else { return }
        let intensity = MosaicEnvelope.intensity(elapsed: now - mosaic.startedAt)
        guard intensity > 0 else { return }
        let puzzle = frame.puzzle
        for row in visible.rows {
            for col in visible.cols {
                let cell = row * puzzle.cols + col
                guard let color = mosaic.colors[cell] else { continue }
                context.fill(
                    Path(GridModule.cellRect(cell, cols: puzzle.cols)),
                    with: .color(Color(rgb: color).opacity(GridMosaic.washAlpha * intensity)))
                guard let value = frame.values[cell] else { continue }
                let origin = GridModule.cellOrigin(cell, cols: puzzle.cols)
                let size = GridModule.glyphSize(forLength: value.count)
                let hasMarks = !(frame.presence[cell] ?? []).isEmpty
                let shift = hasMarks ? GridModule.glyphPresenceShift : 0
                context.draw(
                    Text(verbatim: value)
                        .font(.system(size: size, weight: Font.Weight(cssAxis: ground.glyphWeight)))
                        .foregroundStyle(Color(rgb: color).opacity(intensity)),
                    at: CGPoint(
                        x: origin.x + GridModule.glyphCenterX + shift,
                        y: origin.y + GridModule.capCenterY(
                            baseline: GridModule.glyphBaseline,
                            fontSize: GridModule.glyphFontSize)),
                    anchor: .center)
            }
        }
    }

    /// Conflict flashes paint above everything: the writer's color over the cell,
    /// decaying on the FlashEnvelope, leaving the new letter (PROTOCOL.md §8).
    private nonisolated static func drawFlashes(
        _ puzzle: GridPuzzle, _ visible: (rows: Range<Int>, cols: Range<Int>),
        _ flashes: FlashBook, _ now: TimeInterval, _ context: inout GraphicsContext
    ) {
        for (cell, _) in flashes.flashes {
            let row = cell / puzzle.cols
            let col = cell % puzzle.cols
            guard visible.rows.contains(row), visible.cols.contains(col),
                let opacity = flashes.opacity(cell: cell, at: now),
                let flash = flashes.flashes[cell]
            else { continue }
            context.fill(
                Path(GridModule.cellRect(cell, cols: puzzle.cols)),
                with: .color(Color(rgb: flash.color).opacity(opacity)))
        }
    }

    // MARK: Geometry helpers

    private nonisolated static func circleRect(_ origin: CGPoint) -> CGRect {
        let center = CGPoint(
            x: origin.x + GridModule.unit / 2, y: origin.y + GridModule.unit / 2)
        return rect(center: center, radius: GridModule.circleRadius)
    }

    private nonisolated static func rect(center: CGPoint, radius: CGFloat) -> CGRect {
        CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
    }

    /// The direction arrow in its 12x12 design box, scaled to the 7-unit glyph at
    /// the top-right anchor (Wave 2.1d; paths mirror the web renderer's cursorPath).
    private nonisolated static func arrowPath(isAcross: Bool, at origin: CGPoint) -> Path {
        let anchor = CGPoint(
            x: origin.x + GridModule.arrowOrigin.x, y: origin.y + GridModule.arrowOrigin.y)
        let s = GridModule.arrowSize / 12
        var path = Path()
        if isAcross {
            path.move(to: anchor)
            path.addLine(to: CGPoint(x: anchor.x + 12 * s, y: anchor.y + 6 * s))
            path.addLine(to: CGPoint(x: anchor.x, y: anchor.y + 12 * s))
        } else {
            path.move(to: anchor)
            path.addLine(to: CGPoint(x: anchor.x + 6 * s, y: anchor.y + 12 * s))
            path.addLine(to: CGPoint(x: anchor.x + 12 * s, y: anchor.y))
        }
        path.closeSubpath()
        return path
    }
}

// MARK: - Store projection

extension GridFrame {
    /// Snapshot the store's render surface (INV-10: renderValue is the sequenced
    /// state painted with the overlay; presence and identity come from the same
    /// snapshot). Runs in body so @Observable registers every read.
    @MainActor
    public init(
        store: GameStore, puzzle: GridPuzzle, selection: GridSelection?, ground: GridGround,
        crossReference: Set<Int> = []
    ) {
        var values: [Int: String] = [:]
        for cell in 0..<puzzle.cellCount {
            if let value = store.renderValue(cell) { values[cell] = value }
        }
        self.init(
            puzzle: puzzle,
            values: values,
            selection: selection,
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
            ground: ground,
            crossReference: crossReference,
            // The standing marks through the §10 overlay-suppression rule: a cell
            // with a pending optimistic entry renders the overlay, not the mark.
            checkedWrong: GridFrame.visibleCheckMarks(
                store.checkedWrong, overlayCells: Set(store.overlay.map(\.cell))))
    }
}

extension CrossyGridView {
    /// The mosaic's writer attribution, from sequenced cells only (DESIGN.md §8:
    /// derived entirely from the event log): a cell maps to its writer iff it
    /// holds a sequenced letter. The optimistic overlay never tints (a pending
    /// command that raced completion will be rejected, not celebrated), and a
    /// cleared cell keeps its clearer as `by` with no value, so it is excluded.
    static func sequencedWriters(store: GameStore, puzzle: GridPuzzle) -> [Int: String] {
        var writers: [Int: String] = [:]
        for (index, cell) in store.cells where cell.v != nil {
            guard index >= 0, index < puzzle.cellCount, let by = cell.by else { continue }
            writers[index] = by
        }
        return writers
    }
}

// MARK: - Token bridges

extension Color {
    /// CrossyDesign colors are data (RGBColor); SwiftUI construction happens here,
    /// once, in the display sRGB space the token tables are written in. Qualified:
    /// the SDK ships an unrelated RGBColor and SwiftUI's import makes the bare name
    /// ambiguous in this file.
    public init(rgb: CrossyDesign.RGBColor) {
        self.init(.sRGB, red: rgb.unitRed, green: rgb.unitGreen, blue: rgb.unitBlue, opacity: 1)
    }
}

extension Font.Weight {
    /// TypeScale carries CSS-axis numerics; map the ones the grid uses.
    init(cssAxis: Int) {
        switch cssAxis {
        case ..<450: self = .regular
        case ..<550: self = .medium
        case ..<650: self = .semibold
        default: self = .bold
        }
    }
}
