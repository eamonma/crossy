package crossy.protocol

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

// The one opaque avatar field (PROTOCOL.md §4), decoded on every participant-carrying payload: the
// welcome/sync participant, the playerConnected notice (§6), and the GET /games/{id} member row
// (§12). Twin of apps/ios AvatarUrlDecodeTests.swift. The contract:
//   present    a string decodes verbatim (opaque, never parsed)
//   null       reads as null (first-class: the initial renders)
//   absent     reads as null too (absent-tolerant, so a pre-avatar server still decodes)
//   non-string a present non-string is malformed (SerializationException), never silently null
// The absent case is the load-bearing one: today's servers send no key, and the client must still
// decode them.

class AvatarUrlDecodeTests {
    private fun participant(avatar: String): String =
        """{"userId":"u1","displayName":"Ana"$avatar,"color":"#7F77DD","role":"host","connected":true}"""

    private fun playerConnected(avatar: String): String =
        """{"type":"playerConnected","userId":"u2","displayName":"Bo"$avatar,"color":"#33AA88","role":"solver"}"""

    private fun member(avatar: String): String =
        """{"userId":"u1","role":"host","joinedAt":"2026-07-08T12:00:00.000Z"$avatar}"""

    // --- Present (§4: an opaque string decodes verbatim) ---

    @Test
    fun participantAvatarUrlPresentDecodesOpaqueString_PROTOCOL4() {
        val value = ProtocolJson.decodeFromString(Participant.serializer(), participant(""","avatarUrl":"https://cdn.example/a.png""""))
        assertEquals("https://cdn.example/a.png", value.avatarUrl)
    }

    @Test
    fun playerConnectedAvatarUrlPresentDecodesOpaqueString_PROTOCOL6() {
        val value = ProtocolJson.decodeFromString(PlayerConnectedMessage.serializer(), playerConnected(""","avatarUrl":"https://cdn.example/b.png""""))
        assertEquals("https://cdn.example/b.png", value.avatarUrl)
    }

    @Test
    fun memberAvatarUrlPresentDecodesOpaqueString_PROTOCOL12() {
        val value = ProtocolJson.decodeFromString(GameView.Member.serializer(), member(""","avatarUrl":"https://cdn.example/c.png""""))
        assertEquals("https://cdn.example/c.png", value.avatarUrl)
    }

    // --- Null (§4: null is first-class, reads as null) ---

    @Test
    fun participantAvatarUrlNullReadsAsNull_PROTOCOL4() {
        val value = ProtocolJson.decodeFromString(Participant.serializer(), participant(""","avatarUrl":null"""))
        assertNull(value.avatarUrl)
    }

    @Test
    fun playerConnectedAvatarUrlNullReadsAsNull_PROTOCOL6() {
        val value = ProtocolJson.decodeFromString(PlayerConnectedMessage.serializer(), playerConnected(""","avatarUrl":null"""))
        assertNull(value.avatarUrl)
    }

    @Test
    fun memberAvatarUrlNullReadsAsNull_PROTOCOL12() {
        val value = ProtocolJson.decodeFromString(GameView.Member.serializer(), member(""","avatarUrl":null"""))
        assertNull(value.avatarUrl)
    }

    // --- Absent (§4: absent-tolerant, so a pre-avatar server still decodes) ---

    @Test
    fun participantAvatarUrlAbsentReadsAsNull_PROTOCOL4() {
        val value = ProtocolJson.decodeFromString(Participant.serializer(), participant(""))
        assertNull(value.avatarUrl, "a pre-avatar participant must still decode")
    }

    @Test
    fun playerConnectedAvatarUrlAbsentReadsAsNull_PROTOCOL6() {
        val value = ProtocolJson.decodeFromString(PlayerConnectedMessage.serializer(), playerConnected(""))
        assertNull(value.avatarUrl, "a pre-avatar playerConnected must still decode")
    }

    @Test
    fun memberAvatarUrlAbsentReadsAsNull_PROTOCOL12() {
        val value = ProtocolJson.decodeFromString(GameView.Member.serializer(), member(""))
        assertNull(value.avatarUrl, "a pre-avatar member row must still decode")
    }

    // --- Non-string (§4: a present non-string is malformed, never silent null) ---

    @Test
    fun participantAvatarUrlNonStringIsMalformed_PROTOCOL4() {
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(Participant.serializer(), participant(""","avatarUrl":42"""))
        }
    }

    @Test
    fun playerConnectedAvatarUrlNonStringIsMalformed_PROTOCOL6() {
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(PlayerConnectedMessage.serializer(), playerConnected(""","avatarUrl":true"""))
        }
    }

    @Test
    fun memberAvatarUrlNonStringIsMalformed_PROTOCOL12() {
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(GameView.Member.serializer(), member(""","avatarUrl":["x"]"""))
        }
    }

    // --- Absent stays off the wire on re-encode (the omit-when-null posture) ---

    @Test
    fun participantWithoutAvatarUrlStaysAbsentOnReencode_PROTOCOL4() {
        val value = ProtocolJson.decodeFromString(Participant.serializer(), participant(""))
        val keys = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(Participant.serializer(), value)).jsonObject.keys
        assertFalse(keys.contains("avatarUrl"), "an absent avatarUrl must stay off the wire, never become null (§3, §4)")
    }

    @Test
    fun playerConnectedWithoutAvatarUrlStaysAbsentOnReencode_PROTOCOL6() {
        val value = ProtocolJson.decodeFromString(PlayerConnectedMessage.serializer(), playerConnected(""))
        val keys = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(PlayerConnectedMessage.serializer(), value)).jsonObject.keys
        assertFalse(keys.contains("avatarUrl"), "an absent avatarUrl must stay off the wire, never become null (§3, §6)")
    }

    // --- A present avatar survives the round trip (opaque, not reshaped) ---

    @Test
    fun participantAvatarUrlSurvivesRoundTrip_PROTOCOL4() {
        val value = ProtocolJson.decodeFromString(Participant.serializer(), participant(""","avatarUrl":"https://cdn.example/a.png""""))
        val round = ProtocolJson.decodeFromString(Participant.serializer(), ProtocolJson.encodeToString(Participant.serializer(), value))
        assertEquals("https://cdn.example/a.png", round.avatarUrl)
    }
}
