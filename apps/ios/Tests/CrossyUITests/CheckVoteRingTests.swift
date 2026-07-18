// The Meridian ring (apps/ios Wave 15.8, the check-vote taste wave; UX.md U4): the vote's one
// clock is a luminous rounded-rect halo anchored to the PROJECTED grid rect (camera truth, so
// it tracks pan and zoom), whose trim drains clockwise from top-center like a clock hand. The
// shape's seam, the camera projection, the clamp-then-outset anchoring, the parallel-offset
// corner (radius == outset), the reduced-motion quarter stepping, and the freeze-at-close
// fraction are all pure, so they are pinned here without a running view.

import CoreGraphics
import CrossyStore
import Foundation
import SwiftUI
import XCTest

@testable import CrossyUI

// MARK: - The Meridian shape (no rotationEffect, no transform tricks)

final class MeridianRoundedRectTests: XCTestCase {
    // The path starts at TOP-CENTER: a hairline trim's bounds sit at the rect's top middle.
    // The old build trimmed from 3 o'clock and rotated -90°, which transposes a non-square
    // rect into two full-width bars; the seam must live in the path itself (U4).
    func test_pathStartsAtTopCenter_U4() {
        let rect = CGRect(x: 0, y: 0, width: 300, height: 500)
        let path = MeridianRoundedRect(cornerRadius: 6).path(in: rect)
        let tip = path.trimmedPath(from: 0, to: 0.001).boundingRect
        XCTAssertEqual(tip.midX, rect.midX, accuracy: 2)
        XCTAssertEqual(tip.minY, rect.minY, accuracy: 1)
    }

    // Clockwise: the first stretch of the perimeter runs into the RIGHT half (top-center
    // toward the top-right corner), so a draining trim retreats like a clock.
    func test_pathRunsClockwise_U4() {
        let rect = CGRect(x: 0, y: 0, width: 300, height: 500)
        let path = MeridianRoundedRect(cornerRadius: 6).path(in: rect)
        let firstLeg = path.trimmedPath(from: 0, to: 0.08).boundingRect
        XCTAssertGreaterThan(firstLeg.midX, rect.midX, "the drain must sweep clockwise")
        XCTAssertEqual(firstLeg.minY, rect.minY, accuracy: 1, "the first leg rides the top edge")
    }

    // A NON-SQUARE rect keeps its own bounds: the whole path fills the rect it was given
    // (the transposition bug rendered a portrait rect's ring as landscape bars).
    func test_nonSquareRectKeepsItsBounds_U4() {
        let rect = CGRect(x: 10, y: 20, width: 200, height: 420)
        let bounds = MeridianRoundedRect(cornerRadius: 6).path(in: rect).boundingRect
        XCTAssertEqual(bounds.minX, rect.minX, accuracy: 1)
        XCTAssertEqual(bounds.minY, rect.minY, accuracy: 1)
        XCTAssertEqual(bounds.width, rect.width, accuracy: 1)
        XCTAssertEqual(bounds.height, rect.height, accuracy: 1)
    }

    // The half trim of a TALL rect must reach the bottom edge (top-center clockwise to
    // bottom-center is exactly half the perimeter, corners near-symmetric).
    func test_halfTrimReachesTheBottomCenter_U4() {
        let rect = CGRect(x: 0, y: 0, width: 200, height: 400)
        let path = MeridianRoundedRect(cornerRadius: 6).path(in: rect)
        let half = path.trimmedPath(from: 0.49, to: 0.51).boundingRect
        XCTAssertEqual(half.midY, rect.maxY, accuracy: 4, "half the drain lands at 6 o'clock")
    }
}

// MARK: - Camera-truth anchoring

final class CheckVoteRingGeometryTests: XCTestCase {
    // The projected grid rect is pure camera arithmetic: origin from the camera offset,
    // size = board units × scale. This is what the grid view reports upward, so the ring
    // tracks pan and zoom instead of the full-bleed container.
    func test_projectedRectFollowsTheCamera_U4() {
        let camera = GridCamera(scale: 2, offset: CGPoint(x: -30, y: 40))
        let rect = CheckVoteRingGeometry.projected(camera: camera, rows: 5, cols: 5)
        // 5 × GridModule.unit (36) = 180 board points; ×2 = 360.
        XCTAssertEqual(rect, CGRect(x: -30, y: 40, width: 360, height: 360))
    }

    // Anchoring: clamp the projected rect to the viewport FIRST (a zoomed board runs past
    // the edges; the ring hugs what is visible), THEN outset by the gap.
    func test_ringRectClampsToTheViewportThenOutsets_U4() {
        let viewport = CGRect(x: 0, y: 0, width: 390, height: 700)
        let projected = CGRect(x: -30, y: 40, width: 360, height: 360)
        let ring = CheckVoteRingGeometry.ringRect(projected: projected, viewport: viewport)
        let d = CheckVoteRingGeometry.outset
        XCTAssertEqual(ring, CGRect(x: -d, y: 40 - d, width: 330 + 2 * d, height: 360 + 2 * d))
    }

