import Foundation
import XCTest

import CrossyProtocol

@testable import CrossyAPI

// GET /me and PATCH /me over the section 12 client (docs/design/name-onboarding.md §7):
// the Bearer header, the null display name (the one place null crosses the wire), the
// canonical adoption, and the typed mapping of the NAME_* 422 codes and the 429
// RATE_LIMITED with its Retry-After. The StubURLProtocol plumbing (StubSupport) records
// the request and answers from a per-test @Sendable handler, so the canned bodies are
// built as local constants before install (never captured off `self`).

/// A `/me` JSON body, module-level so the @Sendable stub handler captures a value, not the
/// test case (which is not Sendable).
private func meJSON(displayName: String?, needsName: Bool, isAnonymous: Bool = false) -> Data {
    let name = displayName.map { "\"\($0)\"" } ?? "null"
    let body = """
        {"userId":"u-1","displayName":\(name),"isAnonymous":\(isAnonymous),\
        "avatarUrl":null,"needsName":\(needsName)}
        """
    return Data(body.utf8)
}

@available(macOS 12.0, iOS 15.0, *)
final class MeRoutesTests: XCTestCase {
    func test_getMe_attachesBearerAndDecodesNullDisplayName() async throws {
        let client = makeStubbedClient()
        let body = meJSON(displayName: nil, needsName: true)
        StubURLProtocol.install { _ in (200, body) }

        let me = try await client.getMe()

        XCTAssertNil(me.displayName, "GET /me returns the raw DB null for a nameless account")
        XCTAssertTrue(me.needsName, "the server-computed onboarding trigger crosses the wire")
        XCTAssertFalse(me.isAnonymous)

        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(request.path, "/me")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
    }

    func test_updateDisplayName_sendsPatchWithTheNameAndAdoptsTheCanonicalValue() async throws {
        let client = makeStubbedClient()
        // The server canonicalizes; the client sends the value and adopts what comes back.
        let body = meJSON(displayName: "Ada Lovelace", needsName: false)
        StubURLProtocol.install { _ in (200, body) }

        let me = try await client.updateDisplayName("  Ada   Lovelace ")

        XCTAssertEqual(me.displayName, "Ada Lovelace", "the client adopts the canonical value")
        XCTAssertFalse(me.needsName)

        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.method, "PATCH")
        XCTAssertEqual(request.path, "/me")
        XCTAssertEqual(request.headers["Authorization"], "Bearer test-token")
        let sent = try XCTUnwrap(request.body)
        let object = try jsonObject(sent) as? [String: Any]
        XCTAssertEqual(object?["displayName"] as? String, "  Ada   Lovelace ")
    }

    func test_updateDisplayName_mapsNameTooLongToATyped422() async throws {
        let client = makeStubbedClient()
        let body = Data(#"{"error":"NAME_TOO_LONG","message":"too long"}"#.utf8)
        StubURLProtocol.install { _ in (422, body) }

        do {
            _ = try await client.updateDisplayName(String(repeating: "a", count: 41))
            XCTFail("a too-long name must throw")
        } catch let error as CrossyAPIError {
            XCTAssertEqual(error.apiCodeString, "NAME_TOO_LONG")
            XCTAssertEqual(error.apiCode, .nameTooLong)
        }
    }

    func test_updateDisplayName_mapsRateLimitedTo429WithTheDedicatedCase() async throws {
        let client = makeStubbedClient()
        // The stub pins Content-Type only, so the Retry-After header parse is covered by
        // CrossyAPIError.retryAfterSeconds separately; here we assert the 429 surfaces as
        // the dedicated rateLimited case carrying the code.
        let body = Data(#"{"error":"RATE_LIMITED","message":"slow down"}"#.utf8)
        StubURLProtocol.install { _ in (429, body) }

        do {
            _ = try await client.updateDisplayName("Ada")
            XCTFail("a spent write window must throw")
        } catch let error as CrossyAPIError {
            XCTAssertEqual(error.apiCodeString, "RATE_LIMITED")
            XCTAssertEqual(error.apiCode, .rateLimited)
            guard case .rateLimited = error else {
                return XCTFail("a 429 must surface as the dedicated rateLimited case")
            }
        }
    }

    func test_updateDisplayName_mapsNameInvalidAndNameRequired() async throws {
        for code in ["NAME_INVALID", "NAME_REQUIRED"] {
            let client = makeStubbedClient()
            let body = Data(#"{"error":"\#(code)","message":"bad"}"#.utf8)
            StubURLProtocol.install { _ in (422, body) }
            do {
                _ = try await client.updateDisplayName("x")
                XCTFail("\(code) must throw")
            } catch let error as CrossyAPIError {
                XCTAssertEqual(error.apiCodeString, code)
            }
        }
    }
}
