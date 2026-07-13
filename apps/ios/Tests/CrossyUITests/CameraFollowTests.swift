import CoreGraphics
import XCTest

@testable import CrossyUI

// Camera follow (I2c): a jump that lands the cursor off-screen (a clue-browser
// tap, a Tab past the viewport edge) pans the MINIMAL distance that shows the
// cell with breathing room; a visible cursor moves nothing. The target math is
// pure; the glide is the view's hand-stepped interpolation over
// `interpolated(to:fraction:)`.

final class CameraFollowTests: XCTestCase {
    private let viewport = CGSize(width: 393, height: 560)
    private let rows = 25
    private let cols = 25

    /// Scale 1: a 25x25 board is 900x900 points, well past the viewport.
    private var camera: GridCamera {
        GridCamera(scale: 1, offset: .zero)
            .clamped(viewport: viewport, rows: rows, cols: cols)
    }

    func test_visibleCellNeedsNoPan() {
        // Cell (2, 2) sits at 72..108 on both axes: inside the margin-inset
        // viewport, so follow returns nil and the caller animates nothing.
        XCTAssertNil(
            camera.following(cell: 2 * cols + 2, viewport: viewport, rows: rows, cols: cols))
    }

    func test_offscreenRight_pansTheMinimalDistance() {
        // Cell (12, 20): x 720..756, far past the 393-point viewport; y 432..468,
        // already visible. Only x moves, and exactly far enough that the cell's
        // right edge sits one margin inside the viewport.
        let target = camera.following(
            cell: 12 * cols + 20, viewport: viewport, rows: rows, cols: cols)
        XCTAssertNotNil(target)
        XCTAssertEqual(target!.offset.x, viewport.width - GridCamera.followMarginPoints - 756)
        XCTAssertEqual(target!.offset.y, 0)
        XCTAssertEqual(target!.scale, 1, "follow is a pan, never a zoom")
    }

    func test_offscreenBelow_pansOnlyTheVerticalAxis() {
        // Cell (20, 3): y 720..756 past the 560-point viewport; x visible.
        let target = camera.following(
            cell: 20 * cols + 3, viewport: viewport, rows: rows, cols: cols)
        XCTAssertNotNil(target)
        XCTAssertEqual(target!.offset.x, 0)
        XCTAssertEqual(target!.offset.y, viewport.height - GridCamera.followMarginPoints - 756)
    }

    func test_cornerCell_staysInsideTheBoardClamp() {
        // The last cell: the pan lands on the clamp's edge, never past it (the
        // board cannot fly offscreen chasing a margin).
        let target = camera.following(
            cell: rows * cols - 1, viewport: viewport, rows: rows, cols: cols)
        XCTAssertNotNil(target)
        XCTAssertEqual(target!.offset.x, viewport.width - 900)
        XCTAssertEqual(target!.offset.y, viewport.height - 900)
    }

    func test_edgeCellUnderThePin_needsNoPanBecauseTheClampHoldsIt() {
        // Cell (0, 0) at offset zero misses its top-left margin, but the clamp
        // pins the board edge to the viewport edge: there is nowhere to pan, so
        // follow reports no-op rather than an equal camera.
        XCTAssertNil(camera.following(cell: 0, viewport: viewport, rows: rows, cols: cols))
    }

    func test_fittingBoard_neverPans() {
        // A 9x9 fits the viewport at its clamped scale; the clamp centers it and
        // every cell is visible.
        let small = GridCamera.initial(viewport: viewport, rows: 9, cols: 9)
        for cell in [0, 40, 80] {
            XCTAssertNil(small.following(cell: cell, viewport: viewport, rows: 9, cols: 9))
        }
    }

    // MARK: Word follow

    // Advancing to a clue frames the whole WORD, not just the landed cell (owner
    // 2026-07-12). `cursor` is the guarantee that never leaves the window; `word`
    // is the reach. A word wider than the zoomed window keeps the cursor on
    // screen and lets the word bleed past the far edge.

    func test_wordFullyVisible_needsNoPan() {
        // Across word row 5, cols 2..5 (cells 127..130): rect x 72..216, y
        // 180..216, comfortably inside the margins, so nothing moves.
        let word: Set<Int> = [127, 128, 129, 130]
        XCTAssertNil(
            camera.following(
                word: word, cursor: 127, viewport: viewport, rows: rows, cols: cols))
    }

