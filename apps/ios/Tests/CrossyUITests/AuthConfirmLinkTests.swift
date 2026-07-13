import XCTest

@testable import CrossyUI

// The magic-link digest's contract (roadmap I3b, AASA /auth/confirm*): a Supabase email
// link lands as a Universal Link carrying token_hash and type, the two values
// completeMagicLink needs (SupabaseAuthClient verifyEmailLink). Only the /auth/confirm
// path with BOTH values present digests to a link; every other URL (a /game invite, a
// bare open, a half-formed query) digests to nil, so the browsing-activity handler can
// tell a magic link from an invite and route each to its own seam.

final class AuthConfirmLinkTests: XCTestCase {
    private func url(_ string: String) -> URL {
        URL(string: string)!
    }

    func test_theConfirmPathWithBothValuesDigestsToTheLink_I3b() {
        let link = AuthConfirm.link(
            fromURL: url("https://crossy.party/auth/confirm?token_hash=abc123&type=magiclink"))
        XCTAssertEqual(link, AuthConfirmLink(tokenHash: "abc123", type: "magiclink"))
    }

    func test_theValuesPassThroughVerbatim_theyAreOpaqueServerTokens_I3b() {
        // token_hash and type are GoTrue's own, never normalized (INV-1 casing has no
        // bearing here): a mixed-case type and a hash with URL-safe punctuation both
        // survive untouched, and query order does not matter.
        let link = AuthConfirm.link(
            fromURL: url("https://crossy.party/auth/confirm?type=Recovery&token_hash=aB-_9x"))
        XCTAssertEqual(link, AuthConfirmLink(tokenHash: "aB-_9x", type: "Recovery"))
    }

    func test_aPercentEncodedValueDecodesThroughURLComponents_I3b() {
        // URLComponents hands back the decoded query value, so a percent-encoded token
        // arrives ready for the verify grant.
        let link = AuthConfirm.link(
            fromURL: url("https://crossy.party/auth/confirm?token_hash=a%2Bb%3Dc&type=email"))
        XCTAssertEqual(link, AuthConfirmLink(tokenHash: "a+b=c", type: "email"))
    }

    func test_aHalfFormedQueryDigestsToNil_I3b() {
        // Either value missing, or present but empty, is not a completable link.
        XCTAssertNil(
            AuthConfirm.link(fromURL: url("https://crossy.party/auth/confirm?token_hash=abc")))
        XCTAssertNil(
            AuthConfirm.link(fromURL: url("https://crossy.party/auth/confirm?type=magiclink")))
        XCTAssertNil(
            AuthConfirm.link(
                fromURL: url("https://crossy.party/auth/confirm?token_hash=&type=magiclink")))
        XCTAssertNil(
            AuthConfirm.link(
                fromURL: url("https://crossy.party/auth/confirm?token_hash=abc&type=")))
        XCTAssertNil(AuthConfirm.link(fromURL: url("https://crossy.party/auth/confirm")))
    }

    func test_anInvitePathIsNotAMagicLink_soTheHandlerFallsThroughToTheInviteParser_I3b() {
        // The invite paths carry no confirm digest, so the handler falls through to
        // InviteScan (the two seams never collide on one URL).
        XCTAssertNil(
            AuthConfirm.link(fromURL: url("https://crossy.party/game/g-1?code=AB23CD45")))
        XCTAssertNil(AuthConfirm.link(fromURL: url("https://crossy.party/g/AB23CD45")))
        XCTAssertNil(AuthConfirm.link(fromURL: url("https://crossy.party/")))
        // A path that merely starts with the confirm segment is not it (a stray
        // /auth/confirmed page never triggers a verify).
        XCTAssertNil(
            AuthConfirm.link(
                fromURL: url("https://crossy.party/auth/confirmed?token_hash=abc&type=email")))
    }
}
