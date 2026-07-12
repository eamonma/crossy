// ShareInvite.url is a Swift port of apps/web/src/domain/invite.ts's `buildShareUrl`;
// these vectors mirror invite.test.ts's `buildShareUrl` suite so the two clients agree
// on the shareable link's shape byte for byte.

import XCTest

@testable import CrossyUI

final class ShareInviteTests: XCTestCase {
    func test_buildsAJoinablePathFormLink() {
        XCTAssertEqual(
            ShareInvite.url(gameId: "g-1", code: "ABCD2345")?.absoluteString,
            "https://crossy.party/game/g-1?code=ABCD2345")
    }

    // The code is the whole query: the room name is API-served (GET /games/{id}),
    // so the link never carries it.
    func test_carriesOnlyTheCode() throws {
        let url = try XCTUnwrap(ShareInvite.url(gameId: "g-1", code: "ABCD2345"))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(items?.map(\.name), ["code"])
    }

    func test_noCodeMeansNoLink() {
        XCTAssertNil(ShareInvite.url(gameId: "g-1", code: nil))
    }

    // An empty code, same rule as the copy row: nothing to share.
    func test_emptyCodeMeansNoLink() {
        XCTAssertNil(ShareInvite.url(gameId: "g-1", code: ""))
    }
}
