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

/// Decode a reaction emoji with the PROTOCOL.md §9 shape check: a non-empty string of
/// at most 32 UTF-8 bytes, the twin of the codec's `asEmoji` (`String.utf8.count` is
/// the byte count codec.ts computes by hand). Shape only: set membership is
/// session-service policy and is never checked here, so an emoji outside the v1 set
/// still decodes (receive-any, §9) and the published set MAY widen without a protocol
/// version bump (§14).
private func decodeEmoji<Key: CodingKey>(
    _ container: KeyedDecodingContainer<Key>, _ key: Key
) throws -> String {
    let emoji = try container.decode(String.self, forKey: key)
    guard !emoji.isEmpty else {
        throw DecodingError.dataCorruptedError(
            forKey: key, in: container,
            debugDescription: "emoji: non-empty string required")
    }
    guard emoji.utf8.count <= 32 else {
        throw DecodingError.dataCorruptedError(
            forKey: key, in: container,
            debugDescription: "emoji: at most 32 UTF-8 bytes required")
    }
    return emoji
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

/// Send an emoji reaction at a cell (PROTOCOL.md §5, §9). The presence-family sibling
/// of moveCursor: ephemeral, no commandId, no seq, at most 5/s, role `any` (spectators
/// react by design), legal in any game status. The wire carries the emoji grapheme
/// itself, never a symbolic token (§9).
public struct ReactMessage: Sendable, Equatable, Codable {
    public static let wireType = "react"

    public let emoji: String
    public let cell: Int

    public init(emoji: String, cell: Int) {
        self.emoji = emoji
        self.cell = cell
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case emoji
        case cell
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        emoji = try decodeEmoji(container, CodingKeys.emoji)
        cell = try container.decode(Int.self, forKey: .cell)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(emoji, forKey: .emoji)
        try container.encode(cell, forKey: .cell)
    }
}

/// Propose the room-wide check (PROTOCOL.md §5, §10; D32): one command opens an attributed,
/// timeboxed majority vote instead of checking immediately. Legal only while the game is
/// ongoing, the grid is full, and no vote is already open; the server broadcasts the
/// sequenced checkVoteOpened. The wire type stays `checkPuzzle`; the electorate is assembled
/// server-side from live presence, never sent by the client.
public struct CheckPuzzleMessage: Sendable, Equatable, Codable {
    public static let wireType = "checkPuzzle"

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

/// Cast one immutable ballot on the open check vote (PROTOCOL.md §5, §10; D32). `voteSeq`
/// names the open vote (the checkVoteOpened `seq`); `approve` is the ballot. One ballot per
/// elector; the proposer never casts one (their proposal already approved). The server
/// broadcasts the sequenced checkVoteCast, or rejects non-fatally (NO_VOTE_OPEN, NOT_ELECTOR,
/// ALREADY_VOTED, ROLE_FORBIDDEN, GAME_NOT_ONGOING).
public struct CastCheckVoteMessage: Sendable, Equatable, Codable {
    public static let wireType = "castCheckVote"

    public let commandId: String
    public let voteSeq: Int
    public let approve: Bool

    public init(commandId: String, voteSeq: Int, approve: Bool) {
        self.commandId = commandId
        self.voteSeq = voteSeq
        self.approve = approve
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case commandId
        case voteSeq
        case approve
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        commandId = try container.decode(String.self, forKey: .commandId)
        voteSeq = try container.decode(Int.self, forKey: .voteSeq)
        approve = try container.decode(Bool.self, forKey: .approve)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(voteSeq, forKey: .voteSeq)
        try container.encode(approve, forKey: .approve)
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

/// Emitted only as the immediate successor of a passing checkVoteClosed (PROTOCOL.md §6,
/// §10; D32). Sequenced: an accepted check mutates durable state (the standing marks and
/// the permanent count), so it consumes a `seq` and rides the §7 gap check like cellSet.
/// `wrongCells` lists, ascending, every playable cell whose value fails the comparator at
/// close time; indices only, never values or answers (INV-6), and never empty (the §10
/// gates). `by` is the proposer, the same id checkVoteOpened carried: D32 overturns the
/// earlier wire neutrality and the check is now fully attributed. Decoded tolerantly (a
/// pre-vote server omits it) so a bare puzzleChecked in the rollout window still applies.
/// `at` is stamped by the session adapter from the server clock, like gameCompleted's.
public struct PuzzleCheckedMessage: Sendable, Equatable, Codable {
    public static let wireType = "puzzleChecked"

    public let seq: Int
    public let wrongCells: [Int]
    public let checkCount: Int
    public let by: String?
    public let commandId: String
    public let at: String

    public init(
        seq: Int, wrongCells: [Int], checkCount: Int, by: String? = nil, commandId: String,
        at: String
    ) {
        self.seq = seq
        self.wrongCells = wrongCells
        self.checkCount = checkCount
        self.by = by
        self.commandId = commandId
        self.at = at
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case seq
        case wrongCells
        case checkCount
        case by
        case commandId
        case at
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        seq = try container.decode(Int.self, forKey: .seq)
        wrongCells = try container.decode([Int].self, forKey: .wrongCells)
        checkCount = try container.decode(Int.self, forKey: .checkCount)
        by = try container.decodeIfPresent(String.self, forKey: .by)
        commandId = try container.decode(String.self, forKey: .commandId)
        at = try container.decode(String.self, forKey: .at)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(seq, forKey: .seq)
        try container.encode(wrongCells, forKey: .wrongCells)
        try container.encode(checkCount, forKey: .checkCount)
        try container.encodeIfPresent(by, forKey: .by)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(at, forKey: .at)
    }
}

/// Broadcast for every accepted checkPuzzle (PROTOCOL.md §6, §10; D32): a proposal opened
/// an attributed, timeboxed room vote. Sequenced: it consumes a `seq` and rides the §7 gap
/// check. `by` is the proposer, `electorate` the frozen ascending eligible voters (INV-1),
/// `needed` the carried strict majority floor(E/2)+1, `expiresAt` the absolute timeout, and
/// `commandId` echoes the proposal. A solo electorate passes at open (a checkVoteClosed and
/// puzzleChecked follow in the same command). `at` is adapter-stamped.
public struct CheckVoteOpenedMessage: Sendable, Equatable, Codable {
    public static let wireType = "checkVoteOpened"

    public let seq: Int
    public let by: String
    public let electorate: [String]
    public let needed: Int
    public let expiresAt: String
    public let commandId: String
    public let at: String

    public init(
        seq: Int, by: String, electorate: [String], needed: Int, expiresAt: String,
        commandId: String, at: String
    ) {
        self.seq = seq
        self.by = by
        self.electorate = electorate
        self.needed = needed
        self.expiresAt = expiresAt
        self.commandId = commandId
        self.at = at
    }

    private enum CodingKeys: String, CodingKey {
        case type, seq, by, electorate, needed, expiresAt, commandId, at
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        seq = try container.decode(Int.self, forKey: .seq)
        by = try container.decode(String.self, forKey: .by)
        electorate = try container.decode([String].self, forKey: .electorate)
        needed = try container.decode(Int.self, forKey: .needed)
        expiresAt = try container.decode(String.self, forKey: .expiresAt)
        commandId = try container.decode(String.self, forKey: .commandId)
        at = try container.decode(String.self, forKey: .at)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(seq, forKey: .seq)
        try container.encode(by, forKey: .by)
        try container.encode(electorate, forKey: .electorate)
        try container.encode(needed, forKey: .needed)
        try container.encode(expiresAt, forKey: .expiresAt)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(at, forKey: .at)
    }
}

/// Broadcast for every accepted castCheckVote (PROTOCOL.md §6, §10; D32). Sequenced. `voteSeq`
/// identifies the vote (the checkVoteOpened `seq`), `by` the voter, `approve` the ballot,
/// `commandId` echoes the ballot command. `at` is adapter-stamped.
public struct CheckVoteCastMessage: Sendable, Equatable, Codable {
    public static let wireType = "checkVoteCast"

    public let seq: Int
    public let voteSeq: Int
    public let by: String
    public let approve: Bool
    public let commandId: String
    public let at: String

    public init(
        seq: Int, voteSeq: Int, by: String, approve: Bool, commandId: String, at: String
    ) {
        self.seq = seq
        self.voteSeq = voteSeq
        self.by = by
        self.approve = approve
        self.commandId = commandId
        self.at = at
    }

    private enum CodingKeys: String, CodingKey {
        case type, seq, voteSeq, by, approve, commandId, at
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        seq = try container.decode(Int.self, forKey: .seq)
        voteSeq = try container.decode(Int.self, forKey: .voteSeq)
        by = try container.decode(String.self, forKey: .by)
        approve = try container.decode(Bool.self, forKey: .approve)
        commandId = try container.decode(String.self, forKey: .commandId)
        at = try container.decode(String.self, forKey: .at)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(seq, forKey: .seq)
        try container.encode(voteSeq, forKey: .voteSeq)
        try container.encode(by, forKey: .by)
        try container.encode(approve, forKey: .approve)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(at, forKey: .at)
    }
}

/// Broadcast once when a check vote resolves (PROTOCOL.md §6, §10; D32). Sequenced. `voteSeq`
/// names the vote; `outcome` is `passed`, `failed`, or `cancelled`; `reason` is absent when
/// passed, else REJECTED / EXPIRED (failed) or GRID_BROKEN / TERMINAL (cancelled). A passed
/// close is immediately followed by one puzzleChecked at the next seq. `at` is adapter-stamped.
public struct CheckVoteClosedMessage: Sendable, Equatable, Codable {
    public static let wireType = "checkVoteClosed"

    public let seq: Int
    public let voteSeq: Int
    public let outcome: CheckVoteOutcome
    public let reason: CheckVoteCloseReason?
    public let at: String

    public init(
        seq: Int, voteSeq: Int, outcome: CheckVoteOutcome, reason: CheckVoteCloseReason? = nil,
        at: String
    ) {
        self.seq = seq
        self.voteSeq = voteSeq
        self.outcome = outcome
        self.reason = reason
        self.at = at
    }

    private enum CodingKeys: String, CodingKey {
        case type, seq, voteSeq, outcome, reason, at
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        seq = try container.decode(Int.self, forKey: .seq)
        voteSeq = try container.decode(Int.self, forKey: .voteSeq)
        outcome = try container.decode(CheckVoteOutcome.self, forKey: .outcome)
        reason = try container.decodeIfPresent(CheckVoteCloseReason.self, forKey: .reason)
        at = try container.decode(String.self, forKey: .at)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(seq, forKey: .seq)
        try container.encode(voteSeq, forKey: .voteSeq)
        try container.encode(outcome, forKey: .outcome)
        try container.encodeIfPresent(reason, forKey: .reason)
        try container.encode(at, forKey: .at)
    }
}

/// The outcome of a closed check vote (PROTOCOL.md §10; D32). Raw values are the wire strings.
public enum CheckVoteOutcome: String, Sendable, Equatable, Codable {
    case passed
    case failed
    case cancelled
}

/// The close reason accompanying a non-passing outcome (PROTOCOL.md §10; D32); absent when
/// passed. Raw values are the wire codes.
public enum CheckVoteCloseReason: String, Sendable, Equatable, Codable {
    case rejected = "REJECTED"
    case expired = "EXPIRED"
    case gridBroken = "GRID_BROKEN"
    case terminal = "TERMINAL"
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
    /// The same opaque nullable avatar field the participant carries (PROTOCOL.md
    /// §4, §6), absent-tolerant on the wire so a pre-avatar server still decodes.
    public let avatarUrl: String?
    public let color: String
    public let role: Role

    public init(
        userId: String, displayName: String, avatarUrl: String? = nil,
        color: String, role: Role
    ) {
        self.userId = userId
        self.displayName = displayName
        self.avatarUrl = avatarUrl
        self.color = color
        self.role = role
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case userId
        case displayName
        case avatarUrl
        case color
        case role
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        userId = try container.decode(String.self, forKey: .userId)
        displayName = try container.decode(String.self, forKey: .displayName)
        // Absent or null both read as nil; a present non-string throws (§4 rule).
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        color = try container.decode(String.self, forKey: .color)
        role = try container.decode(Role.self, forKey: .role)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(userId, forKey: .userId)
        try container.encode(displayName, forKey: .displayName)
        try container.encodeIfPresent(avatarUrl, forKey: .avatarUrl)
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

/// Another participant reacted (PROTOCOL.md §6, §9). Relayed on a valid `react`, never
/// echoed to the sender (like `cursor`) and even lighter: the server records nothing,
/// so a reaction never appears in a snapshot (there is no `board.reactions`).
/// Receive-any: a client renders or ignores any well-formed emoji and MUST NOT reject
/// one outside its own send set (§9).
public struct ReactionMessage: Sendable, Equatable, Codable {
    public static let wireType = "reaction"

    public let userId: String
    public let emoji: String
    public let cell: Int

    public init(userId: String, emoji: String, cell: Int) {
        self.userId = userId
        self.emoji = emoji
        self.cell = cell
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case userId
        case emoji
        case cell
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try expectWireType(container, CodingKeys.type, Self.wireType)
        userId = try container.decode(String.self, forKey: .userId)
        emoji = try decodeEmoji(container, CodingKeys.emoji)
        cell = try container.decode(Int.self, forKey: .cell)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireType, forKey: .type)
        try container.encode(userId, forKey: .userId)
        try container.encode(emoji, forKey: .emoji)
        try container.encode(cell, forKey: .cell)
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
    case react(ReactMessage)
    case checkPuzzle(CheckPuzzleMessage)
    case castCheckVote(CastCheckVoteMessage)
    case heartbeat(HeartbeatMessage)
    case requestSync(RequestSyncMessage)

    /// The wire `type` of the wrapped message.
    public var type: String {
        switch self {
        case .hello: return HelloMessage.wireType
        case .placeLetter: return PlaceLetterMessage.wireType
        case .clearCell: return ClearCellMessage.wireType
        case .moveCursor: return MoveCursorMessage.wireType
        case .react: return ReactMessage.wireType
        case .checkPuzzle: return CheckPuzzleMessage.wireType
        case .castCheckVote: return CastCheckVoteMessage.wireType
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
        case ReactMessage.wireType:
            self = .react(try ReactMessage(from: decoder))
        case CheckPuzzleMessage.wireType:
            self = .checkPuzzle(try CheckPuzzleMessage(from: decoder))
        case CastCheckVoteMessage.wireType:
            self = .castCheckVote(try CastCheckVoteMessage(from: decoder))
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
        case .react(let message): try message.encode(to: encoder)
        case .checkPuzzle(let message): try message.encode(to: encoder)
        case .castCheckVote(let message): try message.encode(to: encoder)
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
    case puzzleChecked(PuzzleCheckedMessage)
    case checkVoteOpened(CheckVoteOpenedMessage)
    case checkVoteCast(CheckVoteCastMessage)
    case checkVoteClosed(CheckVoteClosedMessage)
    case gameAbandoned(GameAbandonedMessage)
    // Ephemeral notices: no seq (§6).
    case welcome(WelcomeMessage)
    case sync(SyncMessage)
    case playerConnected(PlayerConnectedMessage)
    case playerDisconnected(PlayerDisconnectedMessage)
    case cursor(CursorMessage)
    case reaction(ReactionMessage)
    case kicked(KickedMessage)
    case error(ErrorMessage)

    /// The wire `type` of the wrapped message.
    public var type: String {
        switch self {
        case .cellSet: return CellSetMessage.wireType
        case .gameCompleted: return GameCompletedMessage.wireType
        case .puzzleChecked: return PuzzleCheckedMessage.wireType
        case .checkVoteOpened: return CheckVoteOpenedMessage.wireType
        case .checkVoteCast: return CheckVoteCastMessage.wireType
        case .checkVoteClosed: return CheckVoteClosedMessage.wireType
        case .gameAbandoned: return GameAbandonedMessage.wireType
        case .welcome: return WelcomeMessage.wireType
        case .sync: return SyncMessage.wireType
        case .playerConnected: return PlayerConnectedMessage.wireType
        case .playerDisconnected: return PlayerDisconnectedMessage.wireType
        case .cursor: return CursorMessage.wireType
        case .reaction: return ReactionMessage.wireType
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
        case .puzzleChecked(let message): return message.seq
        case .checkVoteOpened(let message): return message.seq
        case .checkVoteCast(let message): return message.seq
        case .checkVoteClosed(let message): return message.seq
        case .gameAbandoned(let message): return message.seq
        case .welcome, .sync, .playerConnected, .playerDisconnected, .cursor,
            .reaction, .kicked, .error:
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
        case PuzzleCheckedMessage.wireType:
            self = .puzzleChecked(try PuzzleCheckedMessage(from: decoder))
        case CheckVoteOpenedMessage.wireType:
            self = .checkVoteOpened(try CheckVoteOpenedMessage(from: decoder))
        case CheckVoteCastMessage.wireType:
            self = .checkVoteCast(try CheckVoteCastMessage(from: decoder))
        case CheckVoteClosedMessage.wireType:
            self = .checkVoteClosed(try CheckVoteClosedMessage(from: decoder))
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
        case ReactionMessage.wireType:
            self = .reaction(try ReactionMessage(from: decoder))
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
        case .puzzleChecked(let message): try message.encode(to: encoder)
        case .checkVoteOpened(let message): try message.encode(to: encoder)
        case .checkVoteCast(let message): try message.encode(to: encoder)
        case .checkVoteClosed(let message): try message.encode(to: encoder)
        case .gameAbandoned(let message): try message.encode(to: encoder)
        case .welcome(let message): try message.encode(to: encoder)
        case .sync(let message): try message.encode(to: encoder)
        case .playerConnected(let message): try message.encode(to: encoder)
        case .playerDisconnected(let message): try message.encode(to: encoder)
        case .cursor(let message): try message.encode(to: encoder)
        case .reaction(let message): try message.encode(to: encoder)
        case .kicked(let message): try message.encode(to: encoder)
        case .error(let message): try message.encode(to: encoder)
        }
    }
}
