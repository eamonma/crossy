import XCTest

@testable import CrossyDesign

// Pins the type constants (apps/ios/DESIGN.md §6) and the motion grammar values
// (§7) so a tuning change is a reviewed diff, never a drive-by.

final class TypeScaleTests: XCTestCase {
    // DESIGN.md §6: weight 600 on the light ground, 500 on the dark (dark grounds
    // fatten type).
    func test_gridGlyphWeights_matchDesign6() {
        XCTAssertEqual(TypeScale.gridGlyphWeightLightGround, 600)
        XCTAssertEqual(TypeScale.gridGlyphWeightDarkGround, 500)
    }

    // DESIGN.md §6: the shared clock never jitters in width.
    func test_tabularNumeralsRequired_design6() {
        XCTAssertTrue(TypeScale.numericChromeRequiresTabularNumerals)
    }
}

final class MotionTests: XCTestCase {
    // PROTOCOL.md §8 / DESIGN.md §7: the flash is roughly 300 ms, sharp attack,
    // long decay; attack and decay partition the envelope.
    func test_flashEnvelope_protocol8() {
        XCTAssertEqual(Motion.Flash.duration, 0.300, accuracy: 0.0001)
        XCTAssertEqual(
            Motion.Flash.attackDuration + Motion.Flash.decayDuration,
            Motion.Flash.duration,
            accuracy: 0.0001
        )
        XCTAssertLessThan(
            Motion.Flash.attackDuration, Motion.Flash.decayDuration,
            "sharp attack, long decay: the attack must be the short side"
        )
    }

    // Bezier control points stay in the unit square so any curve consumer is safe.
    func test_flashDecayControlPoints_areUnitSquare() {
        for point in [Motion.Flash.decayControlPoint1, Motion.Flash.decayControlPoint2] {
            XCTAssertTrue((0.0...1.0).contains(point.x))
            XCTAssertTrue((0.0...1.0).contains(point.y))
        }
    }

    // DESIGN.md §7: standing chrome uses small springs with no overshoot; damping
    // fraction >= 1 is the no-overshoot guarantee. Overshoot is reserved for
    // people and celebration.
    func test_springGrammar_noChromeOvershoot_design7() {
        XCTAssertGreaterThanOrEqual(Motion.Springs.chromeDampingFraction, 1.0)
        XCTAssertLessThan(
            Motion.Springs.celebrationDampingFraction, 1.0,
            "celebration springs are the only ones allowed to overshoot"
        )
        XCTAssertGreaterThan(Motion.Springs.chromeResponse, 0)
        XCTAssertGreaterThan(Motion.Springs.celebrationResponse, 0)
    }
}
