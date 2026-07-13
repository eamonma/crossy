// GET /me and PATCH /me over the §12 client (docs/design/name-onboarding §7): the Bearer header,
// the null display name (the one place null crosses the wire), the canonical adoption, and the
// typed mapping of the NAME_* 422 codes and the 429 RATE_LIMITED with its Retry-After. Twin of
// apps/ios MeRoutesTests.swift, over the shared MockWebServer plumbing (MockServerTest): each test
// enqueues a canned response, drives the suspend client under runBlocking, and reads back the
// recorded request.

package crossy.api

import crossy.protocol.APIErrorCode
import crossy.protocol.ProtocolJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MeRoutesTests : MockServerTest() {

    /** A `/me` JSON body in the §12 field list, the shape CrossyProtocol's me-response fixture pins. */
    private fun meJson(displayName: String?, needsName: Boolean, isAnonymous: Boolean = false): String {
        val name = displayName?.let { "\"$it\"" } ?: "null"
        return """{"userId":"u-1","displayName":$name,"isAnonymous":$isAnonymous,"avatarUrl":null,"needsName":$needsName}"""
    }

    @Test
    fun me_attachesBearerGetAndDecodesNullDisplayName() = runBlocking {
        server.enqueue(jsonResponse(200, meJson(displayName = null, needsName = true)))
        val me = client().me()

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/me", request.requestUrl?.encodedPath)
        assertEquals("Bearer test-token", request.getHeader("Authorization"))
        assertTrue(request.body.size == 0L, "a GET carries no body")

        assertNull(me.displayName, "GET /me returns the raw DB null for a nameless account")
        assertTrue(me.needsName, "the server-computed onboarding trigger crosses the wire")
        assertFalse(me.isAnonymous)
    }

    @Test
    fun updateDisplayName_sendsPatchWithTheNameAndAdoptsTheCanonicalValue() = runBlocking {
        // The server canonicalizes; the client sends the value verbatim and adopts what comes back.
        server.enqueue(jsonResponse(200, meJson(displayName = "Ada Lovelace", needsName = false)))
        val me = client().updateDisplayName("  Ada   Lovelace ")

        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        assertEquals("/me", request.requestUrl?.encodedPath)
        assertEquals("Bearer test-token", request.getHeader("Authorization"))
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(setOf("displayName"), body.keys, "the PATCH body carries only displayName")
        assertEquals("  Ada   Lovelace ", body["displayName"]?.jsonPrimitive?.content, "the name is sent verbatim")

        assertEquals("Ada Lovelace", me.displayName, "the client adopts the canonical value")
        assertFalse(me.needsName)
    }

    @Test
    fun updateDisplayName_mapsNameTooLongToATyped422() = runBlocking {
        // §12: a well-formed body whose name violates a rule is a named 422 the client keys on.
        server.enqueue(jsonResponse(422, """{"error":"NAME_TOO_LONG","message":"too long"}"""))

        val error = runCatching { client().updateDisplayName("a".repeat(41)) }.exceptionOrNull()
        assertTrue(error is CrossyApiError.Api, "expected Api, got $error")
        error as CrossyApiError.Api
        assertEquals(422, error.status)
        assertEquals(APIErrorCode.NAME_TOO_LONG, error.apiCode)
        assertEquals("NAME_TOO_LONG", error.apiCodeString)
    }

    @Test
    fun updateDisplayName_mapsNameInvalidAndNameRequired() = runBlocking {
        for (code in listOf("NAME_INVALID", "NAME_REQUIRED")) {
            server.enqueue(jsonResponse(422, """{"error":"$code","message":"bad"}"""))
            val error = runCatching { client().updateDisplayName("x") }.exceptionOrNull()
            assertEquals(code, (error as CrossyApiError).apiCodeString, "$code must surface typed")
        }
    }

    @Test
    fun updateDisplayName_mapsRateLimitedToTheDedicatedCaseAndParsesRetryAfter() = runBlocking {
        // A spent write window is a 429 carrying Retry-After in the header, not the envelope body, so
        // it lifts into the dedicated RateLimited case the onboarding submit honors before its next
        // auto-retry (R4). The delta-seconds header form is parsed; an absent header degrades to null.
        server.enqueue(
            MockResponse()
                .setResponseCode(429)
                .addHeader("Content-Type", "application/json")
                .addHeader("Retry-After", "30")
                .setBody("""{"error":"RATE_LIMITED","message":"slow down"}"""),
        )

        val error = runCatching { client().updateDisplayName("Ada") }.exceptionOrNull()
        assertTrue(error is CrossyApiError.RateLimited, "a spent window must surface as RateLimited, got $error")
        error as CrossyApiError.RateLimited
        assertEquals(30.0, error.retryAfterSeconds, "the delta-seconds Retry-After is parsed")
        assertEquals(APIErrorCode.RATE_LIMITED, error.apiCode)
        assertEquals("RATE_LIMITED", error.apiCodeString)
    }

    @Test
    fun updateDisplayName_rateLimitedWithoutAHeaderDegradesToNullDelay() = runBlocking {
        // No Retry-After header: the case still surfaces, and the delay degrades to null rather than
        // guessing a clock (the UI falls back to its own backoff).
        server.enqueue(jsonResponse(429, """{"error":"RATE_LIMITED","message":"slow down"}"""))

        val error = runCatching { client().updateDisplayName("Ada") }.exceptionOrNull()
        assertTrue(error is CrossyApiError.RateLimited, "expected RateLimited, got $error")
        assertNull((error as CrossyApiError.RateLimited).retryAfterSeconds, "an absent header degrades to null")
    }
}
