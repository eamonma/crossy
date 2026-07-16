// The Supabase (GoTrue) auth REST leg (AAD-3). Twin of apps/ios SupabaseAuth.swift: the password
// grant, the refresh grant, email OTP / magic link, best-effort sign-out, and the OAuth web leg
// (authorize URL + PKCE code exchange) for Discord, Apple, and hisbaan. No id_token grant: Android
// has no native Apple SDK, so Apple rides the same web leg as the others.
//
// The issuer trap (deploy/README.md, it has caused an outage once): every request here rides the
// CONFIGURED Supabase origin verbatim (the custom domain, `authBaseUrl`), while the tokens it
// returns carry the ref-domain `iss` the deploy pins and the services verify against
// (SUPABASE_ISSUER, always the ref domain even under a custom domain). So `issuer` arrives as its
// OWN configuration datum, NEVER derived from `authBaseUrl`: deriving an issuer from the auth
// origin here would recreate the outage client-side.
//
// Where iOS treats the token as fully opaque and never reads `iss`, this port adds a client-side
// pin (mirror it, per the task): after a grant it reads ONLY the token's `iss` claim and rejects a
// mismatch against the pinned `issuer`, so a token minted under the wrong issuer never reaches the
// store (it would 401 on every server anyway). Signature verification stays the servers' job; this
// reads a claim, it does not trust the token.

package crossy.api

import crossy.protocol.ProtocolJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.Base64

/**
 * The committed public auth facts, arriving as configuration data (every value is public by
 * design, INV-6 note in deploy/README.md). `authBaseUrl` is the `{SupabaseURL}/auth/v1` GoTrue
 * mount on the custom domain; `apiKey` is the `sb_publishable_...` key sent as `apikey`; `issuer`
 * is the pinned ref-domain `iss` (`https://<ref>.supabase.co/auth/v1`), a SEPARATE datum that is
 * never derived from `authBaseUrl` (the issuer trap).
 */
public data class SupabaseConfig(
    val authBaseUrl: HttpUrl,
    val apiKey: String,
    val issuer: String,
    /** Where the OAuth web leg lands back: the custom-scheme deep link the browser redirect
     *  returns to (already on the Supabase allowlist; iOS rides the same value). A String, not
     *  an HttpUrl: okhttp cannot represent a custom scheme. Config, never derived or hardcoded
     *  in client logic; the default keeps existing composition roots compiling until the browser
     *  leg wires it explicitly. */
    val redirectUrl: String = "crossy://auth/callback",
)

/**
 * Which provider minted the session (display only; the token is the identity authority,
 * DESIGN.md §8). `wireId` is exactly the `provider=` query value GoTrue expects, so the one
 * web leg serves every entry with no branching. Twin of iOS `AuthProvider`.
 */
public enum class AuthProvider(public val wireId: String) {
    DISCORD("discord"),

    /** Apple rides the same web leg as the others on Android (no native Apple SDK, so no
     *  id_token grant; the iOS-only leg stays iOS-only). */
    APPLE("apple"),

    /** The custom OIDC provider. Its wire id carries a colon, which the authorize URL
     *  percent-encodes (`custom%3Ahisbaan`) so proxies never mis-split the query value. */
    HISBAAN("custom:hisbaan"),

    /** Email OTP / magic link: no web leg, the session arrives through the verify grant. The
     *  entry exists so the provider marker can name it. GoTrue's own `email` provider string. */
    EMAIL_OTP("email"),
}

/**
 * What the OAuth redirect carried, parsed from the deep-link URI the browser leg hands back.
 * A provider refusal arrives as `error`/`error_description` and no code; [code] is null then
 * (and for an empty or absent value), which the session leg maps to a typed
 * [SupabaseAuthError.InvalidCallback]. Twin of iOS `authorizationCode(fromCallback:)`, widened
 * to surface the error pair for the screen.
 */
public data class OAuthCallback(
    val code: String?,
    val error: String?,
    val errorDescription: String?,
) {
    public companion object {
        /** Parse a callback URI (custom scheme, so java.net.URI, not okhttp). Malformed input
         *  parses to an empty callback rather than throwing: a garbage URI is just a callback
         *  that carried no code. */
        public fun parse(uri: String): OAuthCallback {
            val rawQuery = try {
                java.net.URI(uri).rawQuery
            } catch (e: Exception) {
                null
            }
            val params = (rawQuery ?: "").split("&").mapNotNull { pair ->
                if (pair.isEmpty()) return@mapNotNull null
                val split = pair.indexOf('=')
                val name = if (split >= 0) pair.substring(0, split) else pair
                val value = if (split >= 0) pair.substring(split + 1) else ""
                decode(name) to decode(value)
            }.toMap()
            return OAuthCallback(
                code = params["code"]?.takeIf { it.isNotEmpty() },
                error = params["error"],
                errorDescription = params["error_description"],
            )
        }

        private fun decode(value: String): String = try {
            java.net.URLDecoder.decode(value, "UTF-8")
        } catch (e: IllegalArgumentException) {
            value
        }
    }
}

