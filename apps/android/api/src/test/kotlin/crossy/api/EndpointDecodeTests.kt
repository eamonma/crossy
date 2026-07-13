// Per-endpoint round trips for the §12 surface: the request the client puts on the wire (method,
// path, headers, body) asserted against MockWebServer, and the typed decode of the canned response.
// Twin of apps/ios EndpointTests.swift. INV-6 is defended where a view carries a puzzle: the
// decoded value is re-encoded and asserted to carry no `solution` key (the type has nowhere to
// hold one).

package crossy.api

import crossy.protocol.CreateGameRequest
import crossy.protocol.GameStatus
import crossy.protocol.ProtocolJson
import crossy.protocol.Role
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private const val GAME_ID = "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f"
private const val MEMBER_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"
private const val PUZZLE_ID = "3f8c2b1a-9e4d-4f6a-b7c8-2d1e0f9a8b7c"

class EndpointDecodeTests : MockServerTest() {

    @Test
    fun listGames_sendsABearerGetAndDecodesTheFixture() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.GAMES_LIST))
        val page = client().listGames()

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/games", request.requestUrl?.encodedPath)
        assertEquals("Bearer test-token", request.getHeader("Authorization"))
        assertTrue(request.body.size == 0L, "a GET carries no body")

        assertEquals(2, page.rows.size)
        assertEquals(Role.HOST, page.rows[0].role)
        assertEquals(3, page.rows[0].memberCount)
        assertEquals("Themeless Saturday", page.rows[0].puzzle.title)
        assertNull(page.rows[1].name)
        assertEquals(3, page.rows[0].members.size)
        assertEquals("Ana", page.rows[0].members[0].name)
        assertEquals("BQ7XKM2A", page.rows[0].inviteCode)
    }

    @Test
    fun listPuzzles_sendsABearerGetAndDecodesINV6SafeGeometry() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.PUZZLES_LIST))
        val page = client().listPuzzles()

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/puzzles", request.requestUrl?.encodedPath)
        assertEquals("Bearer test-token", request.getHeader("Authorization"))

        assertEquals(2, page.rows.size)
        assertEquals(15, page.rows[0].rows)
        assertEquals(15, page.rows[0].cols)
        assertTrue(page.rows[0].features.rebus)
        assertNull(page.rows[1].title)
        assertNull(page.rows[1].author)
    }

    @Test
    fun getGame_carriesTheIdInThePathAndDecodesASolutionFreeViewPerINV6() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.GAME_VIEW))
        val view = client().game(GAME_ID)

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/games/$GAME_ID", request.requestUrl?.encodedPath)
        assertEquals("Bearer test-token", request.getHeader("Authorization"))

        assertEquals(GAME_ID, view.gameId)
        assertEquals("BQ7XKM2A", view.inviteCode)
        assertEquals(2, view.members.size)
        assertTrue(view.session.ws.startsWith("wss://"))
        // INV-6: the view's puzzle is ClientPuzzle, solution-free by type; nothing re-encoded can
        // carry one.
        val reencoded = ProtocolJson.encodeToString(crossy.protocol.GameView.serializer(), view)
        assertFalse(reencoded.contains("solution"))
    }

    @Test
    fun getGameAnalysis_carriesTheIdInThePathAndDecodesTheINV6SafeBundle() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.ANALYSIS_VIEW))
        val view = client().gameAnalysis(GAME_ID)

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/games/$GAME_ID/analysis", request.requestUrl?.encodedPath)

        assertEquals(mapOf(0 to "host", 1 to "host", 2 to "mate", 3 to "host"), view.ownersByCell)
        assertEquals(40, view.momentum.samples.size)
        assertEquals("host", view.moments.firstToFall?.userId)
        val reencoded = ProtocolJson.encodeToString(AnalysisViewSerializer, view)
        assertFalse(reencoded.contains("solution"))
    }

    @Test
    fun createPuzzle_uploadsTheDocumentVerbatimAndDecodesThePuzzleView() = runBlocking {
        server.enqueue(jsonResponse(201, Fixtures.PUZZLE_VIEW))
        // The XWord Info document is a third-party payload uploaded verbatim (§12).
        val document = """{"title":"Feline pets","size":{"rows":1,"cols":2}}""".toByteArray()
        val view = client().createPuzzle(document)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/puzzles", request.requestUrl?.encodedPath)
        assertEquals("application/json", request.getHeader("Content-Type")?.substringBefore(";"))
        assertEquals(document.decodeToString(), request.body.readUtf8(), "the document is sent byte for byte")

        assertEquals(PUZZLE_ID, view.puzzleId)
        assertEquals(1, view.puzzle.rows)
        assertEquals(2, view.puzzle.cols)
    }

    @Test
    fun createGame_encodesTheTypedRequestAndDecodesTheResponse() = runBlocking {
        server.enqueue(jsonResponse(201, Fixtures.CREATE_GAME_RESPONSE))
        val response = client().createGame(CreateGameRequest(PUZZLE_ID, "Sunday themeless with the crew"))

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/games", request.requestUrl?.encodedPath)
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(setOf("puzzleId", "name"), body.keys)

        assertEquals(GAME_ID, response.gameId)
        assertEquals(Role.HOST, response.role)
        assertEquals("BQ7XKM2A", response.inviteCode)
        assertNull(response.name)
    }

    @Test
    fun createGame_withoutANameSendsNoNameKey() = runBlocking {
        server.enqueue(jsonResponse(201, Fixtures.CREATE_GAME_RESPONSE))
        client().createGame(CreateGameRequest(PUZZLE_ID))

        val request = server.takeRequest()
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(setOf("puzzleId"), body.keys, "an unnamed create sends no name key")
    }

    @Test
    fun joinByCodeAlone_postsToGamesJoinAndDecodesTheMembership() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.MEMBERSHIP_RESPONSE))
        val membership = client().joinGame(code = "BQ7XKM2A")

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/games/join", request.requestUrl?.encodedPath)
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("BQ7XKM2A", body["code"]?.let { it.toString().trim('"') })

        assertEquals(GAME_ID, membership.gameId)
        assertEquals(Role.SOLVER, membership.role)
    }

    @Test
    fun joinCode_isSentVerbatim_normalizationIsTheServersPerINV1() = runBlocking {
        // INV-1 lives server-side for invite codes; the client sends what was typed, never folds.
        server.enqueue(jsonResponse(200, Fixtures.MEMBERSHIP_RESPONSE))
        client().joinGame(code = " bq7xkm2a ")

        val request = server.takeRequest()
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(" bq7xkm2a ", body["code"].toString().trim('"'))
    }

    @Test
    fun joinKnownGame_postsToTheIdJoinPath() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.MEMBERSHIP_RESPONSE))
        val membership = client().joinGame(gameId = GAME_ID, code = "BQ7XKM2A")

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/games/$GAME_ID/join", request.requestUrl?.encodedPath)
        assertEquals(Role.SOLVER, membership.role)
    }

    @Test
    fun changeRole_postsTheTypedRoleRequest() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.MEMBERSHIP_RESPONSE))
        val membership = client().changeRole(gameId = GAME_ID, to = Role.SOLVER)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/games/$GAME_ID/role", request.requestUrl?.encodedPath)
        val body = ProtocolJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("solver", body["role"].toString().trim('"'))
        assertEquals(Role.SOLVER, membership.role)
    }

    @Test
    fun kick_deletesTheMemberPathAndDecodesTheRemoval() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.KICK_RESPONSE))
        val response = client().kickMember(gameId = GAME_ID, userId = MEMBER_ID)

        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/games/$GAME_ID/members/$MEMBER_ID", request.requestUrl?.encodedPath)
        assertEquals("Bearer test-token", request.getHeader("Authorization"))

        assertEquals(GAME_ID, response.gameId)
        assertEquals(MEMBER_ID, response.removed)
    }

    @Test
    fun abandon_postsWithNoBodyAndDecodesTheTerminalStatus() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.ABANDON_RESPONSE))
        val response = client().abandonGame(gameId = GAME_ID)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/games/$GAME_ID/abandon", request.requestUrl?.encodedPath)
        assertTrue(request.body.size == 0L, "the route reads no body, so none is sent")
        assertNull(request.getHeader("Content-Type"), "no body, no content type")

        assertEquals(GameStatus.ABANDONED, response.status)
    }

    @Test
    fun deleteAccount_deletesTheAccountPathAndDecodesTheTombstone() = runBlocking {
        server.enqueue(jsonResponse(200, Fixtures.DELETE_ACCOUNT_RESPONSE))
        val response = client().deleteAccount()

        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/account", request.requestUrl?.encodedPath)
        assertEquals("Bearer test-token", request.getHeader("Authorization"))

        assertTrue(response.tombstoned)
        assertEquals(1, response.successions)
        assertEquals(listOf("c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f"), response.abandoned)
        assertTrue(response.vendorDeleted)
    }
}

private val AnalysisViewSerializer = crossy.protocol.AnalysisView.serializer()
