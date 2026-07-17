package crossy.protocol

import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

// Parse posture (PROTOCOL.md §3, §5, §11, §14), twinned from the posture cases in
// packages/protocol/src/codec.test.ts and apps/ios WirePostureTests.swift: unknown fields are
// ignored, a recognizable-but-unknown `type` is a distinct outcome from a malformed frame, and
// version negotiation is business logic, not decoding.

class WirePostureTests {
    @Test
    fun unknownClientCommandTypeThrowsUnknownType() {
        // §5: the server answers UNKNOWN_TYPE; the decode outcome must be distinguishable from
        // malformed so it can.
        val frame = """{"type":"frobnicate","commandId":"c9"}"""
        val error = assertThrows<WireDecodingException.UnknownType> {
            ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        }
        assertEquals(WireDecodingException.UnknownType("frobnicate"), error)
    }

    @Test
    fun unknownServerNoticeTypeThrowsUnknownType() {
        // §3: the client ignores and logs an unknown notice; it needs the same distinguishable outcome.
        val frame = """{"type":"sparkle","glitter":true}"""
        val error = assertThrows<WireDecodingException.UnknownType> {
            ProtocolJson.decodeFromString(ServerMessageSerializer, frame)
        }
        assertEquals(WireDecodingException.UnknownType("sparkle"), error)
    }

    @Test
    fun unknownFieldsAreIgnoredAndDroppedOnReencode() {
        // §3, §14 forward compatibility: decode copies only known fields, exactly as the TS
        // decoders build a fresh object.
        val frame = """{"type":"cellSet","seq":1,"cell":0,"value":"A","by":"u1","commandId":"c1","at":"2026-07-07T00:00:00Z","futureField":{"nested":true}}"""
        val decoded = ProtocolJson.decodeFromString(ServerMessageSerializer, frame)
        val reencoded = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(ServerMessageSerializer, decoded),
        ).jsonObject
        assertFalse(reencoded.containsKey("futureField"))
        assertEquals(setOf("type", "seq", "cell", "value", "by", "commandId", "at"), reencoded.keys)
    }

    @Test
    fun malformedFramesThrowSerializationExceptionNotUnknownType() {
        // §11: a frame with no usable `type` is malformed (drop-and-log posture), a different
        // failure from unknown_type. Mirrors the TS malformed cases.
        val malformed = listOf("42", "\"string\"", "null", "[]", "{}", """{"type":7}""")
        for (raw in malformed) {
            val error = assertThrows<SerializationException>("frame $raw must fail to decode") {
                ProtocolJson.decodeFromString(ClientMessageSerializer, raw)
            }
            assertFalse(error is WireDecodingException, "frame $raw must be malformed, not unknown-type")
        }
    }

    @Test
    fun missingRequiredFieldIsMalformed() {
        val frame = """{"type":"placeLetter","commandId":"c1","cell":0}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        }
    }

    @Test
    fun cellSetValueKeyIsRequiredEvenThoughNullable() {
        // §6: `value` is nullable-and-present. A cellSet with no `value` key at all is malformed,
        // matching the TS asNullableString, not silently null.
        val frame = """{"type":"cellSet","seq":1,"cell":0,"by":"u1","commandId":"c1","at":"t"}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ServerMessageSerializer, frame)
        }
    }

    @Test
    fun helloForAFutureVersionStillDecodes() {
        // §2, §14: any integer protocolVersion decodes cleanly; mapping an unsupported one to
        // PROTOCOL_VERSION_UNSUPPORTED is the server's negotiation, not the codec's.
        val frame = """{"type":"hello","protocolVersion":999,"token":"jwt"}"""
        val decoded = ProtocolJson.decodeFromString(ClientMessageSerializer, frame)
        assertTrue(decoded is ClientMessage.Hello, "expected a hello, got ${decoded.type}")
        assertEquals(999, (decoded as ClientMessage.Hello).message.protocolVersion)
    }

    @Test
    fun unknownErrorCodeIsMalformed() {
        // §11 twin of the TS asErrorCode: the code vocabulary is closed per protocol version (a new
        // code is a §14 concern), so "NONSENSE" is malformed.
        val frame = """{"type":"error","code":"NONSENSE","message":"x","fatal":false}"""
        assertThrows<SerializationException> {
            ProtocolJson.decodeFromString(ServerMessageSerializer, frame)
        }
    }

    @Test
    fun asciiOnlyWireEnums_INV1() {
        // INV-1: every enum wire value this module compares against the wire is plain ASCII, so no
        // locale-aware transform can be involved in matching them.
        val wireValues =
            Role.serializer().descriptor.elementNames +
                Direction.serializer().descriptor.elementNames +
                GameStatus.serializer().descriptor.elementNames +
                ErrorCode.serializer().descriptor.elementNames +
                APIErrorCode.entries.map { it.name }
        for (raw in wireValues) {
            assertTrue(raw.all { it.code < 0x80 }, "$raw must be ASCII")
        }
    }
}
