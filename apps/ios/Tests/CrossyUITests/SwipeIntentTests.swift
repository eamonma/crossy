import XCTest

@testable import CrossyUI

// The swipe classifier (root DESIGN §5: on touch, a swipe along the solving
// direction is Tab, and across it toggles). Pure geometry, so every mapping is a
// table check; whether a drag was a swipe at all (a drag that panned the camera is
// a pan) is the grid view's call and is out of scope here.

final class SwipeIntentTests: XCTestCase {
    private func classify(_ dx: CGFloat, _ dy: CGFloat, isAcross: Bool) -> SwipeIntent? {
        SwipeClassifier.classify(
            translation: CGSize(width: dx, height: dy), isAcross: isAcross)
    }

    func test_swipeAlongAcross_isNextPreviousWord_rootDesign5() {
        XCTAssertEqual(classify(80, 4, isAcross: true), .nextWord)
        XCTAssertEqual(classify(-80, -4, isAcross: true), .previousWord)
    }

    func test_swipeAcrossAcross_togglesDirection_rootDesign5() {
        XCTAssertEqual(classify(4, 80, isAcross: true), .toggleDirection)
        XCTAssertEqual(classify(-4, -80, isAcross: true), .toggleDirection)
    }

    func test_swipeAlongDown_isNextPreviousWord_rootDesign5() {
        XCTAssertEqual(classify(4, 80, isAcross: false), .nextWord)
        XCTAssertEqual(classify(-4, -80, isAcross: false), .previousWord)
    }

    func test_swipeAcrossDown_togglesDirection_rootDesign5() {
        XCTAssertEqual(classify(80, 4, isAcross: false), .toggleDirection)
        XCTAssertEqual(classify(-80, -4, isAcross: false), .toggleDirection)
    }

    func test_shortOrDiagonalDrags_classifyAsNothing() {
        // Below the travel floor on both axes.
        XCTAssertNil(classify(10, 2, isAcross: true))
        XCTAssertNil(classify(2, 10, isAcross: false))
        // Long but too diagonal to carry one honest intent.
        XCTAssertNil(classify(60, 50, isAcross: true))
        XCTAssertNil(classify(-50, 60, isAcross: false))
        // Dominant but under the travel floor.
        XCTAssertNil(classify(20, 2, isAcross: true))
    }

    func test_thresholdEdges_dominanceAndTravelBiteExactly() {
        let travel = SwipeClassifier.minimumTravel
        // Exactly at the travel floor with total dominance: classifies.
        XCTAssertEqual(classify(travel, 0, isAcross: true), .nextWord)
        // Exactly at the dominance ratio: classifies.
        XCTAssertEqual(
            classify(travel * 2, travel, isAcross: true), .nextWord)
        // Just inside the ratio: nothing.
        XCTAssertNil(classify(travel * 2 - 1, travel, isAcross: true))
    }
}