    func test_ringRectOfAFittingBoardIsAPlainOutset_U4() {
        let viewport = CGRect(x: 0, y: 0, width: 390, height: 700)
        let projected = CGRect(x: 15, y: 120, width: 360, height: 360)
        let ring = CheckVoteRingGeometry.ringRect(projected: projected, viewport: viewport)
        XCTAssertEqual(ring, projected.insetBy(dx: -CheckVoteRingGeometry.outset, dy: -CheckVoteRingGeometry.outset))
    }

    // The corner is a TRUE PARALLEL OFFSET of the grid's drawn corner: the grid draws a
    // square corner, so an offset at distance d turns it by an arc of radius exactly d.
    // (The old radius-22 halo was misregistered against the grid's own corner.)
    func test_cornerRadiusEqualsTheOutsetGap_U4() {
        XCTAssertEqual(CheckVoteRingGeometry.cornerRadius, CheckVoteRingGeometry.outset)
    }

    // A degenerate overlap (board panned fully past the viewport) never yields a negative
    // rect: the clamp floors at zero size.
    func test_ringRectNeverGoesNegative() {
        let viewport = CGRect(x: 0, y: 0, width: 390, height: 700)
        let projected = CGRect(x: 500, y: 900, width: 100, height: 100)
        let ring = CheckVoteRingGeometry.ringRect(projected: projected, viewport: viewport)
        XCTAssertGreaterThanOrEqual(ring.width, 0)
        XCTAssertGreaterThanOrEqual(ring.height, 0)
    }
}

// MARK: - Reduced Motion: quarters, matching the web (was fifths)

final class CheckVoteRingSteppedOpacityTests: XCTestCase {
    func test_reducedMotionOpacityStepsInQuarters_U4() {
        // Buckets: (0.75, 1] → 1.0; (0.5, 0.75] → 0.75; (0.25, 0.5] → 0.5; [0, 0.25] → 0.25,
        // scaled by the ring's standing 0.9 stroke opacity. Quarters match the web parity.
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 1.0), 0.9, accuracy: 1e-9)
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 0.8), 0.9, accuracy: 1e-9)
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 0.75), 0.675, accuracy: 1e-9)
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 0.6), 0.675, accuracy: 1e-9)
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 0.5), 0.45, accuracy: 1e-9)
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 0.3), 0.45, accuracy: 1e-9)
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 0.2), 0.225, accuracy: 1e-9)
        XCTAssertEqual(CheckVoteRingModel.steppedOpacity(progress: 0.0), 0.225, accuracy: 1e-9)
    }
}

// MARK: - Freeze at close (the ring must not vanish during the breath)

final class CheckVoteRingFreezeTests: XCTestCase {
    // The store nils checkVote at close, so the close beat freezes the last drained
    // fraction from the mirrored vote's expiresAt. Same clamp as the live drain:
    // remaining / TTL, held to [0, 1].
    func test_frozenFractionIsRemainingOverTTL_U6() {
        let now = Date(timeIntervalSince1970: 1_780_000_000)
        let expires = now.addingTimeInterval(15)
        let fraction = CheckVoteRingFreeze.progress(
            expiresAt: ISO8601DateFormatter().string(from: expires), asOf: now)
        XCTAssertEqual(fraction ?? -1, 0.5, accuracy: 0.01)
    }

    func test_frozenFractionClampsBothWays_U6() {
        let now = Date(timeIntervalSince1970: 1_780_000_000)
        let past = ISO8601DateFormatter().string(from: now.addingTimeInterval(-5))
        XCTAssertEqual(CheckVoteRingFreeze.progress(expiresAt: past, asOf: now) ?? -1, 0)
        let far = ISO8601DateFormatter().string(from: now.addingTimeInterval(90))
        XCTAssertEqual(CheckVoteRingFreeze.progress(expiresAt: far, asOf: now) ?? -1, 1)
    }

    func test_unparseableExpiryFreezesNothing() {
        XCTAssertNil(CheckVoteRingFreeze.progress(expiresAt: "not a date", asOf: .now))
    }

    // Fractional-second timestamps (the server's usual form) parse too.
    func test_fractionalSecondsParse() {
        let now = ISO8601DateFormatter().date(from: "2026-07-18T12:00:00Z")!
        let fraction = CheckVoteRingFreeze.progress(
            expiresAt: "2026-07-18T12:00:30.000Z", asOf: now)
        XCTAssertEqual(fraction ?? -1, 1, accuracy: 0.001)
    }
}
