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

    /// The Keychain account the provider marker lives under: a tiny separate blob so
    /// the session schema (and its tests) stays untouched, and the Account screen can
    /// name the provider after a relaunch when only the token has survived.
    public static let providerKeychainAccount = "auth-provider"

    /// Refresh this many seconds before nominal expiry, so a token never dies in
    /// flight between the check here and the server's own clock.
    public static let refreshMargin: TimeInterval = 60

    public private(set) var machine = AuthStateMachine()
    public var phase: AuthPhase { machine.phase }

    /// The signed-in user id when the grant carried one (display concerns only;
    /// identity authority is the token itself, DESIGN.md §8).
    public var userId: String? { stored?.userId }

    /// Which provider minted the standing session, remembered from the leg that ran
    /// and restored from the Keychain marker at launch (display only; nil when a
    /// pre-marker session was restored). The Account screen reads this.
    public private(set) var provider: AuthProvider?

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
        provider = restoredProvider()
        machine.apply(.sessionRestored)
    }

    /// The provider marker as the Keychain holds it, nil when absent or unrecognized
    /// (a pre-marker session, or a value from a future build): display degrades to
    /// "no provider named" rather than misreporting one.
    private func restoredProvider() -> AuthProvider? {
        guard let data = try? keychain.read(account: Self.providerKeychainAccount),
            let raw = String(data: data, encoding: .utf8)
        else { return nil }
        return AuthProvider(rawValue: raw)
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
            recordProvider(.discord)
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
            recordProvider(.apple)
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
        purgeLocal()
        machine.apply(.signedOut)
        if let token {
            await client.signOut(accessToken: token)
        }
    }

    /// The local half of account deletion (roadmap I3, settings): the server-side
    /// `DELETE /account` is the API client's, and lands the tombstone. This purges the
    /// same local state sign-out does, with no vendor logout call (the account is gone,
    /// not just this session), and drops the phase to signed out so routing lands at
    /// Welcome. The composition root calls the REST leg first, then this on success.
    public func purgeForAccountDeletion() {
        purgeLocal()
        machine.apply(.signedOut)
    }

    /// Drop the in-memory session and provider and clear both Keychain blobs. Shared by
    /// sign-out and account deletion; never waits on the network.
    private func purgeLocal() {
        stored = nil
        provider = nil
        refreshTask?.cancel()
        refreshTask = nil
        try? keychain.remove(account: Self.keychainAccount)
        try? keychain.remove(account: Self.providerKeychainAccount)
    }

    /// Remember the provider that minted the standing session, in memory and in the
    /// Keychain marker so a relaunch can still name it. Best-effort: a failed marker
    /// write only costs the provider name after a relaunch, never the sign-in.
    private func recordProvider(_ provider: AuthProvider) {
        self.provider = provider
        if let data = provider.rawValue.data(using: .utf8) {
            try? keychain.write(data, account: Self.providerKeychainAccount)
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
        do {
            return try await performRefresh(session)
        } catch let transient as TransientRefreshError {
            // Weather judges nothing: the stored token rides and the API's verdict,
            // if it comes, is UNAUTHORIZED surfaced through the normal error path.
            return transient.staleToken
        }
    }

    /// Force a refresh through the stored refresh token, with no proactive shortcut. The
    /// REST client calls this after a server 401 on a token the local clock still thought
    /// was valid, so replaying the same rejected token is useless: a transient/network
    /// failure here throws (the client falls back to surfacing the original 401) rather
    /// than returning the stale token that was just rejected. A terminal refusal still
    /// ends the session (Keychain cleared, phase signed out).
    public func refreshedToken() async throws -> String {
        guard let session = stored else { throw SignedOutError() }
        do {
            return try await performRefresh(session)
        } catch let transient as TransientRefreshError {
            throw transient.underlying
        }
    }

    /// The stale token from a transient refresh failure, so the two callers can differ:
    /// `currentToken()` returns it (weather is not a sign-out), `refreshedToken()` rethrows
    /// the underlying error (the stale token was just rejected by the server's 401).
    private struct TransientRefreshError: Error {
        let staleToken: String
        let underlying: any Error
    }

    /// The shared refresh grant both token entry points ride: run or join the single-flight
    /// `refreshTask` so a `currentToken()` and a `refreshedToken()` racing never double-spend
    /// the rotating refresh token. On success persist and return the fresh token; on a
    /// terminal refusal purge and throw `SignedOutError`; on transient/network weather throw
    /// `TransientRefreshError` for the caller to resolve.
    private func performRefresh(_ session: SupabaseSession) async throws -> String {
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
            // A sign-out (or account deletion) may have landed while the refresh
            // was in flight; its purge is the standing truth. Persisting here would
            // write the fresh session back into the Keychain and resurrect the
            // account at the next launch's restore().
            guard stored != nil else { throw SignedOutError() }
            persist(refreshed)
            machine.apply(.refreshSucceeded)
            return refreshed.accessToken
        } catch let signedOut as SignedOutError {
            throw signedOut
        } catch SupabaseAuthError.refused {
            stored = nil
            try? keychain.remove(account: Self.keychainAccount)
            machine.apply(.refreshFailedTerminal)
            throw SignedOutError()
        } catch {
            // The same mid-flight purge surfaces here as the cancelled task's throw;
            // signed out is the honest answer, never the pre-purge token.
            guard stored != nil else { throw SignedOutError() }
            machine.apply(.refreshFailedTransient)
            throw TransientRefreshError(staleToken: session.accessToken, underlying: error)
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
