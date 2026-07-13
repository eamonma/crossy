// The composition root's session and API wiring (ARCHITECTURE.md: ":app wires everything"). It
// builds the Supabase auth leg and the REST client from BuildConfig, and it holds the one bearer
// provider both auth paths feed: the email/password AuthSession (AAD-3) and the injected dev-token
// (the twin of iOS FixedTokenProvider). Token storage is in-memory tonight; the Keystore-backed
// TokenStore is a later track (AAD-3 / AD-4), wired here and nowhere else when it lands.

package crossy.app

import crossy.api.AuthPhase
import crossy.api.AuthSession
import crossy.api.BearerTokenProvider
import crossy.api.CrossyApiClient
import crossy.api.InMemoryTokenStore
import crossy.api.InjectedTokenProvider
import crossy.api.SignedOutError
import crossy.api.SupabaseAuthClient
import crossy.api.SupabaseConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient

/** The origins the root dials, read from BuildConfig. `apiBaseUrl` is the core API; `sessionWsBase`
 *  is where a room's WebSocket lives once :session lands (unused tonight, the scripted transport
 *  stands in). */
data class AppUrls(val apiBaseUrl: HttpUrl, val sessionWsBase: String)

/** Read the committed public config from BuildConfig. Every value is public by design (INV-6 note,
 *  deploy/README.md); the issuer is a separate datum, never derived from the auth origin. */
object AppConfig {
    fun urls(): AppUrls = AppUrls(BuildConfig.API_BASE_URL.toHttpUrl(), BuildConfig.SESSION_WS_BASE)

    /** The invite host the share link is built against (PROTOCOL.md §12). Bare host, no scheme;
     *  ShareInvite prepends https. Configured via BuildConfig.INVITE_HOST (default crossy.ing). */
    fun inviteHost(): String = BuildConfig.INVITE_HOST

    fun supabase(): SupabaseConfig = SupabaseConfig(
        authBaseUrl = BuildConfig.SUPABASE_AUTH_URL.toHttpUrl(),
        apiKey = BuildConfig.SUPABASE_API_KEY,
        issuer = BuildConfig.SUPABASE_ISSUER,
    )
}

/** A bearer provider whose backing swaps at runtime: null before sign-in, the AuthSession after an
 *  email grant, an InjectedTokenProvider after a dev token. The REST client holds one of these for
 *  its whole life, so the auth path can change under it without rebuilding the client. */
class SwitchableTokenProvider : BearerTokenProvider {
    @Volatile
    var delegate: BearerTokenProvider? = null

    override suspend fun currentToken(): String = (delegate ?: throw SignedOutError()).currentToken()

    override suspend fun refreshedToken(): String = (delegate ?: throw SignedOutError()).refreshedToken()
}

/** The app's one session object: the auth leg, the REST client, and the current identity. */
class AppSession(
    val urls: AppUrls,
    supabaseConfig: SupabaseConfig,
    http: OkHttpClient,
) {
    // In-memory for tonight; Keystore-backed EncryptedSharedPreferences is a later track (AD-4).
    private val tokenStore = InMemoryTokenStore()
    private val authClient = SupabaseAuthClient(supabaseConfig, http)
    val auth = AuthSession(authClient, tokenStore)
    private val bearer = SwitchableTokenProvider()

    /** The REST client every shell screen calls, bearer-authenticated through [bearer]. */
    val api = CrossyApiClient(urls.apiBaseUrl, bearer, http)

    /** The socket handshake's token (PROTOCOL.md §2). Same bearer the REST client rides; the
     *  transport folds a thrown SignedOutError into its signed-out stop. */
    suspend fun bearerToken(): String = bearer.currentToken()

    /** The signed-in user id, for seeding the room's self identity. Display only; the token is the
     *  identity authority (DESIGN.md §8). */
    var selfUserId: String? = null
        private set

    val isSignedIn: Boolean get() = bearer.delegate != null

    /** Email/password sign-in (AAD-3). Returns true when the grant landed and the bearer now speaks
     *  for the session. */
    suspend fun signInWithPassword(email: String, password: String): Boolean {
        auth.signInWithPassword(email, password)
        if (auth.phase != AuthPhase.SIGNED_IN) return false
        bearer.delegate = auth
        selfUserId = auth.userId
        return true
    }

    /** Email OTP step one (AAD-3, mirrors #230): ask the server to email a one-time code. No bearer
     *  swap and no phase change yet; the verify step lands the session. Throws through to the host,
     *  which shows the send-failed copy. */
    suspend fun sendEmailOtp(email: String) {
        auth.sendEmailOTP(email)
    }

    /** Email OTP step two (AAD-3): verify the entered code. Same shape as [signInWithPassword] once
     *  the grant lands: the bearer speaks for the session and the self id is seeded. AuthSession
     *  rethrows a bad code, so a false return means the machine did not reach SIGNED_IN. */
    suspend fun verifyEmailOtp(email: String, code: String): Boolean {
        auth.verifyEmailOTP(email, code)
        if (auth.phase != AuthPhase.SIGNED_IN) return false
        bearer.delegate = auth
        selfUserId = auth.userId
        return true
    }

    /** The dev-token path (AAD-3): a fixed bearer that never refreshes, so a 401 surfaces as
     *  UNAUTHORIZED rather than looping. */
    fun useDevToken(token: String) {
        bearer.delegate = InjectedTokenProvider(token)
        selfUserId = subClaim(token)
    }

    /** Drop the bearer and the local identity. The vendor logout is best-effort and never awaited. */
    fun clearSession() {
        bearer.delegate = null
        selfUserId = null
    }

    /** The `sub` claim of a JWT, read for display only (no verification; the servers verify the
     *  signature). Null when the token is not a readable JWT (a bare dev token), which the room
     *  falls back from. */
    private fun subClaim(token: String): String? {
        val parts = token.split(".")
        if (parts.size < 2) return null
        return try {
            val padded = parts[1].padEnd((parts[1].length + 3) / 4 * 4, '=')
            val json = android.util.Base64.decode(padded, android.util.Base64.URL_SAFE).decodeToString()
            Regex("\"sub\"\\s*:\\s*\"([^\"]+)\"").find(json)?.groupValues?.get(1)
        } catch (e: Exception) {
            null
        }
    }
}
