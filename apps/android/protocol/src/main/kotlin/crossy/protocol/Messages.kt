// Every wire message (PROTOCOL.md §§2, 5, 6). Twin of packages/protocol/src/messages.ts
// plus the union decoding in codec.ts, and of apps/ios Messages.swift. Each message carries
// its `type` discriminant as a constant field (@EncodeDefault ALWAYS, so it is written even
// though it equals its default), so a single class round-trips a full frame; the
// ClientMessage / ServerMessage unions peek `type` and delegate, exactly as the TS codec's
// switch does. Unknown fields are ignored on decode (§3, ProtocolJson.ignoreUnknownKeys) and
// therefore dropped on re-encode, matching the TS decoders that copy only known fields.

@file:OptIn(ExperimentalSerializationApi::class)

package crossy.protocol

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Why a frame did not map to a known message. A recognizable-but-unknown `type` is a distinct
 * outcome from a malformed frame (a plain SerializationException): the client ignores and logs
 * it (§3), the server answers UNKNOWN_TYPE (§5). Twin of the codec's `unknown_type` outcome
 * and the Swift `WireDecodingError.unknownType`. It extends SerializationException so it flows
 * through the codec like any decode failure, but its concrete type lets a consumer tell the
 * two apart.
 */
public sealed class WireDecodingException(message: String) : SerializationException(message) {
    public class UnknownType(public val wireType: String) :
        WireDecodingException("unknown message type \"$wireType\" (PROTOCOL.md §3, §5)") {
        override fun equals(other: Any?): Boolean =
            other is UnknownType && other.wireType == wireType

        override fun hashCode(): Int = wireType.hashCode()
    }
}

/**
 * A reaction emoji, shape-checked (PROTOCOL.md §9): a non-empty string of at most 32 UTF-8 bytes.
 * Twin of the codec's `asEmoji` (`String.encodeToByteArray().size` is the byte count codec.ts and
 * the Swift `String.utf8.count` compute) and the Swift `decodeEmoji`. Shape only: set membership is
 * session-service policy and is NEVER checked here, so an emoji outside the v1 set still decodes
 * (receive-any, §9) and the published set MAY widen without a protocol version bump (§14). Applied
 * to the `emoji` field of react/reaction; encoding writes the string verbatim.
 */
public object EmojiSerializer : KSerializer<String> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("crossy.protocol.Emoji", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): String {
        val emoji = decoder.decodeString()
        if (emoji.isEmpty()) {
            throw SerializationException("emoji: non-empty string required (PROTOCOL.md §9)")
        }
        if (emoji.encodeToByteArray().size > 32) {
            throw SerializationException("emoji: at most 32 UTF-8 bytes required (PROTOCOL.md §9)")
        }
        return emoji
    }

    override fun serialize(encoder: Encoder, value: String): Unit = encoder.encodeString(value)
}

// --- Client to server (PROTOCOL.md §2, §5) ---

/**
 * First frame from the client (PROTOCOL.md §2). `protocolVersion` is negotiated, not fixed:
 * any integer decodes, and mapping an unsupported one to PROTOCOL_VERSION_UNSUPPORTED is the
 * server's business logic (§2, §14). `resumeFromSeq` is absent-optional: omitted when null.
 */
@Serializable
public data class HelloMessage(
    val protocolVersion: Int,
    val token: String,
    val resumeFromSeq: Int? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "hello" }
}

/** Place a value in a cell (PROTOCOL.md §5). A board mutation carrying an idempotent commandId. */
@Serializable
public data class PlaceLetterMessage(
    val commandId: String,
    val cell: Int,
    val value: String,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "placeLetter" }
}

/** Clear a cell (PROTOCOL.md §5). Board mutation; the value becomes null. */
@Serializable
public data class ClearCellMessage(
    val commandId: String,
    val cell: Int,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "clearCell" }
}

/** Move this client's cursor (PROTOCOL.md §5). Ephemeral: no commandId, no seq; at most 10/s (§9). */
@Serializable
public data class MoveCursorMessage(
    val cell: Int,
    val direction: Direction,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "moveCursor" }
}

/**
 * Send an emoji reaction at a cell (PROTOCOL.md §5, §9). MoveCursor's presence-family sibling:
 * ephemeral, no commandId, no seq, at most 5/s, role `any` (spectators react by design), legal in
 * any game status. The wire carries the emoji grapheme itself, never a symbolic token (§9); the
 * decoder enforces shape only (non-empty, at most 32 UTF-8 bytes), never set membership.
 */
