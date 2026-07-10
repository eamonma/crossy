import Foundation
import XCTest

import CrossyAPI

// AuthSession end to end over the seams (roadmap I3a): a fake web leg, the stubbed
// URLSession (StubURLProtocol, the CrossyAPIClient test pattern), and the in-memory
// Keychain. No sheet ever presents and no real Supabase is dialed; the phases walked
// and the requests recorded are the whole story.

// MARK: - Seam fakes

private struct FakeWeb: WebAuthenticating {
    enum Outcome {
        case callback(String)
        case canceled
        case failed
    }

    /// Consumed in order, one per authenticate call; the last outcome repeats (a
    /// retry test scripts [failed, callback]).
    let outcomes: [Outcome]
    /// Records what the session asked the sheet to open.
    let opened: Recorder

    final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var urls: [URL] = []
        var all: [URL] {
            lock.lock()
            defer { lock.unlock() }
            return urls
        }
        func record(_ url: URL) {
            lock.lock()
            defer { lock.unlock() }
            urls.append(url)
        }
    }

    @MainActor
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        opened.record(url)
        let index = min(opened.all.count - 1, outcomes.count - 1)
        switch outcomes[index] {
        case .callback(let raw):
            return URL(string: raw)!
        case .canceled:
            throw WebAuthenticationError.canceled
        case .failed:
            throw WebAuthenticationError.failed(underlying: URLError(.timedOut))
        }
    }
}

// MARK: - Fixtures

private let grantBody = Data(
    """
    {
      "access_token": "granted-access",
      "token_type": "bearer",
      "expires_in": 3600,
      "expires_at": 4102444800,
      "refresh_token": "granted-refresh",
      "user": { "id": "11111111-2222-3333-4444-555555555555" }
    }
    """.utf8)

@available(iOS 17.0, macOS 14.0, *)
@MainActor
private func makeSession(
    web: [FakeWeb.Outcome] = [.callback("crossy://auth/callback?code=the-code")],
    keychain: any KeychainStoring = InMemoryKeychain(),
    now: @escaping @Sendable () -> Date = { Date(timeIntervalSince1970: 1_000_000) }
) -> (session: AuthSession, opened: FakeWeb.Recorder, keychain: any KeychainStoring) {
    let configuration = SupabaseAuthConfiguration(
        supabaseURL: "https://api.crossy.me",
        publishableKey: "sb_publishable_test",
        redirect: "crossy://auth/callback")!
    let stubbed = URLSessionConfiguration.ephemeral
    stubbed.protocolClasses = [StubURLProtocol.self]
    let client = SupabaseAuthClient(
        configuration: configuration, session: URLSession(configuration: stubbed))
    let opened = FakeWeb.Recorder()
    let session = AuthSession(
        client: client,
        web: FakeWeb(outcomes: web, opened: opened),
        keychain: keychain,
        now: now)
    return (session, opened, keychain)
}

