// The Supabase auth REST leg (AAD-3 scope): the password grant's wire shape, the refresh grant's
// error taxonomy (refused vs weather, with the 408/429 carve-out), and the issuer pin. The pin
// mirrors deploy/README.md: SUPABASE_ISSUER is always the ref domain, even under a custom domain
// that fronts the API, so the configured issuer arrives as its own datum and a token whose `iss`
// disagrees is rejected before it can be stored. Deriving the issuer from the auth origin is the
// documented outage; the config split in these tests is the guard against recreating it.

package crossy.api

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.booleanOrNull
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

    // MARK: - The OAuth web leg (AAD-3): authorize URL + PKCE exchange

    @Test
    fun authorizeUrl_carriesTheFourQueryItemsInTheIOSOrderAgainstTheConfiguredOrigin() {
        // The normative query set and order (apps/ios SupabaseAuth.swift authorizeURL): provider,
        // redirect_to, code_challenge, code_challenge_method=s256. Built on the configured origin
        // verbatim, never a rewritten one (the issuer-trap posture), and the redirect target is
        // config, never a constant in client logic.
        val url = authClient().authorizeUrl(AuthProvider.DISCORD, codeChallenge = "abc-123_XYZ")

        assertEquals("/auth/v1/authorize", url.encodedPath)
        assertEquals(server.url("/").host, url.host, "the configured origin, verbatim")
        assertEquals("discord", url.queryParameter("provider"))
        assertEquals("crossy://auth/callback", url.queryParameter("redirect_to"))
        assertEquals("abc-123_XYZ", url.queryParameter("code_challenge"))
        assertEquals("s256", url.queryParameter("code_challenge_method"))
        assertTrue(
            url.toString().substringAfter("?").startsWith("provider="),
            "provider leads the query, the iOS item order",
        )
    }

    @Test
    fun authorizeUrl_percentEncodesTheHisbaanColonOnTheWire() {
        // The iOS normative behavior (test_hisbaanRidesTheSameWebLegWithTheEncodedProvider...):
        // custom:hisbaan rides as custom%3Ahisbaan (some proxies mis-split a bare colon in a
        // query value) yet decodes back to the exact raw wire id GoTrue expects.
        val url = authClient().authorizeUrl(AuthProvider.HISBAAN, codeChallenge = "c")

        assertTrue(
            url.toString().contains("provider=custom%3Ahisbaan"),
            "the raw colon is percent-encoded on the wire, got $url",
        )
        assertEquals("custom:hisbaan", url.queryParameter("provider"), "and decodes back intact")
    }

    @Test
    fun authorizeUrl_appleRidesTheSameWebLegNoIdTokenGrant() {
        // Android has no native Apple SDK: Apple is one more provider value on the identical
        // authorize flow, never the iOS-only id_token grant.
        val url = authClient().authorizeUrl(AuthProvider.APPLE, codeChallenge = "c")

        assertEquals("/auth/v1/authorize", url.encodedPath)
        assertEquals("apple", url.queryParameter("provider"))
    }

    @Test
    fun exchangeCode_postsThePkceGrantWithAuthCodeAndVerifier() = runBlocking {
        // The exchange body is exactly {auth_code, code_verifier} on grant_type=pkce (the iOS
        // exchangeCode twin); the response decodes on the same session shape as every grant.
        server.enqueue(jsonResponse(200, grantBody()))

        val session = authClient().exchangeCode("cb-code", "the-verifier", nowSeconds = 1_000_000.0)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/auth/v1/token", request.requestUrl?.encodedPath)
        assertEquals("pkce", request.requestUrl?.queryParameter("grant_type"))
        assertEquals("sb_publishable_test", request.getHeader("apikey"))
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("cb-code", body["auth_code"]?.jsonPrimitive?.contentOrNull)
        assertEquals("the-verifier", body["code_verifier"]?.jsonPrimitive?.contentOrNull)
        assertEquals(setOf("auth_code", "code_verifier"), body.keys, "nothing else rides the body")

        assertEquals("granted-refresh", session.refreshToken)
        assertEquals("11111111-2222-3333-4444-555555555555", session.userId)
    }

    @Test
    fun exchangeCode_ridesTheSameIssuerPinAsTheGrants() = runBlocking {
        // OAuth is a new way in, not a new machine: a pkce-granted token minted under the wrong
        // iss is rejected before it can be stored, exactly as the password grant is.
        server.enqueue(jsonResponse(200, grantBody(issuer = "https://api.crossy.party/auth/v1")))

        val error = runCatching {
            authClient(issuer = REF_ISSUER).exchangeCode("cb-code", "v", 0.0)
        }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.IssuerMismatch)
        assertEquals("https://api.crossy.party/auth/v1", (error as SupabaseAuthError.IssuerMismatch).actual)
    }

    @Test
    fun oauthCallback_parsesTheCodeAndTreatsAnEmptyOrAbsentOneAsNull() {
        // The custom-scheme redirect parses without okhttp (HttpUrl cannot hold crossy://). An
        // empty code is no code, the iOS authorizationCode(fromCallback:) rule.
        val withCode = OAuthCallback.parse("crossy://auth/callback?code=abc123")
        assertEquals("abc123", withCode.code)
        assertNull(withCode.error)

        assertNull(OAuthCallback.parse("crossy://auth/callback?code=").code)
        assertNull(OAuthCallback.parse("crossy://auth/callback").code)
        assertNull(OAuthCallback.parse("not a uri at all").code, "garbage parses to no code, never a throw")
    }

    @Test
    fun oauthCallback_surfacesTheProviderErrorPairDecoded() {
        val callback = OAuthCallback.parse(
            "crossy://auth/callback?error=access_denied&error_description=user%20said%20no",
        )

        assertNull(callback.code)
        assertEquals("access_denied", callback.error)
        assertEquals("user said no", callback.errorDescription)
    }

    // MARK: - Email OTP / magic link (#230)

    @Test
    fun sendEmailOTP_postsTheOtpSendWithCreateUserAndNoCaptchaByDefault() = runBlocking {
        // The send only acknowledges; no session comes back. create_user makes a fresh email a
        // sign-up, not a dead end. Absent a captcha token the gotrue_meta_security block is omitted
        // entirely, so the body is byte-identical to a captcha-off project's send.
        server.enqueue(jsonResponse(200, "{}"))

        authClient().sendEmailOTP("ada@example.test")

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/auth/v1/otp", request.requestUrl?.encodedPath)
        assertEquals("sb_publishable_test", request.getHeader("apikey"))
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("ada@example.test", body["email"]?.jsonPrimitive?.contentOrNull)
        assertEquals(true, body["create_user"]?.jsonPrimitive?.booleanOrNull)
        assertNull(body["gotrue_meta_security"], "no captcha token, no captcha block")
    }

    @Test
    fun sendEmailOTP_nestsTheCaptchaTokenUnderGotrueMetaSecurityWhenPresent() = runBlocking {
        // GoTrue reads the Turnstile token from gotrue_meta_security.captcha_token; a captcha-on
        // project refuses a send without it. The minting web view is a later track, but the wire
        // hook rides here so it drops in with no change to this leg.
        server.enqueue(jsonResponse(200, "{}"))

        authClient().sendEmailOTP("ada@example.test", captchaToken = "turnstile-abc")

        val body = ProtocolJson.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        val meta = body["gotrue_meta_security"]?.jsonObject
        assertEquals("turnstile-abc", meta?.get("captcha_token")?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun verifyEmailOTP_postsTheEmailVerifyGrantAndDecodesTheSession() = runBlocking {
        server.enqueue(jsonResponse(200, grantBody()))

        val session = authClient().verifyEmailOTP("ada@example.test", "123456", nowSeconds = 1_000_000.0)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/auth/v1/verify", request.requestUrl?.encodedPath)
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("email", body["type"]?.jsonPrimitive?.contentOrNull)
        assertEquals("ada@example.test", body["email"]?.jsonPrimitive?.contentOrNull)
        assertEquals("123456", body["token"]?.jsonPrimitive?.contentOrNull)

        assertEquals("granted-refresh", session.refreshToken)
        assertEquals("11111111-2222-3333-4444-555555555555", session.userId)
    }

    @Test
    fun verifyEmailOTP_anExpiredCodeIsRefused() = runBlocking {
        // GoTrue's aged-out-code shape: 403 with error_code otp_expired. A 4xx is Refused, terminal
        // for this attempt; the screen offers a resend, never a dead stop.
        server.enqueue(
            jsonResponse(
                403,
                """{"code":403,"error_code":"otp_expired","msg":"Token has expired or is invalid"}""",
            ),
        )

        val error = runCatching {
            authClient().verifyEmailOTP("ada@example.test", "000000", 0.0)
        }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.Refused)
        assertEquals(403, (error as SupabaseAuthError.Refused).status)
    }

    @Test
    fun verifyEmailOTP_aWrongCodeIsRefused() = runBlocking {
        // GoTrue does not leak wrong-vs-expired: a never-issued code returns the same 403
        // otp_expired shape as an aged-out one. Either way the verify is Refused and the user
        // resends; the coarse taxonomy is the point (one generic "that code didn't work" upstream).
        server.enqueue(
            jsonResponse(
                403,
                """{"code":403,"error_code":"otp_expired","msg":"Token has expired or is invalid"}""",
            ),
        )

        val error = runCatching {
            authClient().verifyEmailOTP("ada@example.test", "999999", 0.0)
        }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.Refused)
        assertEquals(403, (error as SupabaseAuthError.Refused).status)
    }

    @Test
    fun verifyEmailLink_postsTheTokenHashVerifyAndDecodesTheSession() = runBlocking {
        // The magic-link twin: token_hash + the link's own type, decoded to a session on the same
        // /verify leg. (The deep-link route that would call this is the owner-gated App Links track.)
        server.enqueue(jsonResponse(200, grantBody()))

        val session = authClient().verifyEmailLink(tokenHash = "hash-xyz", type = "magiclink", nowSeconds = 1_000_000.0)

        val request = server.takeRequest()
        assertEquals("/auth/v1/verify", request.requestUrl?.encodedPath)
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("magiclink", body["type"]?.jsonPrimitive?.contentOrNull)
        assertEquals("hash-xyz", body["token_hash"]?.jsonPrimitive?.contentOrNull)
        assertEquals("granted-refresh", session.refreshToken)
    }

    @Test
    fun verifyEmailOTP_ridesTheSameIssuerPinAsTheGrants() = runBlocking {
        // OTP is a new way in, not a new machine: a verified session passes the identical issuer pin
        // a password grant does, so a token minted under the wrong iss is rejected before it stores.
        server.enqueue(jsonResponse(200, grantBody(issuer = "https://api.crossy.party/auth/v1")))

        val error = runCatching {
            authClient(issuer = REF_ISSUER).verifyEmailOTP("ada@example.test", "123456", 0.0)
        }.exceptionOrNull()

        assertTrue(error is SupabaseAuthError.IssuerMismatch)
        assertEquals("https://api.crossy.party/auth/v1", (error as SupabaseAuthError.IssuerMismatch).actual)
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