@Serializable
public data class ReactMessage(
    @Serializable(with = EmojiSerializer::class) val emoji: String,
    val cell: Int,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "react" }
}

/** Request a whole-grid check (PROTOCOL.md §5). The server replies with a unicast checkResult. */
@Serializable
public data class CheckRequestMessage(
    val commandId: String,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "checkRequest" }
}

/** Liveness ping, every 15 s (PROTOCOL.md §5, §9). Carries nothing but its type. */
@Serializable
public data class HeartbeatMessage(
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "heartbeat" }
}

/** Ask the server for a fresh snapshot (PROTOCOL.md §5, §7). The server replies with sync. */
@Serializable
public data class RequestSyncMessage(
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "requestSync" }
}

// --- Server to client: sequenced events (PROTOCOL.md §6) ---

/**
 * Emitted for every accepted placeLetter or clearCell, including overwrites and no-ops (§6).
 * Exactly one per accepted command, so the writer always receives its echo (INV-10).
 * `value` is nullable-and-present (no default): the key is required on decode and an explicit
 * null (a clear) survives re-encode. `firstFillAt` is absent-optional and rides only the single
 * cellSet that establishes the first fill (§6), carrying the timer origin for an already-
 * connected client; additive and optional (§14), an older client ignores it.
 */
@Serializable
public data class CellSetMessage(
    val seq: Int,
    val cell: Int,
    val value: String?,
    val by: String,
    val commandId: String,
    val at: String,
    val firstFillAt: String? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "cellSet" }
}

/**
 * Exactly one per game on a full-and-correct board (PROTOCOL.md §6; INV-3). `at` and `stats`
 * are actor-supplied, not engine output (§6).
 */
@Serializable
public data class GameCompletedMessage(
    val seq: Int,
    val at: String,
    val stats: Stats,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "gameCompleted" }
}

/** The game was abandoned by the host (PROTOCOL.md §6; INV-4). */
@Serializable
public data class GameAbandonedMessage(
    val seq: Int,
    val at: String,
    val by: String,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "gameAbandoned" }
}

// --- Server to client: ephemeral notices (PROTOCOL.md §6) ---

/** Handshake success (PROTOCOL.md §2). Carries the caller's identity and the full board. */
@Serializable
public data class WelcomeMessage(
    val protocolVersion: Int,
    val self: SelfIdentity,
    val board: Board,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    /** The caller's own identity for this connection (§2). The wire key is `self`. */
    @Serializable
    public data class SelfIdentity(val userId: String, val role: Role)

    public companion object { public const val WIRE_TYPE: String = "welcome" }
}

/** A full snapshot replacing all sequenced state (PROTOCOL.md §6, §7). */
@Serializable
public data class SyncMessage(
    val board: Board,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "sync" }
}

/**
 * A participant joined or reconnected (PROTOCOL.md §6). `avatarUrl` is the same opaque nullable
 * field the participant carries (§4), absent-tolerant so a pre-avatar server still decodes.
 */
@Serializable
public data class PlayerConnectedMessage(
    val userId: String,
    val displayName: String,
    val color: String,
    val role: Role,
    val avatarUrl: String? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "playerConnected" }
}

/** A participant went away (PROTOCOL.md §6, §9). */
@Serializable
public data class PlayerDisconnectedMessage(
    val userId: String,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "playerDisconnected" }
}

/** Another participant's cursor moved (PROTOCOL.md §6). Best-effort, never sequenced (§9). */
@Serializable
public data class CursorMessage(
    val userId: String,
    val cell: Int,
    val direction: Direction,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "cursor" }
}

/**
 * Another participant reacted (PROTOCOL.md §6, §9). Relayed on a valid `react`, never echoed to the
 * sender (like `cursor`) and even lighter: the server records nothing, so a reaction never appears
 * in a `welcome` or `sync` `board` snapshot (there is no `board.reactions`). Receive-any: a client
 * renders or ignores any well-formed emoji and MUST NOT reject one outside its own send set (§9);
 * the decoder enforces shape only, exactly as the outbound `react` does (one rule, both directions).
 */
@Serializable
public data class ReactionMessage(
    val userId: String,
    @Serializable(with = EmojiSerializer::class) val emoji: String,
    val cell: Int,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "reaction" }
}

/**
 * Unicast reply to checkRequest (PROTOCOL.md §6, §10). Lists filled cells whose value fails
 * the comparator; empty cells are never listed.
 */
