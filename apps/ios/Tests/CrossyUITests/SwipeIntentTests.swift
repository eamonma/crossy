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

    // MARK: - Presets (root DESIGN §5: the swipe-sensitivity thresholds)

    private func classify(
        _ dx: CGFloat, _ dy: CGFloat, isAcross: Bool, tuning: SwipeTuning
    ) -> SwipeIntent? {
        SwipeClassifier.classify(
            translation: CGSize(width: dx, height: dy), isAcross: isAcross, tuning: tuning)
    }

    func test_relaxedPreset_biteAtItsOwnEdges_rootDesign5() {
        let t = SwipeTuning.relaxed
        XCTAssertEqual(t.minimumTravel, 16)
        XCTAssertEqual(t.dominanceRatio, 1.5)
        // At the travel floor with total dominance: classifies.
        XCTAssertEqual(classify(t.minimumTravel, 0, isAcross: true, tuning: t), .nextWord)
        // A 20pt flick the standard preset rejects clears the relaxed floor.
        XCTAssertNil(classify(20, 0, isAcross: true))
        XCTAssertEqual(classify(20, 0, isAcross: true, tuning: t), .nextWord)
        // Exactly at the (lower) dominance ratio: classifies.
        XCTAssertEqual(
            classify(t.minimumTravel * t.dominanceRatio, t.minimumTravel, isAcross: true, tuning: t),
            .nextWord)
        // Just inside the ratio: nothing.
        XCTAssertNil(
            classify(
                t.minimumTravel * t.dominanceRatio - 1, t.minimumTravel, isAcross: true, tuning: t))
    }

    func test_precisePreset_biteAtItsOwnEdges_rootDesign5() {
        let t = SwipeTuning.precise
        XCTAssertEqual(t.minimumTravel, 32)
        XCTAssertEqual(t.dominanceRatio, 2.5)
        // At the (higher) travel floor with total dominance: classifies.
        XCTAssertEqual(classify(t.minimumTravel, 0, isAcross: true, tuning: t), .nextWord)
        // A 24pt swipe the standard preset accepts is under the precise floor.
        XCTAssertEqual(classify(24, 0, isAcross: true), .nextWord)
        XCTAssertNil(classify(24, 0, isAcross: true, tuning: t))
        // Exactly at the (higher) dominance ratio: classifies.
        XCTAssertEqual(
            classify(t.minimumTravel * t.dominanceRatio, t.minimumTravel, isAcross: true, tuning: t),
            .nextWord)
        // A gesture the standard preset would accept as dominant enough is too
        // diagonal for precise: dx twice dy but not 2.5x.
        XCTAssertEqual(classify(80, 40, isAcross: true), .nextWord)
        XCTAssertNil(classify(80, 40, isAcross: true, tuning: t))
    }

    func test_sensitivityMapsToTuning_rootDesign5() {
        XCTAssertEqual(SwipeSensitivity.relaxed.tuning, .relaxed)
        XCTAssertEqual(SwipeSensitivity.standard.tuning, .standard)
        XCTAssertEqual(SwipeSensitivity.precise.tuning, .precise)
        // The standard preset carries the pre-preference thresholds verbatim, so the
        // default is bit-identical to the original classifier.
        XCTAssertEqual(SwipeSensitivity.standard.tuning.minimumTravel, 24)
        XCTAssertEqual(SwipeSensitivity.standard.tuning.dominanceRatio, 2)
    }

    // MARK: - Flick assist (root DESIGN §5: rescue the fast short flick)

    private func classifyFlick(
        _ dx: CGFloat, _ dy: CGFloat, predicted pdx: CGFloat, _ pdy: CGFloat,
        isAcross: Bool, tuning: SwipeTuning = .standard
    ) -> SwipeIntent? {
        SwipeClassifier.classify(
            translation: CGSize(width: dx, height: dy),
            predicted: CGSize(width: pdx, height: pdy),
            isAcross: isAcross, tuning: tuning)
    }

    func test_flickAssist_fastShortFlickClassifiesUnderStandard_rootDesign5() {
        // 18pt of real travel is under the standard 24pt floor, so the actual
        // translation alone means nothing.
        XCTAssertNil(classify(18, 0, isAcross: true))
        // A generous predicted end translation, capped to 2x the actual (36pt),
        // clears the floor: the fast flick turns the page.
        XCTAssertEqual(
            classifyFlick(18, 0, predicted: 72, 0, isAcross: true), .nextWord)
    }

    func test_flickAssist_twitchStaysNilUnderTheTwoXCap_rootDesign5() {
        // A 6pt twitch with a huge lift-off velocity: the raw predicted vector would
        // fire, but the 2x cap holds it to 12pt, under the standard floor, so it
        // stays nothing. This is the fix for the accidental turn.
        XCTAssertNil(classify(6, 0, isAcross: true))
        XCTAssertNil(classifyFlick(6, 0, predicted: 600, 0, isAcross: true))
    }

    func test_flickAssist_predictedIgnoredWhenActualClassifies_rootDesign5() {
        // The actual translation already reads as next word; a predicted vector
        // pointing across (which alone would toggle) is never consulted.
        XCTAssertEqual(
            classifyFlick(80, 4, predicted: 0, 999, isAcross: true), .nextWord)
    }

    func test_flickAssist_capPreservesDominance_soADiagonalFlickStaysNil_rootDesign5() {
        // The cap scales uniformly, so a too-diagonal predicted stays too diagonal:
        // scaling never rescues a gesture that carries no honest single intent.
        XCTAssertNil(classify(10, 8, isAcross: true))
        XCTAssertNil(classifyFlick(10, 8, predicted: 100, 80, isAcross: true))
    }
}
