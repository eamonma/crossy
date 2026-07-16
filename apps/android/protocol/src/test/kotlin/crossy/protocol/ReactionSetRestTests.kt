package crossy.protocol

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// The reaction set on the /me pair (PROTOCOL.md §12; D25), twin of apps/ios ReactionSetRESTTests.swift:
// `GET /me` carries `reactionSet` as five graphemes or an explicit null (the defaults), `PATCH /me`
// takes the same field where null is the RESET command (so the request encodes the key always, never
// omits it), and the three named 422s ride the §12 error envelope. Inline frames, the
// ReactionShapeTests idiom: no fixture, the wire shapes are small.
class ReactionSetRestTests {
    // --- GET /me: reactionSet (§12) ---

    @Test
    fun meDecodesANullReactionSetAsNull_theDefaults_PROTOCOL12() {
        val body =
            """{"userId":"u1","displayName":"Ada","isAnonymous":false,"avatarUrl":null,""" +
                """"needsName":false,"reactionSet":null}"""
        val me = ProtocolJson.decodeFromString(MeResponse.serializer(), body)
        assertNull(me.reactionSet, "null means the default five (§9)")
    }

    @Test
    fun meDecodesAChosenReactionSetInSlotOrder_PROTOCOL12() {
        val body =
            """{"userId":"u1","displayName":"Ada","isAnonymous":false,"avatarUrl":null,""" +
                """"needsName":false,"reactionSet":["🦆","👍🏽","❤️‍🔥","🇨🇦","🫶"]}"""
        val me = ProtocolJson.decodeFromString(MeResponse.serializer(), body)
        assertEquals(listOf("🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶"), me.reactionSet)
    }

    @Test
    fun meToleratesAnAbsentReactionSetKey_additive_PROTOCOL14() {
        // An older server that predates the field: absent reads as null, the same defaults a null
        // means, so the client renders correctly against both.
        val body =
            """{"userId":"u1","displayName":"Ada","isAnonymous":false,"avatarUrl":null,""" +
                """"needsName":false}"""
        val me = ProtocolJson.decodeFromString(MeResponse.serializer(), body)
        assertNull(me.reactionSet)
    }

    @Test
    fun meReEncodesReactionSetAsAnExplicitNull_currentServerPosture_PROTOCOL12() {
        // A current server always writes the key; the twin re-encodes the explicit null (not an
        // absent key), the nullable-and-present posture (@EncodeDefault ALWAYS), so needsName-era
        // fixtures round-trip wire-honestly.
        val me = MeResponse("u1", "Ada", isAnonymous = false, avatarUrl = null, needsName = false)
        val obj = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(MeResponse.serializer(), me),
        ).jsonObject
        assertTrue(obj.containsKey("reactionSet"), "the key is always written")
        assertEquals(JsonNull, obj["reactionSet"], "explicit null, the defaults")
    }

    // --- PATCH /me: the request writes the key always (§12) ---

    @Test
    fun updateRequestEncodesTheFiveInSlotOrder_PROTOCOL12() {
        val obj = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(
                UpdateReactionSetRequest.serializer(),
                UpdateReactionSetRequest(listOf("🔥", "🤔", "🐐", "💀", "😭")),
            ),
        ).jsonObject
        assertEquals(
            listOf("🔥", "🤔", "🐐", "💀", "😭"),
            obj["reactionSet"]!!.jsonArray.map { it.jsonPrimitive.content },
        )
    }

    @Test
    fun updateRequestEncodesNullAsExplicitNull_theReset_PROTOCOL12() {
        // null is the reset command, never an omission: an omitted key would read as "nothing to
        // update" (400 VALIDATION on an otherwise empty patch). This is the absent-vs-null proof.
        val obj = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(
                UpdateReactionSetRequest.serializer(),
                UpdateReactionSetRequest(null),
            ),
        ).jsonObject
        assertTrue(obj.containsKey("reactionSet"), "the key is always written")
        assertEquals(JsonNull, obj["reactionSet"], "explicit null, the reset")
    }

    @Test
    fun updateRequestRoundTripsBothShapes_PROTOCOL12() {
        for (request in listOf(
            UpdateReactionSetRequest(null),
            UpdateReactionSetRequest(listOf("🔥", "🤔", "🐐", "💀", "😭")),
        )) {
            val decoded = ProtocolJson.decodeFromString(
                UpdateReactionSetRequest.serializer(),
                ProtocolJson.encodeToString(UpdateReactionSetRequest.serializer(), request),
            )
            assertEquals(request, decoded)
        }
    }

    @Test
    fun displayNameRequestNeverCarriesReactionSet_independentlySendable_PROTOCOL12() {
        // The two writers are separate single-field bodies: a name write omits reactionSet entirely
        // (the server leaves it untouched), so PROTOCOL.md §12's {displayName?, reactionSet?} shape
        // is realized one field per request.
        val obj = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(UpdateDisplayNameRequest.serializer(), UpdateDisplayNameRequest("Ada")),
        ).jsonObject
        assertEquals(setOf("displayName"), obj.keys, "a name write leaves reactionSet untouched")
    }

    // --- The named 422s ride the §12 vocabulary ---

    @Test
    fun reactionSetCodesAreInTheTypedVocabularyAt422_PROTOCOL12() {
        for ((code, wire) in listOf(
            APIErrorCode.REACTION_SET_LENGTH to "REACTION_SET_LENGTH",
            APIErrorCode.REACTION_SET_INVALID to "REACTION_SET_INVALID",
            APIErrorCode.REACTION_SET_DUPLICATE to "REACTION_SET_DUPLICATE",
        )) {
            assertEquals(wire, code.name)
            assertEquals(422, code.httpStatus)
            val envelope = ProtocolJson.decodeFromString(
                APIErrorEnvelope.serializer(),
                """{"error":"$wire","message":"x"}""",
            )
            assertEquals(code, envelope.code, "the envelope's typed view resolves it")
        }
    }
}
