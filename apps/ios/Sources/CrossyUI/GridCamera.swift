// Pan and zoom over the module-unit board (apps/ios/DESIGN.md §2: grids up to the
// 25x25 ingestion cap render legibly; past comfortable glyph size the grid pans and
// zooms). The camera is two numbers, points-per-unit and a board origin, so every
// rule here is a pure function the tests can pin: the zoom-out clamp holds the
// glyph-legibility floor (TypeScale), the zoom-in clamp a comfortable ceiling, and
// offsets clamp so the board never flies offscreen.

import CoreGraphics
import CrossyDesign

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

    /// The scale at which the whole board fits the viewport.
    public static func fitScale(viewport: CGSize, rows: Int, cols: Int) -> CGFloat {
        let board = boardSize(rows: rows, cols: cols)
        guard board.width > 0, board.height > 0 else { return legibilityFloorScale }
        return min(viewport.width / board.width, viewport.height / board.height)
    }

    /// The zoom-out clamp: whole-board fit when that respects the legibility floor
    /// (no reason to shrink a fitting board further), else the floor itself (a 25x25
    /// on a narrow phone pans instead of blurring). Never above the zoom-in ceiling,
    /// which keeps the range non-empty for tiny boards whose fit exceeds it.
    public static func minScale(viewport: CGSize, rows: Int, cols: Int) -> CGFloat {
        min(maxScale, max(fitScale(viewport: viewport, rows: rows, cols: cols), legibilityFloorScale))
    }

    /// The opening camera: as much board as the clamps allow, centered.
    public static func initial(viewport: CGSize, rows: Int, cols: Int) -> GridCamera {
        GridCamera(scale: minScale(viewport: viewport, rows: rows, cols: cols), offset: .zero)
            .clamped(viewport: viewport, rows: rows, cols: cols)
    }

    // MARK: Clamping

    /// Scale into bounds; each axis then centers when the board is smaller than the
    /// viewport and otherwise pins so no gap opens between board edge and viewport
    /// edge. The board can never fly offscreen.
    public func clamped(viewport: CGSize, rows: Int, cols: Int) -> GridCamera {
        let bounded = min(
            max(scale, Self.minScale(viewport: viewport, rows: rows, cols: cols)),
            Self.maxScale)
        let board = Self.boardSize(rows: rows, cols: cols)
        let content = CGSize(width: board.width * bounded, height: board.height * bounded)
        return GridCamera(
            scale: bounded,
            offset: CGPoint(
                x: Self.clampedAxis(offset.x, content: content.width, viewport: viewport.width),
                y: Self.clampedAxis(offset.y, content: content.height, viewport: viewport.height)))
    }

    private static func clampedAxis(_ offset: CGFloat, content: CGFloat, viewport: CGFloat) -> CGFloat {
        if content <= viewport { return (viewport - content) / 2 }
        return min(0, max(viewport - content, offset))
    }

    // MARK: Gestures

    /// Pinch: rescale about a fixed viewport anchor (the board point under the
    /// fingers stays under them), then clamp.
    public func zoomed(
        by magnification: CGFloat, anchor: CGPoint, viewport: CGSize, rows: Int, cols: Int
    ) -> GridCamera {
        guard magnification > 0 else { return self }
        let target = scale * magnification
        let ratio = target / scale
        let moved = GridCamera(
            scale: target,
            offset: CGPoint(
                x: anchor.x - (anchor.x - offset.x) * ratio,
                y: anchor.y - (anchor.y - offset.y) * ratio))
        return moved.clamped(viewport: viewport, rows: rows, cols: cols)
    }

    /// Drag: translate and clamp. Inert when the board already fits (clamping
    /// re-centers), so pan only bites when zoomed past fit.
    public func panned(by translation: CGSize, viewport: CGSize, rows: Int, cols: Int) -> GridCamera {
        GridCamera(
            scale: scale,
            offset: CGPoint(x: offset.x + translation.width, y: offset.y + translation.height))
            .clamped(viewport: viewport, rows: rows, cols: cols)
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

    /// The minimal pan that brings `cell` fully on screen with `margin` breathing
    /// room (I2c camera follow: a jump that lands the cursor off-screen pans the
    /// least distance that shows it; a visible cursor moves nothing). Returns nil
    /// when no pan is needed or possible (the clamp already centers a fitting
    /// board), so callers animate only real movement. Scale never changes: follow
    /// is a pan, not a zoom.
    public func following(
        cell: Int, viewport: CGSize, rows: Int, cols: Int,
        margin: CGFloat = GridCamera.followMarginPoints
    ) -> GridCamera? {
        guard cell >= 0, cell < rows * cols else { return nil }
        let rect = GridModule.cellRect(cell, cols: cols)
        let target = GridCamera(
            scale: scale,
            offset: CGPoint(
                x: Self.followedAxis(
                    offset.x, cellMin: rect.minX * scale, cellMax: rect.maxX * scale,
                    viewport: viewport.width, margin: margin),
                y: Self.followedAxis(
                    offset.y, cellMin: rect.minY * scale, cellMax: rect.maxY * scale,
                    viewport: viewport.height, margin: margin)))
            .clamped(viewport: viewport, rows: rows, cols: cols)
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

    /// One axis of the minimal pan: shift only as far as the near edge demands.
    /// `cellMin`/`cellMax` are the cell's bounds in scaled content points; the
    /// margin collapses when the viewport is too small to honor it.
    private static func followedAxis(
        _ offset: CGFloat, cellMin: CGFloat, cellMax: CGFloat,
        viewport: CGFloat, margin: CGFloat
    ) -> CGFloat {
        let inset = min(margin, max(0, (viewport - (cellMax - cellMin)) / 2))
        let visibleMin = cellMin + offset
        let visibleMax = cellMax + offset
        if visibleMin < inset {
            return inset - cellMin
        }
        if visibleMax > viewport - inset {
            return viewport - inset - cellMax
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
