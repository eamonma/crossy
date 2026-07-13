// Pan and zoom over the module-unit board (apps/ios/DESIGN.md §2: grids up to the
// 25x25 ingestion cap render legibly; past comfortable glyph size the grid pans and
// zooms). The camera is two numbers, points-per-unit and a board origin, so every
// rule here is a pure function the tests can pin: the zoom-out clamp holds the
// glyph-legibility floor (TypeScale), the zoom-in clamp a comfortable ceiling, and
// offsets clamp so the board never flies offscreen.

import CoreGraphics
import CrossyDesign

/// Standing chrome's cover over the full-bleed board, in viewport points (the
/// owner's full-bleed ruling, 2026-07-10: the board runs under the floating room
/// bar and clue bar; the camera, not the layout, keeps content readable). Two
/// registers ride this one type:
///
/// - The STANDING inset (the room bar above, the one-line clue bar plus feather
///   below) feeds the clamp: a fitting board centers between the bars, a panned
///   board pins its edges to the window, and because the standing inset is built
///   from constants it never moves with clue length. The board past the window
///   edge is full bleed by design.
/// - The KEEP-CLEAR inset (the live, possibly wrapped bar) feeds only the
///   follow: the selected cell pans clear of the grown bar, and nothing else
///   moves.
public struct GridOcclusion: Equatable, Sendable {
    public var top: CGFloat
    public var bottom: CGFloat

    public init(top: CGFloat = 0, bottom: CGFloat = 0) {
        self.top = top
        self.bottom = bottom
    }

    public static let none = GridOcclusion()

    /// The unobstructed height of a viewport under this occlusion, floored at
    /// zero so degenerate chrome can never invert the window.
    public func windowHeight(of viewport: CGSize) -> CGFloat {
        max(viewport.height - top - bottom, 0)
    }
}

public struct GridCamera: Equatable, Sendable {
    /// Viewport points per module unit.
    public var scale: CGFloat
    /// The board origin (cell 0's top-left corner) in viewport points.
    public var offset: CGPoint

    public init(scale: CGFloat, offset: CGPoint) {
        self.scale = scale
        self.offset = offset
    }

    // MARK: Scale bounds

    /// The zoom-out floor: the scale where an entry glyph (24 module units) hits the
    /// TypeScale legibility floor in points. Never zoom out past where glyphs blur
    /// into noise; the number's justification lives on the TypeScale constant.
    public static var legibilityFloorScale: CGFloat {
        CGFloat(TypeScale.gridGlyphLegibilityFloorPoints) / GridModule.glyphFontSize
    }

    /// The zoom-in ceiling as a cell edge in points: 72 pt is two 36 pt tap targets
    /// of magnification, enough to read a squeezed rebus string, past which panning
    /// cost outweighs any legibility gain.
    public static let maxCellPoints: CGFloat = 72

    public static var maxScale: CGFloat { maxCellPoints / GridModule.unit }

    public static func boardSize(rows: Int, cols: Int) -> CGSize {
        CGSize(width: CGFloat(cols) * GridModule.unit, height: CGFloat(rows) * GridModule.unit)
    }

    /// The scale at which the whole board fits the viewport's unobstructed
    /// window (full bleed: the bars float over the board, so "fits" means
    /// visible between them, not merely inside the screen).
    public static func fitScale(
        viewport: CGSize, rows: Int, cols: Int, occlusion: GridOcclusion = .none
    ) -> CGFloat {
        let board = boardSize(rows: rows, cols: cols)
        guard board.width > 0, board.height > 0 else { return legibilityFloorScale }
        return min(viewport.width / board.width, occlusion.windowHeight(of: viewport) / board.height)
    }

    /// The zoom-out clamp: whole-board fit when that respects the legibility floor
    /// (no reason to shrink a fitting board further), else the floor itself (a 25x25
    /// on a narrow phone pans instead of blurring). Never above the zoom-in ceiling,
    /// which keeps the range non-empty for tiny boards whose fit exceeds it.
    public static func minScale(
        viewport: CGSize, rows: Int, cols: Int, occlusion: GridOcclusion = .none
    ) -> CGFloat {
        min(
            maxScale,
            max(
                fitScale(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion),
                legibilityFloorScale))
    }

    /// The opening camera: as much board as the clamps allow, centered in the
    /// unobstructed window.
    public static func initial(
        viewport: CGSize, rows: Int, cols: Int, occlusion: GridOcclusion = .none
    ) -> GridCamera {
        GridCamera(
            scale: minScale(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion),
            offset: .zero)
            .clamped(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion)
    }

    // MARK: Clamping

