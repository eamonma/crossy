import CoreGraphics
import XCTest

@testable import CrossyUI

// The share surface (owner ruling 2026-07-11: ships as the native menu). The
// share pill is a system Menu label so the open rides the system's own melt
// (the RosterMenu mechanism). Pinned here: the row set and its rank, the titled
// section carrying the read-aloud code, the QR tile geometry, and the QR
// sheet's slot arithmetic.

final class ShareMenuListTests: XCTestCase {
    // Three intents as rows, Copy link keeping the primary slot (the group
    // chat is the product's honest social space, docs/design/share-surface.md);
    // the QR is one row like the others (the morph card's zero-tap body was
    // the card's argument, and the card lost). Row order is a one-line change
    // if the owner later swaps QR to second.
    func test_rows_haveCopyPrimaryThenShareThenQR() {
        XCTAssertEqual(ShareMenuList.rows, [.copyLink, .share, .showQR])
        XCTAssertEqual(ShareMenuList.rows, ShareMenuList.Row.allCases)
    }

    // One lexicon per intent (ID-5), never two phrasings.
    func test_rowWords_areTheLexicons_ID5() {
        XCTAssertEqual(ShareMenuList.title(.copyLink), "Copy link")
        XCTAssertEqual(ShareMenuList.title(.share), "Share…")
        XCTAssertEqual(ShareMenuList.title(.showQR), "Show QR code")
    }

    // The rows' glyphs; the QR row takes the system's qrcode mark.
    func test_rowSymbols() {
        XCTAssertEqual(ShareMenuList.symbol(.copyLink), "link")
        XCTAssertEqual(ShareMenuList.symbol(.share), "square.and.arrow.up")
        XCTAssertEqual(ShareMenuList.symbol(.showQR), "qrcode")
    }

    // The read-aloud channel survives the menu form (the code's alphabet was
    // designed to be spoken on a call): the titled section carries the code
    // verbatim, and it is where copying the bare invite code now lives (the
    // facts card's copy-code row retired with the morph card).
    func test_sectionHeader_carriesTheReadAloudCodeVerbatim() {
        XCTAssertEqual(ShareMenuList.sectionHeader(code: "TIDECOVE"), "TIDECOVE")
    }
}

final class ShareQRSheetLayoutTests: XCTestCase {
    // The detent height is slot arithmetic, never font metrics: padding, the
    // code headline, air, the tile.
    func test_height_isSlotArithmetic() {
        let expected: CGFloat =
            28 * 2  // vertical padding
            + 36  // the code headline
            + 20  // air
            + 164  // the QR tile
        XCTAssertEqual(ShareQRSheetLayout.height, expected)
    }

    // The tile is above the scannable floor with its quiet zone (the register
    // the owner judged on the retired card, decode evidence included, carries
    // over to the sheet unchanged).
    func test_tileGeometry() {
        XCTAssertEqual(QRTileLayout.side, 164)
        XCTAssertEqual(QRTileLayout.quietZone, 12)
    }
}
