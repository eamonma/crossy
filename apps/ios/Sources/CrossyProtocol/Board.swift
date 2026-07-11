// The board payload (PROTOCOL.md §4), carried inside `welcome` and `sync`. Twin of
// packages/protocol/src/board.ts. It holds only mutable game state; the puzzle
// (geometry, clues) comes from REST and is immutable per game.
//
// Nullable-and-present discipline: `firstFillAt`, `completedAt`, `abandonedAt`, `stats`,
// and a cell's `v`/`by` are always on the wire, `null` when empty (the §4 example shows
// them explicitly). Synthesized Codable would drop a nil on encode and tolerate a
// missing key on decode, so `Cell` and `Board` write their conformances by hand:
// decode requires the key (allowing null), encode writes an explicit null.

/// A participant's role in a game (DESIGN.md §8). Twin of `Role`.
public enum Role: String, Codable, Sendable, Equatable, CaseIterable {
    case host
    case solver
    case spectator
}

/// Cursor / word orientation (PROTOCOL.md §5). Twin of `Direction`.
public enum Direction: String, Codable, Sendable, Equatable, CaseIterable {
    case across
    case down
}

/// Game lifecycle status (PROTOCOL.md §4). Twin of `GameStatus`.
public enum GameStatus: String, Codable, Sendable, Equatable, CaseIterable {
    case ongoing
    case completed
    case abandoned
}

/// One grid cell's mutable state. `{v:null,by:null}` is a black square or a
/// never-written cell; a cleared cell keeps its clearer as `by` with `v:null`
/// (PROTOCOL.md §4, §6). A filled cell has both. `v` may be a multi-character rebus
/// string.
public struct Cell: Sendable, Equatable, Codable {
    public let v: String?
    public let by: String?

    public init(v: String?, by: String?) {
        self.v = v
        self.by = by
    }

    private enum CodingKeys: String, CodingKey {
        case v
        case by
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // `decode(String?.self)` requires the key to be present (null allowed), matching
        // the TS codec's asNullableString, which fails on a missing key.
        v = try container.decode(String?.self, forKey: .v)
        by = try container.decode(String?.self, forKey: .by)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(v, forKey: .v)
        try container.encode(by, forKey: .by)
    }
}

/// A participant view at snapshot time (PROTOCOL.md §4). Twin of `Participant`.
public struct Participant: Sendable, Equatable, Codable {
    public let userId: String
    public let displayName: String
    /// The opaque, server-resolved avatar URL (PROTOCOL.md §4), nil when the server
    /// has none: a client renders the image when present and falls back to the
    /// initial when it is null, loading, or fails. Absent-tolerant on the wire (the
    /// firstFillAt/commandId posture), unlike the nullable-and-present fields above:
    /// a missing key and an explicit null both read as nil, so a server predating
    /// this field still decodes, and a present non-string still throws.
    public let avatarUrl: String?
    public let color: String
    public let role: Role
    public let connected: Bool

    public init(
        userId: String, displayName: String, avatarUrl: String? = nil,
        color: String, role: Role, connected: Bool
    ) {
        self.userId = userId
        self.displayName = displayName
        self.avatarUrl = avatarUrl
        self.color = color
        self.role = role
        self.connected = connected
    }

    private enum CodingKeys: String, CodingKey {
        case userId
        case displayName
        case avatarUrl
        case color
        case role
        case connected
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userId = try container.decode(String.self, forKey: .userId)
        displayName = try container.decode(String.self, forKey: .displayName)
        // Absent-tolerant: a missing key and an explicit null both read as nil, so a
        // pre-avatar server decodes; a present non-string throws (typeMismatch).
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        color = try container.decode(String.self, forKey: .color)
        role = try container.decode(Role.self, forKey: .role)
        connected = try container.decode(Bool.self, forKey: .connected)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userId, forKey: .userId)
        try container.encode(displayName, forKey: .displayName)
        // Omit-when-nil (the resumeFromSeq/firstFillAt/commandId posture): an absent
        // avatar stays off the wire so a re-encoded pre-avatar snapshot reproduces
        // its fixture byte-for-byte. The field means the same, present-null or
        // absent: no avatar (PROTOCOL.md §4, null is first-class either way).
        try container.encodeIfPresent(avatarUrl, forKey: .avatarUrl)
        try container.encode(color, forKey: .color)
        try container.encode(role, forKey: .role)
        try container.encode(connected, forKey: .connected)
    }
}

