// CrossyProtocol (AD-2: domain edge; imports Foundation only). Codable twins of every
// wire and REST payload in PROTOCOL.md §2–12, the Swift half of the D04 hand-kept-twin
// pattern: packages/protocol is the normative TypeScript schema, this target mirrors it
// by hand, and the contract snapshots in Tests/CrossyProtocolTests pin the two against
// the same PROTOCOL.md fixtures so drift fails CI.
//
// Posture (PROTOCOL.md §3, §14): unknown fields are ignored (Codable's keyed containers
// already do), required fields throw `DecodingError` when missing, and a recognizable
// but unknown message `type` throws `WireDecodingError.unknownType` so a consumer can
// tell §3's ignore-and-log (client) or §5's UNKNOWN_TYPE (server) apart from a malformed
// frame. Nullable-and-present fields (`"value": null`) are distinct from
// optional-and-absent fields (`firstFillAt`); hand-written Codable conformances keep
// that distinction on re-encode, which the snapshot tests assert.

/// PROTOCOL.md §2, §14: the current protocol version. The server supports N and N-1;
/// at v1 the supported set is exactly {1}. Twin of `PROTOCOL_VERSION` in
/// packages/protocol.
public enum ProtocolVersion {
    public static let current = 1
}
