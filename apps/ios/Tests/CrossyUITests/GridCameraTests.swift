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

    // MARK: Pinch (the Photos/Maps anchor)

    /// The board point under a viewport point through a camera, in module units.
    private func boardPoint(_ camera: GridCamera, under viewportPoint: CGPoint) -> CGPoint {
        CGPoint(
            x: (viewportPoint.x - camera.offset.x) / camera.scale,
            y: (viewportPoint.y - camera.offset.y) / camera.scale)
    }

    func test_pinched_withoutDrift_matchesZoomedAboutTheAnchor() {
        // A pinch whose centroid never moves is the old fixed-anchor zoom: the
        // two entry points must agree, so `zoomed` can route through `pinched`.
        let start = GridCamera(scale: 1.0, offset: CGPoint(x: -200, y: -300))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let anchor = CGPoint(x: 200, y: 250)
        let viaZoomed = start.zoomed(
            by: 1.6, anchor: anchor, viewport: viewport, rows: 25, cols: 25)
        let viaPinched = start.pinched(
            by: 1.6, startCentroid: anchor, centroid: anchor,
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(viaPinched.scale, viaZoomed.scale, accuracy: 0.0001)
        XCTAssertEqual(viaPinched.offset.x, viaZoomed.offset.x, accuracy: 0.0001)
        XCTAssertEqual(viaPinched.offset.y, viaZoomed.offset.y, accuracy: 0.0001)
    }

    func test_pinched_startCentroidBoardPoint_landsUnderTheLiveCentroid() {
        // The core anchor law: the board point under the START centroid must sit
        // under the LIVE (drifted) centroid after the pinch, so a centroid that
        // wanders mid-pinch pans the content with it. Both axes overflow before
        // and after, so no clamp interferes.
        let start = GridCamera(scale: 1.0, offset: CGPoint(x: -220, y: -260))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let startCentroid = CGPoint(x: 180, y: 240)
        let liveCentroid = CGPoint(x: 240, y: 210)
        let anchoredBoardPoint = boardPoint(start, under: startCentroid)
        let pinched = start.pinched(
            by: 1.4, startCentroid: startCentroid, centroid: liveCentroid,
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(pinched.scale, 1.4, accuracy: 0.0001)
        // That same board point now sits under the live centroid.
        let landed = boardPoint(pinched, under: liveCentroid)
        XCTAssertEqual(landed.x, anchoredBoardPoint.x, accuracy: 0.01)
        XCTAssertEqual(landed.y, anchoredBoardPoint.y, accuracy: 0.01)
    }

    func test_pinched_pureCentroidDrift_pansWithoutScaling() {
        // Magnification 1 with a drifting centroid is a pure pan: the board point
        // under the start centroid moves to the live centroid, scale unchanged.
        // The board is deep-zoomed (content far larger than the viewport) and the
        // centroid drifts up-left, so the pan lands inside the clamp and the
        // offset moves by exactly the centroid's drift, no clamp interference.
        let start = GridCamera(scale: GridCamera.maxScale, offset: CGPoint(x: -400, y: -400))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let startCentroid = CGPoint(x: 260, y: 340)
        let liveCentroid = CGPoint(x: 200, y: 300)
        let pinned = boardPoint(start, under: startCentroid)
        let pinched = start.pinched(
            by: 1.0, startCentroid: startCentroid, centroid: liveCentroid,
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(pinched.scale, start.scale, accuracy: 0.0001)
        let landed = boardPoint(pinched, under: liveCentroid)
        XCTAssertEqual(landed.x, pinned.x, accuracy: 0.01)
        XCTAssertEqual(landed.y, pinned.y, accuracy: 0.01)
        // The offset moved by exactly the centroid's drift (-60, -40).
        XCTAssertEqual(pinched.offset.x, start.offset.x - 60, accuracy: 0.01)
        XCTAssertEqual(pinched.offset.y, start.offset.y - 40, accuracy: 0.01)
    }

    func test_pinched_atACorner_keepsThatCornerUnderTheCentroid() {
        // Zoom in with the centroid over the board's top-left corner: since
        // scaling in only grows the board, both axes stay overflowing, so the
        // corner's board point holds under the centroid with no clamp fighting it.
        let start = GridCamera(scale: 1.0, offset: .zero)
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let corner = CGPoint(x: 6, y: 6)
        let pinnedBefore = boardPoint(start, under: corner)
        let pinched = start.pinched(
            by: 1.8, startCentroid: corner, centroid: corner,
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(pinched.scale, 1.8, accuracy: 0.0001)
        let pinnedAfter = boardPoint(pinched, under: corner)
        XCTAssertEqual(pinnedAfter.x, pinnedBefore.x, accuracy: 0.01)
        XCTAssertEqual(pinnedAfter.y, pinnedBefore.y, accuracy: 0.01)
    }

    func test_pinched_clampsScaleFloorAndCeiling() {
        // The clamp still holds under the drift-aware pinch: pinching far out
        // floors at minScale, far in ceils at maxScale, whatever the centroids.
        let start = GridCamera.initial(viewport: viewport, rows: 25, cols: 25)
        let out = start.pinched(
            by: 0.01, startCentroid: CGPoint(x: 120, y: 90),
            centroid: CGPoint(x: 40, y: 300),
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(out.scale, GridCamera.minScale(viewport: viewport, rows: 25, cols: 25))
        let deepIn = GridCamera(scale: GridCamera.maxScale, offset: .zero)
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let over = deepIn.pinched(
            by: 100, startCentroid: CGPoint(x: 200, y: 300),
            centroid: CGPoint(x: 260, y: 260),
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(over.scale, GridCamera.maxScale)
    }

    func test_pinched_neverFliesTheBoardOffscreen_evenWithADriftingCentroid() {
        // A drift that would drag the board off its edge is caught by the clamp:
        // the offset never opens a gap between board and viewport at rest.
        let start = GridCamera(scale: GridCamera.maxScale, offset: .zero)
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let pinched = start.pinched(
            by: 1.0, startCentroid: CGPoint(x: 10, y: 10),
            centroid: CGPoint(x: 380, y: 540),
            viewport: viewport, rows: 25, cols: 25)
        // Pulling the top-left corner toward the bottom-right would expose the
        // board's top-left edge; the clamp pins the offset back to zero.
        XCTAssertEqual(pinched.offset, .zero)
    }

    func test_pinched_nonPositiveMagnificationIsInert() {
        let start = GridCamera(scale: 1.0, offset: CGPoint(x: -100, y: -120))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let out = start.pinched(
            by: 0, startCentroid: CGPoint(x: 100, y: 100), centroid: CGPoint(x: 150, y: 150),
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(out, start)
    }

    func test_pinched_atTheCeilingWithAStillCentroid_isAFixedPoint() {
        // The reported bug: at max zoom, pinching harder with the fingers still
        // must change nothing. Scale saturates at the ceiling and the offset holds,
        // however large the magnification grows, because the pin solves at the
        // scale that renders, not at the raw target the clamp would discard.
        let start = GridCamera(scale: GridCamera.maxScale, offset: CGPoint(x: -400, y: -400))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let centroid = CGPoint(x: 200, y: 300)
        for magnification in [CGFloat(1.5), 10, 1000] {
            let saturated = start.pinched(
                by: magnification, startCentroid: centroid, centroid: centroid,
                viewport: viewport, rows: 25, cols: 25)
            XCTAssertEqual(saturated.scale, GridCamera.maxScale)
            XCTAssertEqual(saturated.offset.x, start.offset.x, accuracy: 0.0001)
            XCTAssertEqual(saturated.offset.y, start.offset.y, accuracy: 0.0001)
        }
    }

    func test_pinched_atTheFloorWithAStillCentroid_isAFixedPoint() {
        // The mirror at the zoom-out floor: pinching further out with the fingers
        // still leaves the camera untouched, no offset shove from a scale the
        // clamp floors back up.
        let start = GridCamera.initial(viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(start.scale, GridCamera.minScale(viewport: viewport, rows: 25, cols: 25))
        let centroid = CGPoint(x: 180, y: 260)
        for magnification in [CGFloat(0.5), 0.01, 0.0001] {
            let saturated = start.pinched(
                by: magnification, startCentroid: centroid, centroid: centroid,
                viewport: viewport, rows: 25, cols: 25)
            XCTAssertEqual(saturated.scale, start.scale)
            XCTAssertEqual(saturated.offset.x, start.offset.x, accuracy: 0.0001)
            XCTAssertEqual(saturated.offset.y, start.offset.y, accuracy: 0.0001)
        }
    }

    func test_pinched_saturatedAtTheCeiling_stillPansByExactlyTheDrift() {
        // Saturation kills only false zoom-driven drift, never real panning: at
        // the ceiling, a centroid that moves pans the board by exactly its drift.
        let start = GridCamera(scale: GridCamera.maxScale, offset: CGPoint(x: -400, y: -400))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        let startCentroid = CGPoint(x: 260, y: 340)
        let liveCentroid = CGPoint(x: 200, y: 300)
        let pinned = boardPoint(start, under: startCentroid)
        let saturated = start.pinched(
            by: 100, startCentroid: startCentroid, centroid: liveCentroid,
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(saturated.scale, GridCamera.maxScale)
        // The anchored board point rides to the live centroid, scale held.
        let landed = boardPoint(saturated, under: liveCentroid)
        XCTAssertEqual(landed.x, pinned.x, accuracy: 0.01)
        XCTAssertEqual(landed.y, pinned.y, accuracy: 0.01)
        // The offset moved by exactly the centroid's drift (-60, -40), no more.
        XCTAssertEqual(saturated.offset.x, start.offset.x - 60, accuracy: 0.01)
        XCTAssertEqual(saturated.offset.y, start.offset.y - 40, accuracy: 0.01)
    }

    func test_pinched_crossingTheCeilingMidGesture_pinsAtTheMomentOfSaturation() {
        // A pinch that runs from below the ceiling to past it keeps the board point
        // under the still centroid pinned at the instant of saturation: no jump
        // between the frame just below the ceiling and the frames at it. Both axes
        // overflow throughout, so only the scale clamp is in play.
        let base = GridCamera(scale: GridCamera.maxScale * 0.8, offset: CGPoint(x: -400, y: -400))
            .clamped(viewport: viewport, rows: 25, cols: 25)
        XCTAssertLessThan(base.scale, GridCamera.maxScale)
        let centroid = CGPoint(x: 200, y: 300)
        let pinned = boardPoint(base, under: centroid)
        // Just below the ceiling (magnification 1.2 keeps 0.96 * maxScale).
        let below = base.pinched(
            by: 1.2, startCentroid: centroid, centroid: centroid,
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertLessThan(below.scale, GridCamera.maxScale)
        XCTAssertEqual(boardPoint(below, under: centroid).x, pinned.x, accuracy: 0.01)
        XCTAssertEqual(boardPoint(below, under: centroid).y, pinned.y, accuracy: 0.01)
        // Exactly at the ceiling, then past it: scale saturates and the same board
        // point stays under the centroid, so the crossing is seamless.
        let atCeiling = base.pinched(
            by: GridCamera.maxScale / base.scale, startCentroid: centroid, centroid: centroid,
            viewport: viewport, rows: 25, cols: 25)
        let pastCeiling = base.pinched(
            by: 5, startCentroid: centroid, centroid: centroid,
            viewport: viewport, rows: 25, cols: 25)
        XCTAssertEqual(atCeiling.scale, GridCamera.maxScale, accuracy: 0.0001)
        XCTAssertEqual(pastCeiling.scale, GridCamera.maxScale)
        XCTAssertEqual(atCeiling.offset.x, pastCeiling.offset.x, accuracy: 0.0001)
        XCTAssertEqual(atCeiling.offset.y, pastCeiling.offset.y, accuracy: 0.0001)
        XCTAssertEqual(boardPoint(pastCeiling, under: centroid).x, pinned.x, accuracy: 0.01)
        XCTAssertEqual(boardPoint(pastCeiling, under: centroid).y, pinned.y, accuracy: 0.01)
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
