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

// The synthesized roomBar rect (DESIGN.md §4 toolbar amendment). The hand-drawn bar
// retired, so the bar's room-space rect is derived from the bar items' frames and
// feeds the FACTS CARD's horizontal span and the CLUE-BAR MELT's geometry (both
// post-welcome, when the frames are live). Since SLICE C the BOARD's standing
// occlusion no longer reads this rect at all (it is constant-built, tested below),
// so this rect exists only for the two morphs. The vertical band is anchored on the
// BACK BUTTON, which stands in the bar row from frame one, so the span is identical
// before and after the time pill arrives; the pill never widens it. Pure, pinned.

final class SynthesizedRoomBarTests: XCTestCase {
    private let inset: CGFloat = 12
    private let board = CGRect(x: 0, y: 0, width: 393, height: 500)
    // The back circle: the bar row from frame one. The pill sits in the SAME row
    // but is deliberately a shade taller and lower here, so a naive union band
    // would shift when the pill arrives; the fix must not let it.
    private let back = CGRect(x: 12, y: 60, width: 44, height: 44)
    private let pill = CGRect(x: 297, y: 58, width: 84, height: 48)

    // The rect synthesizes from the back button alone (pre-welcome, the pill's item
    // absent, ClusterPresence): the span the facts card and the melt read exists
    // from frame one. The band IS the back button's row; the x-extent is board-inset.
    func test_synthesizesFromTheBackButtonAlone_section4() {
        let merged: [ChromePiece: CGRect] = [.backButton: back, .board: board]
        let rect = BarItemFrames.synthesizedRoomBar(from: merged, inset: inset)
        XCTAssertNotNil(rect)
        XCTAssertEqual(rect, CGRect(x: 12, y: 60, width: 393 - 24, height: 44))
    }

    // The morphs' span does not shift on the welcome beat: the rect is IDENTICAL
    // with and without the pill's frame, even though the pill here is taller and
    // lower than the back circle. Only the anchor's row sets the band; the pill
    // never widens it (§4: the card and melt read a stable span across the arrival).
    func test_theBandHolds_acrossTheTimePillsArrival_section4() {
        let before = BarItemFrames.synthesizedRoomBar(
            from: [.backButton: back, .board: board], inset: inset)
        let after = BarItemFrames.synthesizedRoomBar(
            from: [.backButton: back, .timePill: pill, .board: board], inset: inset)
        XCTAssertNotNil(before)
        XCTAssertNotNil(after)
        // Wholly identical: the pill contributes nothing (x is board-derived), so the
        // card and melt span is stable across the arrival.
        XCTAssertEqual(before, after)
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

// The BOARD's constant-built standing occlusion (DESIGN.md §2, the standing-inset
// law; SLICE C). The grid's standing top inset is the room container's system-bar
// height (its top safe-area inset, the band the full-bleed board bleeds under),
// NEVER a reported bar-item frame. So the grid's top edge is at its final position
// on its first rendered frame and never moves when the pill arrives (the owner
// device regression, 2026-07-12, where the grid loaded high and DROPPED as the pill
// materialized, closed at the root). Pure, so the "board never moves" contract is
// pinned on the constant itself, independent of any bar geometry.

final class ConstantBoardInsetTests: XCTestCase {
    private let board = CGRect(x: 0, y: 0, width: 393, height: 500)

    // The standing top inset IS the passed constant (the container's system-bar
    // height), clamped non-negative. No bar-item frame enters the derivation, so no
    // welcome-gated frame can change it (§2, the law this fix defends).
    func test_theStandingTopInsetIsTheConstant_section2() {
        XCTAssertEqual(GridOcclusion.standing(board: board, topInset: 59).top, 59)
        // Clamped: a stray negative never lifts the board past its top edge.
        XCTAssertEqual(GridOcclusion.standing(board: board, topInset: -8).top, 0)
    }

    // The board's fit does not change across the pill's arrival BY CONSTRUCTION: the
    // inset is a constant the bar items never feed, so the same container height
    // yields the same inset whether the pill is absent (pre-welcome) or present
    // (post-welcome). The occlusion cannot even SEE the pill (§2, SLICE C).
    func test_theStandingTopInsetHoldsAcrossTheArrival_section2() {
        // The container's top inset is fixed layout; the pill arriving changes no
        // input here (there is no roomBar parameter to move).
        let preWelcome = GridOcclusion.standing(board: board, topInset: 59).top
        let postWelcome = GridOcclusion.standing(board: board, topInset: 59).top
        XCTAssertEqual(preWelcome, postWelcome)
    }

    // No board yields the empty occlusion, so the camera clamps against nothing until
    // the board lands (the withhold-until-real discipline, DESIGN.md §2).
    func test_withholdsUntilTheBoardLands_section2() {
        XCTAssertEqual(GridOcclusion.standing(board: nil, topInset: 59), .none)
    }

    // keepClear rides the SAME constant top (never a reported frame), so the follow's
    // ceiling holds still across the arrival; the bottom still rescues an occluded
    // cell from a wrapped clue's live slot (§2).
    func test_keepClearRidesTheConstantTop_section2() {
        let clueSlot = CGRect(x: 12, y: 430, width: 369, height: 40)
        let keepClear = GridOcclusion.keepClear(
            board: board, topInset: 59, clueSlot: clueSlot)
        XCTAssertEqual(keepClear.top, 59)
        // The bottom escapes the live slot plus feather, not just the standing bottom.
        XCTAssertGreaterThan(keepClear.bottom, GridOcclusion.standing(board: board, topInset: 59).bottom)
    }
}
