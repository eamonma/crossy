import Foundation
import XCTest

import CrossyAPI
import CrossyProtocol

// The failure taxonomy (PROTOCOL.md section 12 error vocabulary; CrossyAPIError).
// A client keys on the stable code string, never on prose: every assertion here reads
// `envelope.error`/`envelope.code`, and none inspects `message` content.

@available(macOS 12.0, iOS 15.0, *)
final class ErrorMappingTests: XCTestCase {
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

    func test_aNonTwoXXWithAKnownCodeThrowsATypedAPIError() async throws {
        // The envelope fixture is VALIDATION at 400 (section 12 status table).
        let body = try SharedRESTFixtures.data("error-envelope")
        StubURLProtocol.install { _ in (400, body) }

        let error = await expectFailure { _ = try await makeStubbedClient().listGames() }
        guard case .api(let status, let envelope) = error else {
            return XCTFail("expected .api, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 400)
        XCTAssertEqual(envelope.code, .validation)
        XCTAssertEqual(envelope.error, "VALIDATION")
        XCTAssertEqual(error?.apiCode, .validation)
        XCTAssertEqual(error?.apiCodeString, "VALIDATION")
    }

    func test_anIngestionRejectionSurfacesItsNamedCode() async throws {
        // Section 12: a parseable but unacceptable puzzle is a named 422 rejection.
        let body = Data(#"{"error":"OVERSIZE_GRID","message":"the grid is too big"}"#.utf8)
        StubURLProtocol.install { _ in (422, body) }

        let error = await expectFailure {
            _ = try await makeStubbedClient().createPuzzle(xwordInfoDocument: Data("{}".utf8))
        }
        XCTAssertEqual(error?.apiCode, .oversizeGrid)
    }

    func test_anUnknownFutureCodeDegradesToATypedErrorNotACrash() async throws {
        // Section 12 names codeless rejections (barred, uniclue) that may gain codes
        // later; when one lands, this client must surface it typed with the stable
        // string kept, not fail the decode.
        let body = Data(#"{"error":"BARRED","message":"barred grids are unsupported"}"#.utf8)
        StubURLProtocol.install { _ in (422, body) }

        let error = await expectFailure { _ = try await makeStubbedClient().listPuzzles() }
        guard case .api(let status, let envelope) = error else {
            return XCTFail("expected .api, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 422)
        XCTAssertNil(envelope.code, "unknown code has no typed view")
        XCTAssertEqual(envelope.error, "BARRED", "the stable string survives")
        XCTAssertEqual(error?.apiCodeString, "BARRED")
    }

    func test_aTransportFailureIsDistinctFromAnAPIRejection() async throws {
        StubURLProtocol.install { _ in throw URLError(.notConnectedToInternet) }

        let error = await expectFailure { _ = try await makeStubbedClient().listGames() }
        guard case .transport(let underlying) = error else {
            return XCTFail("expected .transport, got \(String(describing: error))")
        }
        XCTAssertEqual((underlying as? URLError)?.code, .notConnectedToInternet)
        XCTAssertNil(error?.apiCodeString, "network weather carries no API code")
    }

    func test_aNonEnvelopeErrorBodyIsInvalidResponseNotACrash() async throws {
        // A proxy in front of the API can answer non-2xx with HTML; that is a broken
        // contract frame, not an API rejection with a code.
        let body = Data("<html>bad gateway</html>".utf8)
        StubURLProtocol.install { _ in (502, body) }

        let error = await expectFailure { _ = try await makeStubbedClient().listGames() }
        guard case .invalidResponse(let status) = error else {
            return XCTFail("expected .invalidResponse, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 502)
    }

    func test_aTwoXXBodyThatIsNotTheContractIsDecodingFailed() async throws {
        let body = Data(#"{"unexpected":"shape"}"#.utf8)
        StubURLProtocol.install { _ in (200, body) }

        let error = await expectFailure { _ = try await makeStubbedClient().listGames() }
        guard case .decodingFailed(let status, _) = error else {
            return XCTFail("expected .decodingFailed, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 200)
    }

    func test_deleteAccountSurfacesAnUnauthorizedRejectionTyped() async throws {
        // The settings surface must render a delete failure inline and retryable, never
        // swallow it (roadmap I3): a 401 from DELETE /account arrives typed, so the
        // composition root can key its sentence on the stable code.
        let body = Data(#"{"error":"UNAUTHORIZED","message":"the session expired"}"#.utf8)
        StubURLProtocol.install { _ in (401, body) }

        let error = await expectFailure { _ = try await makeStubbedClient().deleteAccount() }
        guard case .api(let status, let envelope) = error else {
            return XCTFail("expected .api, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 401)
        XCTAssertEqual(envelope.code, .unauthorized)
        XCTAssertEqual(error?.apiCodeString, "UNAUTHORIZED")
    }

    func test_deleteAccountTransportWeatherIsRetryableNotAServerVerdict() async throws {
        // Network weather during a delete is distinct from a server rejection: nothing
        // was judged, so the settings surface offers a plain retry.
        StubURLProtocol.install { _ in throw URLError(.timedOut) }

        let error = await expectFailure { _ = try await makeStubbedClient().deleteAccount() }
        guard case .transport = error else {
            return XCTFail("expected .transport, got \(String(describing: error))")
        }
        XCTAssertNil(error?.apiCodeString, "network weather carries no API code")
    }

    func test_aFailedTokenProviderThrowsTokenUnavailableAndSendsNothing() async throws {
        StubURLProtocol.install { _ in (200, Data("{}".utf8)) }
        let client = makeStubbedClient(tokenProvider: NoSessionTokenProvider())

        let error = await expectFailure { _ = try await client.listGames() }
        guard case .tokenUnavailable(let underlying) = error else {
            return XCTFail("expected .tokenUnavailable, got \(String(describing: error))")
        }
        XCTAssertTrue(underlying is NoSessionTokenProvider.NoSession)
        XCTAssertTrue(
            StubURLProtocol.recordedRequests.isEmpty,
            "no token, no request: nothing reaches the wire")
    }
}
