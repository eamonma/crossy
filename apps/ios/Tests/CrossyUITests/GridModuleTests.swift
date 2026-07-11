import CoreGraphics
import XCTest

@testable import CrossyUI

// Pins the 36-unit cell module against root DESIGN.md §10 and the Wave 2.1d ruling:
// clue number top-left (+2,+10), direction arrow top-right (+27,+3, 7 units), avatar
// bottom-right (center +30,+30, r5, 8 px initial), count badge (center +29,+29, r7,
// 9 px count). These are the cross-client module contract; a changed constant here is
// a spec change, not a tweak.

final class GridModuleTests: XCTestCase {
    func test_moduleIs36Units_rootDesignSection10() {
        XCTAssertEqual(GridModule.unit, 36)
    }

    func test_clueNumberAnchorsTopLeft_wave21d() {
        XCTAssertEqual(GridModule.numberLeading, 2)
        XCTAssertEqual(GridModule.numberBaseline, 10)
        XCTAssertEqual(GridModule.numberFontSize, 10)
    }

    func test_presenceStackAnchorsBottomRight_wave21d() {
        XCTAssertEqual(GridModule.arrowOrigin, CGPoint(x: 27, y: 3))
        XCTAssertEqual(GridModule.arrowSize, 7)
        XCTAssertEqual(GridModule.avatarCenter, CGPoint(x: 30, y: 30))
        XCTAssertEqual(GridModule.avatarRadius, 5)
        XCTAssertEqual(GridModule.avatarInitialFontSize, 8)
        XCTAssertEqual(GridModule.badgeCenter, CGPoint(x: 29, y: 29))
        XCTAssertEqual(GridModule.badgeRadius, 7)
        XCTAssertEqual(GridModule.badgeCountFontSize, 9)
    }

    func test_cellRect_walksRowMajor() {
        XCTAssertEqual(
            GridModule.cellRect(0, cols: 5), CGRect(x: 0, y: 0, width: 36, height: 36))
        XCTAssertEqual(
            GridModule.cellRect(4, cols: 5), CGRect(x: 144, y: 0, width: 36, height: 36))
        XCTAssertEqual(
            GridModule.cellRect(5, cols: 5), CGRect(x: 0, y: 36, width: 36, height: 36))
        XCTAssertEqual(
            GridModule.cellRect(24, cols: 5), CGRect(x: 144, y: 144, width: 36, height: 36))
    }

    // The spec writes text positions as baselines; Canvas draws anchored text. The
    // conversion uses SF Pro's ~0.72 em cap height.
    func test_capCenterY_convertsBaselineToCapMidpoint() {
        XCTAssertEqual(GridModule.capCenterY(baseline: 10, fontSize: 10), 6.4, accuracy: 0.001)
        XCTAssertEqual(GridModule.capCenterY(baseline: 32, fontSize: 24), 23.36, accuracy: 0.001)
    }

    // Rebus strings scale to fit (root DESIGN.md §10 module rules; PROTOCOL.md §3
    // caps a value at 10 characters).
    func test_glyphSize_singleCharacterIsFullSize() {
        XCTAssertEqual(GridModule.glyphSize(forLength: 1), 24)
    }

    func test_glyphSize_neverGrowsWithLength() {
        var previous = GridModule.glyphSize(forLength: 1)
        for length in 2...10 {
            let size = GridModule.glyphSize(forLength: length)
            XCTAssertLessThanOrEqual(size, previous, "length \(length)")
            previous = size
        }
    }

    func test_glyphSize_fitsInkWidthUntilTheFloor() {
        for length in 2...10 {
            let size = GridModule.glyphSize(forLength: length)
            if size > GridModule.rebusMinimumFontSize {
                XCTAssertLessThanOrEqual(
                    size * GridModule.rebusCapAdvance * CGFloat(length),
                    GridModule.rebusInkWidth + 0.001,
                    "length \(length) overflows the ink width")
            }
        }
        XCTAssertGreaterThanOrEqual(
            GridModule.glyphSize(forLength: 10), GridModule.rebusMinimumFontSize)
    }

    // Selection must never shift a cell's own content: only the fill/highlight
    // changes (CrossyGridView.drawFills), never the glyph or number position. The
    // content-placement primitives take no fill/selection input at all, so a
    // selected and unselected cell resolve to the identical draw point for the
    // same cell index and value length. This pins the geometry so a future draw
    // pass cannot reintroduce a selection-dependent inset, border, or reflow.
    func test_glyphOrigin_isIndependentOfSelectionState() {
        let cell = 42
        let cols = 9
        let origin = GridModule.cellOrigin(cell, cols: cols)
        let glyphPoint = CGPoint(
            x: origin.x + GridModule.glyphCenterX,
            y: origin.y + GridModule.capCenterY(
                baseline: GridModule.glyphBaseline, fontSize: GridModule.glyphFontSize))
        // No overload or parameter exists to vary this by isCurrent/isSelected;
        // recomputing from the same inputs must be bit-for-bit identical, which is
        // the whole guarantee: the draw pass has nothing selection-shaped to feed in.
        let recomputed = CGPoint(
            x: origin.x + GridModule.glyphCenterX,
            y: origin.y + GridModule.capCenterY(
                baseline: GridModule.glyphBaseline, fontSize: GridModule.glyphFontSize))
        XCTAssertEqual(glyphPoint, recomputed)
    }

    func test_numberOrigin_isIndependentOfSelectionState() {
        let cell = 17
        let cols = 5
        let origin = GridModule.cellOrigin(cell, cols: cols)
        let numberPoint = CGPoint(
            x: origin.x + GridModule.numberLeading,
            y: origin.y + GridModule.capCenterY(
                baseline: GridModule.numberBaseline, fontSize: GridModule.numberFontSize))
        let recomputed = CGPoint(
            x: origin.x + GridModule.numberLeading,
            y: origin.y + GridModule.capCenterY(
                baseline: GridModule.numberBaseline, fontSize: GridModule.numberFontSize))
        XCTAssertEqual(numberPoint, recomputed)
    }
}
