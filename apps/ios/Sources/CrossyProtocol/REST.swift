// The REST companion (PROTOCOL.md §12). The WebSocket carries gameplay only; everything
// else is REST on the core API, bearer-authenticated with the same tokens. PROTOCOL.md
// §12 lists the routes and pins the error vocabulary; the payload field lists are the
// API's own contract (apps/api/src/games/routes.ts, puzzles/routes.ts,
// identity/routes.ts), mirrored here field for field, and the fixtures in
// Tests/CrossyProtocolTests pin them.
//
// Same nullable-and-present discipline as the wire messages: the API serializes
// user-content fields it holds as SQL NULL (`name`, `title`, `author`) as explicit JSON
// nulls, so their Codable conformances are hand-written to require the key on decode
// and write the null on encode. Request bodies a client composes use absent-optional
// (`CreateGameRequest.name`), matching what the routes accept.
//
// Timestamps stay ISO 8601 `String`s, as on the wire (§3): parsing to `Date` is a
// consumer concern. Display metadata (`name`, `title`, `author`) is shown back
// verbatim: never normalized or compared, so INV-1's ASCII-only casing rule does not
// apply to it (§12), and none of it is a solution (INV-6 untouched).

// MARK: - Error envelope (PROTOCOL.md §12)

/// Every REST error code (PROTOCOL.md §12: the general vocabulary plus the named
/// ingestion rejections). Twin of `ApiErrorCode` (apps/api/src/http/errors.ts). Raw
/// values are the stable wire strings a client keys on, never prose.
public enum APIErrorCode: String, Codable, Sendable, Equatable, CaseIterable {
    case unauthorized = "UNAUTHORIZED"
    case fullAccountRequired = "FULL_ACCOUNT_REQUIRED"
    case notParticipant = "NOT_PARTICIPANT"
    case denied = "DENIED"
    case forbidden = "FORBIDDEN"
    case gameNotFound = "GAME_NOT_FOUND"
    case puzzleNotFound = "PUZZLE_NOT_FOUND"
    case validation = "VALIDATION"
    case internalError = "INTERNAL"
    // Named puzzle-ingestion rejections (§12; DESIGN.md §7, SP5). All 422.
    case unsolvableCell = "UNSOLVABLE_CELL"
    case rebusTooLong = "REBUS_TOO_LONG"
    case oversizeGrid = "OVERSIZE_GRID"
    case ambiguousSolution = "AMBIGUOUS_SOLUTION"
    case degenerateGrid = "DEGENERATE_GRID"
    case diagramless = "DIAGRAMLESS"

    /// The HTTP status the §12 tables pair with each code.
    public var httpStatus: Int {
        switch self {
        case .unauthorized: return 401
        case .fullAccountRequired, .notParticipant, .denied, .forbidden: return 403
        case .gameNotFound, .puzzleNotFound: return 404
        case .validation: return 400
        case .internalError: return 500
        case .unsolvableCell, .rebusTooLong, .oversizeGrid, .ambiguousSolution,
            .degenerateGrid, .diagramless:
            return 422
        }
    }
}

/// The §12 error body: `{ error, message }` plus the matching HTTP status. `error` stays
/// a `String` so a code added to the vocabulary later (§12 names barred/uniclue as
/// codeless today, and `GET /games` `status` as a planned additive extension) degrades
/// to an unrecognized-but-present code instead of a decode failure; `code` is the typed
/// view, nil exactly when the string is outside the current vocabulary.
public struct APIErrorEnvelope: Sendable, Equatable, Codable {
    /// The stable code string, always present.
    public let error: String
    public let message: String

    /// The typed code, nil for a code this client does not know.
    public var code: APIErrorCode? { APIErrorCode(rawValue: error) }

    public init(error: String, message: String) {
        self.error = error
        self.message = message
    }

    public init(code: APIErrorCode, message: String) {
        self.error = code.rawValue
        self.message = message
    }
}

// MARK: - Puzzles (PROTOCOL.md §12: POST /puzzles, GET /puzzles)

/// The `POST /puzzles` (201) response: the ingested puzzle's id and its client view.
/// `puzzle` is `ClientPuzzle`: no solution field, structurally (INV-6). Twin of
/// `PuzzleView` (apps/api/src/puzzles/routes.ts). The request body is not modeled here:
/// it is a third-party XWord Info document owned by ingestion's ACL (§12: the full
/// puzzle schema is "ingestion's to pin"), which a client uploads verbatim.
public struct PuzzleView: Sendable, Equatable, Codable {
    public let puzzleId: String
    public let puzzle: ClientPuzzle

    public init(puzzleId: String, puzzle: ClientPuzzle) {
        self.puzzleId = puzzleId
        self.puzzle = puzzle
    }
}

