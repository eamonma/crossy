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
