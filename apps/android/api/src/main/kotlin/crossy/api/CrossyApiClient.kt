// The REST client for the §12 companion (PROTOCOL.md §12; AAD-1 adapter). Twin of apps/ios
// CrossyAPIClient.swift. Payload shapes are CrossyProtocol's REST twins, consumed as-is and never
// redefined here. Every JSON route in the §12 table is bearer-authenticated (the only public
// route, `GET /g/{code}`, is an HTML shell for link unfurlers, not a client API), so every method
// attaches the bearer. Where §12 prose leaves a detail loose, the live API is mirrored: the
// pagination query parameters are exactly `limit` and `before` (apps/api/src/http/pagination.ts),
// route mounts are `/puzzles`, `/games`, `/account` (apps/api/src/app.ts), and creates answer 201
// while everything else answers 200 (this client accepts any 2xx rather than pinning the split).
//
// Failure taxonomy lives in CrossyApiError; the auth surface is BearerTokenProvider. Timestamps
// stay ISO 8601 strings end to end, so the pagination cursor is the last row's `createdAt` passed
// back verbatim, never a parsed-and-reformatted date.
//
// The iOS Live Activity push routes (§12a) have no twin here: AAD-4 defers the Live Activity
// analog, and CrossyProtocol carries no `LiveActivityTokenRegistration` on this side.

package crossy.api

import crossy.protocol.AbandonResponse
import crossy.protocol.AnalysisView
import crossy.protocol.APIErrorEnvelope
import crossy.protocol.CreateGameRequest
import crossy.protocol.CreateGameResponse
import crossy.protocol.DeleteAccountResponse
import crossy.protocol.GameMembershipResponse
import crossy.protocol.GameSummary
import crossy.protocol.GameView
import crossy.protocol.GamesListResponse
import crossy.protocol.JoinGameRequest
import crossy.protocol.KickResponse
import crossy.protocol.ProtocolJson
import crossy.protocol.PuzzleSummary
import crossy.protocol.PuzzleView
import crossy.protocol.PuzzlesListResponse
import crossy.protocol.Role
import crossy.protocol.RoleChangeRequest
import kotlinx.serialization.DeserializationStrategy
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * One page of a cursor-paginated list (`GET /games`, `GET /puzzles`). The wire body is just the
 * rows, newest first; the cursor contract (§12) is "pass the last row's `createdAt` as the next
 * `before`", which [nextBefore] precomputes. The wire carries no has-more flag, so none is
 * invented: a full final page yields a [nextBefore] whose fetch returns the empty page that ends
 * iteration. Twin of iOS `APIPage`.
 */
public data class ApiPage<Row>(
    val rows: List<Row>,
    val nextBefore: String?,
)

/**
 * The REST client. A value: injected base URL (the core API origin), injected token source,
 * injected OkHttpClient (tests stub via MockWebServer). Every method is `suspend` and throws
 * [CrossyApiError] only.
 */
