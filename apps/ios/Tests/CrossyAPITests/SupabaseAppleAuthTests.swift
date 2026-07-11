import Foundation
import XCTest

import CrossyAPI

// The Apple sign-in vendor calls on SupabaseAuthClient (roadmap I3a, second provider):
// the nonce challenge derivation, the id_token grant's wire shape via StubURLProtocol,
// and the best-effort name push. Same stubbing plumbing as the Discord leg; the requests
// recorded are the whole story (no real Supabase is dialed).

@available(macOS 12.0, iOS 15.0, *)
private func makeAppleClient() -> SupabaseAuthClient {
    let configuration = SupabaseAuthConfiguration(
        supabaseURL: "https://api.crossy.me",
        publishableKey: "sb_publishable_test",
        redirect: "crossy://auth/callback")!
    let stubbed = URLSessionConfiguration.ephemeral
    stubbed.protocolClasses = [StubURLProtocol.self]
    return SupabaseAuthClient(
        configuration: configuration, session: URLSession(configuration: stubbed))
}

private let appleGrantBody = Data(
    """
    {
      "access_token": "apple-access",
      "token_type": "bearer",
      "expires_in": 3600,
      "expires_at": 4102444800,
      "refresh_token": "apple-refresh",
      "user": { "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }
    }
    """.utf8)

@available(macOS 12.0, iOS 15.0, *)
final class SupabaseAppleAuthTests: XCTestCase {
    // The value handed to Apple is the lowercase hex of SHA-256 over the raw nonce's
    // ASCII bytes (GoTrue hashes the raw nonce we send and compares hex against the
    // id_token's nonce claim). Pinned vector: the raw is the RFC 7636 appendix B
    // verifier string (a real base64url value PKCE.verifier() produces); the expected
    // hex is `printf %s '<raw>' | shasum -a 256`.
    func test_theAppleNonceChallengeIsLowercaseHexSHA256() {
        let raw = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let expected = "13d31e961a1ad8ec2f16b10c4c982e0876a878ad6df144566ee1894acb70f9c3"
        XCTAssertEqual(AppleNonce.challenge(for: raw), expected)
        // Hex, not the base64url PKCE.challenge form: the two are not interchangeable.
        XCTAssertNotEqual(AppleNonce.challenge(for: raw), PKCE.challenge(for: raw))
        XCTAssertTrue(AppleNonce.challenge(for: raw).allSatisfy { "0123456789abcdef".contains($0) })
    }

    func test_exchangeAppleIDToken_postsTheIdTokenGrantAndDecodesTheSession() async throws {
        StubURLProtocol.install { _ in (200, appleGrantBody) }
        let client = makeAppleClient()

        let session = try await client.exchangeAppleIDToken(
            "the-id-token", nonce: "the-raw-nonce",
            now: Date(timeIntervalSince1970: 1_000_000))

        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.url.host, "api.crossy.me")
        XCTAssertEqual(request.path, "/auth/v1/token")
        XCTAssertEqual(request.queryValue("grant_type"), "id_token")
        XCTAssertEqual(
            request.headers["Apikey"] ?? request.headers["apikey"], "sb_publishable_test")
        // The body carries the provider, the id_token, and the RAW nonce (GoTrue hashes
        // it server-side; sending the hash would fail the nonce claim comparison).
        let body = try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["provider"], "apple")
        XCTAssertEqual(body["id_token"], "the-id-token")
        XCTAssertEqual(body["nonce"], "the-raw-nonce")

        XCTAssertEqual(session.accessToken, "apple-access")
        XCTAssertEqual(session.refreshToken, "apple-refresh")
        XCTAssertEqual(session.userId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    }

    func test_exchangeAppleIDToken_refusesOn4xxLikeThePKCELeg() async throws {
        StubURLProtocol.install { _ in (400, Data(#"{"error":"invalid_grant"}"#.utf8)) }
        let client = makeAppleClient()

        do {
            _ = try await client.exchangeAppleIDToken("bad", nonce: "n")
            XCTFail("a refused grant cannot produce a session")
        } catch SupabaseAuthError.refused(let status) {
            XCTAssertEqual(status, 400)
        }
    }

    func test_updateUserFullName_putsTheMetadataAndReportsTrueOn2xx() async throws {
        StubURLProtocol.install { _ in (200, Data("{}".utf8)) }
        let client = makeAppleClient()

        let ok = await client.updateUserFullName("Ada Lovelace", accessToken: "acc")

        XCTAssertTrue(ok)
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.method, "PUT")
        XCTAssertEqual(request.path, "/auth/v1/user")
        XCTAssertEqual(
            request.headers["Apikey"] ?? request.headers["apikey"], "sb_publishable_test")
        XCTAssertEqual(request.headers["Authorization"], "Bearer acc")
        // Body is {"data": {"full_name": "..."}} (GoTrue user metadata shape).
        let body = try JSONDecoder().decode(
            [String: [String: String]].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["data"]?["full_name"], "Ada Lovelace")
    }

    func test_updateUserFullName_reportsFalseOnNon2xxWithoutThrowing() async {
        StubURLProtocol.install { _ in (403, Data("{}".utf8)) }
        let client = makeAppleClient()

        let ok = await client.updateUserFullName("Ada", accessToken: "acc")

        // Best-effort: a refused name push never throws, so a sign-in never fails on it.
        XCTAssertFalse(ok)
    }

    func test_updateUserFullName_reportsFalseOnTransportWithoutThrowing() async {
        StubURLProtocol.install { _ in throw URLError(.notConnectedToInternet) }
        let client = makeAppleClient()

        let ok = await client.updateUserFullName("Ada", accessToken: "acc")

        XCTAssertFalse(ok)
    }
}
