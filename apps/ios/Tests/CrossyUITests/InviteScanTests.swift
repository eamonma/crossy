import XCTest

@testable import CrossyUI

// The scan digest's contract (PROTOCOL.md §12: the code is the join capability):
// three payload shapes resolve to the code, everything else to nil. Casing is
// bytewise ASCII per INV-1 — a lowercased QR still joins, a Unicode look-alike
// never does.

final class InviteScanTests: XCTestCase {
    func test_theThreeInviteShapesAllDigestToTheCode_PROTOCOL12() {
        // Bare read-aloud code, with and without cosmetic separators.
        XCTAssertEqual(InviteScan.code(fromPayload: "AB23CD45"), "AB23CD45")
        XCTAssertEqual(InviteScan.code(fromPayload: "AB23-CD45"), "AB23CD45")
        XCTAssertEqual(InviteScan.code(fromPayload: " AB23 CD45 \n"), "AB23CD45")
        // The projector's share link (apps/web buildShareUrl), name riding along.
        XCTAssertEqual(
            InviteScan.code(
                fromPayload: "https://crossy.app/game/g-1?code=AB23CD45&name=Tuesday%20evening"),
            "AB23CD45")
        // The legacy query-routed link still in the wild.
        XCTAssertEqual(
            InviteScan.code(fromPayload: "https://crossy.app/?game=g-1&code=AB23CD45"),
            "AB23CD45")
        // The §12 unfurl link, the one public route.
        XCTAssertEqual(InviteScan.code(fromPayload: "https://crossy.app/g/AB23CD45"), "AB23CD45")
    }

    func test_casingIsBytewiseASCII_INV1() {
        XCTAssertEqual(InviteScan.code(fromPayload: "ab23cd45"), "AB23CD45")
        XCTAssertEqual(
            InviteScan.code(fromPayload: "https://crossy.app/g/ab23cd45"), "AB23CD45")
    }

    func test_proseAndForeignPayloadsNeverConjureACode() {
        // Sanitize alone would fish "HELLWRLD" out of this; the digest must not.
        XCTAssertNil(InviteScan.code(fromPayload: "HELLO WORLD"))
        XCTAssertNil(InviteScan.code(fromPayload: ""))
        XCTAssertNil(InviteScan.code(fromPayload: "WIFI:S:cafe;T:WPA;P:secret;;"))
        // Seven characters is no code; neither is a link without the capability.
        XCTAssertNil(InviteScan.code(fromPayload: "AB23CD4"))
        XCTAssertNil(InviteScan.code(fromPayload: "https://crossy.app/game/g-1"))
        XCTAssertNil(InviteScan.code(fromPayload: "https://crossy.app/game/g-1?code=NOPE"))
        // A /g/ path whose tail only shrinks to eight after dropping glyphs (0, 1,
        // I, O can appear in no code) is not an invite.
        XCTAssertNil(InviteScan.code(fromPayload: "https://crossy.app/g/AB23CD450"))
    }
}
