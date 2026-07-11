import XCTest

@testable import CrossyUI

// The fingerprint derivation (EXPERIENCE.md §3 Rooms: the grid's geometry as a
// fingerprint). Pure math over (rows, cols, tile side): square cells at true
// aspect, centered, clamped to the ingestion cap. The Canvas view only reads this.

final class GeometryFingerprintTests: XCTestCase {
    func test_aSquareGridFillsTheTileExactly() {
        let layout = GeometryFingerprint(rows: 15, cols: 15).layout(fitting: 52)
        XCTAssertEqual(layout.cellSide, 52.0 / 15, accuracy: 1e-9)
        XCTAssertEqual(layout.width, 52, accuracy: 1e-9)
        XCTAssertEqual(layout.height, 52, accuracy: 1e-9)
        XCTAssertEqual(layout.originX, 0, accuracy: 1e-9)
        XCTAssertEqual(layout.originY, 0, accuracy: 1e-9)
    }

    func test_aWideGridKeepsSquareCellsAndCentersVertically() {
        // 11 rows by 21 cols: the cols span the tile, the rows center.
        let layout = GeometryFingerprint(rows: 11, cols: 21).layout(fitting: 42)
        let cell = 42.0 / 21
        XCTAssertEqual(layout.cellSide, cell, accuracy: 1e-9)
        XCTAssertEqual(layout.width, 42, accuracy: 1e-9)
        XCTAssertEqual(layout.height, cell * 11, accuracy: 1e-9)
        XCTAssertEqual(layout.originX, 0, accuracy: 1e-9)
        XCTAssertEqual(layout.originY, (42 - cell * 11) / 2, accuracy: 1e-9)
        XCTAssertGreaterThan(layout.originY, 0, "the shorter dimension floats centered")
    }

    func test_aTallGridCentersHorizontally() {
        let layout = GeometryFingerprint(rows: 21, cols: 11).layout(fitting: 42)
        XCTAssertEqual(layout.originY, 0, accuracy: 1e-9)
        XCTAssertEqual(layout.originX, (42 - layout.width) / 2, accuracy: 1e-9)
    }

    func test_theLatticeNeverEscapesTheTile() {
        for (rows, cols) in [(1, 1), (5, 5), (25, 25), (3, 25), (25, 3), (15, 16)] {
            let layout = GeometryFingerprint(rows: rows, cols: cols).layout(fitting: 52)
            XCTAssertGreaterThanOrEqual(layout.originX, -1e-9)
            XCTAssertGreaterThanOrEqual(layout.originY, -1e-9)
            XCTAssertLessThanOrEqual(layout.originX + layout.width, 52 + 1e-9)
            XCTAssertLessThanOrEqual(layout.originY + layout.height, 52 + 1e-9)
        }
    }

    func test_dimensionsClampToTheIngestionCapAndToOne() {
        // GET /games data is server-validated, but a clamp beats a degenerate
        // divide: past the 25x25 cap (PROTOCOL.md §12 OVERSIZE_GRID) and below 1.
        XCTAssertEqual(GeometryFingerprint(rows: 40, cols: 0).rows, 25)
        XCTAssertEqual(GeometryFingerprint(rows: 40, cols: 0).cols, 1)
        XCTAssertEqual(GeometryFingerprint(rows: -2, cols: 99).rows, 1)
        XCTAssertEqual(GeometryFingerprint(rows: -2, cols: 99).cols, 25)
    }

    func test_aNonPositiveTileCollapsesToTheZeroLayout() {
        let layout = GeometryFingerprint(rows: 5, cols: 5).layout(fitting: 0)
        XCTAssertEqual(layout.cellSide, 0)
        XCTAssertEqual(layout.width, 0)
        XCTAssertEqual(layout.height, 0)
    }
}
