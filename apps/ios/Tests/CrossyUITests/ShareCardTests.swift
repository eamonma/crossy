import CoreGraphics
import Foundation
import XCTest

@testable import CrossyUI

// The share card (owner ask 2026-07-11): a dedicated round share pill
// inflating into the invite surface on the facts card's one-morph grammar.
// Pinned like every morph sibling: the open geometry is slot arithmetic, the
// words derive once, and the Mail-button rule is held strictly (the trailing
// edge is the pill's own, so standing pills to its right are never buried).

final class ShareCardLayoutTests: XCTestCase {
    // The open frame is arithmetic, never font metrics (DESIGN.md §4: the
    // morph's endpoints are layout facts). One constant: the card always
    // carries the code block, the QR slot, and both action rows.
    func test_panelHeight_isSlotArithmetic() {
        let expected: CGFloat =
            20 * 2  // vertical padding
            + 16 + 6 + 36 + 6 + 16  // label, gap, code, gap, detail
            + 16 + 164  // air, QR tile
            + 12 + 1 + 4  // air, hairline, air
            + 40 * 2  // Copy link, Share…
        XCTAssertEqual(ShareCardLayout.panelHeight(), expected)
    }

    // Row text takes the open card's CONSTANT content width (the facts card's
    // rule): truncation is computed once, never re-computed mid-morph.
    func test_contentWidth_isConstantAgainstTheOpenCard_section4() {
        XCTAssertEqual(ShareCardLayout.contentWidth(openWidth: 300), 260)
        XCTAssertEqual(ShareCardLayout.contentWidth(openWidth: 10), 0)
    }

    // The Mail-button rule, held strictly (DESIGN.md §4): the open card's
    // trailing edge is the pill's own, so on a narrow bar the WIDTH gives
    // way, and the card never slides right to bury the players pill.
    func test_panelWidth_capsAtTheMaximumAndYieldsOnNarrowBars_section4() {
        XCTAssertEqual(
            ShareCardLayout.panelWidth(barMinX: 12, pillMaxX: 400),
            ShareCardLayout.panelMaxWidth)
        XCTAssertEqual(ShareCardLayout.panelWidth(barMinX: 12, pillMaxX: 255), 243)
        XCTAssertEqual(ShareCardLayout.panelWidth(barMinX: 12, pillMaxX: 12), 0)
    }

    // The QR tile always fits the card's content width, quiet zone included,
    // even at the narrowest honest bar (the SE-width case above).
    func test_qrTileFitsTheNarrowCard() {
        let narrowest = ShareCardLayout.contentWidth(
            openWidth: ShareCardLayout.panelWidth(barMinX: 12, pillMaxX: 255))
        XCTAssertLessThanOrEqual(ShareCardLayout.qrTileSide, narrowest)
    }
}

final class ShareCardContentTests: XCTestCase {
    // The words derive once as plain strings (the RoomFactsContent pattern):
    // the quiet label, the code as the spoken headline (the read-aloud
    // alphabet was designed for a call), and the lexicon's invite line
    // (EXPERIENCE.md §5) verbatim.
    func test_wordsAreTheLexicons_ID5() {
        let content = ShareCardContent.make(code: "TIDECOVE")
        XCTAssertEqual(content.label, "Invite")
        XCTAssertEqual(content.code, "TIDECOVE")
        XCTAssertEqual(content.detail, "Anyone with this code can join")
    }
}

@MainActor
final class ShareChromeTests: XCTestCase {
    // The scripted entry (the presentFacts pattern): land the card open with
    // no walk, so simctl captures it without a tap (-i2fShare).
    func test_presentShare_landsOpenWithNoWalk() {
        let chrome = RoomChromeModel()
        XCTAssertFalse(chrome.isShareOpen)
        chrome.presentShare()
        XCTAssertEqual(chrome.shareProgress, 1)
        XCTAssertTrue(chrome.isShareOpen)
    }

    // The cut (Reduce Motion, scripted screenshots): no walk to await.
    func test_settleShare_cutsWhenNotAnimated() {
        let chrome = RoomChromeModel()
        chrome.settleShare(open: true, animated: false)
        XCTAssertEqual(chrome.shareProgress, 1)
        chrome.settleShare(open: false, animated: false)
        XCTAssertEqual(chrome.shareProgress, 0)
    }
}