@Serializable
public data class CheckResultMessage(
    val commandId: String,
    val wrongCells: List<Int>,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "checkResult" }
}

/** The caller was removed (PROTOCOL.md §6, §12). Followed by a 1008 close. */
@Serializable
public data class KickedMessage(
    val reason: String,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "kicked" }
}

/**
 * An error (PROTOCOL.md §6, §11). `commandId` is present when the offending command carried one;
 * the client clears the matching overlay entry (§8). `fatal` is the concrete per-frame boolean;
 * §11's `varies` (INTERNAL) resolves to a real boolean on the wire.
 */
@Serializable
public data class ErrorMessage(
    val code: ErrorCode,
    val message: String,
    val fatal: Boolean,
    val commandId: String? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val type: String = WIRE_TYPE,
) {
    public companion object { public const val WIRE_TYPE: String = "error" }
}

// --- Unions (twin of codec.ts's decode switches and the Swift ClientMessage/ServerMessage) ---

/**
 * The discriminated union of every client-to-server message (PROTOCOL.md §5). A wrapper over the
 * concrete messages, the Kotlin stand-in for the Swift enum's associated values. Decoding a frame
 * with a valid-but-unknown `type` throws WireDecodingException.UnknownType (the server maps it to
 * UNKNOWN_TYPE, §5). Serialize/decode go through ClientMessageSerializer, not the plugin.
 */
public sealed class ClientMessage {
    public abstract val type: String

    public data class Hello(val message: HelloMessage) : ClientMessage() {
        override val type: String get() = HelloMessage.WIRE_TYPE
    }
    public data class PlaceLetter(val message: PlaceLetterMessage) : ClientMessage() {
        override val type: String get() = PlaceLetterMessage.WIRE_TYPE
    }
    public data class ClearCell(val message: ClearCellMessage) : ClientMessage() {
        override val type: String get() = ClearCellMessage.WIRE_TYPE
    }
    public data class MoveCursor(val message: MoveCursorMessage) : ClientMessage() {
        override val type: String get() = MoveCursorMessage.WIRE_TYPE
    }
    public data class React(val message: ReactMessage) : ClientMessage() {
        override val type: String get() = ReactMessage.WIRE_TYPE
    }
    public data class CheckRequest(val message: CheckRequestMessage) : ClientMessage() {
        override val type: String get() = CheckRequestMessage.WIRE_TYPE
    }
    public data class Heartbeat(val message: HeartbeatMessage) : ClientMessage() {
        override val type: String get() = HeartbeatMessage.WIRE_TYPE
    }
    public data class RequestSync(val message: RequestSyncMessage) : ClientMessage() {
        override val type: String get() = RequestSyncMessage.WIRE_TYPE
    }
}

/**
 * The discriminated union of every server-to-client message (PROTOCOL.md §6). `seq` is the §6
 * split (sequenced vs ephemeral) as one accessor, the twin of the TS `SequencedEvent` /
 * `EphemeralNotice` aliases; the §7 gap check keys on it. Decoding a valid-but-unknown `type`
 * throws WireDecodingException.UnknownType (the client ignores and logs it, §3).
 */
public sealed class ServerMessage {
    public abstract val type: String

    /** The per-game sequence number for a sequenced event, null for an ephemeral notice (§6, §7). */
    public open val seq: Int? get() = null

    public data class CellSet(val message: CellSetMessage) : ServerMessage() {
        override val type: String get() = CellSetMessage.WIRE_TYPE
        override val seq: Int get() = message.seq
    }
    public data class GameCompleted(val message: GameCompletedMessage) : ServerMessage() {
        override val type: String get() = GameCompletedMessage.WIRE_TYPE
        override val seq: Int get() = message.seq
    }
    public data class GameAbandoned(val message: GameAbandonedMessage) : ServerMessage() {
        override val type: String get() = GameAbandonedMessage.WIRE_TYPE
        override val seq: Int get() = message.seq
    }
    public data class Welcome(val message: WelcomeMessage) : ServerMessage() {
        override val type: String get() = WelcomeMessage.WIRE_TYPE
    }
    public data class Sync(val message: SyncMessage) : ServerMessage() {
        override val type: String get() = SyncMessage.WIRE_TYPE
    }
    public data class PlayerConnected(val message: PlayerConnectedMessage) : ServerMessage() {
        override val type: String get() = PlayerConnectedMessage.WIRE_TYPE
    }
    public data class PlayerDisconnected(val message: PlayerDisconnectedMessage) : ServerMessage() {
        override val type: String get() = PlayerDisconnectedMessage.WIRE_TYPE
    }
    public data class Cursor(val message: CursorMessage) : ServerMessage() {
        override val type: String get() = CursorMessage.WIRE_TYPE
    }
    public data class Reaction(val message: ReactionMessage) : ServerMessage() {
        override val type: String get() = ReactionMessage.WIRE_TYPE
    }
    public data class CheckResult(val message: CheckResultMessage) : ServerMessage() {
        override val type: String get() = CheckResultMessage.WIRE_TYPE
    }
    public data class Kicked(val message: KickedMessage) : ServerMessage() {
        override val type: String get() = KickedMessage.WIRE_TYPE
    }
    public data class Error(val message: ErrorMessage) : ServerMessage() {
        override val type: String get() = ErrorMessage.WIRE_TYPE
    }
}

