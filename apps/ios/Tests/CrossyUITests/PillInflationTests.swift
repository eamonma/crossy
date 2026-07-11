import CoreGraphics
import XCTest

@testable import CrossyDesign
@testable import CrossyUI

// The pill-inflation prototype (owner ask 2026-07-11, gooey candidates for
// the tap-opened pill panels). The law is untouched: ChromeSettleCurve keeps
// its own tests (no overshoot, DESIGN.md §7), the melt never rides the new
// curve, and the default character is .clean. What is pinned here is the
// candidate itself: the underdamped curve breathes a HAIR past 1 (never a
// bounce-house), settles exactly, and terminates; and the unclamped blend it
// drives leaves anchored edges anchored.

final class PillInflationCurveTests: XCTestCase {
    func test_curve_startsAtRestAndTerminatesAtOne() {
        XCTAssertEqual(PillInflationCurve.fraction(at: 0), 0)
        XCTAssertEqual(PillInflationCurve.fraction(at: -1), 0)
        let late = Motion.Springs.chromeResponse * 3
        XCTAssertTrue(PillInflationCurve.isSettled(at: late))
        XCTAssertEqual(PillInflationCurve.fraction(at: late), 1)
    }

    // The whole point: unlike the settle curve, this one crosses 1.
    func test_curve_overshootsItsTarget() {
        var peak = 0.0
        for step in 1...400 {
            peak = max(peak, PillInflationCurve.fraction(at: Double(step) * 0.002))
        }
        XCTAssertGreaterThan(peak, 1.0)
    }

    // A hair, not a bounce: the peak stays within ~5% of the open frame
    // (overshoot is reserved for people and celebration, §7; this candidate
    // borrows the smallest audible amount and the owner rules on it).
    func test_overshootIsAHair_designSection7Tradeoff() {
        var peak = 0.0
        for step in 1...400 {
            peak = max(peak, PillInflationCurve.fraction(at: Double(step) * 0.002))
        }
        XCTAssertLessThan(peak, 1.05)
    }

    // Once settled the curve reports exactly 1 forever, so a walk stepping it
    // terminates and snaps its endpoint (the ChromeSettleCurve contract).
    func test_settlementIsTerminal() throws {
        var settledAt: Double?
        for step in 1...1000 {
            let t = Double(step) * 0.002
            if PillInflationCurve.isSettled(at: t) {
                settledAt = t
                break
            }
        }
        let settled = try XCTUnwrap(settledAt)
        for step in 0...100 {
            let t = settled + Double(step) * 0.01
            XCTAssertTrue(PillInflationCurve.isSettled(at: t))
            XCTAssertEqual(PillInflationCurve.fraction(at: t), 1)
        }
    }
}

final class GlassMorphUnclampedTests: XCTestCase {
    /// A share-card-shaped morph: top and trailing edges shared (the
    /// Mail-button rule), leading and bottom edges travel.
    private let inflation = GlassMorph(
        rest: CGRect(x: 243, y: 10, width: 44, height: 44),
        open: CGRect(x: 12, y: 10, width: 275, height: 397),
        restCornerRadius: 22,
        openCornerRadius: 24)

    // The unclamped blend's fixed points: anchored edges (rest == open) never
    // move, whatever the driving spring does, so an overshooting open never
    // detaches the panel from its pill's shared edges.
    func test_anchoredEdgesHoldUnderOvershoot() {
        let breathed = inflation.frameUnclamped(at: 1.04)
        XCTAssertEqual(breathed.minY, 10)
        XCTAssertEqual(breathed.maxX, 287)
    }

    // Traveling edges breathe past the open frame by the overshoot fraction
    // and nothing else: the surface grows a hair, then the walk settles it.
    func test_travelingEdgesBreathePastTheOpenFrame() {
        let breathed = inflation.frameUnclamped(at: 1.04)
        XCTAssertEqual(breathed.minX, 12 - (243 - 12) * 0.04, accuracy: 0.0001)
        XCTAssertEqual(breathed.maxY, 407 + (407 - 54) * 0.04, accuracy: 0.0001)
    }

    // At the endpoints the unclamped blend agrees with the law exactly.
    func test_endpointsAgreeWithTheClampedLaw_SPi1() {
        XCTAssertEqual(inflation.frameUnclamped(at: 0), inflation.frame(at: 0))
        XCTAssertEqual(inflation.frameUnclamped(at: 1), inflation.frame(at: 1))
        XCTAssertEqual(
            inflation.cornerRadiusUnclamped(at: 1), inflation.cornerRadius(at: 1))
    }

    // The law's own clamp is untouched: the drag-scrubbed path still pins to
    // its endpoints (the SP-i1 grammar the melt rides).
    func test_theClampedPathStillClamps_SPi1() {
        XCTAssertEqual(inflation.frame(at: 1.04), inflation.open)
        XCTAssertEqual(inflation.frame(at: -0.2), inflation.rest)
    }
}