/// Detected feature flags stored with a puzzle (DESIGN.md §7, §9), surfaced on
/// `GET /puzzles` rows. Twin of `PuzzleFeatures` (apps/api/src/puzzles/ingest.ts);
/// PROTOCOL.md §12 lists the field without pinning its shape, so the ACL's is mirrored.
public struct PuzzleFeatures: Sendable, Equatable, Codable {
    /// At least one solution cell holds a multi-character rebus answer.
    public let rebus: Bool
    /// At least one circled cell (structural overlay, no gameplay effect).
    public let circles: Bool
    /// At least one shaded-circle cell (a render variant of a circle).
    public let shadedCircles: Bool

    public init(rebus: Bool, circles: Bool, shadedCircles: Bool) {
        self.rebus = rebus
        self.circles = circles
        self.shadedCircles = shadedCircles
    }
}

/// One row of `GET /puzzles` (§12): a puzzle the caller uploaded, geometry only, no
/// solution (INV-6). `title`/`author` are display metadata, null when the document
/// carried none. Twin of `PuzzleSummary` (apps/api/src/puzzles/routes.ts).
public struct PuzzleSummary: Sendable, Equatable, Codable {
    public let puzzleId: String
    public let createdAt: String
    public let rows: Int
    public let cols: Int
    public let features: PuzzleFeatures
    public let title: String?
    public let author: String?

    public init(
        puzzleId: String,
        createdAt: String,
        rows: Int,
        cols: Int,
        features: PuzzleFeatures,
        title: String?,
        author: String?
    ) {
        self.puzzleId = puzzleId
        self.createdAt = createdAt
        self.rows = rows
        self.cols = cols
        self.features = features
        self.title = title
        self.author = author
    }

    private enum CodingKeys: String, CodingKey {
        case puzzleId
        case createdAt
        case rows
        case cols
        case features
        case title
        case author
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        puzzleId = try container.decode(String.self, forKey: .puzzleId)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        rows = try container.decode(Int.self, forKey: .rows)
        cols = try container.decode(Int.self, forKey: .cols)
        features = try container.decode(PuzzleFeatures.self, forKey: .features)
        title = try container.decode(String?.self, forKey: .title)
        author = try container.decode(String?.self, forKey: .author)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(puzzleId, forKey: .puzzleId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(rows, forKey: .rows)
        try container.encode(cols, forKey: .cols)
        try container.encode(features, forKey: .features)
        try container.encode(title, forKey: .title)
        try container.encode(author, forKey: .author)
    }
}

/// The `GET /puzzles` response body: `{ puzzles }`, newest first, cursor-paginated
/// (§12: `limit` clamped to [1, 100], `before` an ISO 8601 `createdAt`; both are query
/// parameters, not body fields).
public struct PuzzlesListResponse: Sendable, Equatable, Codable {
    public let puzzles: [PuzzleSummary]

    public init(puzzles: [PuzzleSummary]) {
        self.puzzles = puzzles
    }
}

// MARK: - Games (PROTOCOL.md §12: POST /games, GET /games, joins, view, lifecycle)

/// The `POST /games` request: `{puzzleId, name?}` (§12). `name` is an optional display
/// label (trimmed and capped server-side at 80 chars; absent, null, or empty all read
/// as unnamed), so absent-optional encoding is exact.
public struct CreateGameRequest: Sendable, Equatable, Codable {
    public let puzzleId: String
    public let name: String?

    public init(puzzleId: String, name: String? = nil) {
        self.puzzleId = puzzleId
        self.name = name
    }
}

/// The `POST /games` (201) response (§12: "returns the game, its invite code, and the
/// `name`"). Field list per apps/api/src/games/routes.ts; `name` is nullable-and-present
/// (null when unnamed), and the creator is seated `host`.
public struct CreateGameResponse: Sendable, Equatable, Codable {
    public let gameId: String
    public let inviteCode: String
    public let puzzleId: String
    public let name: String?
    public let createdBy: String
    public let role: Role

    public init(
        gameId: String,
        inviteCode: String,
        puzzleId: String,
        name: String?,
        createdBy: String,
        role: Role
    ) {
        self.gameId = gameId
        self.inviteCode = inviteCode
        self.puzzleId = puzzleId
        self.name = name
        self.createdBy = createdBy
        self.role = role
    }

