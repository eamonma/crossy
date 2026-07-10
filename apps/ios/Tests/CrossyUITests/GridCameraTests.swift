import CoreGraphics
import XCTest

import CrossyDesign

@testable import CrossyUI

// The camera: zoom clamped between the glyph-legibility floor (TypeScale) and a
// comfortable ceiling, offsets clamped so the board never flies offscreen, hit
// testing as a pure point-to-cell function across any transform. A 25x25 is the
// ingestion cap the whole file is sized against (apps/ios/DESIGN.md §2).

final class GridCameraTests: XCTestCase {
    /// An iPhone-ish grid viewport.
    private let viewport = CGSize(width: 393, height: 560)

    func test_legibilityFloor_comesFromTypeScale() {
        // Glyphs are 24 module units; the floor scale is where they hit the
        // TypeScale floor in points, which puts the cell edge at 15 pt.
        let floor = GridCamera.legibilityFloorScale
        XCTAssertEqual(
            Double(floor * GridModule.glyphFontSize),
            TypeScale.gridGlyphLegibilityFloorPoints, accuracy: 0.0001)
        XCTAssertEqual(floor * GridModule.unit, 15, accuracy: 0.0001)
    }

    func test_minScale_floorGovernsWhenFitWouldBlur_25x25() {
        // A 25x25 on a narrow viewport: fit would take glyphs below the floor, so
        // the clamp holds the floor and the board pans instead of blurring.
        let narrow = CGSize(width: 320, height: 480)
        let fit = GridCamera.fitScale(viewport: narrow, rows: 25, cols: 25)
        XCTAssertLessThan(fit, GridCamera.legibilityFloorScale)
        XCTAssertEqual(
            GridCamera.minScale(viewport: narrow, rows: 25, cols: 25),
            GridCamera.legibilityFloorScale)
    }

    func test_minScale_fitGovernsWhenTheBoardFitsLegibly_15x15() {
        let fit = GridCamera.fitScale(viewport: viewport, rows: 15, cols: 15)
        XCTAssertGreaterThan(fit, GridCamera.legibilityFloorScale)
        XCTAssertEqual(GridCamera.minScale(viewport: viewport, rows: 15, cols: 15), fit)
    }

    func test_minScale_neverExceedsMaxScale_tinyBoard() {
        // A 2x2 board's fit scale is huge; the range must stay non-empty.
        XCTAssertEqual(
            GridCamera.minScale(viewport: viewport, rows: 2, cols: 2), GridCamera.maxScale)
    }

