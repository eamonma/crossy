// ShareInvite.url emits the canonical short invite link the web app emits;
// these vectors pin the shareable link's shape byte for byte so the two clients
// agree on `https://crossy.ing/{CODE}`.

import XCTest

@testable import CrossyUI

final class ShareInviteTests: XCTestCase {
    func test_buildsTheCanonicalShortLink() {
        XCTAssertEqual(
            ShareInvite.url(gameId: "g-1", code: "ABCD2345")?.absoluteString,
            "https://crossy.ing/ABCD2345")
    }

    // The short link is the origin plus the code: no gameId, no query, no name.
    // The room name is API-served (GET /games/{id}), so the link never carries it.
    func test_carriesOnlyTheCode() throws {
        let url = try XCTUnwrap(ShareInvite.url(gameId: "g-1", code: "ABCD2345"))
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        XCTAssertNil(components?.queryItems)
        XCTAssertEqual(components?.path, "/ABCD2345")
    }

    func test_noCodeMeansNoLink() {
        XCTAssertNil(ShareInvite.url(gameId: "g-1", code: nil))
    }

    // An empty code, same rule as the copy row: nothing to share.
    func test_emptyCodeMeansNoLink() {
        XCTAssertNil(ShareInvite.url(gameId: "g-1", code: ""))
    }
}