/**
 * One signed-in session as Supabase grants it and the store persists it. `@Serializable` because
 * a Keystore-backed [TokenStore] serializes exactly this. `expiresAt` is unix seconds; the token
 * itself stays opaque beyond the pinned `iss` read (no signature check: the `exp` we need arrives
 * as a sibling field). Twin of iOS `SupabaseSession`.
 */
@Serializable
public data class SupabaseSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Double,
    val userId: String?,
)

/**
 * Why an auth call failed. `Refused` is the auth server speaking (bad credentials, a dead refresh
 * token); `Transport` is network weather; `InvalidResponse` is a broken frame; `IssuerMismatch` is
 * the client-side pin rejecting a token whose `iss` is not the configured issuer. Twin of iOS
 * `SupabaseAuthError`, plus the pin case.
 */
public sealed class SupabaseAuthError(message: String, cause: Throwable? = null) :
    Exception(message, cause) {

    public class Transport(cause: Throwable) : SupabaseAuthError("transport failure", cause)

    /** The server answered 4xx: the grant is refused and retrying the same request cannot help.
     *  For a refresh this is terminal (the session is over). 408 and 429 are carved out (the
     *  limiter answered, not the grant evaluator), riding the transient [InvalidResponse] lane. */
    public class Refused(public val status: Int) :
        SupabaseAuthError("grant refused ($status)")

    /** A 5xx, an undecodable body, or a malformed token: the session stands and a later retry may
     *  succeed (the transient refresh case). */
    public class InvalidResponse(public val status: Int?) :
        SupabaseAuthError("invalid response frame (status $status)")

    /** The pin fired: the granted token's `iss` is not the configured ref-domain issuer, so the
     *  token is rejected before it can be stored (deploy/README.md issuer trap). `actual` is null
     *  when the token carried no readable `iss`, which fails the pin closed. */
    public class IssuerMismatch(public val expected: String, public val actual: String?) :
        SupabaseAuthError("token issuer $actual is not the pinned $expected")

    /** The OAuth callback carried no code: the provider refused (its `error` and
     *  `error_description` ride here for the screen) or the redirect was malformed. Typed and
     *  thrown before any network call; there is nothing to exchange. Twin of iOS
     *  `invalidCallback`, widened with the error pair. */
    public class InvalidCallback(
        public val error: String?,
        public val errorDescription: String?,
    ) : SupabaseAuthError("oauth callback carried no code${error?.let { " ($it)" } ?: ""}")
}

/** The vendor calls, a value over an injected OkHttpClient (tests stub via MockWebServer, the
 *  CrossyApiClient pattern). Every session it returns has already passed the issuer pin. */
