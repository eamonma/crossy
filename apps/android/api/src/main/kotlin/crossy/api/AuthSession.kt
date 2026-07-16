// The auth session: the one object that walks AuthStateMachine and owns the effects around it.
// Twin of apps/ios AuthSession.swift (AAD-3). Sign-in is a Supabase password grant, an email OTP
// verify, or the split OAuth flow (beginOAuth hands the browser leg its URL, completeOAuth digests
// the deep-link callback); persistence is the TokenStore seam, and currentToken() is the
// silent-refresh path every REST call rides (BearerTokenProvider, so CrossyApiClient consumes this
// directly). The injected dev-token path (InjectedTokenProvider) is the interchangeable other side
// of that seam and never constructs this type.
//
// iOS confines this to @MainActor; here confinement is the composition root's job (ARCHITECTURE.md
// AAD-2). The refresh mutex is the one hard concurrency guarantee `:api` makes itself: it
// single-flights the rotating refresh token so two callers never double-spend it.

package crossy.api

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl

/** Thrown by the token path when there is no session to speak for, and by a mid-flight refresh
 *  whose session was purged under it. Surfaces as [CrossyApiError.TokenUnavailable] at the REST
 *  client. Twin of iOS `SignedOutError`. */
public class SignedOutError : Exception("no signed-in session")

/** One in-flight OAuth attempt: the provider the browser was sent to and the PKCE verifier its
 *  challenge was derived from. Held in memory for the warm return and `@Serializable` so the store
 *  can persist it across process death (the cold-return recovery; no iOS twin, whose in-process web
 *  sheet never leaves the app). */
@Serializable
public data class PendingOAuth(val provider: AuthProvider, val verifier: String)