    /// Scale into bounds; each axis then centers when the board is smaller than the
    /// unobstructed window and otherwise pins so no gap opens between board edge and
    /// window edge. The board can never fly offscreen, and past the window edge it
    /// runs under the floating bars (full bleed): a fully panned board rests its
    /// first row just below the room bar and its last just above the clue bar's
    /// feather, exactly the scroll-inset grammar. The occlusion here is the
    /// STANDING inset, constant under clue growth, so the clamp never moves the
    /// board when the bar breathes.
    public func clamped(
        viewport: CGSize, rows: Int, cols: Int, occlusion: GridOcclusion = .none
    ) -> GridCamera {
        let bounded = min(
            max(scale, Self.minScale(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion)),
            Self.maxScale)
        let board = Self.boardSize(rows: rows, cols: cols)
        let content = CGSize(width: board.width * bounded, height: board.height * bounded)
        return GridCamera(
            scale: bounded,
            offset: CGPoint(
                x: Self.clampedAxis(offset.x, content: content.width, viewport: viewport.width),
                y: Self.clampedAxis(
                    offset.y, content: content.height, viewport: viewport.height,
                    insetMin: occlusion.top, insetMax: occlusion.bottom)))
    }

    private static func clampedAxis(
        _ offset: CGFloat, content: CGFloat, viewport: CGFloat,
        insetMin: CGFloat = 0, insetMax: CGFloat = 0
    ) -> CGFloat {
        let window = max(viewport - insetMin - insetMax, 0)
        if content <= window { return insetMin + (window - content) / 2 }
        return min(insetMin, max(insetMin + window - content, offset))
    }

    // MARK: Gestures

    /// Pinch about a fixed anchor (the board point under the fingers stays under
    /// them), then clamp. The centroid holds still across the zoom; `pinched`
    /// generalizes this to a centroid that also drifts.
    public func zoomed(
        by magnification: CGFloat, anchor: CGPoint, viewport: CGSize, rows: Int, cols: Int,
        occlusion: GridOcclusion = .none
    ) -> GridCamera {
        pinched(
            by: magnification, startCentroid: anchor, centroid: anchor,
            viewport: viewport, rows: rows, cols: cols, occlusion: occlusion)
    }

    /// Pinch, the Photos/Maps rule: the board point under the pinch's START
    /// centroid stays pinned under the LIVE centroid as scale changes. So a
    /// centroid that drifts mid-pinch pans the board with it, and the zoom
    /// anchors on the fingers. Scale and pan solve in one step off the frozen
    /// base (self), never as two gestures compounding against separate bases.
    /// `startCentroid` and `centroid` share one stable coordinate space; the
    /// solved offset is clamped so the board never flies offscreen at rest.
    ///
    /// The scale clamps FIRST, so the pin solves at the scale that will render.
    /// Pinch past the ceiling (or floor) with a still centroid and the camera is
    /// a fixed point: scale saturates and the offset holds, no drift injected by
    /// solving the pin for a scale the clamp then discards. Only real centroid
    /// drift pans.
    public func pinched(
        by magnification: CGFloat, startCentroid: CGPoint, centroid: CGPoint,
        viewport: CGSize, rows: Int, cols: Int, occlusion: GridOcclusion = .none
    ) -> GridCamera {
        guard magnification > 0, scale > 0 else { return self }
        // Clamp the scale before placing the pin: the anchor law must hold at the
        // scale that renders, not at the raw target the clamp would then pull back.
        let target = min(
            max(
                scale * magnification,
                Self.minScale(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion)),
            Self.maxScale)
        // The board point under the start centroid, in module units.
        let boardPoint = CGPoint(
            x: (startCentroid.x - offset.x) / scale,
            y: (startCentroid.y - offset.y) / scale)
        // Put that board point back under the live centroid at the clamped scale.
        let moved = GridCamera(
            scale: target,
            offset: CGPoint(
                x: centroid.x - boardPoint.x * target,
                y: centroid.y - boardPoint.y * target))
        // Bounds-clamp only: the scale is already inside its range, so this pins
        // the offset without touching the pin the scale would otherwise break.
        return moved.clamped(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion)
    }

    /// Drag: translate and clamp. Inert when the board already fits (clamping
    /// re-centers), so pan only bites when zoomed past fit.
    public func panned(
        by translation: CGSize, viewport: CGSize, rows: Int, cols: Int,
        occlusion: GridOcclusion = .none
    ) -> GridCamera {
        GridCamera(
            scale: scale,
            offset: CGPoint(x: offset.x + translation.width, y: offset.y + translation.height))
            .clamped(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion)
    }

    // MARK: Hit testing

