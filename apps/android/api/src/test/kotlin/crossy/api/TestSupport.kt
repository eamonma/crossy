// Shared MockWebServer plumbing for the REST + auth suites. The server is in-process (no external
// process); each test enqueues canned responses or installs a routing dispatcher, drives the
// suspend client under runBlocking, and reads back the recorded requests. Fixture bodies are the
// §12 field lists inline (fixture-style JSON), matching the shapes CrossyProtocol's own snapshot
// fixtures pin, so the client is exercised against the same normative shapes.

package crossy.api

import okhttp3.HttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import java.util.Base64

/** Start/stop a MockWebServer around each test and build clients pointed at it. */
abstract class MockServerTest {
    protected lateinit var server: MockWebServer

    @BeforeEach
    fun startServer() {
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun stopServer() {
        server.shutdown()
    }

    protected fun baseUrl(): HttpUrl = server.url("/")

    protected fun client(
        provider: BearerTokenProvider = InjectedTokenProvider("test-token"),
    ): CrossyApiClient = CrossyApiClient(baseUrl(), provider)

    protected fun jsonResponse(status: Int, body: String): MockResponse =
        MockResponse()
            .setResponseCode(status)
            .addHeader("Content-Type", "application/json")
            .setBody(body)
}

/**
 * A provider that separates the proactive token from the forced refresh, so the 401 retry path is
 * drivable: [currentToken] serves the stale token the server will reject; [refreshedToken] serves a
 * fresh one (or throws when [refreshThrows] is set). Both call counts are recorded. Twin of iOS
 * `StaleThenFreshTokenProvider`.
 */
class StaleThenFreshTokenProvider(
    private val stale: String,
    private val fresh: String? = null,
    private val refreshThrows: Throwable? = null,
) : BearerTokenProvider {
    var currentTokenCallCount = 0
        private set
    var refreshedTokenCallCount = 0
        private set

    override suspend fun currentToken(): String {
        currentTokenCallCount++
        return stale
    }

    override suspend fun refreshedToken(): String {
        refreshedTokenCallCount++
        refreshThrows?.let { throw it }
        return fresh ?: error("no fresh token configured")
    }
}

/** A provider whose token resolution fails outright: no token, so no request reaches the wire. */
class NoSessionTokenProvider : BearerTokenProvider {
    class NoSession : Exception()

    override suspend fun currentToken(): String = throw NoSession()
}

/** Build a fake JWT with the given `iss` claim. The signature is bogus ("sig"): the issuer pin
 *  reads the claim only and never verifies the signature (that stays the servers' job,
 *  deploy/README.md), so a claim-only token is enough to exercise the pin. */
fun jwtWithIssuer(issuer: String, subject: String = "user-1"): String {
    val encoder = Base64.getUrlEncoder().withoutPadding()
    val header = encoder.encodeToString("""{"alg":"HS256","typ":"JWT"}""".toByteArray())
    val payload = encoder.encodeToString("""{"iss":"$issuer","sub":"$subject"}""".toByteArray())
    return "$header.$payload.sig"
}