    func test_acrossWordOffscreenRight_revealsTheWholeWord_notJustTheCursor() {
        // Across word row 5, cols 18..22 (cells 143..147): rect x 648..828, y
        // visible. The word (180 pt) fits the 393 pt window, so follow pans until
        // its far edge sits one margin inside: the whole word shows.
        let word: Set<Int> = [143, 144, 145, 146, 147]
        let target = camera.following(
            word: word, cursor: 143, viewport: viewport, rows: rows, cols: cols)
        XCTAssertNotNil(target)
        XCTAssertEqual(target!.offset.x, viewport.width - GridCamera.followMarginPoints - 828)
        XCTAssertEqual(target!.offset.y, 0)
        XCTAssertEqual(target!.scale, 1, "follow is a pan, never a zoom")
        // Contrast: single-cell follow stops at the cursor's own right edge (684),
        // leaving the rest of the word clipped off the right of the viewport.
        let cellOnly = camera.following(
            cell: 143, viewport: viewport, rows: rows, cols: cols)
        XCTAssertEqual(
            cellOnly!.offset.x, viewport.width - GridCamera.followMarginPoints - 684)
    }

    func test_downWordOffscreenBelow_pansOnlyVerticalToRevealTheWord() {
        // Down word col 3, rows 18..22 (cells 453,478,503,528,553): rect y
        // 648..828, x visible. The cross axis is one cell thick, so x holds.
        let word: Set<Int> = [453, 478, 503, 528, 553]
        let target = camera.following(
            word: word, cursor: 453, viewport: viewport, rows: rows, cols: cols)
        XCTAssertNotNil(target)
        XCTAssertEqual(target!.offset.x, 0, "the cross axis is a single cell")
        XCTAssertEqual(
            target!.offset.y, viewport.height - GridCamera.followMarginPoints - 828)
    }

    func test_wordWiderThanWindow_fallsBackToTheSmoothCursorFollow() {
        // Zoomed to the ceiling (72 pt cells), the full top row (cells 0..24) is
        // 1800 pt wide, far past the 393 pt window. A word that cannot be framed
        // must NOT try to: it follows the cursor cell exactly as the single-cell
        // follow does, so typing across it stays smooth (no per-keystroke flip).
        let zoomed = GridCamera(scale: GridCamera.maxScale, offset: .zero)
            .clamped(viewport: viewport, rows: rows, cols: cols)
        let word = Set(0..<cols)
        for cursor in [0, 5, 10, 18, 24] {
            XCTAssertEqual(
                zoomed.following(
                    word: word, cursor: cursor, viewport: viewport, rows: rows, cols: cols),
                zoomed.following(
                    cell: cursor, viewport: viewport, rows: rows, cols: cols),
                "a too-wide word follows the cursor cell, unchanged, at cursor \(cursor)")
        }
    }

    func test_typingAcrossAFramedWord_holdsTheCameraStill() {
        // The anti-spasm guarantee: once a word that fits is framed, advancing the
        // cursor through it returns nil (the target tracks the word, not the
        // cursor), so the camera does not move keystroke to keystroke.
        let word: Set<Int> = [143, 144, 145, 146, 147]
        let framed = camera.following(
            word: word, cursor: 143, viewport: viewport, rows: rows, cols: cols)!
        for cursor in word {
            XCTAssertNil(
                framed.following(
                    word: word, cursor: cursor, viewport: viewport, rows: rows, cols: cols),
                "a framed word holds still as the cursor crosses it (cursor \(cursor))")
        }
    }

    func test_emptyWord_fallsBackToTheCursorCell() {
        // An empty span (a defensive fallback) collapses to the single-cell follow.
        let byWord = camera.following(
            word: Set<Int>(), cursor: 12 * cols + 20,
            viewport: viewport, rows: rows, cols: cols)
        let byCell = camera.following(
            cell: 12 * cols + 20, viewport: viewport, rows: rows, cols: cols)
        XCTAssertEqual(byWord, byCell)
    }

    func test_interpolated_walksEndpointToEndpointClamped() {
        let start = GridCamera(scale: 1, offset: .zero)
        let end = GridCamera(scale: 1, offset: CGPoint(x: -100, y: 40))
        XCTAssertEqual(start.interpolated(to: end, fraction: 0), start)
        XCTAssertEqual(start.interpolated(to: end, fraction: 1), end)
        let mid = start.interpolated(to: end, fraction: 0.5)
        XCTAssertEqual(mid.offset.x, -50)
        XCTAssertEqual(mid.offset.y, 20)
        XCTAssertEqual(start.interpolated(to: end, fraction: 2), end, "fraction clamps")
    }
}