// MARK: - The suite

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class AuthSessionTests: XCTestCase {
    func test_signInWalksPKCEExchangesTheCodeAndPersistsToTheKeychain() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, opened, keychain) = makeSession()

        await session.signIn()

        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertEqual(session.userId, "11111111-2222-3333-4444-555555555555")

        // The sheet opened the authorize URL on the CONFIGURED origin verbatim
        // (deploy/README.md issuer trap: the custom domain fronts auth while tokens
        // keep the ref-domain iss; nothing here derives or rewrites an origin).
        let authorize = try XCTUnwrap(opened.all.first)
        XCTAssertEqual(authorize.host, "api.crossy.me")
        XCTAssertEqual(authorize.path, "/auth/v1/authorize")
        let query = URLComponents(url: authorize, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first { $0.name == "provider" }?.value, "discord")
        XCTAssertEqual(query?.first { $0.name == "code_challenge_method" }?.value, "s256")
        XCTAssertEqual(
            query?.first { $0.name == "redirect_to" }?.value, "crossy://auth/callback")
        let challenge = query?.first { $0.name == "code_challenge" }?.value
        XCTAssertEqual(challenge?.count, 43, "an S256 challenge rode along")

        // The exchange hit the pkce grant with the code and a verifier matching the
        // challenge the sheet saw.
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.url.host, "api.crossy.me")
        XCTAssertEqual(request.path, "/auth/v1/token")
        XCTAssertEqual(request.queryValue("grant_type"), "pkce")
        XCTAssertEqual(request.headers["Apikey"] ?? request.headers["apikey"], "sb_publishable_test")
        let body = try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["auth_code"], "the-code")
        XCTAssertEqual(PKCE.challenge(for: try XCTUnwrap(body["code_verifier"])), challenge)

        // Keychain holds the session blob (ROADMAP I3a: session in the Keychain).
        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "granted-access")
        XCTAssertEqual(persisted.refreshToken, "granted-refresh")

        // And the token provider serves it without any further network.
        StubURLProtocol.install { _ in (500, Data()) }
        let token = try await session.currentToken()
        XCTAssertEqual(token, "granted-access")
        XCTAssertTrue(StubURLProtocol.recordedRequests.isEmpty, "a fresh token needs no refresh")
    }

    func test_cancelingTheSheetReturnsToSignedOutAndWritesNothing() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, keychain) = makeSession(web: [.canceled])

        await session.signIn()

        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
        XCTAssertTrue(StubURLProtocol.recordedRequests.isEmpty, "no code, no exchange")
    }

    func test_aWebFailureLandsInFailedWithRetryOpen_EXPERIENCEWelcomeRetry() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _) = makeSession(web: [.failed, .callback("crossy://auth/callback?code=the-code")])

        await session.signIn()
        XCTAssertEqual(session.phase, .failed)

        // EXPERIENCE.md §3: failure returns to Welcome with a plain retry; the same
        // signIn() runs again from failed.
        await session.signIn()
        XCTAssertEqual(session.phase, .signedIn)
    }

    func test_aCallbackWithoutACodeIsAFailureNotACrash() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _) = makeSession(
            web: [.callback("crossy://auth/callback?error=access_denied")])

        await session.signIn()
        XCTAssertEqual(session.phase, .failed)
        XCTAssertTrue(StubURLProtocol.recordedRequests.isEmpty)
    }

    func test_restoreSignsInFromTheKeychainWithNoNetwork() async throws {
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stored-access", refreshToken: "stored-refresh",
            expiresAt: 2_000_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in (500, Data()) }
        let (session, _, _) = makeSession(keychain: keychain)

        session.restore()

        XCTAssertEqual(session.phase, .signedIn)
        let token = try await session.currentToken()
        XCTAssertEqual(token, "stored-access")
        XCTAssertTrue(StubURLProtocol.recordedRequests.isEmpty)
    }

    func test_anExpiringTokenRefreshesSilentlyAndPersistsTheNewSession() async throws {
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "stored-refresh",
            expiresAt: 1_000_030, userId: "u1")  // inside the 60 s margin
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _) = makeSession(keychain: keychain)
        session.restore()

        let token = try await session.currentToken()

        XCTAssertEqual(token, "granted-access")
        XCTAssertEqual(session.phase, .signedIn)
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.queryValue("grant_type"), "refresh_token")
        let body = try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["refresh_token"], "stored-refresh")
        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "granted-access", "the rotation persisted")
    }

    func test_aRefusedRefreshEndsTheSessionAndClearsTheKeychain() async throws {
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "dead-refresh",
            expiresAt: 999_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in (401, Data(#"{"error":"invalid_grant"}"#.utf8)) }
        let (session, _, _) = makeSession(keychain: keychain)
        session.restore()

        do {
            _ = try await session.currentToken()
            XCTFail("a dead refresh token cannot produce a bearer")
        } catch is SignedOutError {
            // the honest outcome
        }
        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
    }

    func test_refreshNetworkWeatherKeepsTheSessionAndReturnsTheStoredToken() async throws {
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "stored-refresh",
            expiresAt: 999_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in throw URLError(.notConnectedToInternet) }
        let (session, _, _) = makeSession(keychain: keychain)
        session.restore()

        let token = try await session.currentToken()

        // Weather judges nothing: the stored token rides and the API's verdict, if
        // it comes, is UNAUTHORIZED surfaced through the normal error path.
        XCTAssertEqual(token, "stale-access")
        XCTAssertEqual(session.phase, .signedIn)
    }

    func test_signOutClearsTheKeychainAndTheTokenPathThrows() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, keychain) = makeSession()
        await session.signIn()
        XCTAssertEqual(session.phase, .signedIn)

        StubURLProtocol.install { _ in (204, Data()) }
        await session.signOut()

        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
        do {
            _ = try await session.currentToken()
            XCTFail("no session, no token")
        } catch is SignedOutError {}
        // The revoke was attempted best-effort against the logout endpoint.
        XCTAssertEqual(StubURLProtocol.recordedRequests.first?.path, "/auth/v1/logout")
    }

    func test_anEmptyConfigurationResolvesNilSoTheUnconfiguredStateIsHonest() {
        // CrossyConfig.plist slots can ship empty; the seam answers nil and the
        // Welcome screen shows one plain sentence (EXPERIENCE.md §3), never a crash.
        XCTAssertNil(
            SupabaseAuthConfiguration(
                supabaseURL: "", publishableKey: "sb_publishable_x",
                redirect: "crossy://auth/callback"))
        XCTAssertNil(
            SupabaseAuthConfiguration(
                supabaseURL: "https://api.crossy.me", publishableKey: "",
                redirect: "crossy://auth/callback"))
        XCTAssertNil(
            SupabaseAuthConfiguration(
                supabaseURL: nil, publishableKey: nil, redirect: "crossy://auth/callback"))
        XCTAssertNotNil(
            SupabaseAuthConfiguration(
                supabaseURL: "https://api.crossy.me", publishableKey: "sb_publishable_x",
                redirect: "crossy://auth/callback"))
    }
}
