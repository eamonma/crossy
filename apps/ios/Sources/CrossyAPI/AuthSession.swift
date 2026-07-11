// The auth session (roadmap I3a): the one object that walks AuthStateMachine and
// owns the effects around it. Sign-in is PKCE through the web seam, exchange through
// SupabaseAuthClient, persistence through the Keychain seam; currentToken() is the
// silent-refresh path every REST call and socket dial rides (BearerTokenProviding,
// so CrossyAPIClient and the transport's token closure consume this directly).
// The fixture path (the CROSSY_IT_* pattern) implements BearerTokenProviding with an
// injected token instead and never constructs this type; both sides of that seam are
// interchangeable everywhere a token flows.
//
// @MainActor and @Observable, the GameStore posture (AD-3): the phase drives SwiftUI
// routing (Welcome vs Rooms), reads are synchronous, and the effects hop off-main
// inside URLSession anyway.

import Foundation
import Observation

/// Thrown by `currentToken()` when there is no session to speak for. Surfaces as
/// `CrossyAPIError.tokenUnavailable` at the REST client.
public struct SignedOutError: Error, Equatable {
    public init() {}
}

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class AuthSession {
    /// The Keychain account the session blob lives under (one session, one account).
    public static let keychainAccount = "supabase-session"

    /// Refresh this many seconds before nominal expiry, so a token never dies in
    /// flight between the check here and the server's own clock.
    public static let refreshMargin: TimeInterval = 60

    public private(set) var machine = AuthStateMachine()
    public var phase: AuthPhase { machine.phase }

    /// The signed-in user id when the grant carried one (display concerns only;
    /// identity authority is the token itself, DESIGN.md §8).
    public var userId: String? { stored?.userId }

    private let client: SupabaseAuthClient
    private let web: any WebAuthenticating
    private let apple: any AppleAuthenticating
    private let keychain: any KeychainStoring
    private let now: @Sendable () -> Date

    private var stored: SupabaseSession?
    /// One refresh at a time: concurrent `currentToken()` callers join the in-flight
    /// grant instead of racing the machine (and the refresh-token rotation).
    private var refreshTask: Task<SupabaseSession, Error>?

    public init(
        client: SupabaseAuthClient,
        web: any WebAuthenticating,
        apple: any AppleAuthenticating,
        keychain: any KeychainStoring,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.client = client
        self.web = web
        self.apple = apple
        self.keychain = keychain
        self.now = now
    }

    // MARK: - Lifecycle

    /// Restore the Keychain session at launch. No network: a stale token is the
    /// silent-refresh path's problem on first use, not a reason to gate launch.
    public func restore() {
        guard let data = try? keychain.read(account: Self.keychainAccount),
            let session = try? JSONDecoder().decode(SupabaseSession.self, from: data)
        else { return }
        stored = session
        machine.apply(.sessionRestored)
    }

    /// The full sign-in leg: PKCE pair, the web sheet, the code exchange, persist.
    /// Every exit is a machine event, so the UI's routing follows the phase alone.
    public func signIn() async {
        guard machine.apply(.signInStarted) else { return }
        let verifier = PKCE.verifier()
        let url = client.authorizeURL(codeChallenge: PKCE.challenge(for: verifier))
        do {
            let callback = try await web.authenticate(
                url: url, callbackScheme: client.configuration.callbackScheme)
            guard let code = SupabaseAuthClient.authorizationCode(fromCallback: callback)
            else { throw SupabaseAuthError.invalidCallback }
            let session = try await client.exchangeCode(code, verifier: verifier, now: now())
            persist(session)
            machine.apply(.signInCompleted)
        } catch WebAuthenticationError.canceled {
            machine.apply(.signInCanceled)
        } catch {
            machine.apply(.signInFailed)
        }
    }

    /// The Apple sign-in leg (roadmap I3a, second provider): a nonce, the system sheet,
    /// the id_token grant, persist. It walks the same machine as signIn(), so the two
    /// providers are interchangeable to the UI's routing (no new phases). The raw nonce
    /// stays here for the grant; Apple only ever sees its hash.
    ///
    /// The name leg is best-effort and swallowed: Apple hands the full name only on the
    /// first authorization, so when it arrives we push it to GoTrue and, if that took,
    /// run one immediate refresh so the very next access token carries the name into the
    /// server's display-name mirror (the API coalesces, so a nameless later token never
    /// clobbers it; without this the mirror sits null until the natural refresh). Any
    /// failure in this leg leaves the session standing.
    public func signInWithApple() async {
        guard machine.apply(.signInStarted) else { return }
        let rawNonce = PKCE.verifier()
        do {
            let authorization = try await apple.authenticate(
                nonceChallenge: AppleNonce.challenge(for: rawNonce))
            let session = try await client.exchangeAppleIDToken(
                authorization.idToken, nonce: rawNonce, now: now())
            persist(session)
            if let fullName = authorization.fullName {
                await pushFullName(fullName, on: session)
            }
            machine.apply(.signInCompleted)
        } catch AppleAuthenticationError.canceled {
            machine.apply(.signInCanceled)
        } catch {
            machine.apply(.signInFailed)
        }
    }

    /// Push the Apple name into the display-name mirror once, then refresh so the next
    /// token carries it. Best-effort throughout: any failure here leaves `session` as the
    /// persisted truth and the sign-in stands.
    private func pushFullName(_ fullName: String, on session: SupabaseSession) async {
        guard await client.updateUserFullName(fullName, accessToken: session.accessToken)
        else { return }
        guard let refreshed = try? await client.refresh(
            refreshToken: session.refreshToken, now: now())
        else { return }
        persist(refreshed)
    }

    /// Sign out: revoke best-effort, clear the Keychain, drop the session. Local
    /// clearing never waits on the network verdict.
    public func signOut() async {
        let token = stored?.accessToken
        stored = nil
        refreshTask?.cancel()
        refreshTask = nil
        try? keychain.remove(account: Self.keychainAccount)
        machine.apply(.signedOut)
        if let token {
            await client.signOut(accessToken: token)
        }
    }

    // MARK: - The token path (BearerTokenProviding)

    /// The current bearer token, refreshed silently when within the expiry margin.
    /// A terminal refusal ends the session honestly (Keychain cleared, phase signed
    /// out); network weather returns the stored token unjudged, and the API's own
    /// UNAUTHORIZED, if it comes, is the surfaced truth.
    public func currentToken() async throws -> String {
        guard let session = stored else { throw SignedOutError() }
        if now().timeIntervalSince1970 < session.expiresAt - Self.refreshMargin {
            return session.accessToken
        }

        let task =
            refreshTask
            ?? Task { [client, now] in
                try await client.refresh(refreshToken: session.refreshToken, now: now())
            }
        refreshTask = task
        machine.apply(.refreshStarted)
        defer { refreshTask = nil }

        do {
            let refreshed = try await task.value
            persist(refreshed)
            machine.apply(.refreshSucceeded)
            return refreshed.accessToken
        } catch SupabaseAuthError.refused {
            stored = nil
            try? keychain.remove(account: Self.keychainAccount)
            machine.apply(.refreshFailedTerminal)
            throw SignedOutError()
        } catch {
            machine.apply(.refreshFailedTransient)
            return session.accessToken
        }
    }

    private func persist(_ session: SupabaseSession) {
        stored = session
        if let data = try? JSONEncoder().encode(session) {
            try? keychain.write(data, account: Self.keychainAccount)
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
extension AuthSession: BearerTokenProviding {}