    /// The cell under a viewport point, through this camera's transform; nil outside
    /// the board. Pure point-to-cell: blocks are the caller's rule (the view ignores
    /// taps on them), not geometry's.
    public func cell(at point: CGPoint, rows: Int, cols: Int) -> Int? {
        guard scale > 0 else { return nil }
        let col = Int(((point.x - offset.x) / scale / GridModule.unit).rounded(.down))
        let row = Int(((point.y - offset.y) / scale / GridModule.unit).rounded(.down))
        guard row >= 0, row < rows, col >= 0, col < cols else { return nil }
        return row * cols + col
    }

    // MARK: Follow

    /// Breathing room around a followed cell, in viewport points: enough that a
    /// landed cursor never kisses the viewport edge, small enough that the pan
    /// stays minimal.
    public static let followMarginPoints: CGFloat = 24

    /// The minimal pan that brings `cell` into the unobstructed window with
    /// `margin` breathing room (I2c camera follow: a jump that lands the cursor
    /// off-screen pans the least distance that shows it; a visible cursor moves
    /// nothing). Returns nil when no pan is needed or possible (the clamp already
    /// centers a fitting board), so callers animate only real movement. Scale
    /// never changes: follow is a pan, not a zoom.
    ///
    /// `occlusion` is the STANDING inset the clamp holds (constant under clue
    /// growth); `keepClear` is the LIVE cover the cell must escape (the wrapped
    /// bar plus feather; defaults to the standing inset). The final clamp rides
    /// the standing inset on purpose: a grown bar may pull the cell clear only
    /// as far as the standing pin allows, so clue length can never shove a
    /// bottom-pinned board around, only rescue the one selected cell (the
    /// full-bleed ruling, owner ask 2026-07-10).
    public func following(
        cell: Int, viewport: CGSize, rows: Int, cols: Int,
        margin: CGFloat = GridCamera.followMarginPoints,
        occlusion: GridOcclusion = .none,
        keepClear: GridOcclusion? = nil
    ) -> GridCamera? {
        guard cell >= 0, cell < rows * cols else { return nil }
        let rect = GridModule.cellRect(cell, cols: cols)
        return followed(
            span: rect, cursor: rect, viewport: viewport, rows: rows, cols: cols,
            margin: margin, occlusion: occlusion, keepClear: keepClear)
    }

    /// The minimal pan that brings the whole current WORD into the unobstructed
    /// window when it fits, and otherwise follows the cursor cell alone (owner
    /// 2026-07-12: advancing a clue should frame the word you are about to solve,
    /// not just its first cell). `word` is the run through the cursor
    /// (GridPuzzle.wordCells); its order does not matter, only its lowest and
    /// highest cell, since a word is a straight line.
    ///
    /// Whether to frame the word is decided per axis by whether the word fits the
    /// window, which depends on word length and zoom, NOT on the cursor. So while
    /// you type across a word the target holds still (a framed word does not move,
    /// and a word too wide to frame follows the cursor exactly as
    /// `following(cell:)` always has): no per-keystroke flip, no spasm. Reduces to
    /// `following(cell:)` on the cross axis (one cell thick) and for an empty word.
    /// Scale never changes: follow is a pan.
    public func following(
        word: some Sequence<Int>, cursor: Int, viewport: CGSize, rows: Int, cols: Int,
        margin: CGFloat = GridCamera.followMarginPoints,
        occlusion: GridOcclusion = .none,
        keepClear: GridOcclusion? = nil
    ) -> GridCamera? {
        guard cursor >= 0, cursor < rows * cols else { return nil }
        let count = rows * cols
        // A word is a contiguous run, so its bounding rect spans its lowest and
        // highest cell index; an empty word (a block or an out-of-range pick)
        // collapses the span onto the cursor and this becomes the cell follow.
        var lo = cursor, hi = cursor
        for c in word where c >= 0 && c < count {
            lo = min(lo, c)
            hi = max(hi, c)
        }
        let span = GridModule.cellRect(lo, cols: cols)
            .union(GridModule.cellRect(hi, cols: cols))
        return followed(
            span: span, cursor: GridModule.cellRect(cursor, cols: cols),
            viewport: viewport, rows: rows, cols: cols,
            margin: margin, occlusion: occlusion, keepClear: keepClear)
    }

