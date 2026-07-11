import CoreGraphics
import XCTest

@testable import CrossyUI

// The share menu variant (-shareMenu, owner comparison 2026-07-11): the share
// pill as a system Menu label so the open rides the system's own melt (the
// RosterMenu mechanism). Pinned here: the row set and its rank, the titled
// section carrying the read-aloud code, the QR sheet's slot arithmetic, and
// the default mechanism staying the card (the law until an owner ruling).

final class ShareMenuListTests: XCTestCase {
    // The card's three intents as rows, Copy link keeping the primary slot
    // (the group chat is the product's honest social space,
    // docs/design/share-surface.md); the QR loses its zero-tap rank by the
    // menu's nature and stages a sheet instead.
    func test_rows_reuseTheCardsIntentsWithCopyPrimary() {
        XCTAssertEqual(ShareMenuList.rows, [.copyLink, .share, .showQR])
        XCTAssertEqual(ShareMenuList.rows, ShareMenuList.Row.allCases)
    }

    // The words are the card's own where a row exists for them (ID-5: one
    // lexicon per intent, never two phrasings across mechanisms).
    func test_rowWords_matchTheCardsLexicon_ID5() {
        XCTAssertEqual(ShareMenuList.title(.copyLink), "Copy link")
        XCTAssertEqual(ShareMenuList.title(.share), "Share…")
        XCTAssertEqual(ShareMenuList.title(.showQR), "Show QR code")
    }

    // The symbols are the card's own rows' glyphs; the QR row takes the
    // system's qrcode mark.
    func test_rowSymbols_areTheCards() {
        XCTAssertEqual(ShareMenuList.symbol(.copyLink), "link")
        XCTAssertEqual(ShareMenuList.symbol(.share), "square.and.arrow.up")
        XCTAssertEqual(ShareMenuList.symbol(.showQR), "qrcode")
    }

    // The read-aloud channel survives the menu form (the card's headline:
    // the code's alphabet was designed to be spoken on a call): the titled
    // section carries the code verbatim.
    func test_sectionHeader_carriesTheReadAloudCodeVerbatim() {
        XCTAssertEqual(ShareMenuList.sectionHeader(code: "TIDECOVE"), "TIDECOVE")
    }
}

final class ShareQRSheetLayoutTests: XCTestCase {
    // The detent height is slot arithmetic, never font metrics (the
    // ShareCardLayout rule): padding, the code headline, air, the tile.
    func test_height_isSlotArithmetic() {
        let expected: CGFloat =
            28 * 2  // vertical padding
            + 36  // the code headline
            + 20  // air
            + 164  // the QR tile
        XCTAssertEqual(ShareQRSheetLayout.height, expected)
    }

    // The sheet presents the card's exact tile (ShareCardLayout.qrTileSide
    // with its quiet zone), so the register the owner judged on the card,
    // decode evidence included, carries over unchanged.
    func test_tileIsTheCardsOwn() {
        XCTAssertEqual(ShareCardLayout.qrTileSide, 164)
        XCTAssertEqual(ShareCardLayout.qrQuietZone, 12)
    }
}

@MainActor
final class ShareSurfaceTests: XCTestCase {
    // Nothing runs unless the switch is flipped: the default is the card,
    // the shipped law (the PillInflation discipline).
    func test_defaultMechanismIsTheCard() {
        XCTAssertEqual(ShareSurface.mechanism, .card)
    }
}
