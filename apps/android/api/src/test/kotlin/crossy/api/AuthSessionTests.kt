// The auth session lifecycle over real vendor calls (MockWebServer) and the in-memory TokenStore:
// the AAD-3 slice of apps/ios AuthSessionTests.swift (password sign-in instead of the web leg; no
// provider marker, no Apple name push). The token path is the load-bearing part: silent refresh
// inside the margin, weather-tolerant currentToken, weather-rethrowing refreshedToken (the 401
// seam's supplier, INV-11), and the terminal purge.

package crossy.api

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

private const val REF_ISSUER = "https://qvnvokstvbarsxhufrja.supabase.co/auth/v1"

class AuthSessionTests : MockServerTest() {
    private var now = 1_000_000.0

    private fun makeSession(store: TokenStore = InMemoryTokenStore()): Pair<AuthSession, TokenStore> {
        val client = SupabaseAuthClient(
            SupabaseConfig(
                authBaseUrl = server.url("/auth/v1"),
                apiKey = "sb_publishable_test",
                issuer = REF_ISSUER,
            ),
        )
        return AuthSession(client, store, nowSeconds = { now }) to store
    }

    private fun grantBody(access: String, refresh: String, expiresAt: Double): String =
        """
        {
          "access_token": "${jwtWithIssuer(REF_ISSUER, subject = access)}",
          "refresh_token": "$refresh",
          "expires_in": 3600,
          "expires_at": $expiresAt,
          "user": { "id": "11111111-2222-3333-4444-555555555555" }
        }
        """.trimIndent()

    /** A stored session whose access token is a plain marker string: restore() does not re-check
     *  the pin (the grant already did), so the marker keeps assertions readable. */
    private fun storedSession(expiresAt: Double, access: String = "stored-access") =
        SupabaseSession(access, "stored-refresh", expiresAt, "user-1")

    @Test
    fun signInWithPassword_persistsTheSessionAndSignsIn() = runBlocking {
        server.enqueue(jsonResponse(200, grantBody("granted", "granted-refresh", 4_102_444_800.0)))
        val (session, store) = makeSession()

        session.signInWithPassword("ada@example.test", "hunter2")

        assertEquals(AuthPhase.SIGNED_IN, session.phase)
        assertEquals("11111111-2222-3333-4444-555555555555", session.userId)
        assertEquals("granted-refresh", store.read()?.refreshToken, "the store holds the session")

        // And the token provider serves it without any further network.
        val token = session.currentToken()
        assertTrue(token.isNotEmpty())
        assertEquals(1, server.requestCount, "a fresh token needs no refresh")
    }

    @Test
    fun aRefusedSignInLandsInFailedAndWritesNothing() = runBlocking {
        server.enqueue(jsonResponse(400, """{"error":"invalid_grant"}"""))
        val (session, store) = makeSession()

        session.signInWithPassword("ada@example.test", "wrong")

        assertEquals(AuthPhase.FAILED, session.phase)
        assertNull(store.read(), "a failed sign-in persists nothing")
    }

    // MARK: - Email OTP / magic link (#230): a new way in, the same machine and token path

    @Test
    fun verifyEmailOTP_persistsTheSessionAndSignsIn() = runBlocking {
        server.enqueue(jsonResponse(200, grantBody("verified", "otp-refresh", 4_102_444_800.0)))
        val (session, store) = makeSession()

        session.verifyEmailOTP("ada@example.test", "123456")

        assertEquals(AuthPhase.SIGNED_IN, session.phase, "SIGNED_OUT -> AUTHENTICATING -> SIGNED_IN")
        assertEquals("11111111-2222-3333-4444-555555555555", session.userId)
        assertEquals("otp-refresh", store.read()?.refreshToken, "the verified session persists like a password one")
        assertTrue(session.currentToken().isNotEmpty(), "the token provider serves it with no further network")
    }