public class AuthSession(
    private val client: SupabaseAuthClient,
    private val store: TokenStore,
    private val nowSeconds: () -> Double = { System.currentTimeMillis() / 1000.0 },
) : BearerTokenProvider {

    public val machine: AuthStateMachine = AuthStateMachine()
    public val phase: AuthPhase get() = machine.phase

    /** The signed-in user id when the grant carried one (display concerns only; identity authority
     *  is the token itself, DESIGN.md §8). */
    public val userId: String? get() = stored?.userId

    /** Which provider minted the standing session, remembered from the leg that ran (display only)
     *  and persisted through the store's provider marker, so a relaunch's [restore] can still name
     *  it (or leaves it null rather than misreporting one when no marker survived). Twin of iOS
     *  `provider` and its Keychain marker. */
    public var provider: AuthProvider? = null
        private set

    @Volatile
    private var stored: SupabaseSession? = null

    /** The one in-flight OAuth attempt: the provider the browser was sent to and the verifier
     *  its challenge was derived from. A second begin supersedes it (the stale verifier can
     *  never match a newer challenge anyway); any completion attempt spends it. Also persisted
     *  through the store, so a cold return (the browser tab outlived the app) can recover it. */
    @Volatile
    private var pendingOAuth: PendingOAuth? = null

    private val refreshMutex = Mutex()

    // MARK: - Lifecycle

    /** Restore the stored session at launch. No network: a stale token is the silent-refresh
     *  path's problem on first use, not a reason to gate launch. */
    public fun restore() {
        val session = store.read() ?: return
        stored = session
        provider = store.readProvider()
        machine.apply(AuthEvent.SESSION_RESTORED)
    }

    /** The email/password sign-in leg (AAD-3): the password grant, then persist. Every exit is a
     *  machine event, so UI routing follows the phase alone. There is no cancel path here (no
     *  sheet to dismiss); failure lands in FAILED with a plain retry. */
    public suspend fun signInWithPassword(email: String, password: String) {
        if (!machine.apply(AuthEvent.SIGN_IN_STARTED)) return
        try {
            val session = client.signInWithPassword(email, password, nowSeconds())
            persist(session)
            machine.apply(AuthEvent.SIGN_IN_COMPLETED)
        } catch (e: Throwable) {
            machine.apply(AuthEvent.SIGN_IN_FAILED)
        }
    }

    // MARK: - OAuth over the browser leg (Discord / Apple / hisbaan)
    //
    // Where iOS runs the whole web hop in-process (ASWebAuthenticationSession awaits the
    // callback), Android's flow is split: the app launches a Custom Tab and the redirect comes
    // back later through a deep link. So the one iOS signIn(provider:) becomes a begin/complete
    // pair, mirroring the sendEmailOTP/verifyEmailOTP two-step: begin is effect-free on the
    // machine (like the OTP send), complete walks it (like the verify).

    /** Step one of the split OAuth flow: mint a fresh PKCE verifier for this attempt, remember
     *  the pending {provider, verifier}, and return the authorize URL for the browser leg to
     *  open. No phase change and no network: an abandoned browser trip leaves nothing to undo,
     *  and a second begin simply supersedes the stale pending. Every provider rides this same
     *  leg, Apple included (no native Apple SDK on Android). */
    public fun beginOAuth(provider: AuthProvider): HttpUrl {
        val verifier = Pkce.verifier()
        val pending = PendingOAuth(provider, verifier)
        pendingOAuth = pending
        // Persist so a cold return (process death under the browser tab) can still complete; the
        // in-memory field stays the warm-return path and a second begin supersedes both.
        store.writePendingOAuth(pending)
        return client.authorizeUrl(provider, Pkce.challenge(verifier))
    }

    /** Step two: the deep-link callback. Parses the redirect URI; a provider refusal
     *  (`error`/`error_description`, no code) is a typed [SupabaseAuthError.InvalidCallback]
     *  thrown with no network call. A code exchanges through the pkce grant (same issuer pin as
     *  every grant), persists, remembers the provider, and lands SIGNED_IN. Walks the machine
     *  exactly as verifyEmailOTP does and rethrows on failure so the screen can render the
     *  inline reason. Returns false, touching nothing, for a stray callback with no pending
     *  begin (or one racing an in-flight sign-in). Either way the pending attempt is spent:
     *  retry means a new begin, a new verifier. */
    public suspend fun completeOAuth(callbackUri: String): Boolean {
        // The in-memory attempt is the warm return; the persisted one is the cold-return fallback
        // (the browser tab outlived the app and took the in-memory verifier to process death).
        val pending = pendingOAuth ?: store.readPendingOAuth() ?: return false
        if (!machine.apply(AuthEvent.SIGN_IN_STARTED)) return false
        pendingOAuth = null
        store.clearPendingOAuth()
        try {
            val callback = OAuthCallback.parse(callbackUri)
            val code = callback.code ?: throw SupabaseAuthError.InvalidCallback(
                callback.error,
                callback.errorDescription,
            )
            val session = client.exchangeCode(code, pending.verifier, nowSeconds())
            persist(session)
            recordProvider(pending.provider)
            machine.apply(AuthEvent.SIGN_IN_COMPLETED)
            return true
        } catch (e: Throwable) {
            machine.apply(AuthEvent.SIGN_IN_FAILED)
            throw e
        }
    }

    // MARK: - Email OTP / magic link (roadmap I3b, mirrors #230)

    /** Step one of the email OTP flow: ask the server to email the code (and the magic link). No
     *  phase change here; the sign-in screen owns the local sub-state (code entry, resend). The
     *  error rides straight through so the screen can say what went wrong. `captchaToken` threads a
     *  Turnstile token when a captcha-on project needs it; null (the local/dev posture) sends the
     *  plain body. OTP is a new way in, not a new machine. */
    public suspend fun sendEmailOTP(email: String, captchaToken: String? = null) {
        client.sendEmailOTP(email, captchaToken)
    }

    /** Step two of the email OTP flow: verify the entered code. Walks the same machine as the
     *  password leg (SIGNED_OUT/FAILED -> AUTHENTICATING -> SIGNED_IN on success, -> FAILED on a bad
     *  code), so routing stays provider-blind and the verified session persists and refreshes on the
     *  identical path. Unlike the password leg it rethrows on failure, so the screen can render the
     *  inline reason as well as follow the phase. A second call while one is in flight is the
     *  machine's illegal SIGN_IN_STARTED and no-ops (the re-entrancy guard). */
    public suspend fun verifyEmailOTP(email: String, code: String) {
        if (!machine.apply(AuthEvent.SIGN_IN_STARTED)) return
        try {
            val session = client.verifyEmailOTP(email, code, nowSeconds())
            persist(session)
            recordProvider(AuthProvider.EMAIL_OTP)
            machine.apply(AuthEvent.SIGN_IN_COMPLETED)
        } catch (e: Throwable) {
            machine.apply(AuthEvent.SIGN_IN_FAILED)
            throw e
        }
    }

    /** Complete a magic link by its `token_hash` (roadmap I3b). Identical to [verifyEmailOTP] but
     *  through the link-verify grant; the owner-gated App Links route (PARITY.md) would call this
     *  once it lands. Drives AUTHENTICATING -> SIGNED_IN, persists, and rethrows on failure. */
    public suspend fun completeMagicLink(tokenHash: String, type: String) {
        if (!machine.apply(AuthEvent.SIGN_IN_STARTED)) return
        try {
            val session = client.verifyEmailLink(tokenHash, type, nowSeconds())
            persist(session)
            recordProvider(AuthProvider.EMAIL_OTP)
            machine.apply(AuthEvent.SIGN_IN_COMPLETED)
        } catch (e: Throwable) {
            machine.apply(AuthEvent.SIGN_IN_FAILED)
            throw e
        }
    }

    /** Sign out: clear the store, drop the session, then revoke best-effort. Local clearing never
     *  waits on the network verdict. */
    public suspend fun signOut() {
        val token = stored?.accessToken
        purgeLocal()
        machine.apply(AuthEvent.SIGNED_OUT)
        if (token != null) client.signOut(token)
    }

    /** The local half of account deletion: the server-side `DELETE /account` is the REST client's
     *  (CrossyApiClient.deleteAccount) and lands the tombstone. This purges the same local state
     *  sign-out does, with no vendor logout call (the account is gone, not just this session), and
     *  drops the phase to signed out. The composition root calls the REST leg first, then this. */
    public fun purgeForAccountDeletion() {
        purgeLocal()
        machine.apply(AuthEvent.SIGNED_OUT)
    }

    // MARK: - The token path (BearerTokenProvider)

    /** The current bearer token, refreshed silently when within the expiry margin. A terminal
     *  refusal ends the session honestly (store cleared, phase signed out); network weather returns
     *  the stored token unjudged, and the API's own UNAUTHORIZED, if it comes, is the surfaced
     *  truth. */
    override suspend fun currentToken(): String {
        val session = stored ?: throw SignedOutError()
        if (nowSeconds() < session.expiresAt - REFRESH_MARGIN_SECONDS) return session.accessToken
        refreshMutex.withLock {
            // Another caller may have refreshed while we waited: re-read and re-check freshness so
            // we never double-spend the rotating refresh token.
            val latest = stored ?: throw SignedOutError()
            if (nowSeconds() < latest.expiresAt - REFRESH_MARGIN_SECONDS) return latest.accessToken
            return try {
                doRefresh(latest)
            } catch (transient: TransientRefreshError) {
                // Weather judges nothing: the stored token rides and the API's verdict, if it
                // comes, is UNAUTHORIZED surfaced through the normal error path.
                transient.staleToken
            }
        }
    }

    /** Force a refresh with no proactive shortcut. The REST client calls this after a server 401 on
     *  a token the local clock still thought valid, so replaying the same rejected token is
     *  useless: a transient/network failure here throws (the client falls back to surfacing the
     *  original 401) rather than returning the stale token that was just rejected. A terminal
     *  refusal still ends the session. */
    override suspend fun refreshedToken(): String {
        stored ?: throw SignedOutError()
        refreshMutex.withLock {
            val latest = stored ?: throw SignedOutError()
            return try {
                doRefresh(latest)
            } catch (transient: TransientRefreshError) {
                throw transient.underlying
            }
        }
    }

    /** The shared refresh grant both token entry points ride, under [refreshMutex]. On success
     *  persist and return the fresh token; on a terminal refusal purge and throw [SignedOutError];
     *  on transient/network weather throw [TransientRefreshError] for the caller to resolve. */
    private suspend fun doRefresh(session: SupabaseSession): String {
        machine.apply(AuthEvent.REFRESH_STARTED)
        try {
            val refreshed = client.refresh(session.refreshToken, nowSeconds())
            // A sign-out (or account deletion) may have landed while the refresh was in flight; its
            // purge is the standing truth. Persisting here would resurrect the account at the next
            // launch's restore().
            if (stored == null) throw SignedOutError()
            persist(refreshed)
            machine.apply(AuthEvent.REFRESH_SUCCEEDED)
            return refreshed.accessToken
        } catch (e: SignedOutError) {
            throw e
        } catch (e: SupabaseAuthError.Refused) {
            stored = null
            store.clear()
            machine.apply(AuthEvent.REFRESH_FAILED_TERMINAL)
            throw SignedOutError()
        } catch (e: Throwable) {
            if (stored == null) throw SignedOutError()
            machine.apply(AuthEvent.REFRESH_FAILED_TRANSIENT)
            throw TransientRefreshError(session.accessToken, e)
        }
    }

    private fun persist(session: SupabaseSession) {
        stored = session
        store.write(session)
    }

    /** Remember the provider that minted the standing session, in memory and in the store marker so
     *  a relaunch can still name it (twin of iOS `recordProvider`). Best-effort at the store: a
     *  failed marker write only costs the provider name after a relaunch, never the sign-in. */
    private fun recordProvider(provider: AuthProvider) {
        this.provider = provider
        store.writeProvider(provider)
    }

    /** Drop the in-memory session, provider, and pending OAuth attempt, and wipe every persisted
     *  slot (session, provider marker, pending verifier). Shared by sign-out and account deletion;
     *  never waits on the network. */
    private fun purgeLocal() {
        stored = null
        provider = null
        pendingOAuth = null
        store.clear()
        store.clearProvider()
        store.clearPendingOAuth()
    }

    /** The stale token from a transient refresh failure, so the two callers can differ:
     *  currentToken() returns it (weather is not a sign-out), refreshedToken() rethrows the
     *  underlying error (the stale token was just rejected by the server's 401). */
    private class TransientRefreshError(val staleToken: String, val underlying: Throwable) :
        Exception(underlying)

    public companion object {
        /** Refresh this many seconds before nominal expiry, so a token never dies in flight between
         *  the check here and the server's own clock. */
        public const val REFRESH_MARGIN_SECONDS: Double = 60.0
    }
}
