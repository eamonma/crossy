// The auth session lifecycle over real vendor calls (MockWebServer) and the in-memory TokenStore:
// the AAD-3 slice of apps/ios AuthSessionTests.swift (a split begin/complete OAuth leg instead of
// the in-process web sheet; the provider marker is in-memory pending the Keystore store; no Apple
// name push). The token path is the load-bearing part: silent refresh inside the margin,
// weather-tolerant currentToken, weather-rethrowing refreshedToken (the 401 seam's supplier,
// INV-11), and the terminal purge.

package crossy.api

import crossy.protocol.ProtocolJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
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
        assertEquals(AuthProvider.EMAIL_OTP, session.provider, "the leg remembers the email provider")
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

    // MARK: - OAuth over the split browser leg (AAD-3): begin hands out the URL, the deep link
    // comes back to complete. Normative behaviors ported from apps/ios AuthSessionTests.swift
    // (test_hisbaanRidesTheSameWebLegWithTheEncodedProviderAndRemembersItself and kin).

    @Test
    fun beginOAuth_mintsAFreshVerifierPerAttemptAndTouchesNothing() = runBlocking {
        // PKCE hygiene: every attempt gets its own verifier, so two begins yield two different
        // challenges. Begin is the OTP send's twin: no phase change, no network, nothing to undo
        // when the browser trip is abandoned.
        val (session, store) = makeSession()

        val first = session.beginOAuth(AuthProvider.DISCORD)
        val second = session.beginOAuth(AuthProvider.DISCORD)

        assertEquals("/auth/v1/authorize", first.encodedPath)
        assertNotEquals(
            first.queryParameter("code_challenge"),
            second.queryParameter("code_challenge"),
            "a fresh verifier per begin, never a reused one",
        )
        assertEquals(AuthPhase.SIGNED_OUT, session.phase, "begin walks no machine")
        assertNull(store.read())
        assertEquals(0, server.requestCount, "begin is pure construction")
    }

    @Test
    fun completeOAuth_hisbaanRidesTheWebLegWithTheEncodedProviderAndRemembersItself() = runBlocking {
        // The iOS normative case: hisbaan is a custom OIDC provider on the identical PKCE flow
        // Discord rides; only the provider value and the remembered marker differ. The colon
        // lands on the wire percent-encoded yet decodes back to the raw wire id, and the
        // exchange hits the pkce grant with the begin's own verifier ({auth_code, code_verifier}).
        server.enqueue(jsonResponse(200, grantBody("granted", "oauth-refresh", 4_102_444_800.0)))
        val (session, store) = makeSession()

        val authorize = session.beginOAuth(AuthProvider.HISBAAN)
        val landed = session.completeOAuth("crossy://auth/callback?code=cb-code")

        assertTrue(landed)
        assertEquals(AuthPhase.SIGNED_IN, session.phase)
        assertEquals(AuthProvider.HISBAAN, session.provider, "the leg remembers hisbaan")
        assertEquals("oauth-refresh", store.read()?.refreshToken, "the session persists like every grant")

        assertTrue(
            authorize.toString().contains("provider=custom%3Ahisbaan"),
            "the raw colon is percent-encoded on the wire",
        )
        assertEquals("custom:hisbaan", authorize.queryParameter("provider"))

        val exchange = server.takeRequest()
        assertEquals("/auth/v1/token", exchange.requestUrl?.encodedPath)
        assertEquals("pkce", exchange.requestUrl?.queryParameter("grant_type"))
        val body = ProtocolJson.parseToJsonElement(exchange.body.readUtf8()).jsonObject
        assertEquals("cb-code", body["auth_code"]?.jsonPrimitive?.contentOrNull)
        val spentVerifier = body["code_verifier"]?.jsonPrimitive?.contentOrNull
        assertEquals(
            authorize.queryParameter("code_challenge"),
            Pkce.challenge(spentVerifier ?: ""),
            "the exchange spends the exact verifier the begin's challenge was derived from",
        )
    }

    @Test
    fun completeOAuth_aSecondBeginSupersedesTheStalePending() = runBlocking {
        // The user backs out of the browser and taps sign-in again: the second begin's verifier
        // is the live one, and the callback exchanges against it, never the stale first.
        server.enqueue(jsonResponse(200, grantBody("granted", "r", 4_102_444_800.0)))
        val (session, _) = makeSession()

        val stale = session.beginOAuth(AuthProvider.DISCORD)
        val live = session.beginOAuth(AuthProvider.DISCORD)
        session.completeOAuth("crossy://auth/callback?code=cb-code")

        val body = ProtocolJson.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        val spentChallenge = Pkce.challenge(body["code_verifier"]?.jsonPrimitive?.contentOrNull ?: "")
        assertEquals(live.queryParameter("code_challenge"), spentChallenge, "the live pending won")
        assertNotEquals(stale.queryParameter("code_challenge"), spentChallenge, "the stale one is gone")
    }

    @Test
    fun completeOAuth_anErrorCallbackIsATypedFailureWithNoNetworkCall() = runBlocking {
        // A provider refusal comes back as error/error_description and no code: a typed
        // InvalidCallback thrown before any exchange, landing FAILED (the retry state) with
        // nothing persisted.
        val (session, store) = makeSession()
        session.beginOAuth(AuthProvider.DISCORD)

        val error = runCatching {
            session.completeOAuth(
                "crossy://auth/callback?error=access_denied&error_description=user%20said%20no",
            )
        }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.InvalidCallback, "typed, got $error")
        error as SupabaseAuthError.InvalidCallback
        assertEquals("access_denied", error.error)
        assertEquals("user said no", error.errorDescription)
        assertEquals(AuthPhase.FAILED, session.phase)
        assertNull(store.read(), "a refused callback persists nothing")
        assertEquals(0, server.requestCount, "no code, no exchange, no network")
        assertNull(session.provider, "a failed leg remembers nothing")
    }

    @Test
    fun completeOAuth_aStrayCallbackWithNoPendingBeginReturnsFalseAndTouchesNothing() = runBlocking {
        // A deep link with no attempt behind it (a replayed link, a cold start) speaks for no
        // one: false, no machine walk, no network.
        val (session, store) = makeSession()

        val landed = session.completeOAuth("crossy://auth/callback?code=cb-code")

        assertFalse(landed)
        assertEquals(AuthPhase.SIGNED_OUT, session.phase)
        assertNull(store.read())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun completeOAuth_anIssuerMismatchIsRejectedBeforeStorage() = runBlocking {
        // The pin rides the pkce grant exactly as it rides the others (deploy/README.md issuer
        // trap): a token minted under the wrong iss never reaches the store, the attempt lands
        // FAILED, and the typed mismatch rethrows for the screen.
        server.enqueue(
            jsonResponse(
                200,
                """
                {
                  "access_token": "${jwtWithIssuer("https://api.crossy.party/auth/v1")}",
                  "refresh_token": "evil-refresh",
                  "expires_in": 3600
                }
                """.trimIndent(),
            ),
        )
        val (session, store) = makeSession()
        session.beginOAuth(AuthProvider.DISCORD)

        val error = runCatching {
            session.completeOAuth("crossy://auth/callback?code=cb-code")
        }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.IssuerMismatch, "the pin fired, got $error")
        assertNull(store.read(), "the mismatched token never reached the store")
        assertEquals(AuthPhase.FAILED, session.phase)
        assertNull(session.provider)
    }

    @Test
    fun signOut_forgetsTheRememberedProvider() = runBlocking {
        // The iOS marker rule (test_signOutForgetsTheProviderMarker): the provider clears with
        // the session it named.
        server.enqueue(jsonResponse(200, grantBody("granted", "r", 4_102_444_800.0)))
        val (session, _) = makeSession()
        session.beginOAuth(AuthProvider.DISCORD)
        session.completeOAuth("crossy://auth/callback?code=cb-code")
        assertEquals(AuthProvider.DISCORD, session.provider)

        server.enqueue(jsonResponse(204, ""))
        session.signOut()

        assertNull(session.provider, "the provider clears alongside the session")
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

    // MARK: - Persistent restore + the pending-verifier survival (the Keystore token-store track)

    @Test
    fun restore_rehydratesTheProviderMarker() = runBlocking {
        // iOS restores the provider from its Keychain marker; the persisted store carries the same,
        // so a relaunch names the provider instead of degrading to none.
        val store = InMemoryTokenStore().apply {
            write(storedSession(expiresAt = now + 3600))
            writeProvider(AuthProvider.DISCORD)
        }
        val (session, _) = makeSession(store)

        session.restore()

        assertEquals(AuthPhase.SIGNED_IN, session.phase)
        assertEquals(AuthProvider.DISCORD, session.provider, "the marker rides the restore")
    }

    @Test
    fun restore_anExpiredSessionStillRestoresAndRefreshesOnFirstUse() = runBlocking {
        // The refresh leg owns expiry, not restore: a token already past exp restores to SIGNED_IN
        // and the first currentToken silently refreshes it (the returning-user-with-a-stale-token
        // path; iOS restores the same way and refreshes on first use).
        val store = InMemoryTokenStore().apply { write(storedSession(expiresAt = now - 10)) }
        val (session, _) = makeSession(store)

        session.restore()
        assertEquals(AuthPhase.SIGNED_IN, session.phase, "restore gates nothing on expiry")

        server.enqueue(jsonResponse(200, grantBody("refreshed", "next-refresh", now + 3600)))
        val token = session.currentToken()

        assertEquals(1, server.requestCount, "the stale token refreshed on first use")
        assertTrue(token != "stored-access", "the fresh token came back, not the expired one")
        assertEquals("next-refresh", store.read()?.refreshToken, "the rotated session persisted")
    }

    @Test
    fun signOut_wipesEverySlot_theSessionTheMarkerAndAnyPendingVerifier() = runBlocking {
        // The full purge, not just the session blob: the provider marker and any outstanding
        // verifier go too, so a relaunch after sign-out restores nothing and a stray callback finds
        // no attempt to spend (iOS purgeLocal removes both keychain accounts; Android adds the
        // pending slot).
        server.enqueue(jsonResponse(200, grantBody("granted", "r", 4_102_444_800.0)))
        val (session, store) = makeSession()
        session.beginOAuth(AuthProvider.DISCORD)
        session.completeOAuth("crossy://auth/callback?code=cb-code")
        assertNotNull(store.read(), "signed in: the session persisted")
        assertEquals(AuthProvider.DISCORD, store.readProvider(), "and the marker")

        server.enqueue(jsonResponse(204, ""))
        session.signOut()

        assertNull(store.read(), "the session is wiped")
        assertNull(store.readProvider(), "the provider marker is wiped")
        assertNull(store.readPendingOAuth(), "no pending verifier survives the purge")
    }

    @Test
    fun completeOAuth_recoversThePersistedVerifierAfterProcessDeath() = runBlocking {
        // The cold return (no iOS twin): the browser tab outlived the app, so the in-memory attempt
        // died with the process. A fresh AuthSession over the same store recovers the persisted
        // verifier and completes the exchange instead of landing the calm retry.
        val store = InMemoryTokenStore()
        val (begin, _) = makeSession(store)
        begin.beginOAuth(AuthProvider.DISCORD)
        val persistedVerifier = store.readPendingOAuth()?.verifier
        assertNotNull(persistedVerifier, "beginOAuth persisted the attempt")

        // A new process: a fresh session with an empty in-memory pending, the same store.
        server.enqueue(jsonResponse(200, grantBody("granted", "cold-refresh", 4_102_444_800.0)))
        val (cold, _) = makeSession(store)
        val landed = cold.completeOAuth("crossy://auth/callback?code=cb-code")

        assertTrue(landed, "the cold return completes")
        assertEquals(AuthPhase.SIGNED_IN, cold.phase)
        assertEquals(AuthProvider.DISCORD, cold.provider, "the persisted provider rode along")
        val exchange = server.takeRequest()
        assertTrue(
            exchange.body.readUtf8().contains(persistedVerifier!!),
            "the exchange spent the persisted verifier, not a fresh one",
        )
        assertNull(store.readPendingOAuth(), "the attempt is spent once completed: no replay")
    }
}
