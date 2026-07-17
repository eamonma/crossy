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
    // Named display-name rejections (§12; docs/design/name-onboarding.md §7.2). All 422:
    // the body is well-formed JSON (a malformed body is 400 VALIDATION) but the name
    // violates a domain rule the person can read and fix.
    case nameRequired = "NAME_REQUIRED"
    case nameTooLong = "NAME_TOO_LONG"
    case nameInvalid = "NAME_INVALID"
    // Named reaction-set rejections (§9, §12; DESIGN.md D25), the NAME_* style: a
    // well-formed body whose `reactionSet` violates a rule the person can read and fix.
    case reactionSetLength = "REACTION_SET_LENGTH"
    case reactionSetInvalid = "REACTION_SET_INVALID"
    case reactionSetDuplicate = "REACTION_SET_DUPLICATE"
    // The write window is spent (PATCH /me is rate-limited per user); carries Retry-After.
    case rateLimited = "RATE_LIMITED"

    /// The HTTP status the §12 tables pair with each code.
    public var httpStatus: Int {
        switch self {
        case .unauthorized: return 401
        case .fullAccountRequired, .notParticipant, .denied, .forbidden: return 403
        case .gameNotFound, .puzzleNotFound: return 404
        case .validation: return 400
        case .internalError: return 500
        case .rateLimited: return 429
        case .unsolvableCell, .rebusTooLong, .oversizeGrid, .ambiguousSolution,
            .degenerateGrid, .diagramless, .nameRequired, .nameTooLong, .nameInvalid,
            .reactionSetLength, .reactionSetInvalid, .reactionSetDuplicate:
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
    /// The INV-6-safe puzzle summary on a game row: geometry, display title, and the
    /// black-square silhouette. `mask` is the puzzle's pattern only (§12): an array of
    /// `rows` strings, each `cols` characters of `#` (block) and `.` (playable cell),
    /// derived server-side from geometry and block positions, never the solution (no
    /// letters, numbers, or circles; INV-6 holds). It is the face of the puzzle the
    /// signed-in home paints per room.
    public struct PuzzleRef: Sendable, Equatable, Codable {
        public let puzzleId: String
        public let rows: Int
        public let cols: Int
        public let title: String?
        /// The black-square silhouette, pattern only (§12). Always present and never null
        /// on a current server; additive and optional on the wire (§14), so an older
        /// server that predates the field, or a fixture that carries none, reads as empty
        /// and the client falls back to the bare geometry lattice.
        public let mask: [String]

        public init(puzzleId: String, rows: Int, cols: Int, title: String?, mask: [String]) {
            self.puzzleId = puzzleId
            self.rows = rows
            self.cols = cols
            self.title = title
            self.mask = mask
        }

        private enum CodingKeys: String, CodingKey {
            case puzzleId
            case rows
            case cols
            case title
            case mask
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            puzzleId = try container.decode(String.self, forKey: .puzzleId)
            rows = try container.decode(Int.self, forKey: .rows)
            cols = try container.decode(Int.self, forKey: .cols)
            title = try container.decode(String?.self, forKey: .title)
            // Additive and optional (§14): an older server omits the mask, which reads as
            // empty (the silhouette then falls back to the bare geometry lattice).
            mask = try container.decodeIfPresent([String].self, forKey: .mask) ?? []
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(puzzleId, forKey: .puzzleId)
            try container.encode(rows, forKey: .rows)
            try container.encode(cols, forKey: .cols)
            try container.encode(title, forKey: .title)
            try container.encode(mask, forKey: .mask)
        }
    }

    /// One member on a row (§12): display identity only, the §4 participant's naming.
    /// `name` is the server-resolved display name and never null on the wire (a nameless
    /// mirror reads "former participant" server-side, the same fallback the live roster
    /// shows, DESIGN.md §8). `avatarUrl` is the same opaque nullable field as §4: the
    /// current server writes a mirror NULL as an explicit JSON null, so encode writes
    /// the key back (null included) to keep the fixture round trip wire-honest, and
    /// decode also tolerates an absent key (§14); both read as none. `role` is the
    /// member's seat, so the standing solvers-only filters apply from it alone (a guest
    /// seats spectator; there is NO guest flag on the wire, §12).
    public struct Member: Sendable, Equatable, Codable {
        public let userId: String
        public let name: String
        public let avatarUrl: String?
        public let role: Role

        public init(userId: String, name: String, avatarUrl: String?, role: Role) {
            self.userId = userId
            self.name = name
            self.avatarUrl = avatarUrl
            self.role = role
        }

        private enum CodingKeys: String, CodingKey {
            case userId
            case name
            case avatarUrl
            case role
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            userId = try container.decode(String.self, forKey: .userId)
            name = try container.decode(String.self, forKey: .name)
            avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
            role = try container.decode(Role.self, forKey: .role)
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(userId, forKey: .userId)
            try container.encode(name, forKey: .name)
            // Explicit null when nil: the server always writes the key (jsonb_build_object),
            // so the fixture's explicit nulls survive the lossless round trip.
            try container.encode(avatarUrl, forKey: .avatarUrl)
            try container.encode(role, forKey: .role)
        }
    }

    public let gameId: String
    public let name: String?
    /// The caller's own role in this game.
    public let role: Role
    public let createdAt: String
    public let createdBy: String
    /// Total members (all roles), for the list card; equals `members.count` on a current
    /// server (an older one omits `members`, which reads empty while the count stays true).
    public let memberCount: Int
    /// The full membership as display identity, join-ordered (first joiner first, ties by
    /// userId; §12), so the room-open chrome and the card's stack can be born true at tap
    /// time without a second fetch. Additive and optional on the wire (§14): decoded with
    /// `decodeIfPresent` so an older server that omits it reads as empty, mirroring how
    /// `completedAt`/`lastActivityAt` tolerate absence.
    public let members: [Member]
    /// The game's invite code (§12), on every row under exactly the game view's member-only
    /// rule: the list is member-scoped, so every row's reader is a member. Additive and
    /// optional on the wire (§14): an older server omits it, which reads as none; nil
    /// re-encodes as absent, never null (the server never sends a null code).
    public let inviteCode: String?
    /// When the game completed (ISO 8601), or nil while it is ongoing AND nil for an abandoned
    /// game, which never completed (§12). Read from the session-owned `game_state.completed_at`
    /// under a SELECT-only read grant, never a cell value or a solution: it is a bare timestamp,
    /// so INV-6 is untouched. The one lifecycle fact the home needs today; a full lifecycle
    /// `status` enum is a later additive extension. Additive and optional on the wire (§14):
    /// decoded with `decodeIfPresent` so an older server that omits it still decodes (nil =
    /// ongoing).
    public let completedAt: String?
    /// When a host ended the game (ISO 8601), or nil unless it was abandoned (§12). The twin
    /// terminal timestamp to `completedAt` and mutually exclusive with it: a terminal game is
    /// completed or ended, never both, so a non-nil value shelves the room as ended rather than
    /// leaving it in the live shelf (both nil reads ongoing). A bare timestamp read from the
    /// session-owned `game_state.abandoned_at` under the same SELECT-only grant, so INV-6 is
    /// untouched. Additive and optional on the wire (§14): decoded with `decodeIfPresent` so an
    /// older server that omits it, or sends null, reads as not-ended.
    public let abandonedAt: String?
    /// The game's last activity: the newest board event's ISO 8601 timestamp, or nil when no one
    /// has played yet (§12). `MAX(cell_events.at)` read server-side under a SELECT-only grant,
    /// never a cell value or a solution (INV-6-safe). The list arrives ordered by
    /// `COALESCE(lastActivityAt, createdAt)`, most recent first, so an unplayed game orders by its
    /// creation time rather than sorting last. Additive and optional on the wire (§14): decoded
    /// with `decodeIfPresent` so an older server that omits it still decodes (nil = unplayed).
    public let lastActivityAt: String?
    public let puzzle: PuzzleRef

    public init(
        gameId: String,
        name: String?,
        role: Role,
        createdAt: String,
        createdBy: String,
        memberCount: Int,
        members: [Member],
        inviteCode: String?,
        completedAt: String?,
        abandonedAt: String?,
        lastActivityAt: String?,
        puzzle: PuzzleRef
    ) {
        self.gameId = gameId
        self.name = name
        self.role = role
        self.createdAt = createdAt
        self.createdBy = createdBy
        self.memberCount = memberCount
        self.members = members
        self.inviteCode = inviteCode
        self.completedAt = completedAt
        self.abandonedAt = abandonedAt
        self.lastActivityAt = lastActivityAt
        self.puzzle = puzzle
    }

    private enum CodingKeys: String, CodingKey {
        case gameId
        case name
        case role
        case createdAt
        case createdBy
        case memberCount
        case members
        case inviteCode
        case completedAt
        case abandonedAt
        case lastActivityAt
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
        // Optional and additive (§14): an older server omits the stack, which reads as empty.
        members = try container.decodeIfPresent([Member].self, forKey: .members) ?? []
        // Optional and additive (§14): an older server omits the code, which reads as none.
        inviteCode = try container.decodeIfPresent(String.self, forKey: .inviteCode)
        // Optional and additive (§14): a server that omits it, or sends null, reads as ongoing.
        completedAt = try container.decodeIfPresent(String.self, forKey: .completedAt)
        // Optional and additive (§14): a server that omits it, or sends null, reads as not-ended.
        abandonedAt = try container.decodeIfPresent(String.self, forKey: .abandonedAt)
        // Optional and additive (§14): a server that omits it, or sends null, reads as unplayed.
        lastActivityAt = try container.decodeIfPresent(String.self, forKey: .lastActivityAt)
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
        try container.encode(members, forKey: .members)
        // Absent when nil, never null: the server either sends the code or omits the key.
        try container.encodeIfPresent(inviteCode, forKey: .inviteCode)
        try container.encode(completedAt, forKey: .completedAt)
        try container.encode(abandonedAt, forKey: .abandonedAt)
        try container.encode(lastActivityAt, forKey: .lastActivityAt)
        try container.encode(puzzle, forKey: .puzzle)
    }
}

/// The `GET /games` response body: `{ games, nextBefore }`, most-recently-active first within the
/// page, cursor-paginated (§12; `limit`/`before` are query parameters, not body fields). The page
/// is SELECTED by createdAt but SHOWN by activity, so the visual last row is not the page's oldest
/// createdAt; `nextBefore` is the server-computed next cursor (the page-minimum createdAt), null
/// when the list is exhausted. A client MUST page by `nextBefore`, never by re-deriving a cursor
/// from the reordered rows (§12).
///
/// The field is additive (§14) but its ABSENCE and its NULL mean different things, so decoding
/// tracks presence, not just value. Key present with a value: that is the cursor. Key present and
/// null: the list is exhausted, so there is no next page. Key absent (an older server that predates
/// activity ordering): `hasCursor` is false and the caller falls back to the last row's createdAt,
/// valid there because that server did not reorder the page. `hasCursor` distinguishes present-null
/// (stop) from absent (fall back), which a plain optional cannot.
public struct GamesListResponse: Sendable, Equatable, Codable {
    public let games: [GameSummary]
    /// The next cursor when present; null both when the server sent it as null (exhausted) and
    /// when the server omitted it entirely. Read `hasCursor` to tell those apart.
    public let nextBefore: String?
    /// True when the server included the `nextBefore` key at all (present, value or null). False
    /// only for an older server that omits it. Lets the client honor a present-null as "exhausted"
    /// rather than falling back into a paging loop.
    public let hasCursor: Bool

    public init(games: [GameSummary], nextBefore: String? = nil, hasCursor: Bool = true) {
        self.games = games
        self.nextBefore = nextBefore
        self.hasCursor = hasCursor
    }

    private enum CodingKeys: String, CodingKey {
        case games
        case nextBefore
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        games = try container.decode([GameSummary].self, forKey: .games)
        hasCursor = container.contains(.nextBefore)
        // decodeIfPresent reads a present-null as nil, which is exactly the "exhausted" value; the
        // hasCursor flag above carries whether the key was there at all.
        nextBefore = try container.decodeIfPresent(String.self, forKey: .nextBefore)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(games, forKey: .games)
        // Emit the key when the server would have (hasCursor), preserving present-null vs absent
        // across a decode/encode round trip (the snapshot test relies on this).
        if hasCursor {
            try container.encode(nextBefore, forKey: .nextBefore)
        }
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

/// The `GET /games/{id}/analysis` post-game bundle (§12): the completed surface in one
/// fetch. `owners` is the mosaic's owner map (cell index to owning userId), `momentum`
/// is the room's tempo (a fixed-length peak-normalized curve plus the solve's duration),
/// `moments` are the three named beats, and `titles` are the solver superlatives
/// (design/post-game/TITLES.md). Twin of `AnalysisView`
/// (apps/api/src/archive/analysis.ts).
///
/// Every field carries userIds, cells, and numbers only, so it is INV-6-safe by
/// construction: the type has nowhere to hold a solution value or a raw event, so a leak
/// is a compile error here, never a missed runtime strip. The client already holds the
/// roster (names, colors) from the game view's member data, so this never duplicates
/// identity display.
public struct AnalysisView: Sendable, Equatable, Codable {
    /// The room's tempo (§12). `samples` is a fixed-length 40-bucket curve, each value
    /// peak-normalized into [0, 1]; `durationSeconds` is the solve's wall span. Numbers
    /// only, so INV-6 holds.
    public struct Momentum: Sendable, Equatable, Codable {
        public let durationSeconds: Double
        public let samples: [Double]

        public init(durationSeconds: Double, samples: [Double]) {
            self.durationSeconds = durationSeconds
            self.samples = samples
        }
    }

    /// One named beat (§12): a cell that fell, its owning userId, and when. A cell index
    /// plus a userId plus a number, never a letter, so INV-6 holds.
    public struct Beat: Sendable, Equatable, Codable {
        public let cell: Int
        public let userId: String
        public let atSeconds: Double

        public init(cell: Int, userId: String, atSeconds: Double) {
            self.cell = cell
            self.userId = userId
            self.atSeconds = atSeconds
        }
    }

    /// The pivot (§12): the stall before the break, the break itself, and the burst that
    /// followed, all as timings and a count. Numbers only, so INV-6 holds.
    public struct TurningPoint: Sendable, Equatable, Codable {
        public let stallSeconds: Double
        public let breakSeconds: Double
        public let burst: Int

        public init(stallSeconds: Double, breakSeconds: Double, burst: Int) {
            self.stallSeconds = stallSeconds
            self.breakSeconds = breakSeconds
            self.burst = burst
        }
    }

    /// The three named beats (§12). Each is nullable-and-present on the wire: the server
    /// always writes the key, with an explicit JSON null when the beat is absent (a solve
    /// too short to have one). The Codable conformance is hand-written for the same reason
    /// `GameSummary`'s nullable fields are: decode requires the key (null reads as nil),
    /// and encode emits the explicit null (not `encodeIfPresent`), so a decode/encode
    /// round trip preserves the null wire-honestly.
    public struct Moments: Sendable, Equatable, Codable {
        public let firstToFall: Beat?
        public let lastSquare: Beat?
        public let turningPoint: TurningPoint?

        public init(firstToFall: Beat?, lastSquare: Beat?, turningPoint: TurningPoint?) {
            self.firstToFall = firstToFall
            self.lastSquare = lastSquare
            self.turningPoint = turningPoint
        }

        private enum CodingKeys: String, CodingKey {
            case firstToFall
            case lastSquare
            case turningPoint
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            firstToFall = try container.decodeIfPresent(Beat.self, forKey: .firstToFall)
            lastSquare = try container.decodeIfPresent(Beat.self, forKey: .lastSquare)
            turningPoint = try container.decodeIfPresent(TurningPoint.self, forKey: .turningPoint)
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            // Explicit null when nil: the server always writes the key, so the fixture's
            // explicit nulls survive the lossless round trip.
            try container.encode(firstToFall, forKey: .firstToFall)
            try container.encode(lastSquare, forKey: .lastSquare)
            try container.encode(turningPoint, forKey: .turningPoint)
        }
    }

    /// One solver superlative (§12; design/post-game/TITLES.md): a userId, a
    /// lowercase-kebab title key from the pinned ladder, and the title's own count (or
    /// null for a rung that cites none). Keys and numbers only, never a letter, so INV-6
    /// holds. `title` is deliberately NOT an enum: a client MUST ignore an unknown key
    /// (§12, how the ladder grows without client lockstep), so the twin carries the
    /// string verbatim and the render layer decides what it knows. The Codable
    /// conformance is hand-written for the Moments reason: the server always writes the
    /// `evidence` key (an explicit JSON null when the rung cites nothing), so decode
    /// reads null as nil and encode emits the explicit null, keeping the round trip
    /// wire-honest.
    public struct Title: Sendable, Equatable, Codable {
        public let userId: String
        public let title: String
        public let evidence: Int?

        public init(userId: String, title: String, evidence: Int?) {
            self.userId = userId
            self.title = title
            self.evidence = evidence
        }

        private enum CodingKeys: String, CodingKey {
            case userId
            case title
            case evidence
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            userId = try container.decode(String.self, forKey: .userId)
            title = try container.decode(String.self, forKey: .title)
            evidence = try container.decodeIfPresent(Int.self, forKey: .evidence)
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(userId, forKey: .userId)
            try container.encode(title, forKey: .title)
            // Explicit null when nil: the server always writes the key.
            try container.encode(evidence, forKey: .evidence)
        }
    }

    /// The sittings partition (§12; DESIGN.md D29): `count` sittings, one `spans` entry
    /// per sitting ON THE ACTIVE AXIS (the same axis as `momentum.durationSeconds`, so a
    /// client places ribbon seam ticks by lookup; contiguous, first start 0, last end
    /// the duration), and `wallSeconds`, the wall-clock trace span the pre-D29
    /// `durationSeconds` reported, kept for flavor copy only. Numbers only, so INV-6
    /// holds.
    public struct Sittings: Sendable, Equatable, Codable {
        /// One sitting's reach on the active axis. A sitting holding no trace entry
        /// clamps to a zero-width span at the axis edge (§12), which draws nothing.
        public struct Span: Sendable, Equatable, Codable {
            public let startSeconds: Double
            public let endSeconds: Double

            public init(startSeconds: Double, endSeconds: Double) {
                self.startSeconds = startSeconds
                self.endSeconds = endSeconds
            }
        }

        public let count: Int
        public let spans: [Span]
        public let wallSeconds: Double

        public init(count: Int, spans: [Span], wallSeconds: Double) {
            self.count = count
            self.spans = spans
            self.wallSeconds = wallSeconds
        }
    }

    /// The mosaic owner map (§12): the first-correct owner per solved cell. The wire is a
    /// JSON object whose keys are the cell indices as strings (JSON object keys are always
    /// strings), values the owning userId. Kept as `[String: String]` so the round trip is
    /// lossless; read `ownersByCell` for the integer-keyed view.
    public let owners: [String: String]
    public let momentum: Momentum
    public let moments: Moments
    /// The solver superlatives (§12), ordered by ladder rank: at most one per solver,
    /// at most one per key, empty when fewer than two solvers wrote (the solo rule).
    /// Optional for the `MeResponse.reactionSet` reason: a current server always writes
    /// the key, and the synthesized optional also tolerates an older server that omits
    /// it (§14 additive evolution), which reads the same as no titles at all.
    public let titles: [Title]?
    /// The sittings partition (§12; DESIGN.md D29). Optional for the titles reason: a
    /// client MUST tolerate the field's absence (an older cached bundle) and degrade to
    /// rendering without seams, so the synthesized optional reads an omitted key as nil,
    /// never a decode failure.
    public let sittings: Sittings?

    public init(
        owners: [String: String],
        momentum: Momentum,
        moments: Moments,
        titles: [Title]? = nil,
        sittings: Sittings? = nil
    ) {
        self.owners = owners
        self.momentum = momentum
        self.moments = moments
        self.titles = titles
        self.sittings = sittings
    }

    /// The owner map with its keys parsed back to cell indices. Non-integer keys are
    /// dropped defensively (a current server sends only integer keys), so this is the
    /// map's honest integer-keyed view without ever throwing on a malformed key.
    public var ownersByCell: [Int: String] {
        var result: [Int: String] = [:]
        for (key, userId) in owners {
            if let cell = Int(key) {
                result[cell] = userId
            }
        }
        return result
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

// MARK: - Self display identity (PROTOCOL.md §12: GET /me, PATCH /me)

/// The `GET /me` / `PATCH /me` response: the caller's own display identity, the read the
/// onboarding trigger confirms against and the Settings editor loads from
/// (docs/design/name-onboarding.md §7). Field list per apps/api/src/identity/routes.ts.
///
/// `displayName` is the raw app-DB value and MAY be null: this is the one place a null
/// name crosses the wire on purpose, so a client can detect a nameless account and
/// onboard (the gameplay wire in §4 stays non-null). `needsName` is the server-computed
/// trigger (`!isAnonymous && display_name IS NULL`, R3), the authoritative "are you
/// nameless" answer the client acts on rather than re-deriving. Because `displayName` is
/// an intentional null (not an absent user-content field), its Codable is the default:
/// the key is present with a JSON null the synthesized optional decodes cleanly.
public struct MeResponse: Sendable, Equatable, Codable {
    /// The caller's id (the token `sub`, mirrored). Always present.
    public let userId: String
    /// The app-DB display name, or nil for an account that has not chosen one yet.
    public let displayName: String?
    /// The identity's anonymous flag, so the client can apply the guest rule.
    public let isAnonymous: Bool
    /// The resolved avatar URL for the live puck preview, nil when the server has none.
    public let avatarUrl: String?
    /// The server-computed onboarding trigger: true iff a permanent account is nameless.
    /// Present onboarding iff this is true (R3: the naming policy lives on the server).
    public let needsName: Bool
    /// The caller's personal reaction set: five emoji graphemes in slot order, or nil
    /// for the default five (PROTOCOL.md §9, §12; D25). A current server always writes
    /// the key (null until an account chooses); the synthesized optional also tolerates
    /// an older server that omits it (§14), which reads the same as null: the defaults.
    public let reactionSet: [String]?

    public init(
        userId: String,
        displayName: String?,
        isAnonymous: Bool,
        avatarUrl: String?,
        needsName: Bool,
        reactionSet: [String]? = nil
    ) {
        self.userId = userId
        self.displayName = displayName
        self.isAnonymous = isAnonymous
        self.avatarUrl = avatarUrl
        self.needsName = needsName
        self.reactionSet = reactionSet
    }
}

/// The `PATCH /me` request body: the caller sets their own display name. A single
/// `displayName` field (a partial update of the profile resource), sent verbatim; the
/// server owns canonicalization and validation (§5), so mirroring it in the type would
/// only shadow the contract.
public struct UpdateDisplayNameRequest: Sendable, Equatable, Codable {
    public let displayName: String

    public init(displayName: String) {
        self.displayName = displayName
    }
}

/// The `PATCH /me` request body for the personal reaction set (§9, §12; D25): five
/// graphemes in slot order, or null to reset to the defaults. The Codable is
/// hand-written because null is a VALUE here, not an omission: the server reads a
/// missing `reactionSet` as "nothing to update" (400 VALIDATION on an otherwise empty
/// patch), so encode always writes the key, explicit null included, and decode requires
/// it. The set is sent byte-exact; the server owns validation (the REACTION_SET_* 422s),
/// though `ReactionSetSpec.validate` lets an editor name the same rule at the edge.
public struct UpdateReactionSetRequest: Sendable, Equatable, Codable {
    public let reactionSet: [String]?

    public init(reactionSet: [String]?) {
        self.reactionSet = reactionSet
    }

    private enum CodingKeys: String, CodingKey {
        case reactionSet
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reactionSet = try container.decode([String]?.self, forKey: .reactionSet)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Explicit null when nil: null IS the reset command (§12), never an absence.
        try container.encode(reactionSet, forKey: .reactionSet)
    }
}
