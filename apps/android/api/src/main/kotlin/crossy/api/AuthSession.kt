// The auth session: the one object that walks AuthStateMachine and owns the effects around it.
// Twin of apps/ios AuthSession.swift, scoped to AAD-3 (email/password + the token path). Sign-in
// is a Supabase password grant, persistence is the TokenStore seam, and currentToken() is the
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

/** Thrown by the token path when there is no session to speak for, and by a mid-flight refresh
 *  whose session was purged under it. Surfaces as [CrossyApiError.TokenUnavailable] at the REST
 *  client. Twin of iOS `SignedOutError`. */
public class SignedOutError : Exception("no signed-in session")

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

    @Volatile
    private var stored: SupabaseSession? = null
    private val refreshMutex = Mutex()

    // MARK: - Lifecycle

    /** Restore the stored session at launch. No network: a stale token is the silent-refresh
     *  path's problem on first use, not a reason to gate launch. */
    public fun restore() {
        val session = store.read() ?: return
        stored = session
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

    /** Drop the in-memory session and clear the store. Shared by sign-out and account deletion;
     *  never waits on the network. */
    private fun purgeLocal() {
        stored = null
        store.clear()
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
