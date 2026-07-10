// Every wire message (PROTOCOL.md §§2, 5, 6). Twin of
// packages/protocol/src/messages.ts plus the union decoding in codec.ts. Each message
// carries its `type` discriminant through Codable, so a single struct round-trips a
// full frame; `ClientMessage`/`ServerMessage` peek the `type` and delegate, exactly as
// the TS codec's switch does. Unknown fields are ignored on decode (§3) and therefore
// dropped on re-encode, matching the TS decoders, which copy only known fields.

/// Why a frame did not map to a known message. A recognizable-but-unknown `type` is a
/// distinct outcome from a malformed frame (which surfaces as `DecodingError`): the
/// client ignores and logs it (§3), the server answers UNKNOWN_TYPE (§5). Twin of the
/// codec's `DecodeError.kind: "unknown_type"`.
public enum WireDecodingError: Error, Sendable, Equatable {
    case unknownType(String)
}

/// Decode and check the `type` discriminant of one message (PROTOCOL.md §3: `type` is
/// required on every message). A mismatch inside a concrete message decode is malformed,
/// never unknown-type: the union has already routed on `type` by the time this runs.
private func expectWireType<Key: CodingKey>(
    _ container: KeyedDecodingContainer<Key>, _ key: Key, _ expected: String
) throws {
    let found = try container.decode(String.self, forKey: key)
    guard found == expected else {
        throw DecodingError.dataCorruptedError(
            forKey: key, in: container,
            debugDescription: "expected type \"\(expected)\", found \"\(found)\"")
    }
}

// MARK: - Client to server (PROTOCOL.md §2, §5)

/// First frame from the client (PROTOCOL.md §2). `protocolVersion` is negotiated, not
/// fixed: any integer decodes, and mapping an unsupported one to
/// PROTOCOL_VERSION_UNSUPPORTED is the server's business logic (§2, §14).
public struct HelloMessage: Sendable, Equatable, Codable {
    public static let wireType = "hello"

    public let protocolVersion: Int
    public let token: String
    /// Optional and informational; the server always replies with a full snapshot (§2).
    /// Absent-optional: omitted from the frame when nil.
    public let resumeFromSeq: Int?

    public init(protocolVersion: Int, token: String, resumeFromSeq: Int? = nil) {
        self.protocolVersion = protocolVersion
        self.token = token
        self.resumeFromSeq = resumeFromSeq
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case protocolVersion
        case token
        case resumeFromSeq
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        protocolVersion = try container.decode(Int.self, forKey: .protocolVersion)
        token = try container.decode(String.self, forKey: .token)
        resumeFromSeq = try container.decodeIfPresent(Int.self, forKey: .resumeFromSeq)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(token, forKey: .token)
        try container.encodeIfPresent(resumeFromSeq, forKey: .resumeFromSeq)
    }
}

/// Place a value in a cell (PROTOCOL.md §5). A board mutation carrying an idempotent
/// commandId.
public struct PlaceLetterMessage: Sendable, Equatable, Codable {
    public static let wireType = "placeLetter"

    public let commandId: String
    public let cell: Int
    public let value: String

    public init(commandId: String, cell: Int, value: String) {
        self.commandId = commandId
        self.cell = cell
        self.value = value
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case commandId
        case cell
        case value
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        commandId = try container.decode(String.self, forKey: .commandId)
        cell = try container.decode(Int.self, forKey: .cell)
        value = try container.decode(String.self, forKey: .value)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(cell, forKey: .cell)
        try container.encode(value, forKey: .value)
    }
}

/// Clear a cell (PROTOCOL.md §5). Board mutation; the value becomes null.
public struct ClearCellMessage: Sendable, Equatable, Codable {
    public static let wireType = "clearCell"

    public let commandId: String
    public let cell: Int

    public init(commandId: String, cell: Int) {
        self.commandId = commandId
        self.cell = cell
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case commandId
        case cell
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        commandId = try container.decode(String.self, forKey: .commandId)
        cell = try container.decode(Int.self, forKey: .cell)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(cell, forKey: .cell)
    }
}

/// Move this client's cursor (PROTOCOL.md §5). Ephemeral: no commandId, no seq; at most
/// 10/s (§9).
public struct MoveCursorMessage: Sendable, Equatable, Codable {
    public static let wireType = "moveCursor"

    public let cell: Int
    public let direction: Direction

