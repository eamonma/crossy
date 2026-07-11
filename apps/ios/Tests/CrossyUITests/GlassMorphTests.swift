import CoreGraphics
import XCTest

@testable import CrossyUI

// The melt's math (apps/ios/DESIGN.md §4 morph grammar as pinned by SP-i1): one
// persistent surface whose frame and corner radius are pure functions of gesture
// progress. These tests pin the interpolation, the finger mapping (1:1 against the
// top edge's travel), the release rule (threshold plus flick), and the content
// fade, so the gesture site carries no arithmetic of its own.

final class GlassMorphTests: XCTestCase {
    /// A clue-bar-shaped morph: bottom edge anchored, top edge travels 400 points.
    private let melt = GlassMorph(
        rest: CGRect(x: 12, y: 500, width: 369, height: 52),
        open: CGRect(x: 12, y: 100, width: 369, height: 452),
        restCornerRadius: 26,
        openCornerRadius: 24)

    func test_frame_endpointsAreExact_spI1SingleSurface() {
        XCTAssertEqual(melt.frame(at: 0), melt.rest)
        XCTAssertEqual(melt.frame(at: 1), melt.open)
    }

    func test_frame_midpointInterpolatesEveryEdge() {
        let mid = melt.frame(at: 0.5)
        XCTAssertEqual(mid.minY, 300)
        // The bottom edge is anchored (rest and open share maxY), so it holds.
        XCTAssertEqual(mid.maxY, 552)
        XCTAssertEqual(mid.minX, 12)
        XCTAssertEqual(mid.width, 369)
    }

    func test_frame_progressClampsAtTheEndpoints() {
        XCTAssertEqual(melt.frame(at: -1), melt.rest)
        XCTAssertEqual(melt.frame(at: 2), melt.open)
    }

    func test_cornerRadius_interpolatesCapsuleToPanel() {
        XCTAssertEqual(melt.cornerRadius(at: 0), 26)
        XCTAssertEqual(melt.cornerRadius(at: 0.5), 25)
        XCTAssertEqual(melt.cornerRadius(at: 1), 24)
    }

    func test_fingerMapping_isOneToOneAgainstTopEdgeTravel_spI1Discipline() {
        XCTAssertEqual(melt.topEdgeTravel, 400)
        // 200 points of upward drag over 400 of travel is exactly half open.
        XCTAssertEqual(melt.progress(draggedBy: -200, from: 0), 0.5)
        // From open, 100 points down closes a quarter.
        XCTAssertEqual(melt.progress(draggedBy: 100, from: 1), 0.75)
        XCTAssertEqual(melt.progress(draggedBy: -900, from: 0), 1)
        XCTAssertEqual(melt.progress(draggedBy: 900, from: 1), 0)
    }

    func test_fingerMapping_zeroTravelHoldsBase() {
        let degenerate = GlassMorph(
            rest: CGRect(x: 0, y: 100, width: 10, height: 10),
            open: CGRect(x: 0, y: 100, width: 10, height: 10),
            restCornerRadius: 5, openCornerRadius: 5)
        XCTAssertEqual(degenerate.progress(draggedBy: -50, from: 0.4), 0.4)
    }

    func test_settle_thresholdDecidesAStillRelease() {
        XCTAssertFalse(GlassSettle.settlesOpen(progress: 0.49, upwardVelocity: 0))
        XCTAssertTrue(GlassSettle.settlesOpen(progress: 0.5, upwardVelocity: 0))
    }

    func test_settle_flickBeatsPosition() {
        // A fast upward release opens from low progress; a fast downward one
        // pours back from high (the pour back, SP-i5's best moment).
        XCTAssertTrue(GlassSettle.settlesOpen(progress: 0.1, upwardVelocity: 400))
        XCTAssertFalse(GlassSettle.settlesOpen(progress: 0.9, upwardVelocity: -400))
        // Below the flick bar, position rules again.
        XCTAssertFalse(GlassSettle.settlesOpen(progress: 0.1, upwardVelocity: 349))
        XCTAssertTrue(GlassSettle.settlesOpen(progress: 0.9, upwardVelocity: -349))
    }

    func test_listOpacity_fadesInLateAndClamps() {
        XCTAssertEqual(GlassMorphContent.listOpacity(at: 0), 0)
        XCTAssertEqual(GlassMorphContent.listOpacity(at: GlassMorphContent.listFadeStart), 0)
        XCTAssertEqual(GlassMorphContent.listOpacity(at: 1), 1)
        let mid = GlassMorphContent.listOpacity(at: (GlassMorphContent.listFadeStart + 1) / 2)
        XCTAssertEqual(mid, 0.5, accuracy: 0.0001)
    }

    // MARK: Swipe-down dismissal (owner ask 2026-07-10, the sheet grammar)

    /// The open panel's header ends here (open.minY 100 plus the 52 rest row).
    private let headerMaxY: CGFloat = 152

    func test_panelDismiss_takesADownwardDragOnTheListAtItsTop() {
        XCTAssertTrue(
            PanelDismiss.takes(
                progress: 1, startY: 300, headerMaxY: headerMaxY,
                listAtTop: true, translation: CGSize(width: 2, height: 20)))
    }

    func test_panelDismiss_yieldsToTheScrollingList() {
        // The list away from its top owns the drag: sheets scroll before they
        // dismiss.
        XCTAssertFalse(
            PanelDismiss.takes(
                progress: 1, startY: 300, headerMaxY: headerMaxY,
                listAtTop: false, translation: CGSize(width: 0, height: 40)))
    }

    func test_panelDismiss_yieldsToThePinnedRowsOwnDrag() {
        // A touch on the header belongs to the row's bidirectional drag; the
        // takeover rule stands down there.
        XCTAssertFalse(
            PanelDismiss.takes(
                progress: 1, startY: 140, headerMaxY: headerMaxY,
                listAtTop: true, translation: CGSize(width: 0, height: 40)))
    }

    func test_panelDismiss_onlyAFullyOpenPanelDismissesThisWay() {
        // Mid-settle the surface belongs to the row's drag (SP-i1: a finger
        // catching a settle owns progress from the row).
        XCTAssertFalse(
            PanelDismiss.takes(
                progress: 0.8, startY: 300, headerMaxY: headerMaxY,
                listAtTop: true, translation: CGSize(width: 0, height: 40)))
    }

    func test_panelDismiss_upwardOrSidewaysNeverTakes() {
        XCTAssertFalse(
            PanelDismiss.takes(
                progress: 1, startY: 300, headerMaxY: headerMaxY,
                listAtTop: true, translation: CGSize(width: 0, height: -40)),
            "an upward drag scrolls the list, never over-opens")
        XCTAssertFalse(
            PanelDismiss.takes(
                progress: 1, startY: 300, headerMaxY: headerMaxY,
                listAtTop: true, translation: CGSize(width: 50, height: 20)),
            "a sideways drag is not a dismissal")
    }

    func test_panelDismiss_needsTheCommitDistance() {
        XCTAssertFalse(
            PanelDismiss.takes(
                progress: 1, startY: 300, headerMaxY: headerMaxY,
                listAtTop: true,
                translation: CGSize(width: 0, height: PanelDismiss.takeoverDistance - 1)))
        XCTAssertTrue(
            PanelDismiss.takes(
                progress: 1, startY: 300, headerMaxY: headerMaxY,
                listAtTop: true,
                translation: CGSize(width: 0, height: PanelDismiss.takeoverDistance)))
    }
}
