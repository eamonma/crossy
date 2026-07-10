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
    private let store: GameStore
    private let puzzle: GridPuzzle
    private let ground: GridGround
    private let selection: GridSelection?
    private let onPlaceCursor: (Int) -> Void

    /// nil until the first layout pass sizes the initial camera.
    @State private var camera: GridCamera?
    /// The camera frozen at gesture start, so a pinch or drag composes against a
    /// stable base instead of its own partial output.
    @State private var magnifyBase: GridCamera?
    @State private var dragBase: GridCamera?
    @State private var flashes = FlashBook()

    /// `initialCamera` seeds the first camera (nil opens at the clamp, centered):
    /// the hook for restoring a solver's zoom across scene changes. Every camera is
    /// re-clamped in body, so no seed can start the board offscreen or blurred.
    public init(
        store: GameStore,
        puzzle: GridPuzzle,
        ground: GridGround,
        selection: GridSelection?,
        initialCamera: GridCamera? = nil,
        onPlaceCursor: @escaping (Int) -> Void
    ) {
        self.store = store
        self.puzzle = puzzle
        self.ground = ground
        self.selection = selection
        self.onPlaceCursor = onPlaceCursor
        _camera = State(initialValue: initialCamera)
    }

    public var body: some View {
        GeometryReader { proxy in
            let viewport = proxy.size
            let camera = (self.camera
                ?? GridCamera.initial(viewport: viewport, rows: puzzle.rows, cols: puzzle.cols))
                .clamped(viewport: viewport, rows: puzzle.rows, cols: puzzle.cols)
            let frame = GridFrame(
                store: store, puzzle: puzzle, selection: selection, ground: ground)
            // The timeline drives redraws only while a flash decays; at rest the
            // Canvas redraws only when the snapshot inputs change.
            TimelineView(.animation(minimumInterval: nil, paused: flashes.isEmpty)) { timeline in
                let now = timeline.date.timeIntervalSinceReferenceDate
                Canvas { context, size in
                    Self.draw(
                        frame: frame, camera: camera, ground: ground,
                        flashes: flashes, now: now,
                        context: &context, viewport: size)
                }
            }
            .background(Color(rgb: ground.tokens.canvas))
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
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { value in
                        let base = magnifyBase ?? camera
                        magnifyBase = base
                        self.camera = base.zoomed(
                            by: value.magnification,
                            anchor: value.startLocation,
                            viewport: viewport, rows: puzzle.rows, cols: puzzle.cols)
                    }
                    .onEnded { _ in magnifyBase = nil }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        let base = dragBase ?? camera
                        dragBase = base
                        self.camera = base.panned(
                            by: value.translation,
                            viewport: viewport, rows: puzzle.rows, cols: puzzle.cols)
                    }
                    .onEnded { _ in dragBase = nil }
            )
            .onChange(of: viewport) { _, size in
                self.camera = self.camera?.clamped(
                    viewport: size, rows: puzzle.rows, cols: puzzle.cols)
            }
            .onAppear { wireFlashSink() }
        }
        .accessibilityLabel(
            Text(verbatim: "\(puzzle.cols) by \(puzzle.rows) crossword grid"))
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
    }

    /// Everything below draws from plain values. `nonisolated`: the Canvas renderer
    /// closure is not actor-isolated, and the snapshot means it needs nothing that is.
    private nonisolated static func draw(
        frame: GridFrame, camera: GridCamera, ground: GridGround,
        flashes: FlashBook, now: TimeInterval,
        context: inout GraphicsContext, viewport: CGSize
    ) {
        let puzzle = frame.puzzle
        let tokens = ground.tokens
        context.translateBy(x: camera.offset.x, y: camera.offset.y)
        context.scaleBy(x: camera.scale, y: camera.scale)
        let visible = camera.visibleCells(
            viewport: viewport, rows: puzzle.rows, cols: puzzle.cols)

        drawFills(frame, visible, tokens, &context)
        drawLines(puzzle, visible, tokens, &context)
        drawCellContent(frame, visible, ground, &context)
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
                case .current:
                    context.fill(
                        Path(rect),
                        with: .color(Color(rgb: frame.cursorTint).opacity(Paint.currentAlpha)))
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
                case .block, .check, .base:
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
    public init(store: GameStore, puzzle: GridPuzzle, selection: GridSelection?, ground: GridGround) {
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
            ground: ground)
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