    public init(cell: Int, direction: Direction) {
        self.cell = cell
        self.direction = direction
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case cell
        case direction
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        cell = try container.decode(Int.self, forKey: .cell)
        direction = try container.decode(Direction.self, forKey: .direction)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(cell, forKey: .cell)
        try container.encode(direction, forKey: .direction)
    }
}

/// Request a whole-grid check (PROTOCOL.md §5). The server replies with a unicast
/// checkResult.
public struct CheckRequestMessage: Sendable, Equatable, Codable {
    public static let wireType = "checkRequest"

    public let commandId: String

    public init(commandId: String) {
        self.commandId = commandId
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case commandId
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        commandId = try container.decode(String.self, forKey: .commandId)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(commandId, forKey: .commandId)
    }
}

/// Liveness ping, every 15 s (PROTOCOL.md §5, §9). Carries nothing but its type.
public struct HeartbeatMessage: Sendable, Equatable, Codable {
    public static let wireType = "heartbeat"

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case type
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
    }
}

/// Ask the server for a fresh snapshot (PROTOCOL.md §5, §7). The server replies with
/// sync.
public struct RequestSyncMessage: Sendable, Equatable, Codable {
    public static let wireType = "requestSync"

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case type
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
    }
}

// MARK: - Server to client: sequenced events (PROTOCOL.md §6)

/// Emitted for every accepted placeLetter or clearCell, including overwrites and no-ops
/// (§6). Exactly one per accepted command, so the writer always receives its echo
/// (INV-10).
public struct CellSetMessage: Sendable, Equatable, Codable {
    public static let wireType = "cellSet"

    public let seq: Int
    public let cell: Int
    /// A string, or nil for a clear (PROTOCOL.md §6). Nullable-and-present: the wire
    /// carries an explicit `"value": null`, and re-encode preserves it.
    public let value: String?
    public let by: String
    /// Echoes the originating command so the writer can clear its overlay (§6, §8).
    public let commandId: String
    public let at: String
    /// Present only on the single cellSet that establishes the first fill (§6), carrying
    /// the timer origin so an already-connected client starts the shared timer on the
    /// delta rather than waiting for a snapshot. Additive and optional (§14):
    /// absent-optional, omitted from the frame when nil.
    public let firstFillAt: String?

    public init(
        seq: Int,
        cell: Int,
        value: String?,
        by: String,
        commandId: String,
        at: String,
        firstFillAt: String? = nil
    ) {
        self.seq = seq
        self.cell = cell
        self.value = value
        self.by = by
        self.commandId = commandId
        self.at = at
        self.firstFillAt = firstFillAt
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case seq
        case cell
        case value
        case by
        case commandId
        case at
        case firstFillAt
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        seq = try container.decode(Int.self, forKey: .seq)
        cell = try container.decode(Int.self, forKey: .cell)
        // Required key, null allowed (a clear), matching the TS asNullableString.
        value = try container.decode(String?.self, forKey: .value)
        by = try container.decode(String.self, forKey: .by)
        commandId = try container.decode(String.self, forKey: .commandId)
        at = try container.decode(String.self, forKey: .at)
        firstFillAt = try container.decodeIfPresent(String.self, forKey: .firstFillAt)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(seq, forKey: .seq)
        try container.encode(cell, forKey: .cell)
        try container.encode(value, forKey: .value)
        try container.encode(by, forKey: .by)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(at, forKey: .at)
        try container.encodeIfPresent(firstFillAt, forKey: .firstFillAt)
    }
}

/// Exactly one per game on a full-and-correct board (PROTOCOL.md §6; INV-3). `at` and
/// `stats` are actor-supplied, not engine output (§6).
public struct GameCompletedMessage: Sendable, Equatable, Codable {
    public static let wireType = "gameCompleted"

    public let seq: Int
    public let at: String
    public let stats: Stats

    public init(seq: Int, at: String, stats: Stats) {
        self.seq = seq
        self.at = at
        self.stats = stats
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case seq
        case at
        case stats
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        seq = try container.decode(Int.self, forKey: .seq)
        at = try container.decode(String.self, forKey: .at)
        stats = try container.decode(Stats.self, forKey: .stats)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(seq, forKey: .seq)
        try container.encode(at, forKey: .at)
        try container.encode(stats, forKey: .stats)
    }
}

/// The game was abandoned by the host (PROTOCOL.md §6; INV-4).
public struct GameAbandonedMessage: Sendable, Equatable, Codable {
    public static let wireType = "gameAbandoned"

