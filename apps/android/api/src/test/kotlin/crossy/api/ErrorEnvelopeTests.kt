// The failure taxonomy (PROTOCOL.md §12 error vocabulary; CrossyApiError). A client keys on the
// stable code string, never on prose: every assertion reads `envelope.error`/`envelope.code` and
// none inspects `message` content. Twin of apps/ios ErrorMappingTests.swift. The load-bearing case
// is the unknown future code, which must degrade to a typed error with the stable string kept, not
// fail the decode (§12 names codeless rejections that may gain codes later).

package crossy.api

import crossy.protocol.APIErrorCode
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse

class ErrorEnvelopeTests : MockServerTest() {

    @Test
    fun aNonTwoXXWithAKnownCodeThrowsATypedApiError() = runBlocking {
        server.enqueue(jsonResponse(400, Fixtures.ERROR_ENVELOPE_VALIDATION))

        val error = runCatching { client().listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Api)
        error as CrossyApiError.Api
        assertEquals(400, error.status)
        assertEquals(APIErrorCode.VALIDATION, error.envelope.code)
        assertEquals("VALIDATION", error.envelope.error)
        assertEquals(APIErrorCode.VALIDATION, error.apiCode)
        assertEquals("VALIDATION", error.apiCodeString)
    }

    @Test
    fun anIngestionRejectionSurfacesItsNamedCode() = runBlocking {
        // §12: a parseable but unacceptable puzzle is a named 422 rejection.
        server.enqueue(jsonResponse(422, """{"error":"OVERSIZE_GRID","message":"the grid is too big"}"""))

        val error = runCatching { client().createPuzzle("{}".toByteArray()) }.exceptionOrNull()
        assertEquals(APIErrorCode.OVERSIZE_GRID, (error as CrossyApiError).apiCode)
    }

    @Test
    fun anUnknownFutureCodeDegradesToATypedErrorNotACrash() = runBlocking {
        // §12 names codeless rejections (barred, uniclue) that may gain codes later; when one
        // lands, this client surfaces it typed with the stable string kept, not a decode failure.
        server.enqueue(jsonResponse(422, """{"error":"BARRED","message":"barred grids are unsupported"}"""))

        val error = runCatching { client().listPuzzles() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Api)
        error as CrossyApiError.Api
        assertEquals(422, error.status)
        assertNull(error.envelope.code, "unknown code has no typed view")
        assertEquals("BARRED", error.envelope.error, "the stable string survives")
        assertEquals("BARRED", error.apiCodeString)
    }

    @Test
    fun aTransportFailureIsDistinctFromAnApiRejection() = runBlocking {
        // No enqueued response and the socket dropped at the start of the body: OkHttp raises an
        // IOException, which the client maps to Transport (network weather, nothing judged).
        server.enqueue(MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AT_START))
        val impatient = CrossyApiClient(baseUrl(), InjectedTokenProvider("test-token"), OkHttpClient())

        val error = runCatching { impatient.listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Transport, "expected Transport, got $error")
        assertTrue((error as CrossyApiError.Transport).cause is IOException)
        assertNull(error.apiCodeString, "network weather carries no API code")
    }

    @Test
    fun aNonEnvelopeErrorBodyIsInvalidResponseNotACrash() = runBlocking {
        // A proxy in front of the API can answer non-2xx with HTML; that is a broken contract frame,
        // not an API rejection with a code.
        server.enqueue(
            MockResponse().setResponseCode(502).addHeader("Content-Type", "text/html")
                .setBody("<html>bad gateway</html>"),
        )

        val error = runCatching { client().listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.InvalidResponse)
        assertEquals(502, (error as CrossyApiError.InvalidResponse).status)
    }

    @Test
    fun aTwoXXBodyThatIsNotTheContractIsDecodingFailed() = runBlocking {
        server.enqueue(jsonResponse(200, """{"unexpected":"shape"}"""))

        val error = runCatching { client().listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.DecodingFailed)
        assertEquals(200, (error as CrossyApiError.DecodingFailed).status)
    }

    @Test
    fun aFailedTokenProviderThrowsTokenUnavailableAndSendsNothing() = runBlocking {
        server.enqueue(jsonResponse(200, "{}"))
        val error = runCatching { client(NoSessionTokenProvider()).listGames() }.exceptionOrNull()
        assertTrue(error is CrossyApiError.TokenUnavailable)
        assertTrue((error as CrossyApiError.TokenUnavailable).cause is NoSessionTokenProvider.NoSession)
        assertEquals(0, server.requestCount, "no token, no request: nothing reaches the wire")
    }
}