    private enum CodingKeys: String, CodingKey {
        case gameId
        case inviteCode
        case puzzleId
        case name
        case createdBy
        case role
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        gameId = try container.decode(String.self, forKey: .gameId)
        inviteCode = try container.decode(String.self, forKey: .inviteCode)
        puzzleId = try container.decode(String.self, forKey: .puzzleId)
        name = try container.decode(String?.self, forKey: .name)
        createdBy = try container.decode(String.self, forKey: .createdBy)
        role = try container.decode(Role.self, forKey: .role)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(gameId, forKey: .gameId)
        try container.encode(inviteCode, forKey: .inviteCode)
        try container.encode(puzzleId, forKey: .puzzleId)
        try container.encode(name, forKey: .name)
        try container.encode(createdBy, forKey: .createdBy)
        try container.encode(role, forKey: .role)
    }
}

/// One row of `GET /games` (§12): a game the caller is a member of. Deliberately no
/// lifecycle `status` (session-owned `game_state`; a planned additive extension) and no
/// board. `puzzle` carries only INV-6-safe geometry plus the display `title`. Twin of
/// `GameSummary` (apps/api/src/games/routes.ts).
public struct GameSummary: Sendable, Equatable, Codable {
    /// The INV-6-safe puzzle summary on a game row: geometry and display title only.
    public struct PuzzleRef: Sendable, Equatable, Codable {
        public let puzzleId: String
        public let rows: Int
        public let cols: Int
        public let title: String?

        public init(puzzleId: String, rows: Int, cols: Int, title: String?) {
            self.puzzleId = puzzleId
            self.rows = rows
            self.cols = cols
            self.title = title
        }

        private enum CodingKeys: String, CodingKey {
            case puzzleId
            case rows
            case cols
            case title
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            puzzleId = try container.decode(String.self, forKey: .puzzleId)
            rows = try container.decode(Int.self, forKey: .rows)
            cols = try container.decode(Int.self, forKey: .cols)
            title = try container.decode(String?.self, forKey: .title)
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(puzzleId, forKey: .puzzleId)
            try container.encode(rows, forKey: .rows)
            try container.encode(cols, forKey: .cols)
            try container.encode(title, forKey: .title)
        }
    }

    public let gameId: String
    public let name: String?
    /// The caller's own role in this game.
    public let role: Role
    public let createdAt: String
    public let createdBy: String
    /// Total members (all roles), for the list card.
    public let memberCount: Int
    public let puzzle: PuzzleRef

    public init(
        gameId: String,
        name: String?,
        role: Role,
        createdAt: String,
        createdBy: String,
        memberCount: Int,
        puzzle: PuzzleRef
    ) {
        self.gameId = gameId
        self.name = name
        self.role = role
        self.createdAt = createdAt
        self.createdBy = createdBy
        self.memberCount = memberCount
        self.puzzle = puzzle
    }

    private enum CodingKeys: String, CodingKey {
        case gameId
        case name
        case role
        case createdAt
        case createdBy
        case memberCount
        case puzzle
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        gameId = try container.decode(String.self, forKey: .gameId)
        name = try container.decode(String?.self, forKey: .name)
        role = try container.decode(Role.self, forKey: .role)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        createdBy = try container.decode(String.self, forKey: .createdBy)
        memberCount = try container.decode(Int.self, forKey: .memberCount)
        puzzle = try container.decode(PuzzleRef.self, forKey: .puzzle)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(gameId, forKey: .gameId)
        try container.encode(name, forKey: .name)
        try container.encode(role, forKey: .role)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(createdBy, forKey: .createdBy)
        try container.encode(memberCount, forKey: .memberCount)
        try container.encode(puzzle, forKey: .puzzle)
    }
}

/// The `GET /games` response body: `{ games }`, newest first, cursor-paginated (§12;
/// `limit`/`before` are query parameters, not body fields).
public struct GamesListResponse: Sendable, Equatable, Codable {
    public let games: [GameSummary]

    public init(games: [GameSummary]) {
        self.games = games
    }
}

/// The request body of both joins (§12): `POST /games/join` (code alone; the code is
/// the lookup key) and `POST /games/{id}/join` (code as capability for a known id).
public struct JoinGameRequest: Sendable, Equatable, Codable {
    public let code: String

    public init(code: String) {
        self.code = code
    }
}

/// The `{gameId, role, userId}` membership result (§12), shared verbatim by
/// `POST /games/join`, `POST /games/{id}/join`, and `POST /games/{id}/role`: the two
/// joins seat with identical semantics, and the role upgrade returns the same shape.
public struct GameMembershipResponse: Sendable, Equatable, Codable {
    public let gameId: String
    public let userId: String
    public let role: Role

    public init(gameId: String, userId: String, role: Role) {
        self.gameId = gameId
        self.userId = userId
        self.role = role
    }
}

/// The optional `POST /games/{id}/role` request body (§12). The only supported upgrade
/// is spectator to solver; an absent body means the same thing, and any other target
/// role is a server-side VALIDATION.
public struct RoleChangeRequest: Sendable, Equatable, Codable {
    public let role: Role

