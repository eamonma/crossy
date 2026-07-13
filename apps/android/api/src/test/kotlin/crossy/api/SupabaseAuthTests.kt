// The Supabase auth REST leg (AAD-3 scope): the password grant's wire shape, the refresh grant's
// error taxonomy (refused vs weather, with the 408/429 carve-out), and the issuer pin. The pin
// mirrors deploy/README.md: SUPABASE_ISSUER is always the ref domain, even under a custom domain
// that fronts the API, so the configured issuer arrives as its own datum and a token whose `iss`
// disagrees is rejected before it can be stored. Deriving the issuer from the auth origin is the
// documented outage; the config split in these tests is the guard against recreating it.

package crossy.api

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import crossy.protocol.ProtocolJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The pinned ref-domain issuer, deliberately unrelated to the MockWebServer origin the client
 *  dials: the two never coincide in production either (custom domain vs ref domain). */
private const val REF_ISSUER = "https://qvnvokstvbarsxhufrja.supabase.co/auth/v1"

class SupabaseAuthTests : MockServerTest() {

    private fun authClient(issuer: String = REF_ISSUER): SupabaseAuthClient =
        SupabaseAuthClient(
            SupabaseConfig(
                authBaseUrl = server.url("/auth/v1"),
                apiKey = "sb_publishable_test",
                issuer = issuer,
            ),
        )

    private fun grantBody(issuer: String = REF_ISSUER): String {
        val token = jwtWithIssuer(issuer)
        return """
            {
              "access_token": "$token",
              "token_type": "bearer",
              "expires_in": 3600,
              "expires_at": 4102444800,
              "refresh_token": "granted-refresh",
              "user": { "id": "11111111-2222-3333-4444-555555555555" }
            }
        """.trimIndent()
    }

    @Test
    fun signInWithPassword_postsThePasswordGrantAndDecodesTheSession() = runBlocking {
        server.enqueue(jsonResponse(200, grantBody()))

        val session = authClient().signInWithPassword("ada@example.test", "hunter2", nowSeconds = 1_000_000.0)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/auth/v1/token", request.requestUrl?.encodedPath)
        assertEquals("password", request.requestUrl?.queryParameter("grant_type"))
        assertEquals("sb_publishable_test", request.getHeader("apikey"))
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("ada@example.test", body["email"]?.jsonPrimitive?.contentOrNull)
        assertEquals("hunter2", body["password"]?.jsonPrimitive?.contentOrNull)

        assertEquals("granted-refresh", session.refreshToken)
        assertEquals(4102444800.0, session.expiresAt, "expires_at wins when the server sends it")
        assertEquals("11111111-2222-3333-4444-555555555555", session.userId)
    }

    @Test
    fun refresh_postsTheRefreshGrantAndDerivesExpiryFromExpiresInWhenAbsolute_isAbsent() = runBlocking {
        // Older GoTrue omits expires_at; the client derives it from expires_in against the
        // injected clock (no ambient time).
        val token = jwtWithIssuer(REF_ISSUER)
        server.enqueue(
            jsonResponse(
                200,
                """{ "access_token": "$token", "refresh_token": "next-refresh", "expires_in": 3600 }""",
            ),
        )

        val session = authClient().refresh("prior-refresh", nowSeconds = 1_000_000.0)

        val request = server.takeRequest()
        assertEquals("refresh_token", request.requestUrl?.queryParameter("grant_type"))
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("prior-refresh", body["refresh_token"]?.jsonPrimitive?.contentOrNull)

        assertEquals(1_003_600.0, session.expiresAt)
        assertNull(session.userId, "no user block decodes to a null userId")
    }

    @Test
    fun aRefused4xxGrantThrowsRefusedTheTerminalCase() = runBlocking {
        server.enqueue(jsonResponse(400, """{"error":"invalid_grant"}"""))

        val error = runCatching { authClient().refresh("dead-token", 0.0) }.exceptionOrNull()
        assertTrue(error is SupabaseAuthError.Refused)
        assertEquals(400, (error as SupabaseAuthError.Refused).status)
    }

