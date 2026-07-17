package crossy.protocol

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Contract snapshots for the REST companion (PROTOCOL.md §12): every request and response payload
// plus the error envelope, decode -> re-encode -> compare against the checked-in fixtures. Twin of
// apps/ios RESTSnapshotTests.swift; field lists follow the API's own contract, which §12 defers to.

class RestSnapshotTests {
    // --- Error envelope (§12) ---

    @Test
    fun errorEnvelopeRoundTripsAndExposesTheTypedCode() {
        val envelope = assertLosslessRoundTrip(APIErrorEnvelope.serializer(), FixtureGroup.REST, "error-envelope")
        assertEquals("VALIDATION", envelope.error)
        assertEquals(APIErrorCode.VALIDATION, envelope.code)
    }

    @Test
    fun aFutureErrorCodeDegradesToAnUntypedStringNotADecodeFailure() {
        // §12 names codeless rejections (barred, uniclue) that may gain codes later; a client must
        // keep the stable string and fail no decode when one lands.
        val body = """{"error":"BARRED","message":"barred grids are unsupported"}"""
        val envelope = ProtocolJson.decodeFromString(APIErrorEnvelope.serializer(), body)
        assertEquals("BARRED", envelope.error)
        assertNull(envelope.code)
    }

    @Test
    fun errorCodesCarryTheSection12HTTPStatuses() {
        // Both §12 tables (general vocabulary + named ingestion rejections), verbatim.
        val table = mapOf(
            "UNAUTHORIZED" to 401,
            "FULL_ACCOUNT_REQUIRED" to 403,
            "NOT_PARTICIPANT" to 403,
            "DENIED" to 403,
            "FORBIDDEN" to 403,
            "GAME_NOT_FOUND" to 404,
            "PUZZLE_NOT_FOUND" to 404,
            "VALIDATION" to 400,
            "INTERNAL" to 500,
            "UNSOLVABLE_CELL" to 422,
            "REBUS_TOO_LONG" to 422,
            "OVERSIZE_GRID" to 422,
            "AMBIGUOUS_SOLUTION" to 422,
            "DEGENERATE_GRID" to 422,
            "DIAGRAMLESS" to 422,
            // Display-name rejections (docs/design/name-onboarding §7.2): the three NAME_* codes are
            // 422 (a well-formed body whose value violates a rule), and a spent write window is 429.
            "NAME_REQUIRED" to 422,
            "NAME_TOO_LONG" to 422,
            "NAME_INVALID" to 422,
            // Personal-reaction-set rejections (§9, §12; D25): the three REACTION_SET_* codes are 422
            // (a well-formed body whose value violates a set rule the person can read and fix).
            "REACTION_SET_LENGTH" to 422,
            "REACTION_SET_INVALID" to 422,
            "REACTION_SET_DUPLICATE" to 422,
            "RATE_LIMITED" to 429,
        )
        assertEquals(table.keys, APIErrorCode.entries.map { it.name }.toSet())
        for (code in APIErrorCode.entries) {
            assertEquals(table[code.name], code.httpStatus, "${code.name} status must match PROTOCOL.md §12")
        }
    }

    // --- Puzzles (§12) ---

    @Test
    fun puzzleViewRoundTrips() {
        val view = assertLosslessRoundTrip(PuzzleView.serializer(), FixtureGroup.REST, "puzzle-view")
        assertEquals(1, view.puzzle.rows)
        assertEquals(2, view.puzzle.cols)
        assertEquals(listOf(1), view.puzzle.blocks)
        assertNull(view.puzzle.shadedCircles, "absent stays absent")
        assertEquals("Feline pet", view.puzzle.clues.across.first().text)
    }

    @Test
    fun puzzlesListRoundTripsWithNullAndNonNullMetadata() {
        val list = assertLosslessRoundTrip(PuzzlesListResponse.serializer(), FixtureGroup.REST, "puzzles-list")
        assertEquals(2, list.puzzles.size)
        assertEquals("Themeless Saturday", list.puzzles[0].title)
        assertEquals(
            PuzzleFeatures(rebus = true, circles = true, shadedCircles = false),
            list.puzzles[0].features,
        )
        // §12: absent, null, empty all read as null; the wire carries explicit nulls.
        assertNull(list.puzzles[1].title)
        assertNull(list.puzzles[1].author)
    }

    // --- Games (§12) ---

    @Test
    fun createGameRequestRoundTripsWithAName() {
        val request = assertLosslessRoundTrip(CreateGameRequest.serializer(), FixtureGroup.REST, "create-game-request")
        assertEquals("Sunday themeless with the crew", request.name)
    }