public class CrossyApiClient(
    private val baseUrl: HttpUrl,
    private val tokenProvider: BearerTokenProvider,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    // MARK: - Puzzles (§12: POST /puzzles, GET /puzzles)

    /** `POST /puzzles`: ingest an XWord Info JSON document, uploaded verbatim. The body is a
     *  third-party document whose schema is ingestion's to pin (§12), so it is raw bytes, not a
     *  typed payload. Rejections arrive as [CrossyApiError.Api] with the named ingestion codes
     *  (422) or `VALIDATION` (400). */
    public suspend fun createPuzzle(xwordInfoDocument: ByteArray): PuzzleView =
        send(
            Endpoint("POST", listOf("puzzles"), body = xwordInfoDocument),
            PuzzleView.serializer(),
        )

    /** `GET /puzzles`: the caller's uploaded puzzles, newest first. `limit` is clamped server-side
     *  to [1, 100] (default 50); `before` is the `createdAt` cursor ([ApiPage.nextBefore]),
     *  strictly-before filtering. */
    public suspend fun listPuzzles(limit: Int? = null, before: String? = null): ApiPage<PuzzleSummary> {
        val response = send(
            Endpoint("GET", listOf("puzzles"), query = pageQuery(limit, before)),
            PuzzlesListResponse.serializer(),
        )
        return ApiPage(response.puzzles, response.puzzles.lastOrNull()?.createdAt)
    }

    // MARK: - Games (§12: POST /games, GET /games, joins, view, lifecycle)

    /** `POST /games`: create a game from an ingested puzzle (full account; the creator is seated
     *  host). The optional `name` rides in the typed request, absent when null. */
    public suspend fun createGame(body: CreateGameRequest): CreateGameResponse =
        send(
            Endpoint("POST", listOf("games"), body = encode(CreateGameRequest.serializer(), body)),
            CreateGameResponse.serializer(),
        )

    /** `GET /games`: the caller's games (membership join), most-recently-active first within the
     *  page (§12). The page is selected by createdAt but shown by activity, so the cursor is the
     *  server-computed `nextBefore` (the page-minimum createdAt), not the reordered last row.
     *  Prefer that field; fall back to the last row's `createdAt` only for an older server that
     *  omits it (before activity ordering shipped), where the two coincide. A null `nextBefore` on
     *  a full response means the list is exhausted. */
    public suspend fun listGames(limit: Int? = null, before: String? = null): ApiPage<GameSummary> {
        val response = send(
            Endpoint("GET", listOf("games"), query = pageQuery(limit, before)),
            GamesListResponse.serializer(),
        )
        val nextBefore =
            if (response.hasCursor) response.nextBefore else response.games.lastOrNull()?.createdAt
        return ApiPage(response.games, nextBefore)
    }

    /** `POST /games/join`: join by invite code alone; the code is the lookup key and the response
     *  carries the resolved `gameId`. The code is sent verbatim: the server owns normalization
     *  (ASCII-only uppercase plus trim, INV-1), and mirroring it here would just shadow the
     *  contract. */
    public suspend fun joinGame(code: String): GameMembershipResponse =
        send(
            Endpoint(
                "POST",
                listOf("games", "join"),
                body = encode(JoinGameRequest.serializer(), JoinGameRequest(code)),
            ),
            GameMembershipResponse.serializer(),
        )

    /** `POST /games/{id}/join`: join a known game, the code as capability. */
    public suspend fun joinGame(gameId: String, code: String): GameMembershipResponse =
        send(
            Endpoint(
                "POST",
                listOf("games", gameId, "join"),
                body = encode(JoinGameRequest.serializer(), JoinGameRequest(code)),
            ),
            GameMembershipResponse.serializer(),
        )

    /** `GET /games/{id}`: the member-only game view (solution-stripped puzzle, membership, session
     *  endpoint, invite code). */
    public suspend fun game(gameId: String): GameView =
        send(Endpoint("GET", listOf("games", gameId)), GameView.serializer())

    /** `GET /games/{id}/analysis`: the completed-game post-game bundle (first-correct owners,
     *  momentum, moments; INV-6-safe, userIds and numbers only). Member-gated and completed-only;
     *  an ongoing or abandoned game, or the brief completion race, answers 404 GAME_NOT_FOUND,
     *  surfaced as the typed [CrossyApiError.Api] envelope. */
    public suspend fun gameAnalysis(gameId: String): AnalysisView =
        send(Endpoint("GET", listOf("games", gameId, "analysis")), AnalysisView.serializer())

    /** `POST /games/{id}/role`: self role change. The only server-supported transition is spectator
     *  to solver; any other target is refused `VALIDATION`, and a guest is refused
     *  `FULL_ACCOUNT_REQUIRED`. */
    public suspend fun changeRole(gameId: String, to: Role): GameMembershipResponse =
        send(
            Endpoint(
                "POST",
                listOf("games", gameId, "role"),
                body = encode(RoleChangeRequest.serializer(), RoleChangeRequest(to)),
            ),
            GameMembershipResponse.serializer(),
        )

    /** `DELETE /games/{id}/members/{userId}`: kick (host only; never the host themselves). Removes
     *  membership and writes the denylist in one transaction server-side. */
    public suspend fun kickMember(gameId: String, userId: String): KickResponse =
        send(
            Endpoint("DELETE", listOf("games", gameId, "members", userId)),
            KickResponse.serializer(),
        )

    /** `POST /games/{id}/abandon`: terminal state via the session service (host only). No request
     *  body; the route reads none. */
    public suspend fun abandonGame(gameId: String): AbandonResponse =
        send(Endpoint("POST", listOf("games", gameId, "abandon")), AbandonResponse.serializer())

    // MARK: - Account (§12: DELETE /account)

    /** `DELETE /account`: tombstone the caller's own account, with host succession or auto-abandon
     *  per hosted game. */
    public suspend fun deleteAccount(): DeleteAccountResponse =
        send(Endpoint("DELETE", listOf("account")), DeleteAccountResponse.serializer())

    // MARK: - Request plumbing

    private class Endpoint(
        val method: String,
        val path: List<String>,
        val query: List<Pair<String, String>> = emptyList(),
        val body: ByteArray? = null,
    )

    private fun <T> encode(serializer: kotlinx.serialization.SerializationStrategy<T>, value: T): ByteArray =
        ProtocolJson.encodeToString(serializer, value).encodeToByteArray()

    /** The two pagination query parameters, named exactly as the API reads them (`limit`,
     *  `before`). Absent parameters are omitted, not sent empty: omission is the honest encoding of
     *  "not asked". */
    private fun pageQuery(limit: Int?, before: String?): List<Pair<String, String>> = buildList {
        if (limit != null) add("limit" to limit.toString())
        if (before != null) add("before" to before)
    }

    private fun urlFor(endpoint: Endpoint): HttpUrl {
        // Path segments here are all URL-safe (UUIDs, fixed words); the join code rides the body,
        // never the path. Trim a trailing slash on the base so `/` origins do not double up.
        val base = baseUrl.toString().trimEnd('/')
        val path = endpoint.path.joinToString("/")
        val builder = "$base/$path".toHttpUrl().newBuilder()
        for ((name, value) in endpoint.query) builder.addQueryParameter(name, value)
        return builder.build()
    }

    /** One round trip: token, request, status split, decode. The §12 contract in one place so every
     *  method above stays a route description. */
    private suspend fun <T> send(endpoint: Endpoint, deserializer: DeserializationStrategy<T>): T {
        val (data, status) = perform(endpoint)
        return try {
            ProtocolJson.decodeFromString(deserializer, data.decodeToString())
        } catch (e: Exception) {
            throw CrossyApiError.DecodingFailed(status, e)
        }
    }

    /**
     * The shared trip: resolve the token, build and issue the request, and split on status,
     * returning the raw 2xx body and its status code. A non-2xx throws the typed §12 envelope here,
     * so the caller never repeats it.
     *
     * A server 401 on a token the client still thought valid (clock skew, a server-side revocation,
     * a shortened TTL) triggers exactly one reactive refresh-and-retry: force a fresh token, rebuild
     * the request, re-issue once. Only 401 retries; every other status passes through unchanged
     * (DENIED, GAME_NOT_FOUND, and friends are not auth staleness). If the forced refresh cannot
     * produce a token, the original 401 outcome is surfaced, so the two 401 exits stay consistent
     * and the retry never loops (INV-11).
     */
    private suspend fun perform(endpoint: Endpoint): Pair<ByteArray, Int> {
        val token = try {
            tokenProvider.currentToken()
        } catch (e: Throwable) {
            throw CrossyApiError.TokenUnavailable(e)
        }

        val first = roundTrip(endpoint, token)
        if (first.second != 401) return outcome(first)

        // One reactive refresh: replay the request with a freshly minted token. If the refresh
        // throws (terminal sign-out, or transient weather rethrown), do not loop; surface the
        // original 401 outcome instead.
        val refreshed = try {
            tokenProvider.refreshedToken()
        } catch (e: Throwable) {
            return outcome(first)
        }

        return outcome(roundTrip(endpoint, refreshed))
    }

    /** One request build and issue with the given bearer, returning the raw body and the HTTP
     *  status for the caller to split on. Transport weather throws here as [CrossyApiError.Transport]. */
    private suspend fun roundTrip(endpoint: Endpoint, bearer: String): Pair<ByteArray, Int> {
        val requestBody = when {
            endpoint.body != null -> endpoint.body.toRequestBody(JSON_MEDIA_TYPE)
            // OkHttp requires a body for POST/PUT; a bodiless POST (abandon) sends an empty one with
            // no content type, so the wire matches the iOS bodiless POST.
            endpoint.method == "POST" || endpoint.method == "PUT" -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        val request = Request.Builder()
            .url(urlFor(endpoint))
            .method(endpoint.method, requestBody)
            .header("Authorization", "Bearer $bearer")
            .header("Accept", "application/json")
            .build()

        val response = try {
            httpClient.newCall(request).await()
        } catch (e: IOException) {
            throw CrossyApiError.Transport(e)
        }
        return response.use { (it.body?.bytes() ?: ByteArray(0)) to it.code }
    }

    /** The status split: a 2xx returns its body and status; a non-2xx throws the typed §12 envelope,
     *  keyed on the stable code. The envelope's `error` stays a plain string, so a code outside
     *  today's vocabulary still decodes and surfaces typed (degraded, never crashed). */
    private fun outcome(trip: Pair<ByteArray, Int>): Pair<ByteArray, Int> {
        val (data, status) = trip
        if (status in 200..299) return trip
        val envelope = try {
            ProtocolJson.decodeFromString(APIErrorEnvelope.serializer(), data.decodeToString())
        } catch (e: Exception) {
            throw CrossyApiError.InvalidResponse(status)
        }
        throw CrossyApiError.Api(status, envelope)
    }
}
