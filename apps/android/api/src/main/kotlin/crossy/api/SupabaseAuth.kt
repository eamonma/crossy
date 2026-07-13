// The Supabase (GoTrue) auth REST leg (AAD-3). Twin of apps/ios SupabaseAuth.swift, trimmed to
// tonight's scope: email/password sign-in and the refresh grant, plus best-effort sign-out. No
// PKCE code exchange and no Apple id_token grant (no browser flow, no native providers tonight).
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
)

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

    private suspend fun grant(
        grantType: String,
        body: JsonObject,
        nowSeconds: Double,
    ): SupabaseSession {
        val url = config.authBaseUrl.newBuilder()
            .addPathSegment("token")
            .addQueryParameter("grant_type", grantType)
            .build()
        val payload = ProtocolJson.encodeToString(JsonObject.serializer(), body)
        val request = Request.Builder()
            .url(url)
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

        val decoded = try {
            ProtocolJson.decodeFromString(TokenResponse.serializer(), text)
        } catch (e: Exception) {
            throw SupabaseAuthError.InvalidResponse(status)
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
