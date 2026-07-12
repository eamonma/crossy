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