/** Reads a frame's `type` discriminant, or throws malformed when it is missing or non-string (§3). */
private fun wireType(element: kotlinx.serialization.json.JsonElement): String {
    val obj = element as? JsonObject
        ?: throw SerializationException("a message frame must be a JSON object (PROTOCOL.md §3)")
    val type = (obj["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw SerializationException("a message frame must carry a string \"type\" (PROTOCOL.md §3)")
    return type
}

/** Twin of codec.ts's client decode switch. */
public object ClientMessageSerializer : KSerializer<ClientMessage> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("crossy.protocol.ClientMessage")

    override fun deserialize(decoder: Decoder): ClientMessage {
        val input = decoder as? JsonDecoder
            ?: throw SerializationException("ClientMessage decodes from JSON only")
        val element = input.decodeJsonElement()
        return when (val type = wireType(element)) {
            HelloMessage.WIRE_TYPE ->
                ClientMessage.Hello(input.json.decodeFromJsonElement(HelloMessage.serializer(), element))
            PlaceLetterMessage.WIRE_TYPE ->
                ClientMessage.PlaceLetter(input.json.decodeFromJsonElement(PlaceLetterMessage.serializer(), element))
            ClearCellMessage.WIRE_TYPE ->
                ClientMessage.ClearCell(input.json.decodeFromJsonElement(ClearCellMessage.serializer(), element))
            MoveCursorMessage.WIRE_TYPE ->
                ClientMessage.MoveCursor(input.json.decodeFromJsonElement(MoveCursorMessage.serializer(), element))
            ReactMessage.WIRE_TYPE ->
                ClientMessage.React(input.json.decodeFromJsonElement(ReactMessage.serializer(), element))
            CheckRequestMessage.WIRE_TYPE ->
                ClientMessage.CheckRequest(input.json.decodeFromJsonElement(CheckRequestMessage.serializer(), element))
            HeartbeatMessage.WIRE_TYPE ->
                ClientMessage.Heartbeat(input.json.decodeFromJsonElement(HeartbeatMessage.serializer(), element))
            RequestSyncMessage.WIRE_TYPE ->
                ClientMessage.RequestSync(input.json.decodeFromJsonElement(RequestSyncMessage.serializer(), element))
            else -> throw WireDecodingException.UnknownType(type)
        }
    }

    override fun serialize(encoder: Encoder, value: ClientMessage) {
        val output = encoder as? JsonEncoder
            ?: throw SerializationException("ClientMessage encodes to JSON only")
        val element = when (value) {
            is ClientMessage.Hello -> output.json.encodeToJsonElement(HelloMessage.serializer(), value.message)
            is ClientMessage.PlaceLetter -> output.json.encodeToJsonElement(PlaceLetterMessage.serializer(), value.message)
            is ClientMessage.ClearCell -> output.json.encodeToJsonElement(ClearCellMessage.serializer(), value.message)
            is ClientMessage.MoveCursor -> output.json.encodeToJsonElement(MoveCursorMessage.serializer(), value.message)
            is ClientMessage.React -> output.json.encodeToJsonElement(ReactMessage.serializer(), value.message)
            is ClientMessage.CheckRequest -> output.json.encodeToJsonElement(CheckRequestMessage.serializer(), value.message)
            is ClientMessage.Heartbeat -> output.json.encodeToJsonElement(HeartbeatMessage.serializer(), value.message)
            is ClientMessage.RequestSync -> output.json.encodeToJsonElement(RequestSyncMessage.serializer(), value.message)
        }
        output.encodeJsonElement(element)
    }
}