    func test_clamped_boundsScaleBothWays() {
        let low = GridCamera(scale: 0.01, offset: .zero)
            .clamped(viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(low.scale, GridCamera.minScale(viewport: viewport, rows: 25, cols: 25))
        let high = GridCamera(scale: 50, offset: .zero)
            .clamped(viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(high.scale, GridCamera.maxScale)
    }

    func test_clamped_centersAFittingAxisAndPinsAnOverflowingOne() {
        // A 12x12 at scale 1.2 (inside the clamp range) is 518.4 points square:
        // wider than the viewport, shorter than it. X pins to the edge, Y centers.
        let camera = GridCamera(scale: 1.2, offset: CGPoint(x: 999, y: -999))
            .clamped(viewport: viewport, rows: 12, cols: 12)
        XCTAssertEqual(camera.scale, 1.2)
        XCTAssertEqual(camera.offset.x, 0)
        XCTAssertEqual(camera.offset.y, (560 - 518.4) / 2, accuracy: 0.001)
    }

    func test_clamped_theBoardNeverFliesOffscreen() {
        // Zoomed past fit, offsets pin so no gap opens between board and viewport.
        let scale = GridCamera.maxScale
        let content = 25 * GridModule.unit * scale
        let tooFar = GridCamera(scale: scale, offset: CGPoint(x: 400, y: 700))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(tooFar.offset, .zero)
        let tooBack = GridCamera(scale: scale, offset: CGPoint(x: -99999, y: -99999))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(tooBack.offset.x, viewport.width - content, accuracy: 0.001)
        XCTAssertEqual(tooBack.offset.y, viewport.height - content, accuracy: 0.001)
    }

    func test_initial_opensAtTheClampCentered() {
        let camera = GridCamera.initial(viewport: viewport, rows: 15, cols: 15)
        XCTAssertEqual(camera.scale, GridCamera.fitScale(viewport: viewport, rows: 15, cols: 15))
        let content = 15 * GridModule.unit * camera.scale
        XCTAssertEqual(camera.offset.x, (viewport.width - content) / 2, accuracy: 0.001)
    }

    func test_zoomed_keepsTheAnchorPointFixed() {
        // Mid-range zoom on a 25x25, both axes overflowing before and after so no
        // clamp interferes: the board point under the anchor must stay under it.
        let start = GridCamera(scale: 1.0, offset: CGPoint(x: -200, y: -300))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(start.offset, CGPoint(x: -200, y: -300))
        let anchor = CGPoint(x: 200, y: 250)
        let boardPointBefore = CGPoint(
            x: (anchor.x - start.offset.x) / start.scale,
            y: (anchor.y - start.offset.y) / start.scale)
        let zoomed = start.zoomed(
            by: 1.5, anchor: anchor, viewport: viewport, rows: 25, cols: 25)
        let boardPointAfter = CGPoint(
            x: (anchor.x - zoomed.offset.x) / zoomed.scale,
            y: (anchor.y - zoomed.offset.y) / zoomed.scale)
        XCTAssertEqual(zoomed.scale, 1.5, accuracy: 0.001)
        XCTAssertEqual(boardPointAfter.x, boardPointBefore.x, accuracy: 0.01)
        XCTAssertEqual(boardPointAfter.y, boardPointBefore.y, accuracy: 0.01)
    }

    func test_zoomed_clampsAtTheLegibilityFloor() {
        let start = GridCamera.initial(viewport: viewport, rows: 25, cols: 25)
        let out = start.zoomed(
            by: 0.01, anchor: CGPoint(x: 100, y: 100),
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(out.scale, GridCamera.minScale(viewport: viewport, rows: 25, cols: 25))
    }

    func test_panned_translatesAndClamps() {
        let start = GridCamera(scale: GridCamera.maxScale, offset: .zero)
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let panned = start.panned(
            by: CGSize(width: -120, height: -60), viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(panned.offset, CGPoint(x: -120, y: -60))
        let pinned = start.panned(
            by: CGSize(width: 500, height: 500), viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(pinned.offset, .zero)
    }

    // Tap-to-place-cursor: pure point-to-cell across zoom and pan.
    func test_hitTest_identityTransform() {
        let camera = GridCamera(scale: 1, offset: .zero)
        XCTAssertEqual(camera.cell(at: CGPoint(x: 1, y: 1), rows: 5, cols: 5), 0)
        XCTAssertEqual(camera.cell(at: CGPoint(x: 37, y: 1), rows: 5, cols: 5), 1)
        XCTAssertEqual(camera.cell(at: CGPoint(x: 100, y: 100), rows: 5, cols: 5), 12)
    }

    func test_hitTest_acrossZoomAndPan() {
        let camera = GridCamera(scale: 2, offset: CGPoint(x: -72, y: -36))
        // Viewport (10, 10) maps to board units (41, 23): cell (row 0, col 1) = 1.
        XCTAssertEqual(camera.cell(at: CGPoint(x: 10, y: 10), rows: 5, cols: 5), 1)
        // Viewport (150, 150) maps to board units (111, 93): row 2, col 3 = 13.
        XCTAssertEqual(camera.cell(at: CGPoint(x: 150, y: 150), rows: 5, cols: 5), 13)
    }

    func test_hitTest_outsideTheBoardIsNil() {
        let camera = GridCamera(scale: 1, offset: .zero)
        XCTAssertNil(camera.cell(at: CGPoint(x: -1, y: 10), rows: 5, cols: 5))
        XCTAssertNil(camera.cell(at: CGPoint(x: 181, y: 10), rows: 5, cols: 5))
        XCTAssertNil(camera.cell(at: CGPoint(x: 10, y: 181), rows: 5, cols: 5))
    }

    func test_visibleCells_coversTheViewportAndOnlyThat() {
        // 25x25 at the floor scale (15 pt cells) shifted one cell into the board:
        // the window starts at row/col 1 and spans ceil(viewport / 15) + partials.
        let camera = GridCamera(scale: GridCamera.legibilityFloorScale, offset: CGPoint(x: -15, y: -15))
        let visible = camera.visibleCells(viewport: CGSize(width: 150, height: 90), rows: 25, cols: 25)
        XCTAssertEqual(visible.cols, 1..<11)
        XCTAssertEqual(visible.rows, 1..<7)
    }

    func test_visibleCells_clampsToTheBoard() {
        let camera = GridCamera(scale: 1, offset: .zero)
        let visible = camera.visibleCells(viewport: CGSize(width: 10000, height: 10000), rows: 5, cols: 5)
        XCTAssertEqual(visible.rows, 0..<5)
        XCTAssertEqual(visible.cols, 0..<5)
    }
}
