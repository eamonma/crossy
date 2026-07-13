// Cursor pagination for the two list endpoints (PROTOCOL.md §12): `limit` clamped server-side to
// [1, 100], `before` an ISO 8601 `createdAt` the page filters strictly before, and the client pages
// by the server-computed `nextBefore` (falling back to the last row's `createdAt` for an older
// server that omits it). The wire carries no has-more flag, so iteration honestly ends on the first
// empty page. Twin of apps/ios PaginationTests.swift.

package crossy.api

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PaginationTests : MockServerTest() {

    @Test
    fun listGames_followsTheCursorAcrossTwoPagesAndEndsOnTheEmptyOne() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                when (request.requestUrl?.queryParameter("before")) {
                    null -> jsonResponse(200, Fixtures.GAMES_LIST)
                    "2026-07-07T09:30:00.000Z" -> jsonResponse(200, Fixtures.GAMES_LIST_OLDER)
                    "2026-07-06T08:00:00.000Z" -> jsonResponse(200, Fixtures.GAMES_LIST_EMPTY)
                    else -> MockResponse().setResponseCode(400)
                }
        }
        val client = client()

        val page1 = client.listGames(limit = 2)
        assertEquals(2, page1.rows.size)
        assertEquals(
            "2026-07-07T09:30:00.000Z",
            page1.nextBefore,
            "the cursor is the server-computed nextBefore (the page-minimum createdAt)",
        )

        // The older page predates activity ordering (no nextBefore key), so the client falls back to
        // the last row's createdAt: the two paths meet at the same cursor value here.
        val page2 = client.listGames(limit = 2, before = page1.nextBefore)
        assertEquals(1, page2.rows.size)
        assertEquals("2026-07-06T08:00:00.000Z", page2.rows[0].createdAt)
        assertEquals("2026-07-06T08:00:00.000Z", page2.nextBefore)

        val page3 = client.listGames(limit = 2, before = page2.nextBefore)
        assertTrue(page3.rows.isEmpty())
        assertNull(page3.nextBefore, "an empty page ends iteration")

        assertEquals(3, server.requestCount)
        val first = server.takeRequest()
        assertEquals("/games", first.requestUrl?.encodedPath, "the cursor rides the query, not the path")
        assertEquals("2", first.requestUrl?.queryParameter("limit"))
        assertNull(first.requestUrl?.queryParameter("before"), "the first page sends no cursor")
        assertEquals("2026-07-07T09:30:00.000Z", server.takeRequest().requestUrl?.queryParameter("before"))
        assertEquals("2026-07-06T08:00:00.000Z", server.takeRequest().requestUrl?.queryParameter("before"))
    }

    @Test
    fun listGames_aPresentNullCursorMeansExhaustedNotFallback() = runBlocking {
        // Key present and null: the list is exhausted, and the client must NOT re-derive a cursor
        // from the reordered rows (§12: page by nextBefore, never by the visual last row).
        val exhausted = Fixtures.GAMES_LIST.replace(
            "\"nextBefore\": \"2026-07-07T09:30:00.000Z\"",
            "\"nextBefore\": null",
        )
        server.enqueue(jsonResponse(200, exhausted))

        val page = client().listGames()
        assertEquals(2, page.rows.size)
        assertNull(page.nextBefore, "a present-null cursor ends iteration on a full page")
    }

    @Test
    fun listPuzzles_passesTheCursorThroughAndEndsOnTheEmptyPage() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.requestUrl?.queryParameter("before") == null) {
                    jsonResponse(200, Fixtures.PUZZLES_LIST)
                } else {
                    jsonResponse(200, Fixtures.PUZZLES_LIST_EMPTY)
                }
        }
        val client = client()

        val page1 = client.listPuzzles()
        assertEquals(2, page1.rows.size)
        assertEquals("2026-07-07T09:30:00.000Z", page1.nextBefore)

        val page2 = client.listPuzzles(before = page1.nextBefore)
        assertTrue(page2.rows.isEmpty())
        assertNull(page2.nextBefore)

        assertEquals(2, server.requestCount)
        val first = server.takeRequest()
        assertNull(first.requestUrl?.queryParameter("before"))
        assertNull(first.requestUrl?.queryParameter("limit"), "an unset limit is omitted, not defaulted")
        assertEquals("2026-07-07T09:30:00.000Z", server.takeRequest().requestUrl?.queryParameter("before"))
    }
}