/** Twin of codec.ts's server decode switch. */
public object ServerMessageSerializer : KSerializer<ServerMessage> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("crossy.protocol.ServerMessage")

    override fun deserialize(decoder: Decoder): ServerMessage {
        val input = decoder as? JsonDecoder
            ?: throw SerializationException("ServerMessage decodes from JSON only")
        val element = input.decodeJsonElement()
        return when (val type = wireType(element)) {
            CellSetMessage.WIRE_TYPE ->
                ServerMessage.CellSet(input.json.decodeFromJsonElement(CellSetMessage.serializer(), element))
            GameCompletedMessage.WIRE_TYPE ->
                ServerMessage.GameCompleted(input.json.decodeFromJsonElement(GameCompletedMessage.serializer(), element))
            GameAbandonedMessage.WIRE_TYPE ->
                ServerMessage.GameAbandoned(input.json.decodeFromJsonElement(GameAbandonedMessage.serializer(), element))
            WelcomeMessage.WIRE_TYPE ->
                ServerMessage.Welcome(input.json.decodeFromJsonElement(WelcomeMessage.serializer(), element))
            SyncMessage.WIRE_TYPE ->
                ServerMessage.Sync(input.json.decodeFromJsonElement(SyncMessage.serializer(), element))
            PlayerConnectedMessage.WIRE_TYPE ->
                ServerMessage.PlayerConnected(input.json.decodeFromJsonElement(PlayerConnectedMessage.serializer(), element))
            PlayerDisconnectedMessage.WIRE_TYPE ->
                ServerMessage.PlayerDisconnected(input.json.decodeFromJsonElement(PlayerDisconnectedMessage.serializer(), element))
            CursorMessage.WIRE_TYPE ->
                ServerMessage.Cursor(input.json.decodeFromJsonElement(CursorMessage.serializer(), element))
            ReactionMessage.WIRE_TYPE ->
                ServerMessage.Reaction(input.json.decodeFromJsonElement(ReactionMessage.serializer(), element))
            CheckResultMessage.WIRE_TYPE ->
                ServerMessage.CheckResult(input.json.decodeFromJsonElement(CheckResultMessage.serializer(), element))
            KickedMessage.WIRE_TYPE ->
                ServerMessage.Kicked(input.json.decodeFromJsonElement(KickedMessage.serializer(), element))
            ErrorMessage.WIRE_TYPE ->
                ServerMessage.Error(input.json.decodeFromJsonElement(ErrorMessage.serializer(), element))
            else -> throw WireDecodingException.UnknownType(type)
        }
    }

    override fun serialize(encoder: Encoder, value: ServerMessage) {
        val output = encoder as? JsonEncoder
            ?: throw SerializationException("ServerMessage encodes to JSON only")
        val element = when (value) {
            is ServerMessage.CellSet -> output.json.encodeToJsonElement(CellSetMessage.serializer(), value.message)
            is ServerMessage.GameCompleted -> output.json.encodeToJsonElement(GameCompletedMessage.serializer(), value.message)
            is ServerMessage.GameAbandoned -> output.json.encodeToJsonElement(GameAbandonedMessage.serializer(), value.message)
            is ServerMessage.Welcome -> output.json.encodeToJsonElement(WelcomeMessage.serializer(), value.message)
            is ServerMessage.Sync -> output.json.encodeToJsonElement(SyncMessage.serializer(), value.message)
            is ServerMessage.PlayerConnected -> output.json.encodeToJsonElement(PlayerConnectedMessage.serializer(), value.message)
            is ServerMessage.PlayerDisconnected -> output.json.encodeToJsonElement(PlayerDisconnectedMessage.serializer(), value.message)
            is ServerMessage.Cursor -> output.json.encodeToJsonElement(CursorMessage.serializer(), value.message)
            is ServerMessage.Reaction -> output.json.encodeToJsonElement(ReactionMessage.serializer(), value.message)
            is ServerMessage.CheckResult -> output.json.encodeToJsonElement(CheckResultMessage.serializer(), value.message)
            is ServerMessage.Kicked -> output.json.encodeToJsonElement(KickedMessage.serializer(), value.message)
            is ServerMessage.Error -> output.json.encodeToJsonElement(ErrorMessage.serializer(), value.message)
        }
        output.encodeJsonElement(element)
    }
}