    public init(role: Role) {
        self.role = role
    }
}

/// The `DELETE /games/{id}/members/{userId}` (kick) response (§12): the game and the
/// removed member (apps/api/src/games/routes.ts).
public struct KickResponse: Sendable, Equatable, Codable {
    public let gameId: String
    public let removed: String

    public init(gameId: String, removed: String) {
        self.gameId = gameId
        self.removed = removed
    }
}

/// The `POST /games/{id}/abandon` response (§12): the game settles into its terminal
/// state via the session service.
public struct AbandonResponse: Sendable, Equatable, Codable {
    public let gameId: String
    public let status: GameStatus

    public init(gameId: String, status: GameStatus) {
        self.gameId = gameId
        self.status = status
    }
}

/// The `GET /games/{id}` view (§12): solution-stripped puzzle, membership, session
/// endpoint, the optional `name`, and the member-only `inviteCode`. Twin of `GameView`
/// (apps/api/src/games/routes.ts).
public struct GameView: Sendable, Equatable, Codable {
    /// One membership row on the view.
    public struct Member: Sendable, Equatable, Codable {
        public let userId: String
        public let role: Role
        public let joinedAt: String
        /// The same opaque nullable avatar field the participant carries (PROTOCOL.md
        /// §4, §12). Synthesized Codable already handles a trailing optional the way
        /// the field needs: absent or null decodes to nil, a present non-string
        /// throws, and encode omits it when nil, so a pre-avatar `GET /games/{id}`
        /// still decodes and re-encodes byte-for-byte.
        public let avatarUrl: String?

        public init(userId: String, role: Role, joinedAt: String, avatarUrl: String? = nil) {
            self.userId = userId
            self.role = role
            self.joinedAt = joinedAt
            self.avatarUrl = avatarUrl
        }
    }

    /// Where to open the game's WebSocket (§2: `wss://{session-host}/games/{gameId}/ws`).
    public struct SessionEndpoint: Sendable, Equatable, Codable {
        public let ws: String

        public init(ws: String) {
            self.ws = ws
        }
    }

    public let gameId: String
    public let createdBy: String
    public let createdAt: String
    /// Optional room display name (user content); null for an unnamed game.
    public let name: String?
    /// Returned only to members (any role: every member joined via it).
    public let inviteCode: String
    /// `ClientPuzzle`: solution-stripped by type (INV-6).
    public let puzzle: ClientPuzzle
    public let members: [Member]
    public let session: SessionEndpoint

    public init(
        gameId: String,
        createdBy: String,
        createdAt: String,
        name: String?,
        inviteCode: String,
        puzzle: ClientPuzzle,
        members: [Member],
        session: SessionEndpoint
    ) {
        self.gameId = gameId
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.name = name
        self.inviteCode = inviteCode
        self.puzzle = puzzle
        self.members = members
        self.session = session
    }

    private enum CodingKeys: String, CodingKey {
        case gameId
        case createdBy
        case createdAt
        case name
        case inviteCode
        case puzzle
        case members
        case session
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        gameId = try container.decode(String.self, forKey: .gameId)
        createdBy = try container.decode(String.self, forKey: .createdBy)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        name = try container.decode(String?.self, forKey: .name)
        inviteCode = try container.decode(String.self, forKey: .inviteCode)
        puzzle = try container.decode(ClientPuzzle.self, forKey: .puzzle)
        members = try container.decode([Member].self, forKey: .members)
        session = try container.decode(SessionEndpoint.self, forKey: .session)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(gameId, forKey: .gameId)
        try container.encode(createdBy, forKey: .createdBy)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(name, forKey: .name)
        try container.encode(inviteCode, forKey: .inviteCode)
        try container.encode(puzzle, forKey: .puzzle)
        try container.encode(members, forKey: .members)
        try container.encode(session, forKey: .session)
    }
}

// MARK: - Account (PROTOCOL.md §12: DELETE /account)

/// The `DELETE /account` response: the caller's own account is tombstoned, with host
/// succession or auto-abandon per hosted game (§12; DESIGN.md §8). Field list per
/// apps/api/src/identity/routes.ts: `successions` counts games handed to a new host,
/// `abandoned` lists games auto-abandoned because no eligible successor remained.
public struct DeleteAccountResponse: Sendable, Equatable, Codable {
    public let userId: String
    public let tombstoned: Bool
    public let successions: Int
    public let abandoned: [String]
    public let vendorDeleted: Bool

    public init(
        userId: String,
        tombstoned: Bool,
        successions: Int,
        abandoned: [String],
        vendorDeleted: Bool
    ) {
        self.userId = userId
        self.tombstoned = tombstoned
        self.successions = successions
        self.abandoned = abandoned
        self.vendorDeleted = vendorDeleted
    }
}
