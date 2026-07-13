import Foundation
import XCTest

import CrossyAPI
import CrossyProtocol

// URLProtocol-stubbed plumbing for the REST client tests. The stub intercepts every
// request an ephemeral URLSession makes, records the request line, headers, and drained
// body (URLProtocol receives bodies as a stream), and answers from a per-test handler.
// Canned response bodies reuse the CrossyProtocolTests REST fixtures (the D04 contract
// snapshots), located from this file's compiled-in path exactly as that target locates
// them, so the client is tested against the same normative samples that pin the twins.

/// The shared REST fixtures under Tests/CrossyProtocolTests/Fixtures/rest.
enum SharedRESTFixtures {
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyAPITests
        .deletingLastPathComponent()  // Tests
        .appendingPathComponent("CrossyProtocolTests", isDirectory: true)
        .appendingPathComponent("Fixtures", isDirectory: true)
        .appendingPathComponent("rest", isDirectory: true)

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent("\(name).json"))
    }
}

/// Parse JSON to its Foundation graph for order-insensitive comparison (JSON key order
/// is not part of the contract).
func jsonObject(_ data: Data) throws -> NSObject {
    // Force-cast is fine in test plumbing: every payload is a JSON object or array.
    try JSONSerialization.jsonObject(with: data) as! NSObject
}

/// What the stub saw for one request, captured as a value because `URLRequest` hands
/// the body over as a stream that can be drained once.
struct RecordedRequest: Sendable {
    let method: String
    let url: URL
    let headers: [String: String]
    let body: Data?

    var path: String { url.path }

    var queryItems: [URLQueryItem] {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    }

    func queryValue(_ name: String) -> String? {
        queryItems.first { $0.name == name }?.value
    }
}

/// Intercepts every request of a session configured with this protocol class. State is
/// static (URLSession instantiates the class itself), guarded by a lock; XCTest runs
/// the methods of a case serially, so per-test `install` + read-back is race-free.
final class StubURLProtocol: URLProtocol {
    typealias Handler = @Sendable (RecordedRequest) throws -> (status: Int, body: Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: Handler?
    nonisolated(unsafe) private static var recorded: [RecordedRequest] = []

    /// Set the responder for the requests that follow and clear the recording.
    static func install(_ handler: @escaping Handler) {
        lock.lock()
        defer { lock.unlock() }
        self.handler = handler
        recorded = []
    }

    static var recordedRequests: [RecordedRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let seen = RecordedRequest(
            method: request.httpMethod ?? "",
            url: request.url!,
            headers: request.allHTTPHeaderFields ?? [:],
            body: Self.drainBody(of: request))
        Self.lock.lock()
        Self.recorded.append(seen)
        let handler = Self.handler
        Self.lock.unlock()

        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        do {
            let (status, body) = try handler(seen)
            let response = HTTPURLResponse(
                url: seen.url, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func drainBody(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 4096
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: bufferSize)
            guard read > 0 else { break }
            data.append(buffer, count: read)
        }
        return data.isEmpty ? nil : data
    }
}

@available(macOS 12.0, iOS 15.0, *)
struct FixedTokenProvider: BearerTokenProviding {
    let token: String
    func currentToken() async throws -> String { token }
}

@available(macOS 12.0, iOS 15.0, *)
struct NoSessionTokenProvider: BearerTokenProviding {
    struct NoSession: Error {}
    func currentToken() async throws -> String { throw NoSession() }
}

/// A provider that separates the proactive token from the forced refresh, so the 401
/// retry path is drivable: `currentToken()` serves the stale token the server will
/// reject; `refreshedToken()` serves a fresh one (or throws when `refreshOutcome` is set
/// to). Both call counts are recorded.
@available(macOS 12.0, iOS 15.0, *)
final class StaleThenFreshTokenProvider: BearerTokenProviding, @unchecked Sendable {
    enum RefreshOutcome {
        case fresh(String)
        case throwing(any Error)
    }

    let staleToken: String
    let refreshOutcome: RefreshOutcome

    // No lock: NSLock.lock()/unlock() are unavailable from the async provider methods
    // under strict concurrency (Swift 6). This spy is driven sequentially within one task
    // per test (currentToken, then a forced refreshedToken on a 401), so the counts never
    // race; @unchecked Sendable carries that promise.
    private var currentCalls = 0
    private var refreshCalls = 0

    init(stale: String, refresh: RefreshOutcome) {
        self.staleToken = stale
        self.refreshOutcome = refresh
    }

    var currentTokenCallCount: Int { currentCalls }
    var refreshedTokenCallCount: Int { refreshCalls }

    func currentToken() async throws -> String {
        currentCalls += 1
        return staleToken
    }

    func refreshedToken() async throws -> String {
        refreshCalls += 1
        switch refreshOutcome {
        case .fresh(let token):
            return token
        case .throwing(let error):
            throw error
        }
    }
}

/// A client whose session routes every request into `StubURLProtocol`.
@available(macOS 12.0, iOS 15.0, *)
func makeStubbedClient(
    tokenProvider: any BearerTokenProviding = FixedTokenProvider(token: "test-token")
) -> CrossyAPIClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    return CrossyAPIClient(
        baseURL: URL(string: "https://api.crossy.test")!,
        tokenProvider: tokenProvider,
        session: URLSession(configuration: configuration))
}
