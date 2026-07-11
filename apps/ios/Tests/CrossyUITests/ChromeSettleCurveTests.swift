import XCTest

@testable import CrossyDesign
@testable import CrossyUI

// The settle's curve (DESIGN.md §7: chrome moves on small springs, no overshoot;
// adopted for the hand-stepped walk after the owner's 2026-07-10 device finding
// that a cubic ease-out stops instead of settling). Pinned: the spring starts at
// rest, never overshoots, arrives monotonically, and terminates.

final class ChromeSettleCurveTests: XCTestCase {
    func test_curve_startsAtRestAndTerminatesAtOne() {
        XCTAssertEqual(ChromeSettleCurve.fraction(at: 0), 0)
        XCTAssertEqual(ChromeSettleCurve.fraction(at: -1), 0)
        // Well past the response the walk must report arrival exactly.
        XCTAssertEqual(ChromeSettleCurve.fraction(at: Motion.Springs.chromeResponse * 3), 1)
    }

    func test_curve_isMonotonicAndNeverOvershoots_designSection7() {
        var last = 0.0
        for step in 1...200 {
            let fraction = ChromeSettleCurve.fraction(at: Double(step) * 0.005)
            XCTAssertGreaterThanOrEqual(fraction, last)
            XCTAssertLessThanOrEqual(fraction, 1)
            last = fraction
        }
        XCTAssertEqual(last, 1)
    }

    func test_curve_movesLikeTheChromeSpring_notALinearRamp() {
        // Critically damped springs cover most of the travel early and spend the
        // tail settling: past 80% by the response's midpoint.
        let mid = ChromeSettleCurve.fraction(at: Motion.Springs.chromeResponse / 2)
        XCTAssertGreaterThan(mid, 0.8)
        XCTAssertLessThan(mid, 1)
    }
}
