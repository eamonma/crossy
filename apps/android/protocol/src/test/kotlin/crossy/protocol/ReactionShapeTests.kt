package crossy.protocol

import kotlinx.serialization.SerializationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

// Emoji reactions: shape only, receive-any (PROTOCOL.md §5, §6, §9). Twinned case-for-case from
// apps/ios ReactionShapeTests.swift and the reactions describe block in
// packages/protocol/src/codec.test.ts: the decoders enforce a non-empty string of at most 32 UTF-8
// bytes and NEVER set membership, which is session-service policy, so an emoji outside the v1 set
// decodes in both directions and the published set can widen without a version bump (§14).
class ReactionShapeTests {
    // --- Receive-any, send-gated (§9) ---

    @Test
    fun decodesAReactWhoseEmojiIsOutsideTheV1Set_receiveAny_PROTOCOL9() {
        // The codec checks shape, not set membership; gating is the sender's policy.
        val frame = """{"type":"react","emoji":"🔥","cell":3}"""
        val decoded = ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        assertEquals(ClientMessage.React(ReactMessage(emoji = "🔥", cell = 3)), decoded)
    }

    @Test
    fun decodesAReactionWhoseEmojiIsOutsideTheV1Set_receiveAny_PROTOCOL9() {
        // A receiver MUST NOT reject an unknown emoji (receive-any, send-gated, §9).
        val frame = """{"type":"reaction","userId":"u2","emoji":"🦀","cell":3}"""
        val decoded = ProtocolJson.decodeFromString(ServerMessageSerializer, frame)
        assertEquals(ServerMessage.Reaction(ReactionMessage(userId = "u2", emoji = "🦀", cell = 3)), decoded)
    }

    // --- Forward compatibility (§3) ---

    @Test
    fun ignoresUnknownExtraFieldsOnReactAndReaction_PROTOCOL3() {
        val react = """{"type":"react","emoji":"🎉","cell":3,"futureField":{"nested":true}}"""
        val decodedReact = ProtocolJson.decodeFromString(ClientMessageSerializer, react)
        assertEquals(ClientMessage.React(ReactMessage(emoji = "🎉", cell = 3)), decodedReact)
        val reencodedReact = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(ClientMessageSerializer, decodedReact),
        )
        assertEquals(setOf("type", "emoji", "cell"), allJsonKeys(reencodedReact).toSet())

        val reaction = """{"type":"reaction","userId":"u2","emoji":"🎉","cell":3,"futureField":1}"""
        val decodedReaction = ProtocolJson.decodeFromString(ServerMessageSerializer, reaction)
        assertEquals(
            ServerMessage.Reaction(ReactionMessage(userId = "u2", emoji = "🎉", cell = 3)),
            decodedReaction,
        )
        val reencodedReaction = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(ServerMessageSerializer, decodedReaction),
        )
        assertFalse("futureField" in allJsonKeys(reencodedReaction))
    }

    // --- Malformed frames (§5, §11 drop-and-log posture) ---

    @Test
    fun rejectsAReactMissingEmojiAsMalformed_PROTOCOL5() {
        val frame = """{"type":"react","cell":3}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        }
    }

    @Test
    fun rejectsAReactionWithAMistypedCellAsMalformed_PROTOCOL6() {
        // A structurally wrong `cell` is malformed (§6). The iOS twin uses a quoted number ("3");
        // kotlinx's tree decoder leniently coerces a quoted integer, so the Kotlin twin pins the
        // same rule with a shape no decoder coerces: an object where an integer is required.
        val frame = """{"type":"reaction","userId":"u2","emoji":"🎉","cell":{}}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ServerMessageSerializer, frame)
        }
    }

    // --- The 32-byte shape rule (§9) ---

    @Test
    fun rejectsAnEmptyEmojiAsMalformed_PROTOCOL9() {
        val frame = """{"type":"react","emoji":"","cell":3}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        }
    }

    @Test
    fun rejectsAnEmojiOver32UTF8BytesAsMalformed_PROTOCOL9() {
        // Nine 🎉 graphemes are 36 UTF-8 bytes (4 each), past the 32-byte shape cap.
        val frame = """{"type":"react","emoji":"${"🎉".repeat(9)}","cell":3}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        }
    }

    @Test
    fun acceptsAnEmojiExactlyAtThe32UTF8ByteCap_PROTOCOL9() {
        // Eight 🎉 graphemes are exactly 32 UTF-8 bytes, the inclusive boundary.
        val emoji = "🎉".repeat(8)
        val frame = """{"type":"react","emoji":"$emoji","cell":3}"""
        val decoded = ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        assertEquals(ClientMessage.React(ReactMessage(emoji = emoji, cell = 3)), decoded)
    }

    @Test
    fun reactionDecoderAppliesTheSameShapeRule_PROTOCOL9() {
        // The inbound notice enforces shape exactly as the outbound command does: one rule, both
        // directions (the codec's single asEmoji, the shared EmojiSerializer).
        val empty = """{"type":"reaction","userId":"u2","emoji":"","cell":3}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ServerMessageSerializer, empty)
        }
        val oversize = """{"type":"reaction","userId":"u2","emoji":"${"🎉".repeat(9)}","cell":3}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ServerMessageSerializer, oversize)
        }
    }
}
