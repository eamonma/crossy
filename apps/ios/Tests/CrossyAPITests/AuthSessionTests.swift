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

private struct FakeApple: AppleAuthenticating {
    enum Outcome {
        case authorization(idToken: String, fullName: String?)
        case canceled
        case failed
    }

    let outcome: Outcome
    /// Records the nonce challenge the session handed Apple (the hashed form).
    let challenges: Recorder

    final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String] = []
        var all: [String] {
            lock.lock()
            defer { lock.unlock() }
            return values
        }
        func record(_ value: String) {
            lock.lock()
            defer { lock.unlock() }
            values.append(value)
        }
    }

    @MainActor
    func authenticate(nonceChallenge: String) async throws -> AppleIDAuthorization {
        challenges.record(nonceChallenge)
        switch outcome {
        case .authorization(let idToken, let fullName):
            return AppleIDAuthorization(idToken: idToken, fullName: fullName)
        case .canceled:
            throw AppleAuthenticationError.canceled
        case .failed:
            throw AppleAuthenticationError.failed(underlying: URLError(.timedOut))
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
    apple: FakeApple.Outcome = .canceled,
    keychain: any KeychainStoring = InMemoryKeychain(),
    now: @escaping @Sendable () -> Date = { Date(timeIntervalSince1970: 1_000_000) }
) -> (
    session: AuthSession, opened: FakeWeb.Recorder, challenges: FakeApple.Recorder,
    keychain: any KeychainStoring
) {
    let configuration = SupabaseAuthConfiguration(
        supabaseURL: "https://api.crossy.party",
        publishableKey: "sb_publishable_test",
        redirect: "crossy://auth/callback")!
    let stubbed = URLSessionConfiguration.ephemeral
    stubbed.protocolClasses = [StubURLProtocol.self]
    let client = SupabaseAuthClient(
        configuration: configuration, session: URLSession(configuration: stubbed))
    let opened = FakeWeb.Recorder()
    let challenges = FakeApple.Recorder()
    let session = AuthSession(
        client: client,
        web: FakeWeb(outcomes: web, opened: opened),
        apple: FakeApple(outcome: apple, challenges: challenges),
        keychain: keychain,
        now: now)
    return (session, opened, challenges, keychain)
}

// MARK: - The suite

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class AuthSessionTests: XCTestCase {
    func test_signInWalksPKCEExchangesTheCodeAndPersistsToTheKeychain() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, opened, _, keychain) = makeSession()

        await session.signIn(provider: .discord)

        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertEqual(session.userId, "11111111-2222-3333-4444-555555555555")

        // The sheet opened the authorize URL on the CONFIGURED origin verbatim
        // (deploy/README.md issuer trap: the custom domain fronts auth while tokens
        // keep the ref-domain iss; nothing here derives or rewrites an origin).
        let authorize = try XCTUnwrap(opened.all.first)
        XCTAssertEqual(authorize.host, "api.crossy.party")
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
        XCTAssertEqual(request.url.host, "api.crossy.party")
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
        let (session, _, _, keychain) = makeSession(web: [.canceled])

        await session.signIn(provider: .discord)

        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
        XCTAssertTrue(StubURLProtocol.recordedRequests.isEmpty, "no code, no exchange")
    }

    func test_aWebFailureLandsInFailedWithRetryOpen_EXPERIENCEWelcomeRetry() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, _) = makeSession(web: [.failed, .callback("crossy://auth/callback?code=the-code")])

        await session.signIn(provider: .discord)
        XCTAssertEqual(session.phase, .failed)

        // EXPERIENCE.md §3: failure returns to Welcome with a plain retry; the same
        // signIn() runs again from failed.
        await session.signIn(provider: .discord)
        XCTAssertEqual(session.phase, .signedIn)
    }

    func test_aCallbackWithoutACodeIsAFailureNotACrash() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, _) = makeSession(
            web: [.callback("crossy://auth/callback?error=access_denied")])

        await session.signIn(provider: .discord)
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
        let (session, _, _, _) = makeSession(keychain: keychain)

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
        let (session, _, _, _) = makeSession(keychain: keychain)
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
        let (session, _, _, _) = makeSession(keychain: keychain)
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
        let (session, _, _, _) = makeSession(keychain: keychain)
        session.restore()

        let token = try await session.currentToken()

        // Weather judges nothing: the stored token rides and the API's verdict, if
        // it comes, is UNAUTHORIZED surfaced through the normal error path.
        XCTAssertEqual(token, "stale-access")
        XCTAssertEqual(session.phase, .signedIn)
    }

    func test_refreshedTokenForcesAGrantEvenWhenTheTokenIsNotNearExpiry() async throws {
        // Unlike currentToken(), refreshedToken() takes no proactive shortcut: it is only
        // called after a server 401, so it always rotates through the refresh token even
        // when the local clock still thinks the access token is comfortably valid.
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "stored-refresh",
            expiresAt: 2_000_000, userId: "u1")  // far outside the 60 s margin
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, _) = makeSession(keychain: keychain)
        session.restore()

        let token = try await session.refreshedToken()

        XCTAssertEqual(token, "granted-access", "the forced refresh rotated the token")
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.queryValue("grant_type"), "refresh_token")
        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "granted-access", "the rotation persisted")
    }

    func test_refreshedTokenOnARefusalPurgesAndThrowsSignedOut() async throws {
        // A terminal refusal is the same honest end as on the proactive path: Keychain
        // cleared, phase signed out, SignedOutError to the caller.
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "dead-refresh",
            expiresAt: 2_000_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in (401, Data(#"{"error":"invalid_grant"}"#.utf8)) }
        let (session, _, _, _) = makeSession(keychain: keychain)
        session.restore()

        do {
            _ = try await session.refreshedToken()
            XCTFail("a dead refresh token cannot produce a bearer")
        } catch is SignedOutError {
            // the honest outcome
        }
        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
    }

    func test_refreshedTokenOnNetworkWeatherThrowsRatherThanReturningTheStaleToken() async throws {
        // The key semantic difference from currentToken(): refreshedToken() is called only
        // after a server 401, so returning the same rejected stale token is useless. On
        // transient weather it rethrows so the API client falls back to surfacing the 401.
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "stored-refresh",
            expiresAt: 2_000_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in throw URLError(.notConnectedToInternet) }
        let (session, _, _, _) = makeSession(keychain: keychain)
        session.restore()

        do {
            _ = try await session.refreshedToken()
            XCTFail("transient weather must not hand back the rejected stale token")
        } catch is SignedOutError {
            XCTFail("network weather is not a sign-out")
        } catch {
            // The underlying error rides through; the session still stands (weather judges
            // nothing), so a later call can retry.
            XCTAssertEqual(session.phase, .signedIn)
            XCTAssertNotNil(
                try keychain.read(account: AuthSession.keychainAccount),
                "weather clears nothing")
        }
    }

    func test_aRateLimitedRefreshIsWeatherNotARefusal() async throws {
        // GoTrue's rate limiter answers 429 without ever judging the grant; the
        // refresh token behind it is still good, so the session must stand exactly
        // as it does for network weather (a real 4xx refusal stays terminal).
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "stored-refresh",
            expiresAt: 999_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in
            (429, Data(#"{"error":"over_request_rate_limit"}"#.utf8))
        }
        let (session, _, _, _) = makeSession(keychain: keychain)
        session.restore()

        let token = try await session.currentToken()

        XCTAssertEqual(token, "stale-access")
        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertNotNil(
            try keychain.read(account: AuthSession.keychainAccount),
            "a rate limit clears nothing")
    }

    func test_aSignOutDuringAnInFlightRefreshDoesNotResurrectTheSession() async throws {
        // The refresh grant is gated on a semaphore so the purge reliably lands while
        // it is in flight. However the race resolves inside (the cancelled task's
        // throw, or a completed value whose continuation runs after the purge), the
        // purge is the standing truth: no Keychain write-back, SignedOutError to the
        // caller — otherwise the next launch's restore() resurrects the account.
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stale-access", refreshToken: "stored-refresh",
            expiresAt: 999_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        let gate = DispatchSemaphore(value: 0)
        StubURLProtocol.install { request in
            if request.queryValue("grant_type") == "refresh_token" {
                gate.wait()
                return (200, grantBody)
            }
            return (204, Data())  // the sign-out's best-effort revoke
        }
        let (session, _, _, _) = makeSession(keychain: keychain)
        session.restore()

        let inFlight = Task { try await session.currentToken() }
        let deadline = Date().addingTimeInterval(5)
        while StubURLProtocol.recordedRequests.isEmpty, Date() < deadline {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTAssertFalse(StubURLProtocol.recordedRequests.isEmpty, "the refresh dialed")
        session.purgeForAccountDeletion()
        gate.signal()

        do {
            _ = try await inFlight.value
            XCTFail("a signed-out session cannot produce a bearer")
        } catch is SignedOutError {
            // the honest outcome
        }
        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(
            try keychain.read(account: AuthSession.keychainAccount),
            "the in-flight refresh must not write the session back")
    }

    func test_signOutClearsTheKeychainAndTheTokenPathThrows() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, keychain) = makeSession()
        await session.signIn(provider: .discord)
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

    // MARK: - Sign in with Apple (roadmap I3a, second provider)

    func test_signInWithAppleWalksTheNonceExchangesTheTokenAndPersists() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, challenges, keychain) = makeSession(
            apple: .authorization(idToken: "apple-id-token", fullName: nil))

        await session.signInWithApple()

        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertEqual(session.userId, "11111111-2222-3333-4444-555555555555")

        // Apple saw the hashed nonce, hex form (AppleNonce.challenge), never a raw one.
        let challenge = try XCTUnwrap(challenges.all.first)
        XCTAssertEqual(challenge.count, 64, "SHA-256 hex is 64 chars")
        XCTAssertTrue(challenge.allSatisfy { "0123456789abcdef".contains($0) })

        // The exchange hit the id_token grant with the provider, the token, and the RAW
        // nonce whose hex is exactly what Apple saw.
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.path, "/auth/v1/token")
        XCTAssertEqual(request.queryValue("grant_type"), "id_token")
        let body = try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["provider"], "apple")
        XCTAssertEqual(body["id_token"], "apple-id-token")
        XCTAssertEqual(AppleNonce.challenge(for: try XCTUnwrap(body["nonce"])), challenge)

        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "granted-access")
    }

    func test_cancelingAppleReturnsQuietlyToSignedOut() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, keychain) = makeSession(apple: .canceled)

        await session.signInWithApple()

        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
        XCTAssertTrue(StubURLProtocol.recordedRequests.isEmpty, "no authorization, no grant")
    }

    func test_anAppleFailureLandsInFailedWithRetryOpen() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, _) = makeSession(apple: .failed)

        await session.signInWithApple()

        XCTAssertEqual(session.phase, .failed)
        XCTAssertTrue(StubURLProtocol.recordedRequests.isEmpty)
    }

    func test_appleFullNameIsPushedThenRefreshedSoTheNextTokenCarriesTheMirror() async throws {
        // The grant returns the first session; the name push takes; the immediate refresh
        // returns a second session, which must be the one that persists (so the very next
        // access token carries the name into the server's display-name mirror).
        let refreshedGrant = Data(
            """
            {
              "access_token": "named-access",
              "token_type": "bearer",
              "expires_at": 4102444800,
              "refresh_token": "named-refresh",
              "user": { "id": "11111111-2222-3333-4444-555555555555" }
            }
            """.utf8)
        StubURLProtocol.install { request in
            switch request.queryValue("grant_type") {
            case "id_token": return (200, grantBody)
            case "refresh_token": return (200, refreshedGrant)
            default:
                // The PUT /user name push: any 2xx signals it took.
                return (200, Data("{}".utf8))
            }
        }
        let (session, _, _, keychain) = makeSession(
            apple: .authorization(idToken: "apple-id-token", fullName: "Ada Lovelace"))

        await session.signInWithApple()

        XCTAssertEqual(session.phase, .signedIn)
        let requests = StubURLProtocol.recordedRequests
        // Three legs in order: the id_token grant, the PUT /user, the refresh.
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(requests[0].queryValue("grant_type"), "id_token")
        XCTAssertEqual(requests[1].method, "PUT")
        XCTAssertEqual(requests[1].path, "/auth/v1/user")
        let namePush = try JSONDecoder().decode(
            [String: [String: String]].self, from: XCTUnwrap(requests[1].body))
        XCTAssertEqual(namePush["data"]?["full_name"], "Ada Lovelace")
        XCTAssertEqual(requests[2].queryValue("grant_type"), "refresh_token")

        // The refreshed session is the persisted truth, so the next token is the named one.
        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "named-access")
    }

    func test_aFailedNamePushStillCompletesSignInWithTheOriginalSession() async throws {
        // The name leg is best-effort: a refused PUT /user is swallowed, no refresh runs,
        // and the original granted session stands as the persisted truth.
        StubURLProtocol.install { request in
            switch request.queryValue("grant_type") {
            case "id_token": return (200, grantBody)
            default:
                return (500, Data("{}".utf8))  // the PUT /user push fails
            }
        }
        let (session, _, _, keychain) = makeSession(
            apple: .authorization(idToken: "apple-id-token", fullName: "Ada Lovelace"))

        await session.signInWithApple()

        XCTAssertEqual(session.phase, .signedIn)
        let requests = StubURLProtocol.recordedRequests
        // The grant and the failed push; no refresh, because the push did not take.
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].queryValue("grant_type"), "id_token")
        XCTAssertEqual(requests[1].path, "/auth/v1/user")
        XCTAssertFalse(
            requests.contains { $0.queryValue("grant_type") == "refresh_token" },
            "a failed name push runs no refresh")

        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "granted-access", "the original session stands")
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
                supabaseURL: "https://api.crossy.party", publishableKey: "",
                redirect: "crossy://auth/callback"))
        XCTAssertNil(
            SupabaseAuthConfiguration(
                supabaseURL: nil, publishableKey: nil, redirect: "crossy://auth/callback"))
        XCTAssertNotNil(
            SupabaseAuthConfiguration(
                supabaseURL: "https://api.crossy.party", publishableKey: "sb_publishable_x",
                redirect: "crossy://auth/callback"))
    }

    // MARK: - Provider marker (roadmap I3, settings: the Account screen names the provider)

    func test_signInRemembersDiscordAndSurvivesARelaunch() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let keychain = InMemoryKeychain()
        let (session, _, _, _) = makeSession(keychain: keychain)

        await session.signIn(provider: .discord)
        XCTAssertEqual(session.provider, .discord)

        // A relaunch restores only from the Keychain: the marker still names the provider.
        StubURLProtocol.install { _ in (500, Data()) }
        let (relaunched, _, _, _) = makeSession(keychain: keychain)
        relaunched.restore()
        XCTAssertEqual(relaunched.phase, .signedIn)
        XCTAssertEqual(relaunched.provider, .discord, "the marker survives a relaunch")
    }

    func test_signInWithAppleRemembersApple() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, _) = makeSession(
            apple: .authorization(idToken: "apple-id-token", fullName: nil))

        await session.signInWithApple()
        XCTAssertEqual(session.provider, .apple)
    }

    func test_signOutForgetsTheProviderMarker() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let keychain = InMemoryKeychain()
        let (session, _, _, _) = makeSession(keychain: keychain)
        await session.signIn(provider: .discord)
        XCTAssertEqual(session.provider, .discord)

        StubURLProtocol.install { _ in (204, Data()) }
        await session.signOut()

        XCTAssertNil(session.provider)
        XCTAssertNil(
            try keychain.read(account: AuthSession.providerKeychainAccount),
            "the marker is cleared alongside the session")
    }

    func test_accountDeletionPurgeDropsTheSessionAndProviderAndLandsSignedOut() async throws {
        StubURLProtocol.install { _ in (200, grantBody) }
        let keychain = InMemoryKeychain()
        let (session, _, _, _) = makeSession(keychain: keychain)
        await session.signIn(provider: .discord)
        XCTAssertEqual(session.phase, .signedIn)

        // The server-side DELETE /account is the API client's; this is the local purge
        // the composition root runs on its success, with no vendor logout call.
        session.purgeForAccountDeletion()

        XCTAssertEqual(session.phase, .signedOut)
        XCTAssertNil(session.provider)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
        XCTAssertNil(try keychain.read(account: AuthSession.providerKeychainAccount))
        do {
            _ = try await session.currentToken()
            XCTFail("a deleted account has no token")
        } catch is SignedOutError {}
    }

    func test_restoringAPreMarkerSessionNamesNoProvider() async throws {
        // A session written by a build before the marker existed restores fine and
        // simply names no provider (the Account screen degrades, never misreports).
        let keychain = InMemoryKeychain()
        let stored = SupabaseSession(
            accessToken: "stored-access", refreshToken: "stored-refresh",
            expiresAt: 2_000_000, userId: "u1")
        try keychain.write(
            try JSONEncoder().encode(stored), account: AuthSession.keychainAccount)
        StubURLProtocol.install { _ in (500, Data()) }
        let (session, _, _, _) = makeSession(keychain: keychain)

        session.restore()

        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertNil(session.provider, "no marker, no provider named")
    }

    // MARK: - Secondary sign-in methods (roadmap I3b)

    func test_hisbaanRidesTheSameWebLegWithTheEncodedProviderAndRemembersItself() async throws {
        // hisbaan is a custom OIDC provider on the identical PKCE web flow Discord uses;
        // only the provider value and the remembered marker differ. The ":" must land on the
        // wire percent-encoded (custom%3Ahisbaan) yet decode back to the raw provider.
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, opened, _, _) = makeSession()

        await session.signIn(provider: .hisbaan)

        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertEqual(session.provider, .hisbaan, "the leg remembers hisbaan")

        let authorize = try XCTUnwrap(opened.all.first)
        XCTAssertEqual(authorize.host, "api.crossy.party")
        XCTAssertEqual(authorize.path, "/auth/v1/authorize")
        // On the wire the colon is encoded (some proxies mis-split a bare colon).
        XCTAssertTrue(
            authorize.absoluteString.contains("provider=custom%3Ahisbaan"),
            "the raw colon is percent-encoded on the wire")
        // Decoded, it reads back the exact provider raw value GoTrue expects.
        let query = URLComponents(url: authorize, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first { $0.name == "provider" }?.value, "custom:hisbaan")

        // The exchange still hit the pkce grant, exactly as Discord's leg does.
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.path, "/auth/v1/token")
        XCTAssertEqual(request.queryValue("grant_type"), "pkce")
    }

    func test_verifyEmailOTPWalksAuthenticatingToSignedInAndRemembersEmail() async throws {
        // The two-step email flow's second step: a good code drives .authenticating ->
        // .signedIn, persists the session, and remembers the email provider.
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, keychain) = makeSession()

        try await session.verifyEmailOTP(email: "ada@example.com", code: "123456")

        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertEqual(session.provider, .emailOTP)
        XCTAssertEqual(session.userId, "11111111-2222-3333-4444-555555555555")

        // The verify hit /auth/v1/verify with the email type, the address, and the code.
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/auth/v1/verify")
        XCTAssertEqual(request.headers["Apikey"] ?? request.headers["apikey"], "sb_publishable_test")
        let body = try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["type"], "email")
        XCTAssertEqual(body["email"], "ada@example.com")
        XCTAssertEqual(body["token"], "123456")

        // And the session persisted for the token path.
        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "granted-access")
    }

    func test_verifyEmailOTPWithABadCodeLandsInFailedAndRethrows() async throws {
        // A refused code (4xx) returns to the failed state (EXPERIENCE.md §3 retry) and
        // surfaces the typed error so the sheet can render the inline reason too.
        StubURLProtocol.install { _ in (403, Data(#"{"error":"otp_expired"}"#.utf8)) }
        let (session, _, _, keychain) = makeSession()

        do {
            try await session.verifyEmailOTP(email: "ada@example.com", code: "000000")
            XCTFail("a refused code must throw")
        } catch let error as SupabaseAuthError {
            guard case .refused(let status) = error else {
                return XCTFail("a 4xx code refusal is .refused, got \(error)")
            }
            XCTAssertEqual(status, 403)
        }

        XCTAssertEqual(session.phase, .failed)
        XCTAssertNil(session.provider, "a failed verify remembers nothing")
        XCTAssertNil(
            try keychain.read(account: AuthSession.keychainAccount),
            "a failed verify persists nothing")
    }

    func test_sendEmailOTPPostsTheSendRequestAndLeavesThePhaseAlone() async throws {
        // Step one only asks the server to send the code; no session comes back and the
        // phase does not move (a later sheet owns the local sub-state).
        StubURLProtocol.install { _ in (200, Data("{}".utf8)) }
        let (session, _, _, _) = makeSession()
        XCTAssertEqual(session.phase, .signedOut)

        try await session.sendEmailOTP(email: "ada@example.com")

        XCTAssertEqual(session.phase, .signedOut, "sending the code moves no phase")
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/auth/v1/otp")
        // create_user mints an account on first sight, so a new email signs in.
        let body = try jsonObject(XCTUnwrap(request.body))
        XCTAssertEqual(body, try jsonObject(Data(#"{"email":"ada@example.com","create_user":true}"#.utf8)))
    }

    func test_sendEmailOTPSurfacesTheServerRefusal() async throws {
        // The send leg surfaces its error straight through for the sheet to render.
        StubURLProtocol.install { _ in (429, Data(#"{"error":"over_email_send_rate_limit"}"#.utf8)) }
        let (session, _, _, _) = makeSession()

        do {
            try await session.sendEmailOTP(email: "ada@example.com")
            XCTFail("a refused send must throw")
        } catch is SupabaseAuthError {
            // the typed error rides through
        }
        XCTAssertEqual(session.phase, .signedOut, "a failed send moves no phase")
    }

    func test_completeMagicLinkVerifiesTheTokenHashAndSignsIn() async throws {
        // The magic-link path (a later wave routes CrossyApp here): the token_hash and its
        // type verify to a session, driving .authenticating -> .signedIn and remembering
        // the email provider.
        StubURLProtocol.install { _ in (200, grantBody) }
        let (session, _, _, keychain) = makeSession()

        try await session.completeMagicLink(tokenHash: "the-hash", type: "magiclink")

        XCTAssertEqual(session.phase, .signedIn)
        XCTAssertEqual(session.provider, .emailOTP)

        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.path, "/auth/v1/verify")
        let body = try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["type"], "magiclink")
        XCTAssertEqual(body["token_hash"], "the-hash")
        XCTAssertNil(body["email"], "the link verify carries no email, only the hash")

        let blob = try XCTUnwrap(try keychain.read(account: AuthSession.keychainAccount))
        let persisted = try JSONDecoder().decode(SupabaseSession.self, from: blob)
        XCTAssertEqual(persisted.accessToken, "granted-access")
    }

    func test_completeMagicLinkOnARefusalLandsInFailedAndRethrows() async throws {
        // A dead or reused link (4xx) returns to the failed state and surfaces the error.
        StubURLProtocol.install { _ in (401, Data(#"{"error":"token_hash_invalid"}"#.utf8)) }
        let (session, _, _, keychain) = makeSession()

        do {
            try await session.completeMagicLink(tokenHash: "dead-hash", type: "magiclink")
            XCTFail("a dead link must throw")
        } catch is SupabaseAuthError {
            // the typed error rides through
        }

        XCTAssertEqual(session.phase, .failed)
        XCTAssertNil(session.provider)
        XCTAssertNil(try keychain.read(account: AuthSession.keychainAccount))
    }
}