public class SupabaseAuthClient(
    public val config: SupabaseConfig,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    /** `POST {auth}/token?grant_type=password`: email/password sign-in (AAD-3). */
    public suspend fun signInWithPassword(
        email: String,
        password: String,
        nowSeconds: Double,
    ): SupabaseSession =
        grant(
            grantType = "password",
            body = buildJsonObject {
                put("email", email)
                put("password", password)
            },
            nowSeconds = nowSeconds,
        )

    // MARK: - The OAuth web leg (authorize URL + PKCE exchange)

    /** `GET {auth}/authorize?provider=<provider>&...`: where the browser leg navigates. The
     *  query mirrors iOS exactly: `provider`, `redirect_to`, `code_challenge`,
     *  `code_challenge_method=s256`, in that order. The provider value is percent-encoded
     *  beyond okhttp's query rules so `custom:hisbaan` rides as `custom%3Ahisbaan` (a bare
     *  colon in a query value survives okhttp, but some proxies mis-split it; the encoded form
     *  is the contract). Only the provider value gets that treatment, so the Discord leg is
     *  byte-identical to iOS's. Pure construction, no IO. */
    public fun authorizeUrl(
        provider: AuthProvider = AuthProvider.DISCORD,
        codeChallenge: String,
    ): HttpUrl =
        config.authBaseUrl.newBuilder()
            .addPathSegment("authorize")
            .addEncodedQueryParameter("provider", percentEncodeProviderValue(provider.wireId))
            .addQueryParameter("redirect_to", config.redirectUrl)
            .addQueryParameter("code_challenge", codeChallenge)
            .addQueryParameter("code_challenge_method", "s256")
            .build()

    /** Force every reserved character in the provider value into percent form (chiefly the ":"
     *  of `custom:hisbaan`), leaving only the RFC 3986 unreserved set bare. The value still
     *  decodes back to the raw wire id on the server's side. Twin of iOS
     *  `providerValueAllowed`. */
    private fun percentEncodeProviderValue(value: String): String = buildString {
        for (byte in value.encodeToByteArray()) {
            val c = byte.toInt().toChar()
            if (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c in "-._~") {
                append(c)
            } else {
                append('%')
                append("0123456789ABCDEF"[(byte.toInt() ushr 4) and 0xF])
                append("0123456789ABCDEF"[byte.toInt() and 0xF])
            }
        }
    }

    /** `POST {auth}/token?grant_type=pkce`: exchange the callback's code plus the held verifier
     *  for a session. Same decode, issuer pin, and error taxonomy as the password grant, so an
     *  OAuth session is indistinguishable downstream. */
    public suspend fun exchangeCode(
        authCode: String,
        verifier: String,
        nowSeconds: Double,
    ): SupabaseSession =
        grant(
            grantType = "pkce",
            body = buildJsonObject {
                put("auth_code", authCode)
                put("code_verifier", verifier)
            },
            nowSeconds = nowSeconds,
        )

    /** `POST {auth}/token?grant_type=refresh_token`: the silent refresh. A `Refused` throw means
     *  the refresh token is dead (terminal); everything else is weather. */
    public suspend fun refresh(refreshToken: String, nowSeconds: Double): SupabaseSession =
        grant(
            grantType = "refresh_token",
            body = buildJsonObject { put("refresh_token", refreshToken) },
            nowSeconds = nowSeconds,
        )

    /** `POST {auth}/logout?scope=local`: revoke this device's refresh token server-side, not the
     *  user's whole token family (global scope would sign the web app and other devices out at
     *  their next refresh). Best-effort by design: local sign-out must succeed even offline, so
     *  the caller never awaits a verdict here. */
    public suspend fun signOut(accessToken: String) {
        val url = config.authBaseUrl.newBuilder()
            .addPathSegment("logout")
            .addQueryParameter("scope", "local")
            .build()
        val request = Request.Builder()
            .url(url)
            .header("apikey", config.apiKey)
            .header("Authorization", "Bearer $accessToken")
            .post(ByteArray(0).toRequestBody(null))
            .build()
        runCatching { httpClient.newCall(request).await().use { } }
    }

    // MARK: - Email OTP / magic link (roadmap I3b, mirrors #230)

    /** `POST {auth}/otp`: ask GoTrue to email a one-time code (and the magic link). No session
     *  comes back, only a send acknowledgement, so this returns Unit over the same error taxonomy
     *  as the grants (Refused on a 4xx, weather otherwise). `create_user` mints an account on first
     *  sight, so a fresh email signs in rather than dead-ending.
     *
     *  `captchaToken` rides in `gotrue_meta_security.captcha_token`, the shape GoTrue reads: a
     *  project with Turnstile on refuses a send without one. Null omits the whole block, so a
     *  captcha-off build's body is byte-identical to the plain send. Minting the token needs a
     *  hidden web view (the iOS TurnstileProvider twin), its own later track; the wire hook is here
     *  so it drops in with no change to this leg. */
    public suspend fun sendEmailOTP(email: String, captchaToken: String? = null) {
        post(path = "otp", body = otpBody(email, captchaToken))
    }

    /** `POST {auth}/verify`: exchange the emailed code for a session (step two of the OTP flow).
     *  Same decode, issuer pin, and error taxonomy as the token grants, so a verified OTP session
     *  is indistinguishable from a password one downstream. */
    public suspend fun verifyEmailOTP(
        email: String,
        token: String,
        nowSeconds: Double,
    ): SupabaseSession =
        sessionFrom(
            post(
                path = "verify",
                body = buildJsonObject {
                    put("type", "email")
                    put("email", email)
                    put("token", token)
                },
            ),
            nowSeconds,
        )

    /** `POST {auth}/verify`: complete a magic link by its `token_hash`. `type` is the link's own
     *  type (`magiclink`, `email`, ...), passed through verbatim from the callback. Same decode,
     *  pin, and taxonomy as the code verify. The deep-link route that would call this is the
     *  owner-gated App Links track (PARITY.md); this REST leg lands here so it drops in with no
     *  further :api change. */
    public suspend fun verifyEmailLink(
        tokenHash: String,
        type: String,
        nowSeconds: Double,
    ): SupabaseSession =
        sessionFrom(
            post(
                path = "verify",
                body = buildJsonObject {
                    put("type", type)
                    put("token_hash", tokenHash)
                },
            ),
            nowSeconds,
        )

    // MARK: - Plumbing

    @Serializable
    private data class TokenResponse(
        @SerialName("access_token") val accessToken: String,
        @SerialName("refresh_token") val refreshToken: String,
        @SerialName("expires_in") val expiresIn: Double? = null,
        @SerialName("expires_at") val expiresAt: Double? = null,
        val user: User? = null,
    ) {
        @Serializable
        data class User(val id: String? = null)
    }

    /** The `/otp` send body: the address, `create_user` so a fresh email signs up rather than
     *  dead-ends, and the captcha envelope only when a token is present (omitted when null, so the
     *  captcha-off body is byte-identical to the plain send). */
    private fun otpBody(email: String, captchaToken: String?): JsonObject =
        buildJsonObject {
            put("email", email)
            put("create_user", true)
            if (captchaToken != null) {
                putJsonObject("gotrue_meta_security") { put("captcha_token", captchaToken) }
            }
        }

    private suspend fun grant(
        grantType: String,
        body: JsonObject,
        nowSeconds: Double,
    ): SupabaseSession =
        sessionFrom(
            post(path = "token", query = listOf("grant_type" to grantType), body = body),
            nowSeconds,
        )

    /** The shared POST leg for every JSON auth call: the apikey header, the JSON body, and the one
     *  error taxonomy (Refused on a 4xx grant refusal, InvalidResponse for 5xx and undecodable
     *  frames, Transport for network weather). Returns the raw 2xx body for the caller to decode, or
     *  to ignore for the send-only `otp` leg. 408/429 stay in the transient lane: the limiter
     *  answered, not the grant evaluator. */
    private suspend fun post(
        path: String,
        query: List<Pair<String, String>>? = null,
        body: JsonObject,
    ): String {
        val urlBuilder = config.authBaseUrl.newBuilder().addPathSegment(path)
        query?.forEach { (name, value) -> urlBuilder.addQueryParameter(name, value) }
        val payload = ProtocolJson.encodeToString(JsonObject.serializer(), body)
        val request = Request.Builder()
            .url(urlBuilder.build())
            .header("apikey", config.apiKey)
            .post(payload.encodeToByteArray().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        val response = try {
            httpClient.newCall(request).await()
        } catch (e: IOException) {
            throw SupabaseAuthError.Transport(e)
        }
        val status = response.code
        val text = response.use { it.body?.string().orEmpty() }

        if (status !in 200..299) {
            // 408/429 are congestion, not judgment: the refresh token behind a rate-limited grant
            // is still good, so ending the session over one would sign the user out for nothing.
            if (status in 400..499 && status != 408 && status != 429) {
                throw SupabaseAuthError.Refused(status)
            }
            throw SupabaseAuthError.InvalidResponse(status)
        }
        return text
    }

    /** Decode a token-grant body (the `token` and `verify` legs share it) into a session, then run
     *  the issuer pin. An undecodable 2xx body is InvalidResponse, the same verdict a malformed
     *  grant got. Every session this returns has passed the pin, so an OTP-verified session is a
     *  password session's twin downstream: it refreshes on the identical path. */
    private fun sessionFrom(text: String, nowSeconds: Double): SupabaseSession {
        val decoded = try {
            ProtocolJson.decodeFromString(TokenResponse.serializer(), text)
        } catch (e: Exception) {
            throw SupabaseAuthError.InvalidResponse(null)
        }
        // expires_at when the server sends it, else derived from expires_in against the injected
        // clock (older GoTrue omits the absolute form).
        val expiresAt = decoded.expiresAt ?: (nowSeconds + (decoded.expiresIn ?: 3600.0))
        val session = SupabaseSession(
            accessToken = decoded.accessToken,
            refreshToken = decoded.refreshToken,
            expiresAt = expiresAt,
            userId = decoded.user?.id,
        )
        // The pin: the token's own `iss` claim must be the configured ref-domain issuer, or the
        // token is rejected before it can be stored (deploy/README.md issuer trap).
        val tokenIssuer = issuerClaim(session.accessToken)
        if (tokenIssuer != config.issuer) {
            throw SupabaseAuthError.IssuerMismatch(config.issuer, tokenIssuer)
        }
        return session
    }

    /** The `iss` claim of a JWT access token, or null when it is unreadable (a token we cannot
     *  verify against the pin fails it closed). Reads the claim only; the signature stays the
     *  servers' to verify (deploy/README.md). */
    private fun issuerClaim(accessToken: String): String? {
        val parts = accessToken.split(".")
        if (parts.size < 2) return null
        return try {
            val padded = parts[1].padEnd((parts[1].length + 3) / 4 * 4, '=')
            val json = Base64.getUrlDecoder().decode(padded).decodeToString()
            ProtocolJson.parseToJsonElement(json).jsonObject["iss"]?.jsonPrimitive?.contentOrNull
        } catch (e: Exception) {
            null
        }
    }
}
