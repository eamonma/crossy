// The WebSocket error-code table (PROTOCOL.md §11). Twin of
// packages/protocol/src/errors.ts. Fatal errors are followed by a `1008` close;
// non-fatal errors carry the offending `commandId` so the client clears its overlay
// entry (§8). `INTERNAL` fatality varies: the wire `error.fatal` is always a concrete
// boolean, while this table records the policy, so `varies` lives here, never on the
// wire.

/// Every protocol error code (PROTOCOL.md §11). Twin of `ErrorCode`. Raw values are the
/// wire strings verbatim (SCREAMING_SNAKE, ASCII).
public enum ErrorCode: String, Codable, Sendable, Equatable, CaseIterable {
    case unauthorized = "UNAUTHORIZED"
    case notParticipant = "NOT_PARTICIPANT"
    case denied = "DENIED"
    case gameNotFound = "GAME_NOT_FOUND"
    case protocolVersionUnsupported = "PROTOCOL_VERSION_UNSUPPORTED"
    case gameNotOngoing = "GAME_NOT_ONGOING"
    case invalidCell = "INVALID_CELL"
    case invalidValue = "INVALID_VALUE"
    case gridNotFull = "GRID_NOT_FULL"
    case roleForbidden = "ROLE_FORBIDDEN"
    case rateLimited = "RATE_LIMITED"
    case unknownType = "UNKNOWN_TYPE"
    case internalError = "INTERNAL"
    // The check-vote rejections (PROTOCOL.md §10, §11; D32), all non-fatal.
    case votePending = "VOTE_PENDING"
    case noVoteOpen = "NO_VOTE_OPEN"
    case notElector = "NOT_ELECTOR"
    case alreadyVoted = "ALREADY_VOTED"
}

/// Fatality classification (PROTOCOL.md §11). `always`/`never` are fixed; `varies` is
/// decided per occurrence (the wire boolean is authoritative for a given frame). Twin of
/// `Fatality` (`boolean | "varies"`), which Swift spells as three cases.
public enum Fatality: Sendable, Equatable {
    case always
    case never
    case varies
}

extension ErrorCode {
    /// The §11 table's fatality column, the policy behind the wire's concrete
    /// `error.fatal` boolean. Twin of `ERROR_CODES[code].fatal`.
    public var fatality: Fatality {
        switch self {
        case .unauthorized, .notParticipant, .denied, .gameNotFound,
            .protocolVersionUnsupported:
            return .always
        case .gameNotOngoing, .invalidCell, .invalidValue, .gridNotFull, .roleForbidden,
            .rateLimited, .unknownType,
            .votePending, .noVoteOpen, .notElector, .alreadyVoted:
            return .never
        case .internalError:
            return .varies
        }
    }
}