    public let seq: Int
    public let at: String
    public let by: String

    public init(seq: Int, at: String, by: String) {
        self.seq = seq
        self.at = at
        self.by = by
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case seq
        case at
        case by
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        seq = try container.decode(Int.self, forKey: .seq)
        at = try container.decode(String.self, forKey: .at)
        by = try container.decode(String.self, forKey: .by)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(seq, forKey: .seq)
        try container.encode(at, forKey: .at)
        try container.encode(by, forKey: .by)
    }
}

// MARK: - Server to client: ephemeral notices (PROTOCOL.md §6)

/// Handshake success (PROTOCOL.md §2). Carries the caller's identity and the full board.
public struct WelcomeMessage: Sendable, Equatable, Codable {
    public static let wireType = "welcome"

    /// The caller's own identity for this connection (§2). The wire key is `self`, a
    /// Swift keyword, so this is the one place a property name diverges from the wire;
    /// CodingKeys pins the wire spelling.
    public struct SelfIdentity: Sendable, Equatable, Codable {
        public let userId: String
        public let role: Role

        public init(userId: String, role: Role) {
            self.userId = userId
            self.role = role
        }
    }

    public let protocolVersion: Int
    public let selfIdentity: SelfIdentity
    public let board: Board

    public init(protocolVersion: Int, selfIdentity: SelfIdentity, board: Board) {
        self.protocolVersion = protocolVersion
        self.selfIdentity = selfIdentity
        self.board = board
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case protocolVersion
        case selfIdentity = "self"
        case board
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        protocolVersion = try container.decode(Int.self, forKey: .protocolVersion)
        selfIdentity = try container.decode(SelfIdentity.self, forKey: .selfIdentity)
        board = try container.decode(Board.self, forKey: .board)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(selfIdentity, forKey: .selfIdentity)
        try container.encode(board, forKey: .board)
    }
}

/// A full snapshot replacing all sequenced state (PROTOCOL.md §6, §7).
public struct SyncMessage: Sendable, Equatable, Codable {
    public static let wireType = "sync"

    public let board: Board

    public init(board: Board) {
        self.board = board
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case board
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        board = try container.decode(Board.self, forKey: .board)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(board, forKey: .board)
    }
}

/// A participant joined or reconnected (PROTOCOL.md §6).
public struct PlayerConnectedMessage: Sendable, Equatable, Codable {
    public static let wireType = "playerConnected"

    public let userId: String
    public let displayName: String
    public let color: String
    public let role: Role

    public init(userId: String, displayName: String, color: String, role: Role) {
        self.userId = userId
        self.displayName = displayName
        self.color = color
        self.role = role
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case userId
        case displayName
        case color
        case role
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        userId = try container.decode(String.self, forKey: .userId)
        displayName = try container.decode(String.self, forKey: .displayName)
        color = try container.decode(String.self, forKey: .color)
        role = try container.decode(Role.self, forKey: .role)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(userId, forKey: .userId)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(color, forKey: .color)
        try container.encode(role, forKey: .role)
    }
}

/// A participant went away (PROTOCOL.md §6, §9).
public struct PlayerDisconnectedMessage: Sendable, Equatable, Codable {
    public static let wireType = "playerDisconnected"

    public let userId: String

    public init(userId: String) {
        self.userId = userId
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case userId
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        userId = try container.decode(String.self, forKey: .userId)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(userId, forKey: .userId)
    }
}

/// Another participant's cursor moved (PROTOCOL.md §6). Best-effort, never sequenced
/// (§9).
public struct CursorMessage: Sendable, Equatable, Codable {
    public static let wireType = "cursor"

    public let userId: String
    public let cell: Int
    public let direction: Direction

    public init(userId: String, cell: Int, direction: Direction) {
        self.userId = userId
        self.cell = cell
        self.direction = direction
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case userId
        case cell
        case direction
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        userId = try container.decode(String.self, forKey: .userId)
        cell = try container.decode(Int.self, forKey: .cell)
        direction = try container.decode(Direction.self, forKey: .direction)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(userId, forKey: .userId)
        try container.encode(cell, forKey: .cell)
        try container.encode(direction, forKey: .direction)
    }
}

/// Unicast reply to checkRequest (PROTOCOL.md §6, §10). Lists filled cells whose value
/// fails the comparator; empty cells are never listed.
public struct CheckResultMessage: Sendable, Equatable, Codable {
    public static let wireType = "checkResult"