    @Test
    fun createGameRequestWithoutANameOmitsTheKey() {
        val request = assertLosslessRoundTrip(
            CreateGameRequest.serializer(), FixtureGroup.REST, "create-game-request-minimal",
        )
        assertNull(request.name)
        val reencoded = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(CreateGameRequest.serializer(), request),
        ).jsonObject
        assertFalse(reencoded.containsKey("name"), "an unnamed create sends no name key")
    }

    @Test
    fun createGameResponseKeepsTheExplicitNullName() {
        val response = assertLosslessRoundTrip(CreateGameResponse.serializer(), FixtureGroup.REST, "create-game-response")
        assertNull(response.name)
        assertEquals(Role.HOST, response.role)
        assertEquals("BQ7XKM2A", response.inviteCode)
    }

    @Test
    fun gamesListRoundTripsAndCarriesNoLifecycleStatus() {
        val list = assertLosslessRoundTrip(GamesListResponse.serializer(), FixtureGroup.REST, "games-list")
        assertEquals(2, list.games.size)
        assertEquals(Role.HOST, list.games[0].role)
        assertEquals("Themeless Saturday", list.games[0].puzzle.title)
        assertEquals(3, list.games[0].memberCount)
        assertNull(list.games[1].name)
        assertNull(list.games[1].puzzle.title)
        // §12: GET /games deliberately omits `status` (session-owned game_state); its future
        // arrival is an additive extension, not a shape this twin invents early.
        val reencoded = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(GamesListResponse.serializer(), list))
        assertFalse(allJsonKeys(reencoded).contains("status"))
    }

    @Test
    fun gamesListCarriesLastActivityAndTheServerCursor() {
        // §12 activity ordering: a played game carries its last-activity time, an unplayed one
        // carries null; the response carries the server-computed nextBefore (the page cursor).
        val list = assertLosslessRoundTrip(GamesListResponse.serializer(), FixtureGroup.REST, "games-list")
        assertEquals("2026-07-09T18:24:03.000Z", list.games[0].lastActivityAt)
        assertNull(list.games[1].lastActivityAt, "an unplayed game has null activity")
        assertTrue(list.hasCursor)
        assertEquals("2026-07-07T09:30:00.000Z", list.nextBefore)
    }

    @Test
    fun gamesListCarriesCompletionThroughCompletedAt_PROTOCOL12() {
        // §12: GET /games reports completion through `completedAt`, null while ongoing (and null
        // for an abandoned game). The fixture pins both branches wire-honestly.
        val list = assertLosslessRoundTrip(GamesListResponse.serializer(), FixtureGroup.REST, "games-list")
        assertEquals("2026-07-09T18:24:03.000Z", list.games[0].completedAt, "a solved game carries its ISO completion time")
        assertNull(list.games[1].completedAt, "an ongoing game has null completion")
    }

    @Test
    fun gamesListCarriesAbandonmentThroughAbandonedAt_PROTOCOL12() {
        // §12: GET /games reports a host-ended game through `abandonedAt`, the twin terminal
        // timestamp, mutually exclusive with `completedAt`. The shared fixture's two rows are
        // solved and ongoing, so both read null abandonment; a non-null branch (an ended game) is
        // pinned inline, decode -> re-encode -> decode, since the round-trip fixture never shows an
        // abandoned row alongside a solved one.
        val list = assertLosslessRoundTrip(GamesListResponse.serializer(), FixtureGroup.REST, "games-list")
        assertNull(list.games[0].abandonedAt, "a solved game was not abandoned")
        assertNull(list.games[1].abandonedAt, "an ongoing game was not abandoned")

        val ended = """{"games":[{"gameId":"g","name":null,"role":"host","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"members":[],"inviteCode":"ENDED009","completedAt":null,"abandonedAt":"2026-07-07T18:52:00.000Z","lastActivityAt":"2026-07-07T18:40:00.000Z","puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null,"mask":[]}}],"nextBefore":null}"""
        val decoded = ProtocolJson.decodeFromString(GamesListResponse.serializer(), ended)
        assertEquals("2026-07-07T18:52:00.000Z", decoded.games[0].abandonedAt, "a host-ended game carries its ISO abandonment time")
        assertNull(decoded.games[0].completedAt, "an abandoned game never completed (the two terminal timestamps are exclusive)")
        // Lossless: re-encoding then re-decoding preserves the abandoned row unchanged.
        val reencoded = ProtocolJson.encodeToString(GamesListResponse.serializer(), decoded)
        assertEquals(decoded, ProtocolJson.decodeFromString(GamesListResponse.serializer(), reencoded))
    }

    @Test
    fun gamesListDecodesAnOlderServerThatOmitsAbandonedAt_PROTOCOL14() {
        // §14 additive tolerance, mirroring completedAt: a server predating the abandonment read
        // omits `abandonedAt`; the twin decodes it as null (reads as not-ended, §12).
        val legacy = """{"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"completedAt":null,"lastActivityAt":null,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}],"nextBefore":null}"""
        val decoded = ProtocolJson.decodeFromString(GamesListResponse.serializer(), legacy)
        assertNull(decoded.games[0].abandonedAt, "an omitted abandonedAt reads as not-ended")
    }

    @Test
    fun gamesListDecodesAnOlderServerThatOmitsCompletedAt_PROTOCOL14() {
        // §14 additive tolerance, mirroring lastActivityAt: a server predating the completion read
        // omits `completedAt`; the twin decodes it as null (reads as ongoing, §12).
        val legacy = """{"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"lastActivityAt":null,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}],"nextBefore":null}"""
        val decoded = ProtocolJson.decodeFromString(GamesListResponse.serializer(), legacy)
        assertNull(decoded.games[0].completedAt, "an omitted completedAt reads as ongoing")
    }

    @Test
    fun gamesListCarriesTheRowMemberStackAndInviteCode_PROTOCOL12() {
        // §12: each row carries its full membership as display identity {userId, name, avatarUrl,
        // role}, join-ordered and consistent with memberCount, plus the game's inviteCode under the
        // view's member-only rule.
        val list = assertLosslessRoundTrip(GamesListResponse.serializer(), FixtureGroup.REST, "games-list")
        assertEquals(list.games[0].memberCount, list.games[0].members.size)
        assertEquals(
            GameSummary.Member(
                userId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
                name = "Ana",
                avatarUrl = "https://cdn.example/avatars/ana.png",
                role = Role.HOST,
            ),
            list.games[0].members[0],
            "the first joiner (the creator) leads the join-ordered stack",
        )
        assertNull(
            list.games[0].members[1].avatarUrl,
            "a mirror NULL arrives as an explicit null and reads as none (§4 fallback rule)",
        )
        // The solvers/spectators fact rides `role` alone: a guest seats spectator and there is NO
        // guest flag on the wire (§12).
        assertEquals(Role.SPECTATOR, list.games[0].members[2].role)
        assertEquals("BQ7XKM2A", list.games[0].inviteCode)
        assertEquals(list.games[1].memberCount, list.games[1].members.size)
        assertEquals("JW3PZQ9K", list.games[1].inviteCode)
        // One identity, one mirror value: the same member reads the same name and avatar on every
        // row (the §12 no-drift rule).
        assertEquals(list.games[0].members[0].name, list.games[1].members[0].name)
        assertEquals(list.games[0].members[0].avatarUrl, list.games[1].members[0].avatarUrl)
    }

    @Test
    fun gamesListDecodesAnOlderServerThatOmitsMembersAndInviteCode_PROTOCOL14() {
        // §14 additive tolerance: a server predating the member stack omits both fields; the twin
        // reads an empty stack and no code, failing no decode.
        val legacy = """{"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"completedAt":null,"lastActivityAt":null,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}],"nextBefore":null}"""
        val decoded = ProtocolJson.decodeFromString(GamesListResponse.serializer(), legacy)
        assertEquals(emptyList<GameSummary.Member>(), decoded.games[0].members, "an omitted stack reads as empty")
        assertNull(decoded.games[0].inviteCode, "an omitted code reads as none")
        assertEquals(2, decoded.games[0].memberCount, "memberCount stays true even while the stack is absent")
    }

    @Test
    fun gamesListPresentNullCursorMeansExhaustedNotAbsent() {
        // A present-null nextBefore (list exhausted) must be distinguishable from an absent key
        // (older server): the client stops on the former and falls back on the latter (§12, §14).
        val present = ProtocolJson.decodeFromString(GamesListResponse.serializer(), """{"games":[],"nextBefore":null}""")
        assertTrue(present.hasCursor, "the key is present, even as null")
        assertNull(present.nextBefore)

        val absent = ProtocolJson.decodeFromString(GamesListResponse.serializer(), """{"games":[]}""")
        assertFalse(absent.hasCursor, "an older server omits the key entirely")
        assertNull(absent.nextBefore)
    }

    @Test
    fun gamesListDecodesAnOlderServerThatOmitsActivityAndCursor() {
        // §14 additive: a server predating activity ordering sends neither lastActivityAt nor
        // nextBefore; the twin still decodes, reading unplayed activity and no server cursor.
        val legacy = """{"games":[{"gameId":"g","name":null,"role":"solver","createdAt":"2026-07-01T00:00:00.000Z","createdBy":"u","memberCount":2,"puzzle":{"puzzleId":"p","rows":15,"cols":15,"title":null}}]}"""
        val decoded = ProtocolJson.decodeFromString(GamesListResponse.serializer(), legacy)
        assertNull(decoded.games[0].lastActivityAt)
        assertFalse(decoded.hasCursor)
    }

    @Test
    fun joinRequestRoundTrips() {
        val request = assertLosslessRoundTrip(JoinGameRequest.serializer(), FixtureGroup.REST, "join-request")
        assertEquals("BQ7XKM2A", request.code)
    }

    @Test
    fun membershipResponseRoundTripsForBothJoinsAndTheRoleUpgrade() {
        // §12: POST /games/join, /{id}/join, and /{id}/role all answer {gameId, role, userId}.
        val response = assertLosslessRoundTrip(GameMembershipResponse.serializer(), FixtureGroup.REST, "membership-response")
        assertEquals(Role.SOLVER, response.role)
    }

    @Test
    fun roleChangeRequestRoundTrips() {
        val request = assertLosslessRoundTrip(RoleChangeRequest.serializer(), FixtureGroup.REST, "role-request")
        assertEquals(Role.SOLVER, request.role)
    }

    @Test
    fun kickResponseRoundTrips() {
        val response = assertLosslessRoundTrip(KickResponse.serializer(), FixtureGroup.REST, "kick-response")
        assertEquals("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", response.removed)
    }

    @Test
    fun abandonResponseRoundTrips() {
        val response = assertLosslessRoundTrip(AbandonResponse.serializer(), FixtureGroup.REST, "abandon-response")
        assertEquals(GameStatus.ABANDONED, response.status)
    }

    @Test
    fun deleteAccountResponseRoundTrips() {
        val response = assertLosslessRoundTrip(DeleteAccountResponse.serializer(), FixtureGroup.REST, "delete-account-response")
        assertTrue(response.tombstoned)
        assertEquals(1, response.successions)
        assertEquals(listOf("c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f"), response.abandoned)
    }

    // --- Self display identity (§12: GET /me, PATCH /me) ---

    @Test
    fun meResponseRoundTripsAndKeepsTheExplicitNullName() {
        // §12: `displayName` is the one place a null name crosses the wire on purpose (a nameless
        // account), and `avatarUrl` is null when the server has none. Both are nullable-and-present:
        // the server writes the key with an explicit null, and the twin re-encodes that explicit
        // null (not an absent key), so the round trip is lossless and needsName crosses verbatim.
        val me = assertLosslessRoundTrip(MeResponse.serializer(), FixtureGroup.REST, "me-response")
        assertNull(me.displayName, "a nameless account carries an explicit null name")
        assertNull(me.avatarUrl)
        assertFalse(me.isAnonymous)
        assertTrue(me.needsName, "the server-computed onboarding trigger crosses the wire")
        val reencoded = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(MeResponse.serializer(), me)).jsonObject
        assertEquals(JsonNull, reencoded["displayName"], "displayName re-encodes as an explicit null, not an absent key")
        assertEquals(JsonNull, reencoded["avatarUrl"], "avatarUrl re-encodes as an explicit null")
    }

    @Test
    fun meResponseDecodesAChosenName() {
        // The named branch: a permanent account that has chosen a name. displayName is the raw value,
        // needsName is false, and casing is preserved (INV-1 does not apply to names).
        val named = """{"userId":"u-2","displayName":"Ada Lovelace","isAnonymous":false,"avatarUrl":"https://cdn.example/a.png","needsName":false}"""
        val me = ProtocolJson.decodeFromString(MeResponse.serializer(), named)
        assertEquals("Ada Lovelace", me.displayName)
        assertFalse(me.needsName)
        assertEquals("https://cdn.example/a.png", me.avatarUrl)
        // Lossless: re-encode then re-decode preserves the chosen name.
        val reencoded = ProtocolJson.encodeToString(MeResponse.serializer(), me)
        assertEquals(me, ProtocolJson.decodeFromString(MeResponse.serializer(), reencoded))
    }

    @Test
    fun updateDisplayNameRequestSendsOnlyTheNameField() {
        val request = UpdateDisplayNameRequest("  Ada   Lovelace ")
        val obj = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(UpdateDisplayNameRequest.serializer(), request)).jsonObject
        assertEquals(setOf("displayName"), obj.keys, "the PATCH body carries only displayName")
        // Sent verbatim: the server owns canonicalization, so the client never folds or trims.
        assertEquals("  Ada   Lovelace ", obj["displayName"]?.jsonPrimitive?.content)
    }

    @Test
    fun gameViewRoundTripsWithMembersSessionAndInviteCode() {
        val view = assertLosslessRoundTrip(GameView.serializer(), FixtureGroup.REST, "game-view")
        assertEquals("Sunday themeless with the crew", view.name)
        assertEquals("BQ7XKM2A", view.inviteCode)
        assertEquals(2, view.members.size)
        assertEquals(Role.SPECTATOR, view.members[1].role)
        assertEquals(listOf(2), view.puzzle.shadedCircles, "present shadedCircles survive")
        assertTrue(view.session.ws.startsWith("wss://"), "§2 endpoint shape")
    }

    // --- Analysis (§12: GET /games/{id}/analysis) ---

    @Test
    fun analysisViewRoundTripsWithOwnersMomentumAndMoments() {
        val view = assertLosslessRoundTrip(AnalysisView.serializer(), FixtureGroup.REST, "analysis-view")
        // The owner map arrives as string cell-index keys; ownersByCell parses them back.
        assertEquals(
            mapOf(0 to "host", 1 to "host", 2 to "mate", 3 to "host"),
            view.ownersByCell,
            "string cell-index keys parse back to the integer-keyed owner map",
        )
        // The momentum ribbon is always 40 buckets, each peak-normalized into [0, 1].
        assertEquals(60.0, view.momentum.durationSeconds)
        assertEquals(40, view.momentum.samples.size, "the ribbon is a fixed 40-bucket curve")
        assertTrue(view.momentum.samples.all { it in 0.0..1.0 }, "each sample is peak-normalized into [0, 1]")
        // The three named beats.
        assertEquals(AnalysisView.Beat(cell = 0, userId = "host", atSeconds = 0.0), view.moments.firstToFall)
        assertEquals(AnalysisView.Beat(cell = 3, userId = "mate", atSeconds = 115.0), view.moments.lastSquare)
        assertEquals(
            AnalysisView.TurningPoint(stallSeconds = 100.0, breakSeconds = 110.0, burst = 2),
            view.moments.turningPoint,
        )
        // The solver superlatives (§12; design/post-game/TITLES.md), in ladder-rank order: keys and
        // counts only, evidence a number or an explicit null.
        assertEquals(
            listOf(
                AnalysisView.Title(userId = "mate", title = "one-hit-wonder", evidence = null),
                AnalysisView.Title(userId = "host", title = "quick-starter", evidence = 1),
            ),
            view.titles,
        )
        // The sittings partition (§12, D29): count, contiguous spans on the ACTIVE axis (first start
        // 0, last end == momentum.durationSeconds, so a seam tick places by lookup), and the
        // wall-clock span kept for flavor only.
        val sittings = view.sittings!!
        assertEquals(2, sittings.count)
        assertEquals(
            listOf(
                AnalysisView.Sittings.Span(startSeconds = 0.0, endSeconds = 45.0),
                AnalysisView.Sittings.Span(startSeconds = 45.0, endSeconds = 60.0),
            ),
            sittings.spans,
        )
        assertEquals(0.0, sittings.spans.first().startSeconds, "§12: the first span starts at 0")
        assertEquals(
            view.momentum.durationSeconds, sittings.spans.last().endSeconds,
            "§12: the last span ends at momentum.durationSeconds, the shared active axis",
        )
        assertEquals(1860.0, sittings.wallSeconds)
        // A no-evidence rung's null is present, not absent: re-encoding emits the key with an
        // explicit null (the Moments posture), which the lossless round trip above already held
        // against the fixture's own bytes.
        val reencoded = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(AnalysisView.serializer(), view)).jsonObject
        val encodedTitles = reencoded.getValue("titles").let { it as kotlinx.serialization.json.JsonArray }
        assertEquals(
            JsonNull, encodedTitles[0].jsonObject["evidence"],
            "a null evidence re-encodes as an explicit null, not an absent key",
        )
    }

    @Test
    fun analysisViewToleratesAbsentSittingsFromAnOlderBundle_D29() {
        // §12, D29: a client MUST tolerate the `sittings` field's absence (an older cached bundle)
        // and degrade to today's rendering. Inline JSON, not a fixture: the fixtures pin the CURRENT
        // contract, which always writes the key.
        val older = """
            {
              "owners": { "0": "host" },
              "momentum": { "durationSeconds": 8, "samples": [] },
              "moments": { "firstToFall": null, "lastSquare": null, "turningPoint": null }
            }
        """.trimIndent()
        val view = ProtocolJson.decodeFromString(AnalysisView.serializer(), older)
        assertNull(view.sittings, "an absent sittings field reads as none, not a crash")
    }

    @Test
    fun analysisViewToleratesAbsentTitlesFromAnOlderAPI_PROTOCOL14() {
        // §14 additive evolution: `titles` is an additive field, so an older API omits it entirely.
        // The twin reads that as no titles at all (null, mapped to empty by the render layer), never
        // a decode failure.
        val older = """
            {
              "owners": { "0": "host" },
              "momentum": { "durationSeconds": 8, "samples": [] },
              "moments": { "firstToFall": null, "lastSquare": null, "turningPoint": null }
            }
        """.trimIndent()
        val view = ProtocolJson.decodeFromString(AnalysisView.serializer(), older)
        assertNull(view.titles, "an absent titles field reads as none, not a crash")
    }

    @Test
    fun analysisViewCarriesAnUnknownTitleKeyVerbatim_forwardCompatibility() {
        // §12: a client MUST ignore an unknown title key (how the ladder grows without client
        // lockstep). Ignoring is the render layer's job; the twin's job is to decode the award
        // without failing and carry the key verbatim.
        val newer = """
            {
              "owners": { "0": "host" },
              "momentum": { "durationSeconds": 8, "samples": [] },
              "moments": { "firstToFall": null, "lastSquare": null, "turningPoint": null },
              "titles": [
                { "userId": "host", "title": "marathoner", "evidence": 5 },
                { "userId": "mate", "title": "workhorse", "evidence": 12 }
              ]
            }
        """.trimIndent()
        val view = ProtocolJson.decodeFromString(AnalysisView.serializer(), newer)
        assertEquals(
            listOf(
                AnalysisView.Title(userId = "host", title = "marathoner", evidence = 5),
                AnalysisView.Title(userId = "mate", title = "workhorse", evidence = 12),
            ),
            view.titles,
            "an unknown key decodes and rides; the display table decides what it knows",
        )
    }

    @Test
    fun analysisViewKeepsExplicitNullMomentsAcrossTheRoundTrip() {
        // A solve too short to have a beat carries an explicit JSON null for each moment; the twin
        // decodes those to null AND re-encodes the explicit null (not an absent key), so the round
        // trip is lossless.
        val view = assertLosslessRoundTrip(AnalysisView.serializer(), FixtureGroup.REST, "analysis-view-null-moments")
        assertNull(view.moments.firstToFall)
        assertNull(view.moments.lastSquare)
        assertNull(view.moments.turningPoint)
        // This fixture predates titles and sittings and omits both keys; the null defaults read that
        // as none AND re-encode them absent, so the lossless round trip above doubles as the older-API
        // tolerance pin (§14 additive evolution; D29's absence rule for sittings).
        assertNull(view.titles)
        assertNull(view.sittings)
        val moments = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(AnalysisView.serializer(), view))
            .jsonObject.getValue("moments").jsonObject
        for (key in listOf("firstToFall", "lastSquare", "turningPoint")) {
            assertEquals(JsonNull, moments[key], "$key re-encodes as an explicit null, not an absent key")
        }
    }

    @Test
    fun analysisViewCanCarryNoLetter_INV6() {
        // INV-6: the analysis bundle holds userIds, cells, and numbers only, and has nowhere to put
        // a solution value. The solved answer of this 4-cell fixture would have been "CATS"; no
        // letter of it, and no whole word, may appear anywhere in the encoded bundle.
        val view = assertLosslessRoundTrip(AnalysisView.serializer(), FixtureGroup.REST, "analysis-view")
        val json = ProtocolJson.encodeToString(AnalysisView.serializer(), view)
        assertFalse(json.contains("solution"), "no solution field can exist on the type")
        for (letter in listOf("\"C\"", "\"A\"", "\"T\"", "\"S\"", "CATS")) {
            assertFalse(json.contains(letter), "the encoded analysis bundle carries no solution letter (INV-6)")
        }
    }
}
