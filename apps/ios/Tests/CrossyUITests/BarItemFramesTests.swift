import CoreGraphics
import XCTest

@testable import CrossyUI

// The bar items' frame conversion (apps/ios/DESIGN.md §4, the toolbar-adoption
// ruling). The top chrome is the system nav bar's items now, which live outside
// the room's coordinate space, so they report GLOBAL frames and the solve screen
// converts them into room space against the room's own global origin. The facts
// card's rest geometry and the eclipse test both read the converted values, so a
// wrong offset would launch the card from the wrong place. The conversion is pure
// math, pinned here.

final class BarItemFramesTests: XCTestCase {
    // A global frame minus the room's global origin lands in room space: the
    // room's coordinate space is named on the ZStack whose global origin this
    // subtracts, so the mapping is exact (DESIGN.md §4 toolbar amendment).
    func test_inRoomSpace_subtractsTheRoomOrigin_section4() {
        // The room ZStack sits below the status bar at global (0, 59); a time
        // pill in the nav bar reports its global frame there.
        let roomOrigin = CGPoint(x: 0, y: 59)
        let pillGlobal = CGRect(x: 297, y: 65, width: 84, height: 44)
        let inRoom = BarItemFrames.inRoomSpace(pillGlobal, roomOrigin: roomOrigin)
        // The pill's room-space y is negative: it stands in the nav bar, ABOVE
        // room y=0 (below the bar), so the facts card grows down from there.
        XCTAssertEqual(inRoom, CGRect(x: 297, y: 65 - 59, width: 84, height: 44))
    }

    // A non-zero room x-origin (a split view, an inset container) is subtracted
    // on both axes, so the conversion never assumes a screen-anchored room.
    func test_inRoomSpace_subtractsBothAxes_section4() {
        let roomOrigin = CGPoint(x: 40, y: 100)
        let itemGlobal = CGRect(x: 50, y: 106, width: 44, height: 44)
        XCTAssertEqual(
            BarItemFrames.inRoomSpace(itemGlobal, roomOrigin: roomOrigin),
            CGRect(x: 10, y: 6, width: 44, height: 44))
    }

    // The set conversion maps every piece at once and withholds entirely until
    // the room origin is measured: a nil origin yields nothing, so the morph
    // geometry withholds cleanly rather than launching from a wrong place
    // (the withhold-until-real discipline, DESIGN.md §4).
    func test_inRoomSpace_setWithholdsUntilTheOriginLands_section4() {
        let globals: [ChromePiece: CGRect] = [
            .timePill: CGRect(x: 297, y: 65, width: 84, height: 44),
            .backButton: CGRect(x: 12, y: 65, width: 44, height: 44),
        ]
        XCTAssertTrue(BarItemFrames.inRoomSpace(globals, roomOrigin: nil).isEmpty)
        let converted = BarItemFrames.inRoomSpace(
            globals, roomOrigin: CGPoint(x: 0, y: 59))
        XCTAssertEqual(
            converted[.timePill], CGRect(x: 297, y: 6, width: 84, height: 44))
        XCTAssertEqual(
            converted[.backButton], CGRect(x: 12, y: 6, width: 44, height: 44))
    }

    // The room origin IS the room space's zero, so a zero origin is the identity:
    // a global frame reported in an already-room-anchored hierarchy is unchanged
    // (the conversion never double-offsets).
    func test_inRoomSpace_zeroOriginIsIdentity_section4() {
        let f = CGRect(x: 100, y: 6, width: 84, height: 44)
        XCTAssertEqual(BarItemFrames.inRoomSpace(f, roomOrigin: .zero), f)
    }
}

// The synthesized roomBar rect (DESIGN.md §4 toolbar amendment; the standing-inset
// law, DESIGN.md §2). The hand-drawn bar retired, so the bar's room-space rect is
// derived from the bar items' frames and feeds the camera's standing top inset and
// the clue-bar melt. The vertical band is anchored on the BACK BUTTON, which stands
// in the bar row from frame one (never gated on the welcome), so the band is
// identical before and after the time pill arrives: the board cannot move by even a
// point when the pill materializes (the owner device regression, 2026-07-12, where
// the grid dropped as the pill loaded). Pure, so the "board never moves" contract
// is pinned here.