    public let commandId: String
    public let wrongCells: [Int]

    public init(commandId: String, wrongCells: [Int]) {
        self.commandId = commandId
        self.wrongCells = wrongCells
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case commandId
        case wrongCells
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        commandId = try container.decode(String.self, forKey: .commandId)
        wrongCells = try container.decode([Int].self, forKey: .wrongCells)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(wrongCells, forKey: .wrongCells)
    }
}

/// The caller was removed (PROTOCOL.md §6, §12). Followed by a 1008 close.
public struct KickedMessage: Sendable, Equatable, Codable {
    public static let wireType = "kicked"

    public let reason: String

    public init(reason: String) {
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case reason
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        reason = try container.decode(String.self, forKey: .reason)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(reason, forKey: .reason)
    }
}

/// An error (PROTOCOL.md §6, §11). `commandId` is present when the offending command
/// carried one; the client clears the matching overlay entry (§8).
public struct ErrorMessage: Sendable, Equatable, Codable {
    public static let wireType = "error"

    public let code: ErrorCode
    public let message: String
    /// The concrete per-frame fatality; §11's `varies` (INTERNAL) resolves to a real
    /// boolean on the wire.
    public let fatal: Bool
    /// Absent-optional: omitted when the offending command carried no commandId.
    public let commandId: String?

    public init(code: ErrorCode, message: String, fatal: Bool, commandId: String? = nil) {
        self.code = code
        self.message = message
        self.fatal = fatal
        self.commandId = commandId
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case code
        case message
        case fatal
        case commandId
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        code = try container.decode(ErrorCode.self, forKey: .code)
        message = try container.decode(String.self, forKey: .message)
        fatal = try container.decode(Bool.self, forKey: .fatal)
        commandId = try container.decodeIfPresent(String.self, forKey: .commandId)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(code, forKey: .code)
        try container.encode(message, forKey: .message)
        try container.encode(fatal, forKey: .fatal)
        try container.encodeIfPresent(commandId, forKey: .commandId)
    }
}

// MARK: - Unions (twin of codec.ts's decode switches)

/// The single key the unions peek before delegating to a concrete message decode.
private enum DiscriminantKey: String, CodingKey {
    case type
}

/// The discriminated union of every client-to-server message (PROTOCOL.md §5). Decoding
/// a frame with a valid-but-unknown `type` throws `WireDecodingError.unknownType`, the
/// twin of the codec's `unknown_type` outcome (the server maps it to UNKNOWN_TYPE, §5).
public enum ClientMessage: Sendable, Equatable, Codable {
    case hello(HelloMessage)
    case placeLetter(PlaceLetterMessage)
    case clearCell(ClearCellMessage)
    case moveCursor(MoveCursorMessage)
    case checkRequest(CheckRequestMessage)
    case heartbeat(HeartbeatMessage)
    case requestSync(RequestSyncMessage)

    /// The wire `type` of the wrapped message.
    public var type: String {
        switch self {
        case .hello: return HelloMessage.wireType
        case .placeLetter: return PlaceLetterMessage.wireType
        case .clearCell: return ClearCellMessage.wireType
        case .moveCursor: return MoveCursorMessage.wireType
        case .checkRequest: return CheckRequestMessage.wireType
        case .heartbeat: return HeartbeatMessage.wireType
        case .requestSync: return RequestSyncMessage.wireType
        }
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: DiscriminantKey.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case HelloMessage.wireType:
            self = .hello(try HelloMessage(from: decoder))
        case PlaceLetterMessage.wireType:
            self = .placeLetter(try PlaceLetterMessage(from: decoder))
        case ClearCellMessage.wireType:
            self = .clearCell(try ClearCellMessage(from: decoder))
        case MoveCursorMessage.wireType:
            self = .moveCursor(try MoveCursorMessage(from: decoder))
        case CheckRequestMessage.wireType:
            self = .checkRequest(try CheckRequestMessage(from: decoder))
        case HeartbeatMessage.wireType:
            self = .heartbeat(try HeartbeatMessage(from: decoder))
        case RequestSyncMessage.wireType:
            self = .requestSync(try RequestSyncMessage(from: decoder))
        default:
            throw WireDecodingError.unknownType(type)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        switch self {
        case .hello(let message): try message.encode(to: encoder)
        case .placeLetter(let message): try message.encode(to: encoder)
        case .clearCell(let message): try message.encode(to: encoder)
        case .moveCursor(let message): try message.encode(to: encoder)
        case .checkRequest(let message): try message.encode(to: encoder)
        case .heartbeat(let message): try message.encode(to: encoder)
        case .requestSync(let message): try message.encode(to: encoder)
        }
    }
}

