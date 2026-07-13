// CrossyProtocol (AAD-1: domain edge; imports kotlinx.serialization only). The Kotlin
// half of the D04 hand-kept-twin pattern: packages/protocol is the normative TypeScript
// schema, apps/ios/CrossyProtocol is the Swift twin, and this module mirrors both by hand
// with @Serializable twins of every wire and REST payload (PROTOCOL.md §2-12). The
// contract snapshots under src/test pin all three against the same PROTOCOL.md fixtures,
// so drift fails CI on whichever side moved.
//
// Posture (PROTOCOL.md §3, §14), pinned by ProtocolJson below and the snapshot tests:
//   - Unknown fields are ignored on decode (ignoreUnknownKeys) and so dropped on
//     re-encode, matching the TS decoders that copy only known fields.
//   - Nullable-and-present fields (`"value": null`, `firstFillAt: null`) keep their key
//     on the wire: modeled as a nullable field with NO default, so the key is required on
//     decode and an explicit null is written on encode.
//   - Absent-optional fields (`resumeFromSeq`, `avatarUrl`, `runs`) stay off the wire when
//     empty: modeled as a nullable field defaulting to null under encodeDefaults=false, so
//     an absent key decodes to null and a null value re-encodes to an absent key.
//   - A field that decodes absent-tolerantly but always re-emits its key (`completedAt`,
//     a mirror `avatarUrl` the server writes as an explicit null) carries a null default
//     AND @EncodeDefault(ALWAYS), so absence decodes to null yet a null re-encodes as an
//     explicit null, wire-honest with the current server.
// A recognizable-but-unknown message `type` throws WireDecodingException.UnknownType, a
// distinct outcome from a malformed frame (a plain SerializationException), so a consumer
// can tell §3's ignore-and-log (client) or §5's UNKNOWN_TYPE (server) from a garbled frame.

package crossy.protocol

import kotlinx.serialization.json.Json

/**
 * PROTOCOL.md §2, §14: the current protocol version. The server supports N and N-1; at v1
 * the supported set is exactly {1}. Twin of `PROTOCOL_VERSION` (packages/protocol) and
 * `ProtocolVersion.current` (apps/ios).
 */
public object ProtocolVersion {
    public const val CURRENT: Int = 1
}

/**
 * The one Json instance every twin serializes through (PROTOCOL.md §3). `ignoreUnknownKeys`
 * carries §3's forward-compatibility rule; `encodeDefaults = false` is what lets an
 * absent-optional field (a nullable with a null default) drop its key on encode, while a
 * nullable field with no default still writes its explicit null. `explicitNulls` stays at
 * its default (true), so those no-default nullable keys keep their null on the wire.
 */
public val ProtocolJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
}