/// A cursor position at snapshot time (PROTOCOL.md §4). Best-effort, never sequenced
/// (§9). Twin of `Cursor`.
public struct Cursor: Sendable, Equatable, Codable {
    public let userId: String
    public let cell: Int
    public let direction: Direction

    public init(userId: String, cell: Int, direction: Direction) {
        self.userId = userId
        self.cell = cell
        self.direction = direction
    }
}

/// Completion stats, non-null only when the game is completed (PROTOCOL.md §4). Twin of
/// `Stats`.
public struct Stats: Sendable, Equatable, Codable {
    public let solveTimeSeconds: Int
    public let totalEvents: Int
    public let participantCount: Int

    public init(solveTimeSeconds: Int, totalEvents: Int, participantCount: Int) {
        self.solveTimeSeconds = solveTimeSeconds
        self.totalEvents = totalEvents
        self.participantCount = participantCount
    }
}

/// The full board snapshot (PROTOCOL.md §4). `cells` has length `rows * cols`.
/// `recentCommandIds` is the last K applied `commandId`s for snapshot reconciliation
/// (§8). Reconnect always transfers the whole board; there are no deltas (§1). Twin of
/// `Board`. Timestamps stay `String` (ISO 8601, server clock, §3): the wire type is a
/// string, and parsing to `Date` is a consumer concern, never a codec transform.
public struct Board: Sendable, Equatable, Codable {
    public let seq: Int
    public let status: GameStatus
    public let firstFillAt: String?
    public let completedAt: String?
    public let abandonedAt: String?
    public let cells: [Cell]
    public let participants: [Participant]
    public let cursors: [Cursor]
    public let recentCommandIds: [String]
    public let stats: Stats?

    public init(
        seq: Int,
        status: GameStatus,
        firstFillAt: String?,
        completedAt: String?,
        abandonedAt: String?,
        cells: [Cell],
        participants: [Participant],
        cursors: [Cursor],
        recentCommandIds: [String],
        stats: Stats?
    ) {
        self.seq = seq
        self.status = status
        self.firstFillAt = firstFillAt
        self.completedAt = completedAt
        self.abandonedAt = abandonedAt
        self.cells = cells
        self.participants = participants
        self.cursors = cursors
        self.recentCommandIds = recentCommandIds
        self.stats = stats
    }

    private enum CodingKeys: String, CodingKey {
        case seq
        case status
        case firstFillAt
        case completedAt
        case abandonedAt
        case cells
        case participants
        case cursors
        case recentCommandIds
        case stats
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seq = try container.decode(Int.self, forKey: .seq)
        status = try container.decode(GameStatus.self, forKey: .status)
        firstFillAt = try container.decode(String?.self, forKey: .firstFillAt)
        completedAt = try container.decode(String?.self, forKey: .completedAt)
        abandonedAt = try container.decode(String?.self, forKey: .abandonedAt)
        cells = try container.decode([Cell].self, forKey: .cells)
        participants = try container.decode([Participant].self, forKey: .participants)
        cursors = try container.decode([Cursor].self, forKey: .cursors)
        recentCommandIds = try container.decode([String].self, forKey: .recentCommandIds)
        stats = try container.decode(Stats?.self, forKey: .stats)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(seq, forKey: .seq)
        try container.encode(status, forKey: .status)
        try container.encode(firstFillAt, forKey: .firstFillAt)
        try container.encode(completedAt, forKey: .completedAt)
        try container.encode(abandonedAt, forKey: .abandonedAt)
        try container.encode(cells, forKey: .cells)
        try container.encode(participants, forKey: .participants)
        try container.encode(cursors, forKey: .cursors)
        try container.encode(recentCommandIds, forKey: .recentCommandIds)
        try container.encode(stats, forKey: .stats)
    }
}