    @Test
    fun verifyEmailOTP_aWrongCodeLandsInFailedRethrowsAndWritesNothing() = runBlocking {
        // GoTrue's bad/expired code shape (403 otp_expired). Unlike the password leg, verify rethrows
        // so the screen can render the inline reason as well as follow the phase into FAILED.
        server.enqueue(
            jsonResponse(403, """{"code":403,"error_code":"otp_expired","msg":"Token has expired or is invalid"}"""),
        )
        val (session, store) = makeSession()

        val error = runCatching { session.verifyEmailOTP("ada@example.test", "000000") }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.Refused, "the bad code rethrows, got $error")
        assertEquals(AuthPhase.FAILED, session.phase)
        assertNull(store.read(), "a failed verify persists nothing")
    }

    @Test
    fun completeMagicLink_persistsTheSessionAndSignsIn() = runBlocking {
        server.enqueue(jsonResponse(200, grantBody("linked", "link-refresh", 4_102_444_800.0)))
        val (session, store) = makeSession()

        session.completeMagicLink(tokenHash = "hash-xyz", type = "magiclink")

        assertEquals(AuthPhase.SIGNED_IN, session.phase)
        assertEquals("link-refresh", store.read()?.refreshToken)
        assertEquals("/auth/v1/verify", server.takeRequest().requestUrl?.encodedPath)
    }

    @Test
    fun aVerifiedOtpSessionRefreshesExactlyLikeAPasswordSession_INV11() = runBlocking {
        // Sign in through the OTP verify with a token already inside the 60s refresh margin, then let
        // the token path run: it fires the refresh_token grant and rotates the session, the identical
        // path a password session rides (currentToken_refreshesSilentlyInsideTheExpiryMargin). OTP is
        // a new way in, not a new machine, so the session it lands is a password session's twin.
        val (session, store) = makeSession()
        server.enqueue(jsonResponse(200, grantBody("verified", "otp-refresh", now + 30)))
        session.verifyEmailOTP("ada@example.test", "123456")
        assertEquals(AuthPhase.SIGNED_IN, session.phase)
        assertEquals("otp-refresh", store.read()?.refreshToken)

        server.enqueue(jsonResponse(200, grantBody("rotated", "next-refresh", now + 3600)))
        session.currentToken()

        assertEquals(2, server.requestCount, "the /verify, then exactly one refresh grant")
        server.takeRequest() // the /verify
        val refresh = server.takeRequest() // the /token refresh
        assertEquals("/auth/v1/token", refresh.requestUrl?.encodedPath)
        assertEquals("refresh_token", refresh.requestUrl?.queryParameter("grant_type"), "the OTP session refreshes on the token grant")
        assertEquals("next-refresh", store.read()?.refreshToken, "the rotated session persisted")
        assertEquals(AuthPhase.SIGNED_IN, session.phase)
    }

    @Test
    fun restore_readsTheStoreWithoutNetworkAndSignsIn() = runBlocking {
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now + 3600)) }
        val (session, _) = makeSession(store)

        session.restore()

        assertEquals(AuthPhase.SIGNED_IN, session.phase)
        assertEquals("user-1", session.userId)
        assertEquals(0, server.requestCount, "restore gates nothing on the network")
        assertEquals("stored-access", session.currentToken())
    }

    @Test
    fun currentToken_refreshesSilentlyInsideTheExpiryMargin() = runBlocking {
        // The stored token nominally expires in 30s, inside the 60s margin: currentToken must
        // refresh rather than hand out a token about to die in flight.
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now + 30)) }
        val (session, _) = makeSession(store)
        session.restore()
        server.enqueue(jsonResponse(200, grantBody("refreshed", "next-refresh", now + 3600)))

        val token = session.currentToken()

        assertEquals(1, server.requestCount, "one refresh grant fired")
        assertTrue(token != "stored-access", "the fresh token came back, not the dying one")
        assertEquals("next-refresh", store.read()?.refreshToken, "the rotated session persisted")
        assertEquals(AuthPhase.SIGNED_IN, session.phase)
    }

    @Test
    fun currentToken_returnsTheStaleTokenOnWeather_INV11() = runBlocking {
        // Transient refresh failure (a 500 here): weather judges nothing, the stored token rides,
        // and the API's verdict, if it comes, is UNAUTHORIZED through the normal error path. The
        // session never dead-stops (INV-11 posture).
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now + 30)) }
        val (session, _) = makeSession(store)
        session.restore()
        server.enqueue(jsonResponse(500, "oops"))

        val token = session.currentToken()

        assertEquals("stored-access", token, "weather returns the stored token unjudged")
        assertEquals(AuthPhase.SIGNED_IN, session.phase, "a transient failure keeps the session standing")
    }

    @Test
    fun refreshedToken_rethrowsWeatherInsteadOfReturningTheRejectedToken_INV11() = runBlocking {
        // The 401 seam's supplier: after a server 401 the stale token was just rejected, so a
        // transient refresh failure must throw (the REST client falls back to surfacing the
        // original 401), never re-serve the rejected token and loop.
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now + 3600)) }
        val (session, _) = makeSession(store)
        session.restore()
        server.enqueue(jsonResponse(500, "oops"))

        val error = runCatching { session.refreshedToken() }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.InvalidResponse, "weather is rethrown, got $error")
        assertEquals(AuthPhase.SIGNED_IN, session.phase, "weather is not a sign-out")
    }

    @Test
    fun aTerminalRefreshRefusalPurgesTheStoreAndSignsOut() = runBlocking {
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now + 30)) }
        val (session, _) = makeSession(store)
        session.restore()
        server.enqueue(jsonResponse(400, """{"error":"invalid_grant"}"""))

        val error = runCatching { session.currentToken() }.exceptionOrNull()

        assertTrue(error is SignedOutError, "a dead refresh token ends the session honestly")
        assertNull(store.read(), "the store is purged")
        assertEquals(AuthPhase.SIGNED_OUT, session.phase)
    }

    @Test
    fun signOut_purgesLocallyThenRevokesBestEffort() = runBlocking {
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now + 3600)) }
        val (session, _) = makeSession(store)
        session.restore()
        server.enqueue(jsonResponse(204, ""))

        session.signOut()

        assertEquals(AuthPhase.SIGNED_OUT, session.phase)
        assertNull(store.read())
        val logout = server.takeRequest()
        assertEquals("/auth/v1/logout", logout.requestUrl?.encodedPath)
        assertEquals("local", logout.requestUrl?.queryParameter("scope"))
        assertTrue(
            runCatching { session.currentToken() }.exceptionOrNull() is SignedOutError,
            "the token path speaks for no one after sign-out",
        )
    }

    @Test
    fun purgeForAccountDeletion_dropsLocalStateWithoutAVendorCall() = runBlocking {
        // The REST DELETE /account leg is CrossyApiClient's; this is the local half only. No
        // logout call: the account is gone, not just this session.
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now + 3600)) }
        val (session, _) = makeSession(store)
        session.restore()

        session.purgeForAccountDeletion()

        assertEquals(AuthPhase.SIGNED_OUT, session.phase)
        assertNull(store.read())
        assertEquals(0, server.requestCount, "no vendor call rides the purge")
    }
}