    @Test
    fun rateLimit429RidesTheTransientLaneNotRefused() = runBlocking {
        // 408/429 are congestion, not judgment: the refresh token behind a rate-limited grant is
        // still good, so ending the session over one would sign the user out for nothing.
        server.enqueue(jsonResponse(429, """{"error":"over_request_rate_limit"}"""))

        val error = runCatching { authClient().refresh("still-good", 0.0) }.exceptionOrNull()
        assertTrue(error is SupabaseAuthError.InvalidResponse, "429 is transient, never Refused")
        assertEquals(429, (error as SupabaseAuthError.InvalidResponse).status)
    }

    @Test
    fun a5xxOrUndecodableBodyIsInvalidResponseTheTransientCase() = runBlocking {
        server.enqueue(jsonResponse(500, "oops"))
        val error = runCatching { authClient().refresh("r", 0.0) }.exceptionOrNull()
        assertTrue(error is SupabaseAuthError.InvalidResponse)
        assertEquals(500, (error as SupabaseAuthError.InvalidResponse).status)
    }

    // MARK: - The issuer pin (deploy/README.md)

    @Test
    fun aTokenMintedUnderTheWrongIssuerIsRejectedByThePin() = runBlocking {
        // The trap scenario: someone points config at the custom domain as issuer, or an auth host
        // mints tokens under an origin-derived iss. The granted token carries the WRONG iss and the
        // pin rejects it before it can be stored.
        server.enqueue(jsonResponse(200, grantBody(issuer = "https://api.crossy.party/auth/v1")))

        val error = runCatching {
            authClient(issuer = REF_ISSUER).signInWithPassword("a@b.c", "pw", 0.0)
        }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.IssuerMismatch)
        error as SupabaseAuthError.IssuerMismatch
        assertEquals(REF_ISSUER, error.expected)
        assertEquals("https://api.crossy.party/auth/v1", error.actual)
    }

    @Test
    fun aTokenWithNoReadableIssuerFailsThePinClosed() = runBlocking {
        // An opaque or malformed access token cannot be checked against the pin, so it fails
        // closed: no readable iss, no session.
        server.enqueue(
            jsonResponse(
                200,
                """{ "access_token": "not-a-jwt", "refresh_token": "r", "expires_in": 3600 }""",
            ),
        )

        val error = runCatching { authClient().refresh("r", 0.0) }.exceptionOrNull()
        assertTrue(error is SupabaseAuthError.IssuerMismatch)
        assertNull((error as SupabaseAuthError.IssuerMismatch).actual)
    }

    @Test
    fun theConfiguredIssuerIsItsOwnDatumNeverDerivedFromTheAuthOrigin() = runBlocking {
        // The auth origin here is the MockWebServer host; the pinned issuer is the ref domain. A
        // matching-iss token passes even though the two origins disagree, proving the pin compares
        // against the configured issuer, not anything derived from authBaseUrl (the outage's shape).
        server.enqueue(jsonResponse(200, grantBody(issuer = REF_ISSUER)))

        val session = authClient(issuer = REF_ISSUER).signInWithPassword("a@b.c", "pw", 0.0)

        assertTrue(session.accessToken.isNotEmpty())
        val dialed = server.takeRequest().requestUrl!!
        assertTrue(
            REF_ISSUER.startsWith("https://qvnvokstvbarsxhufrja") && dialed.host != "qvnvokstvbarsxhufrja.supabase.co",
            "the dialed origin and the pinned issuer are different hosts by construction",
        )
    }

    @Test
    fun signOut_postsTheLocalScopeLogoutBestEffort() = runBlocking {
        // scope=local revokes this device's refresh token, not the whole family (global would sign
        // other devices out at their next refresh); a failure never throws.
        server.enqueue(jsonResponse(204, ""))
        authClient().signOut("some-access-token")

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/auth/v1/logout", request.requestUrl?.encodedPath)
        assertEquals("local", request.requestUrl?.queryParameter("scope"))
        assertEquals("Bearer some-access-token", request.getHeader("Authorization"))
        assertEquals("sb_publishable_test", request.getHeader("apikey"))
    }
}
