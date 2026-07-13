import Foundation
import XCTest

import CrossyAPI
import CrossyProtocol

// The reactive refresh-and-retry on a server 401 (CrossyAPIClient.perform). When the
// client's local clock still thinks a token is valid but the server rejects it (clock
// skew, a server-side revocation, a shortened TTL), the client must force one refresh
// through the token provider and replay the request once before surfacing the failure.
// Only a 401 triggers the retry, and it happens at most once.

@available(macOS 12.0, iOS 15.0, *)
final class RefreshOn401Tests: XCTestCase {
    private func expectFailure(
        _ run: @Sendable () async throws -> Void,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async -> CrossyAPIError? {
        do {
            try await run()
            XCTFail("expected the call to throw", file: file, line: line)
            return nil
        } catch let error as CrossyAPIError {
            return error
        } catch {
            XCTFail("expected CrossyAPIError, got \(error)", file: file, line: line)
            return nil
        }
    }

    func test_aServer401RefreshesOnceRetriesWithTheFreshTokenAndSucceeds() async throws {
        // First request carries the stale token and is rejected 401; the client forces a
        // refresh and replays with the fresh token, which the server accepts.
        let successBody = try SharedRESTFixtures.data("games-list")
        let unauthorized = Data(#"{"error":"UNAUTHORIZED","message":"the session expired"}"#.utf8)
        StubURLProtocol.install { _ in
            let priorRequests = StubURLProtocol.recordedRequests.count
            return priorRequests <= 1 ? (401, unauthorized) : (200, successBody)
        }
        let provider = StaleThenFreshTokenProvider(
            stale: "stale-token", refresh: .fresh("fresh-token"))

        let page = try await makeStubbedClient(tokenProvider: provider).listGames()

        // The decoded success came back: the retry carried the request through.
        XCTAssertEqual(page.rows.count, 2)

        // Exactly one refresh, exactly one retry (two requests total).
        XCTAssertEqual(provider.refreshedTokenCallCount, 1, "forced a single refresh")
        let requests = StubURLProtocol.recordedRequests
        XCTAssertEqual(requests.count, 2, "the request was replayed once")
        XCTAssertEqual(requests[0].headers["Authorization"], "Bearer stale-token")
        XCTAssertEqual(
            requests[1].headers["Authorization"], "Bearer fresh-token",
            "the replay carried the freshly minted token")
    }

    func test_aTerminalSignedOutRefreshSurfacesThe401AndDoesNotRetry() async throws {
        // The forced refresh is terminally refused (SignedOutError): the client surfaces
        // the original 401/UNAUTHORIZED and never issues a second request.
        let unauthorized = Data(#"{"error":"UNAUTHORIZED","message":"the session expired"}"#.utf8)
        StubURLProtocol.install { _ in (401, unauthorized) }
        let provider = StaleThenFreshTokenProvider(
            stale: "stale-token", refresh: .throwing(SignedOutError()))

        let error = await expectFailure {
            _ = try await makeStubbedClient(tokenProvider: provider).listGames()
        }
        guard case .api(let status, let envelope) = error else {
            return XCTFail("expected .api, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 401)
        XCTAssertEqual(envelope.code, .unauthorized)

        XCTAssertEqual(provider.refreshedTokenCallCount, 1, "one refresh was attempted")
        XCTAssertEqual(
            StubURLProtocol.recordedRequests.count, 1,
            "a refused refresh does not replay the request")
    }

    func test_aTransientRefreshFailureSurfacesTheOriginal401WithoutRetrying() async throws {
        // A transient refresh failure (network weather rethrown) is not a sign-out; the
        // client still surfaces the original 401 and does not loop.
        let unauthorized = Data(#"{"error":"UNAUTHORIZED","message":"the session expired"}"#.utf8)
        StubURLProtocol.install { _ in (401, unauthorized) }
        let provider = StaleThenFreshTokenProvider(
            stale: "stale-token", refresh: .throwing(URLError(.notConnectedToInternet)))

        let error = await expectFailure {
            _ = try await makeStubbedClient(tokenProvider: provider).listGames()
        }
        guard case .api(let status, _) = error else {
            return XCTFail("expected .api, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 401)
        XCTAssertEqual(provider.refreshedTokenCallCount, 1)
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1, "no replay on transient weather")
    }

    func test_aSecond401AfterTheRefreshIsSurfacedAndNotRetriedAgain() async throws {
        // The refresh mints a token the server also rejects: the retry runs once, the
        // second 401 is surfaced as-is, and there is no third attempt.
        let unauthorized = Data(#"{"error":"UNAUTHORIZED","message":"still rejected"}"#.utf8)
        StubURLProtocol.install { _ in (401, unauthorized) }
        let provider = StaleThenFreshTokenProvider(
            stale: "stale-token", refresh: .fresh("fresh-token"))

        let error = await expectFailure {
            _ = try await makeStubbedClient(tokenProvider: provider).listGames()
        }
        guard case .api(let status, _) = error else {
            return XCTFail("expected .api, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 401)
        XCTAssertEqual(provider.refreshedTokenCallCount, 1, "the refresh ran exactly once")
        XCTAssertEqual(
            StubURLProtocol.recordedRequests.count, 2,
            "the request is replayed at most once, never a third time")
    }

    func test_aNon401RejectionPassesThroughAndNeverRefreshes() async throws {
        // 403 DENIED (and every non-401 status) is not auth staleness: the client must not
        // refresh and must surface it unchanged.
        let denied = Data(#"{"error":"DENIED","message":"not a member"}"#.utf8)
        StubURLProtocol.install { _ in (403, denied) }
        let provider = StaleThenFreshTokenProvider(
            stale: "stale-token", refresh: .fresh("fresh-token"))

        let error = await expectFailure {
            _ = try await makeStubbedClient(tokenProvider: provider).listGames()
        }
        guard case .api(let status, _) = error else {
            return XCTFail("expected .api, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 403)
        XCTAssertEqual(
            provider.refreshedTokenCallCount, 0,
            "a 403 is not auth staleness: no refresh is forced")
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1, "no replay for a non-401")
    }
}
