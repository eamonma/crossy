import CoreGraphics
import XCTest

@testable import CrossyUI

// The stats morph's geometry (apps/ios/DESIGN.md §4: the frozen clock inflates
// into the stats card, ID-2; owner ruling 2026-07-10 replacing the transitioned
// overlay). Pinned like the roster riders: the time at rest sits exactly on the
// bar clock, at open exactly in the headline slot, and the card's height is slot
// arithmetic, so the hand-off on both ends is exact by construction.

final class StatsRideLayoutTests: XCTestCase {
    /// A stats-shaped morph: rest is the bar clock's small frame; open is the
    /// card hanging under the room bar, at the no-detail height.
    private let morph = GlassMorph(
        rest: CGRect(x: 250, y: 24, width: 42, height: 16),
        open: CGRect(x: 26, y: 66, width: 340, height: 112),
        restCornerRadius: 8,
        openCornerRadius: 24)

    func test_panelHeight_isSlotArithmetic() {
        XCTAssertEqual(StatsRideLayout.panelHeight(hasDetail: false), 112)
        XCTAssertEqual(StatsRideLayout.panelHeight(hasDetail: true), 134)
    }

    func test_rider_atRest_sitsExactlyOnTheBarClock_ID2() {
        let center = StatsRideLayout.timeCenter(morph: morph, progress: 0)
        XCTAssertEqual(center.x, morph.rest.midX - morph.rest.minX, accuracy: 0.0001)
        XCTAssertEqual(center.y, morph.rest.midY - morph.rest.minY, accuracy: 0.0001)
    }

    func test_rider_atOpen_landsExactlyInTheHeadlineSlot_ID2() {
        let center = StatsRideLayout.timeCenter(morph: morph, progress: 1)
        XCTAssertEqual(center.x, morph.open.width / 2, accuracy: 0.0001)
        XCTAssertEqual(center.y, StatsRideLayout.timeCenterY(), accuracy: 0.0001)
        XCTAssertEqual(StatsRideLayout.timeCenterY(), 66)
    }

    func test_fontSize_walksBarClockToHeadline() {
        XCTAssertEqual(StatsRideLayout.fontSize(at: 0), 13)
        XCTAssertEqual(StatsRideLayout.fontSize(at: 1), 40)
        XCTAssertEqual(StatsRideLayout.fontSize(at: 0.5), 26.5)
    }

    func test_rider_midMorph_staysInsideTheInterpolatedSurface() {
        for progress in stride(from: CGFloat(0), through: 1, by: 0.1) {
            let frame = morph.frame(at: progress)
            let center = StatsRideLayout.timeCenter(morph: morph, progress: progress)
            XCTAssertTrue(center.x >= 0 && center.x <= frame.width)
            XCTAssertTrue(center.y >= 0 && center.y <= frame.height)
        }
    }
}
