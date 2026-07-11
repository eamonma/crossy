import XCTest

@testable import CrossyDesign

// Pins the two ground token sets against the apps/ios/DESIGN.md §5 tables (ID-6:
// one app, two grounds, no third identity).

final class GroundTests: XCTestCase {
    func test_studioTokens_matchDesignTable_ID6() {
        XCTAssertEqual(Ground.studio.canvas.rgb24, 0xF2F1EC)
        XCTAssertEqual(Ground.studio.cell.rgb24, 0xFFFFFF)
        XCTAssertEqual(Ground.studio.ink.rgb24, 0x1D1B18)
        XCTAssertEqual(Ground.studio.block.rgb24, 0x1B1A17)
        XCTAssertEqual(Ground.studio.gridLine.rgb24, 0xD9D6CD)
        XCTAssertEqual(Ground.studio.number.rgb24, 0x8B877D)
    }

    func test_observatoryTokens_matchDesignTable_ID6() {
        XCTAssertEqual(Ground.observatory.canvas.rgb24, 0x121118)
        XCTAssertEqual(Ground.observatory.cell.rgb24, 0x201F27)
        XCTAssertEqual(Ground.observatory.ink.rgb24, 0xEDEAE2)
        XCTAssertEqual(Ground.observatory.block.rgb24, 0x0A0910)
        XCTAssertEqual(Ground.observatory.gridLine.rgb24, 0x2C2B34)
        XCTAssertEqual(Ground.observatory.number.rgb24, 0x77747F)
    }

    // DESIGN.md §5: Observatory recesses blocks darker than the canvas; Studio
    // raises cells lighter than the canvas. Pins the relationships the prose
    // promises, not just the raw values.
    func test_groundRelationships_ID6() {
        XCTAssertLessThan(
            Ground.observatory.block.rgb24, Ground.observatory.canvas.rgb24,
            "Observatory blocks must recess darker than the canvas"
        )
        XCTAssertGreaterThan(
            Ground.studio.cell.rgb24, Ground.studio.canvas.rgb24,
            "Studio cells sit lighter than the bone canvas"
        )
    }
}
