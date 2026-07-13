// The reactive refresh-and-retry on a server 401 (CrossyApiClient.perform), the seam INV-11
// defends: when the client's local clock still thinks a token is valid but the server rejects it
// (clock skew, a server-side revocation, a shortened TTL), the client forces exactly one refresh
// through the token provider and replays the request once before surfacing the failure. Only a 401
// triggers the retry, and it happens at most once (never a loop). Twin of apps/ios
// RefreshOn401Tests.swift (PR #192 pattern).

package crossy.api

import crossy.protocol.APIErrorCode
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

class RefreshOn401Tests : MockServerTest() {
    private val unauthorized = """{"error":"UNAUTHORIZED","message":"the session expired"}"""

    @Test
    fun aServer401RefreshesOnceRetriesWithTheFreshTokenAndSucceeds_INV11() = runBlocking {
        // First request carries the stale token and is rejected 401; the client forces a refresh
        // and replays with the fresh token, which the server accepts.
        server.enqueue(jsonResponse(401, unauthorized))
        server.enqueue(jsonResponse(200, Fixtures.GAMES_LIST))
        val provider = StaleThenFreshTokenProvider(stale = "stale-token", fresh = "fresh-token")

        val page = client(provider).listGames()

        // The decoded success came back: the retry carried the request through.
        assertEquals(2, page.rows.size)
        // Exactly one refresh, exactly one retry (two requests total).
        assertEquals(1, provider.refreshedTokenCallCount, "forced a single refresh")
        assertEquals(2, server.requestCount, "the request was replayed once")
        assertEquals("Bearer stale-token", server.takeRequest().getHeader("Authorization"))
        assertEquals(
            "Bearer fresh-token",
            server.takeRequest().getHeader("Authorization"),
            "the replay carried the freshly minted token",
        )
    }

    @Test
    fun aTerminalSignedOutRefreshSurfacesThe401AndDoesNotRetry_INV11() = runBlocking {
        // The forced refresh is terminally refused (SignedOutError): the client surfaces the
        // original 401/UNAUTHORIZED and never issues a second request.
        server.enqueue(jsonResponse(401, unauthorized))
        val provider = StaleThenFreshTokenProvider(stale = "stale-token", refreshThrows = SignedOutError())

        val error = runCatching { client(provider).listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Api)
        error as CrossyApiError.Api
        assertEquals(401, error.status)
        assertEquals(APIErrorCode.UNAUTHORIZED, error.envelope.code)

        assertEquals(1, provider.refreshedTokenCallCount, "one refresh was attempted")
        assertEquals(1, server.requestCount, "a refused refresh does not replay the request")
    }

    @Test
    fun aTransientRefreshFailureSurfacesTheOriginal401WithoutRetrying_INV11() = runBlocking {
        // A transient refresh failure (network weather rethrown) is not a sign-out; the client
        // still surfaces the original 401 and does not loop.
        server.enqueue(jsonResponse(401, unauthorized))
        val provider =
            StaleThenFreshTokenProvider(stale = "stale-token", refreshThrows = IOException("offline"))

        val error = runCatching { client(provider).listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Api)
        assertEquals(401, (error as CrossyApiError.Api).status)
        assertEquals(1, provider.refreshedTokenCallCount)
        assertEquals(1, server.requestCount, "no replay on transient weather")
    }

    @Test
    fun aSecond401AfterTheRefreshIsSurfacedAndNotRetriedAgain_INV11() = runBlocking {
        // The refresh mints a token the server also rejects: the retry runs once, the second 401 is
        // surfaced as UNAUTHORIZED, and there is no third attempt.
        server.enqueue(jsonResponse(401, unauthorized))
        server.enqueue(jsonResponse(401, """{"error":"UNAUTHORIZED","message":"still rejected"}"""))
        val provider = StaleThenFreshTokenProvider(stale = "stale-token", fresh = "fresh-token")

        val error = runCatching { client(provider).listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Api)
        error as CrossyApiError.Api
        assertEquals(401, error.status)
        assertEquals(APIErrorCode.UNAUTHORIZED, error.envelope.code)
        assertEquals(1, provider.refreshedTokenCallCount, "the refresh ran exactly once")
        assertEquals(2, server.requestCount, "the request is replayed at most once, never a third time")
    }

    @Test
    fun aNon401RejectionPassesThroughAndNeverRefreshes_INV11() = runBlocking {
        // 403 DENIED (and every non-401 status) is not auth staleness: the client must not refresh
        // and must surface it unchanged.
        server.enqueue(jsonResponse(403, """{"error":"DENIED","message":"not a member"}"""))
        val provider = StaleThenFreshTokenProvider(stale = "stale-token", fresh = "fresh-token")

        val error = runCatching { client(provider).listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Api)
        assertEquals(403, (error as CrossyApiError.Api).status)
        assertEquals(0, provider.refreshedTokenCallCount, "a 403 is not auth staleness: no refresh")
        assertEquals(1, server.requestCount, "no replay for a non-401")
    }
}