    /// Shared follow solver: pan so `span` (a whole word) enters the window with
    /// `margin`, falling back per axis to `cursor` (the single cell) when the word
    /// is too wide for the window. The two rects coincide for the cell follow.
    /// `keepClear` is the live cover the cursor must escape (the larger cover per
    /// edge, so a keep-clear lagging the standing inset can never open a window the
    /// bars still cover); the final clamp rides the standing `occlusion`, so clue
    /// growth can only rescue the cursor, never shove a pinned board (the
    /// full-bleed ruling).
    private func followed(
        span: CGRect, cursor: CGRect, viewport: CGSize, rows: Int, cols: Int,
        margin: CGFloat, occlusion: GridOcclusion, keepClear: GridOcclusion?
    ) -> GridCamera? {
        let live = keepClear ?? occlusion
        let clear = GridOcclusion(
            top: max(live.top, occlusion.top), bottom: max(live.bottom, occlusion.bottom))
        let target = GridCamera(
            scale: scale,
            offset: CGPoint(
                x: Self.followedAxis(
                    offset.x,
                    spanMin: span.minX * scale, spanMax: span.maxX * scale,
                    cellMin: cursor.minX * scale, cellMax: cursor.maxX * scale,
                    viewport: viewport.width, margin: margin),
                y: Self.followedAxis(
                    offset.y,
                    spanMin: span.minY * scale, spanMax: span.maxY * scale,
                    cellMin: cursor.minY * scale, cellMax: cursor.maxY * scale,
                    viewport: viewport.height, margin: margin,
                    insetMin: clear.top, insetMax: clear.bottom)))
            .clamped(viewport: viewport, rows: rows, cols: cols, occlusion: occlusion)
        return target == self ? nil : target
    }

    /// Straight-line interpolation toward another camera, fraction clamped: the
    /// follow animator's step function (Canvas transforms cannot ride SwiftUI
    /// animation, so the glide is computed).
    public func interpolated(to other: GridCamera, fraction: CGFloat) -> GridCamera {
        let t = min(max(fraction, 0), 1)
        return GridCamera(
            scale: scale + (other.scale - scale) * t,
            offset: CGPoint(
                x: offset.x + (other.offset.x - offset.x) * t,
                y: offset.y + (other.offset.y - offset.y) * t))
    }

    /// One axis of the minimal pan: shift only as far as the near edge demands to
    /// reveal the target, which is the whole word (`spanMin`/`spanMax`) when it
    /// fits the window and the cursor cell (`cellMin`/`cellMax`) when the word is
    /// too wide to frame. All bounds are in scaled content points; the window is
    /// the viewport less the occluding chrome, and the margin collapses when the
    /// target is too wide to honor it.
    ///
    /// Choosing per-axis on FIT (word length and zoom), never on cursor position,
    /// is what keeps typing smooth: a framed word does not move as the cursor
    /// crosses it, and a too-wide word follows the cursor cell exactly as the
    /// single-cell follow always has. `span == cell` (the cell follow) is
    /// unchanged.
    private static func followedAxis(
        _ offset: CGFloat,
        spanMin: CGFloat, spanMax: CGFloat,
        cellMin: CGFloat, cellMax: CGFloat,
        viewport: CGFloat, margin: CGFloat,
        insetMin: CGFloat = 0, insetMax: CGFloat = 0
    ) -> CGFloat {
        let window = max(viewport - insetMin - insetMax, 0)
        // Frame the whole word only when it fits; otherwise the word cannot be
        // framed, so track the cursor cell (the original, smooth follow).
        let fitsWord = (spanMax - spanMin) <= window
        let targetMin = fitsWord ? spanMin : cellMin
        let targetMax = fitsWord ? spanMax : cellMax
        let inset = min(margin, max(0, (window - (targetMax - targetMin)) / 2))
        let visibleMin = targetMin + offset
        let visibleMax = targetMax + offset
        if visibleMin < insetMin + inset {
            return insetMin + inset - targetMin
        }
        if visibleMax > viewport - insetMax - inset {
            return viewport - insetMax - inset - targetMax
        }
        return offset
    }

    // MARK: Culling

    /// The rows and columns intersecting the viewport: the draw pass touches only
    /// these, so a zoomed 25x25 costs what is on screen, not 625 cells.
    public func visibleCells(viewport: CGSize, rows: Int, cols: Int) -> (rows: Range<Int>, cols: Range<Int>) {
        guard scale > 0 else { return (0..<0, 0..<0) }
        let unit = GridModule.unit * scale
        let firstCol = max(0, Int((-offset.x / unit).rounded(.down)))
        let firstRow = max(0, Int((-offset.y / unit).rounded(.down)))
        let lastCol = min(cols, Int(((viewport.width - offset.x) / unit).rounded(.up)))
        let lastRow = min(rows, Int(((viewport.height - offset.y) / unit).rounded(.up)))
        return (firstRow..<max(firstRow, lastRow), firstCol..<max(firstCol, lastCol))
    }
}