/// The discriminated union of every server-to-client message (PROTOCOL.md §6). Decoding
/// a frame with a valid-but-unknown `type` throws `WireDecodingError.unknownType`, the
/// twin of the codec's `unknown_type` outcome (the client ignores and logs it, §3).
public enum ServerMessage: Sendable, Equatable, Codable {
    // Sequenced events: exactly the messages that mutate durable state (§6).
    case cellSet(CellSetMessage)
    case gameCompleted(GameCompletedMessage)
    case gameAbandoned(GameAbandonedMessage)
    // Ephemeral notices: no seq (§6).
    case welcome(WelcomeMessage)
    case sync(SyncMessage)
    case playerConnected(PlayerConnectedMessage)
    case playerDisconnected(PlayerDisconnectedMessage)
    case cursor(CursorMessage)
    case checkResult(CheckResultMessage)
    case kicked(KickedMessage)
    case error(ErrorMessage)

    /// The wire `type` of the wrapped message.
    public var type: String {
        switch self {
        case .cellSet: return CellSetMessage.wireType
        case .gameCompleted: return GameCompletedMessage.wireType
        case .gameAbandoned: return GameAbandonedMessage.wireType
        case .welcome: return WelcomeMessage.wireType
        case .sync: return SyncMessage.wireType
        case .playerConnected: return PlayerConnectedMessage.wireType
        case .playerDisconnected: return PlayerDisconnectedMessage.wireType
        case .cursor: return CursorMessage.wireType
        case .checkResult: return CheckResultMessage.wireType
        case .kicked: return KickedMessage.wireType
        case .error: return ErrorMessage.wireType
        }
    }

    /// The per-game sequence number for a sequenced event, nil for an ephemeral notice.
    /// The §6 split (sequenced vs ephemeral) as one accessor, the Swift stand-in for the
    /// TS `SequencedEvent` / `EphemeralNotice` aliases; the §7 gap check keys on it.
    public var seq: Int? {
        switch self {
        case .cellSet(let message): return message.seq
        case .gameCompleted(let message): return message.seq
        case .gameAbandoned(let message): return message.seq
        case .welcome, .sync, .playerConnected, .playerDisconnected, .cursor,
            .checkResult, .kicked, .error:
            return nil
        }
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: DiscriminantKey.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case CellSetMessage.wireType:
            self = .cellSet(try CellSetMessage(from: decoder))
        case GameCompletedMessage.wireType:
            self = .gameCompleted(try GameCompletedMessage(from: decoder))
        case GameAbandonedMessage.wireType:
            self = .gameAbandoned(try GameAbandonedMessage(from: decoder))
        case WelcomeMessage.wireType:
            self = .welcome(try WelcomeMessage(from: decoder))
        case SyncMessage.wireType:
            self = .sync(try SyncMessage(from: decoder))
        case PlayerConnectedMessage.wireType:
            self = .playerConnected(try PlayerConnectedMessage(from: decoder))
        case PlayerDisconnectedMessage.wireType:
            self = .playerDisconnected(try PlayerDisconnectedMessage(from: decoder))
        case CursorMessage.wireType:
            self = .cursor(try CursorMessage(from: decoder))
        case CheckResultMessage.wireType:
            self = .checkResult(try CheckResultMessage(from: decoder))
        case KickedMessage.wireType:
            self = .kicked(try KickedMessage(from: decoder))
        case ErrorMessage.wireType:
            self = .error(try ErrorMessage(from: decoder))
        default:
            throw WireDecodingError.unknownType(type)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        switch self {
        case .cellSet(let message): try message.encode(to: encoder)
        case .gameCompleted(let message): try message.encode(to: encoder)
        case .gameAbandoned(let message): try message.encode(to: encoder)
        case .welcome(let message): try message.encode(to: encoder)
        case .sync(let message): try message.encode(to: encoder)
        case .playerConnected(let message): try message.encode(to: encoder)
        case .playerDisconnected(let message): try message.encode(to: encoder)
        case .cursor(let message): try message.encode(to: encoder)
        case .checkResult(let message): try message.encode(to: encoder)
        case .kicked(let message): try message.encode(to: encoder)
        case .error(let message): try message.encode(to: encoder)
        }
    }
}
