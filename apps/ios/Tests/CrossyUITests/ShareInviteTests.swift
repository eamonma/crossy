// ShareInvite.url is a Swift port of apps/web/src/domain/invite.ts's `buildShareUrl`;
// these vectors mirror invite.test.ts's `buildShareUrl` suite so the two clients agree
// on the shareable link's shape byte for byte.

import XCTest

@testable import CrossyUI

final class ShareInviteTests: XCTestCase {
    func test_buildsAJoinablePathFormLink() {
        XCTAssertEqual(
            ShareInvite.url(gameId: "g-1", code: "ABCD2345", name: nil)?.absoluteString,
            "https://crossy.me/game/g-1?code=ABCD2345")
    }

    func test_appendsTheNameURLEncoded() {
        XCTAssertEqual(
            ShareInvite.url(gameId: "g-1", code: "ABCD2345", name: "Sunday themeless")?
                .absoluteString,
            "https://crossy.me/game/g-1?code=ABCD2345&name=Sunday%20themeless")
    }

    func test_noCodeMeansNoLink() {
        XCTAssertNil(ShareInvite.url(gameId: "g-1", code: nil, name: "Named"))
    }

    // A blank name is treated as absent (SolveScreen's default `roomName` is
    // `""`, not nil): the query stays code-only rather than carrying an empty
    // `name=` pair.
    func test_blankNameIsTreatedAsAbsent() {
        XCTAssertEqual(
            ShareInvite.url(gameId: "g-1", code: "ABCD2345", name: "")?.absoluteString,
            "https://crossy.me/game/g-1?code=ABCD2345")
    }

    // An empty code, same rule as the copy row: nothing to share.
    func test_emptyCodeMeansNoLink() {
        XCTAssertNil(ShareInvite.url(gameId: "g-1", code: "", name: nil))
    }
}