final class SynthesizedRoomBarTests: XCTestCase {
    private let inset: CGFloat = 12
    private let board = CGRect(x: 0, y: 0, width: 393, height: 500)
    // The back circle: the bar row from frame one. The pill sits in the SAME row
    // but is deliberately a shade taller and lower here, so a naive union band
    // would shift when the pill arrives; the fix must not let it.
    private let back = CGRect(x: 12, y: 60, width: 44, height: 44)
    private let pill = CGRect(x: 297, y: 58, width: 84, height: 48)

    // Pre-welcome: the time pill's item is absent (TimePillPresence), but the back
    // button stands, so the rect STILL synthesizes and the standing inset exists
    // from frame one. The empty-pre-welcome hole (rect nil, top inset 0, board
    // higher) is closed (§2: the board fits under a bar that is there from frame
    // one).
    func test_synthesizesFromTheBackButtonAlone_beforeTheWelcome_section2() {
        let merged: [ChromePiece: CGRect] = [.backButton: back, .board: board]
        let rect = BarItemFrames.synthesizedRoomBar(from: merged, inset: inset)
        XCTAssertNotNil(rect)
        // The band IS the back button's row; the x-extent is board-inset.
        XCTAssertEqual(rect, CGRect(x: 12, y: 60, width: 393 - 24, height: 44))
    }

    // The board must not move on the welcome beat: the vertical band (minY, maxY)
    // is IDENTICAL with and without the pill's frame, even though the pill here is
    // taller and lower than the back circle. Only the anchor's row sets the band;
    // the pill never widens it (§2: constant-built insets, now pill-arrival-proof).
    func test_theVerticalBandHolds_acrossTheTimePillsArrival_section2() {
        let before = BarItemFrames.synthesizedRoomBar(
            from: [.backButton: back, .board: board], inset: inset)
        let after = BarItemFrames.synthesizedRoomBar(
            from: [.backButton: back, .timePill: pill, .board: board], inset: inset)
        XCTAssertNotNil(before)
        XCTAssertNotNil(after)
        // The band the camera reads (minY..maxY) is unchanged: the grid holds still.
        XCTAssertEqual(before?.minY, after?.minY)
        XCTAssertEqual(before?.maxY, after?.maxY)
        // And the rect is wholly identical: the pill contributes nothing here (x is
        // board-derived), so the whole geometry is stable across the arrival.
        XCTAssertEqual(before, after)
    }

    // The standing top inset the camera clamps against is therefore the same before
    // and after the pill arrives, so the board's fit does not change (§2, the law
    // this fix defends): a direct read through GridOcclusion.standing.
    func test_theStandingTopInsetHolds_acrossTheArrival_section2() {
        let before = BarItemFrames.synthesizedRoomBar(
            from: [.backButton: back, .board: board], inset: inset)
        let after = BarItemFrames.synthesizedRoomBar(
            from: [.backButton: back, .timePill: pill, .board: board], inset: inset)
        XCTAssertEqual(
            GridOcclusion.standing(board: board, roomBar: before).top,
            GridOcclusion.standing(board: board, roomBar: after).top)
    }

    // Defensive fallback: if only the pill's frame is present (the back button
    // never reports first in the real bar, but the seam must not crash) the band
    // falls back to the pill so the morphs still have geometry.
    func test_fallsBackToThePill_whenOnlyItsFrameExists_section4() {
        let rect = BarItemFrames.synthesizedRoomBar(
            from: [.timePill: pill, .board: board], inset: inset)
        XCTAssertEqual(rect, CGRect(x: 12, y: 58, width: 393 - 24, height: 48))
    }

    // Withhold until an anchor and the board land: no bar item and no board yields
    // nothing, so the morphs withhold cleanly rather than launching from a wrong
    // place (the withhold-until-real discipline, DESIGN.md §4).
    func test_withholdsUntilAnAnchorAndTheBoardLand_section4() {
        XCTAssertNil(
            BarItemFrames.synthesizedRoomBar(from: [.board: board], inset: inset))
        XCTAssertNil(
            BarItemFrames.synthesizedRoomBar(from: [.backButton: back], inset: inset))
        XCTAssertNil(BarItemFrames.synthesizedRoomBar(from: [:], inset: inset))
    }
}
