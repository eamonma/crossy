import CoreGraphics
import XCTest

@testable import CrossyUI

// The roster riders' geometry (apps/ios/DESIGN.md §4: content rides the morph;
// the pucks are the continuity carriers, adopted after the owner's 2026-07-10
// device finding that the panel inflated hollow and rendered its people twice).
// These pin the endpoints: a rider at rest sits exactly on its bar puck, a rider
// at open sits exactly in its row's puck slot, and the diameter walks cluster to
// row size, so the hand-off on both ends is pixel-exact by construction.

final class RosterRideLayoutTests: XCTestCase {
    /// A roster-shaped morph: rest is a puck cluster on the room bar's trailing
    /// edge; open is a panel hanging beneath it, sized to four rows
    /// (4 x 44 + 2 x 10, the SolveScreen sizing rule over these same constants).
    private let morph = GlassMorph(
        rest: CGRect(x: 300, y: 20, width: 70, height: 24),
        open: CGRect(x: 73, y: 66, width: 320, height: 196),
        restCornerRadius: 12,
        openCornerRadius: 24)

    func test_rider_atRest_sitsExactlyOnItsBarPuck() {
        let rest = CGPoint(x: 312, y: 32)
        let center = RosterRideLayout.center(
            rest: rest, openLocal: RosterRideLayout.openCenter(rowIndex: 0),
            morph: morph, progress: 0)
        // Panel-local at progress 0 is room-space minus the rest frame's origin.
        XCTAssertEqual(center.x, rest.x - morph.rest.minX, accuracy: 0.0001)
        XCTAssertEqual(center.y, rest.y - morph.rest.minY, accuracy: 0.0001)
    }

    func test_rider_atOpen_landsExactlyInItsRowSlot() {
        for row in 0..<4 {
            let openLocal = RosterRideLayout.openCenter(rowIndex: row)
            let center = RosterRideLayout.center(
                rest: CGPoint(x: 312, y: 32), openLocal: openLocal,
                morph: morph, progress: 1)
            XCTAssertEqual(center.x, openLocal.x, accuracy: 0.0001)
            XCTAssertEqual(center.y, openLocal.y, accuracy: 0.0001)
        }
    }

    func test_openCenter_isTheRowsPuckSlot() {
        // Row layout: vertical padding, then 44 pt rows with a leading 26 pt puck
        // inset 16 (the memberRow constants, shared through RosterRideLayout).
        XCTAssertEqual(RosterRideLayout.openCenter(rowIndex: 0), CGPoint(x: 29, y: 32))
        XCTAssertEqual(RosterRideLayout.openCenter(rowIndex: 2), CGPoint(x: 29, y: 120))
    }

    func test_diameter_walksClusterToRowSize() {
        XCTAssertEqual(RosterRideLayout.diameter(at: 0), 24)
        XCTAssertEqual(RosterRideLayout.diameter(at: 1), 26)
        XCTAssertEqual(RosterRideLayout.diameter(at: 0.5), 25)
    }

    func test_rider_midMorph_staysInsideTheInterpolatedSurface() {
        // Convexity: both endpoints sit inside their frames, so every lerped
        // center sits inside the lerped frame and the clip never cuts a rider.
        let rest = CGPoint(x: 312, y: 32)
        for progress in stride(from: CGFloat(0), through: 1, by: 0.1) {
            let frame = morph.frame(at: progress)
            let center = RosterRideLayout.center(
                rest: rest, openLocal: RosterRideLayout.openCenter(rowIndex: 3),
                morph: morph, progress: progress)
            XCTAssertTrue(center.x >= 0 && center.x <= frame.width)
            XCTAssertTrue(center.y >= 0 && center.y <= frame.height)
        }
    }
}
