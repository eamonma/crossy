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
    /// The permanent room-check count, frozen at completion (PROTOCOL.md §4, §10; D27).
    /// Always present from a current server; decoded tolerantly (default 0, the
    /// avatarUrl posture toward additive fields) so a pre-check payload still decodes.
    public let checkCount: Int
    /// `solveTimeSeconds` with idle collapsed: same endpoints, same rounding, minus
    /// every gap of `SITTING_GAP_MS` or more between consecutive cell events, clamped
    /// at 0 (the sittings partition, PROTOCOL.md §4; DESIGN.md D29). Additive
    /// (2026-07-16) and never backfilled: stats frozen before it shipped lack it, so
    /// it stays optional and absence keeps meaning "fall back to `solveTimeSeconds`"
    /// (`headlineSolveSeconds`), never a default that fakes a number.
    public let activeSolveSeconds: Int?
    /// The sittings partition's count (PROTOCOL.md §4; DESIGN.md D29). Additive like
    /// `activeSolveSeconds`: nil from a frozen pre-D29 row, and nil renders exactly
    /// as one sitting does (no context suffix).
    public let sittingCount: Int?

    public init(
        solveTimeSeconds: Int, totalEvents: Int, participantCount: Int, checkCount: Int = 0,
        activeSolveSeconds: Int? = nil, sittingCount: Int? = nil
    ) {
        self.solveTimeSeconds = solveTimeSeconds
        self.totalEvents = totalEvents
        self.participantCount = participantCount
        self.checkCount = checkCount
        self.activeSolveSeconds = activeSolveSeconds
        self.sittingCount = sittingCount
    }

    private enum CodingKeys: String, CodingKey {
        case solveTimeSeconds
        case totalEvents
        case participantCount
        case checkCount
        case activeSolveSeconds
        case sittingCount
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        solveTimeSeconds = try container.decode(Int.self, forKey: .solveTimeSeconds)
        totalEvents = try container.decode(Int.self, forKey: .totalEvents)
        participantCount = try container.decode(Int.self, forKey: .participantCount)
        checkCount = try container.decodeIfPresent(Int.self, forKey: .checkCount) ?? 0
        activeSolveSeconds = try container.decodeIfPresent(Int.self, forKey: .activeSolveSeconds)
        sittingCount = try container.decodeIfPresent(Int.self, forKey: .sittingCount)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(solveTimeSeconds, forKey: .solveTimeSeconds)
        try container.encode(totalEvents, forKey: .totalEvents)
        try container.encode(participantCount, forKey: .participantCount)
        try container.encode(checkCount, forKey: .checkCount)
        // Absent stays absent (unlike checkCount, whose 0 is a real count): a frozen
        // pre-D29 stats row re-encodes without the keys, keeping the round trip honest.
        try container.encodeIfPresent(activeSolveSeconds, forKey: .activeSolveSeconds)
        try container.encodeIfPresent(sittingCount, forKey: .sittingCount)
    }

    /// The headline Time everywhere stats render (owner ruling, DESIGN.md D29;
    /// PROTOCOL.md §4): active time is THE time, and a frozen pre-D29 row falls back
    /// to the wall-clock `solveTimeSeconds` it always showed.
    public var headlineSolveSeconds: Int {
        activeSolveSeconds ?? solveTimeSeconds
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
    /// The standing room-check marks, ascending, `[]` when none stand (PROTOCOL.md §4,
    /// §10; D27). They ride every snapshot, so reconnect and resync heal the marks with
    /// no delta replay. Always present from a current server; decoded tolerantly
    /// (default `[]`, the avatarUrl posture toward additive fields).
    public let checkedWrongCells: [Int]
    /// The game's total accepted checks, `0` before the first; permanent, never reset
    /// (PROTOCOL.md §4, §10; D27). Decoded tolerantly (default 0) like the marks.
    public let checkCount: Int
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
        checkedWrongCells: [Int] = [],
        checkCount: Int = 0,
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
        self.checkedWrongCells = checkedWrongCells
        self.checkCount = checkCount
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
        case checkedWrongCells
        case checkCount
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
        // Absent-tolerant defaults (the avatarUrl posture): a pre-check server's
        // snapshot decodes as unmarked and uncounted; a present non-array/non-int
        // still throws (PROTOCOL.md §4).
        checkedWrongCells = try container.decodeIfPresent([Int].self, forKey: .checkedWrongCells) ?? []
        checkCount = try container.decodeIfPresent(Int.self, forKey: .checkCount) ?? 0
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
        try container.encode(checkedWrongCells, forKey: .checkedWrongCells)
        try container.encode(checkCount, forKey: .checkCount)
        try container.encode(participants, forKey: .participants)
        try container.encode(cursors, forKey: .cursors)
        try container.encode(recentCommandIds, forKey: .recentCommandIds)
        try container.encode(stats, forKey: .stats)
    }
}
