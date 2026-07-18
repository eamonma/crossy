// The WebSocket error-code table (PROTOCOL.md §11). Twin of packages/protocol/src/errors.ts
// and apps/ios Errors.swift. Fatal errors are followed by a `1008` close; non-fatal errors
// carry the offending `commandId` so the client clears its overlay entry (§8). `INTERNAL`
// fatality varies: the wire `error.fatal` is always a concrete boolean, while this table
// records the policy, so `varies` lives here, never on the wire.

package crossy.protocol

import kotlinx.serialization.Serializable

/**
 * Every protocol error code (PROTOCOL.md §11). Twin of `ErrorCode`. The constant names are
 * the wire strings verbatim (SCREAMING_SNAKE, ASCII), so the default enum serialization is
 * the wire encoding; an unknown code fails the decode (a §14 concern), matching the TS
 * `asErrorCode` guard.
 */
@Serializable
public enum class ErrorCode {
    UNAUTHORIZED,
    NOT_PARTICIPANT,
    DENIED,
    GAME_NOT_FOUND,
    PROTOCOL_VERSION_UNSUPPORTED,
    GAME_NOT_ONGOING,
    INVALID_CELL,
    INVALID_VALUE,
    GRID_NOT_FULL,
    VOTE_PENDING,
    NO_VOTE_OPEN,
    NOT_ELECTOR,
    ALREADY_VOTED,
    ROLE_FORBIDDEN,
    RATE_LIMITED,
    UNKNOWN_TYPE,
    INTERNAL,
}

/**
 * Fatality classification (PROTOCOL.md §11). `ALWAYS`/`NEVER` are fixed; `VARIES` is decided
 * per occurrence (the wire boolean is authoritative for a given frame). Twin of `Fatality`
 * (`boolean | "varies"`), which Kotlin spells as three cases.
 */
public enum class Fatality {
    ALWAYS,
    NEVER,
    VARIES,
}

/**
 * The §11 table's fatality column, the policy behind the wire's concrete `error.fatal`
 * boolean. Twin of `ERROR_CODES[code].fatal`.
 */
public val ErrorCode.fatality: Fatality
    get() = when (this) {
        ErrorCode.UNAUTHORIZED,
        ErrorCode.NOT_PARTICIPANT,
        ErrorCode.DENIED,
        ErrorCode.GAME_NOT_FOUND,
        ErrorCode.PROTOCOL_VERSION_UNSUPPORTED,
        -> Fatality.ALWAYS

        ErrorCode.GAME_NOT_ONGOING,
        ErrorCode.INVALID_CELL,
        ErrorCode.INVALID_VALUE,
        ErrorCode.GRID_NOT_FULL,
        ErrorCode.VOTE_PENDING,
        ErrorCode.NO_VOTE_OPEN,
        ErrorCode.NOT_ELECTOR,
        ErrorCode.ALREADY_VOTED,
        ErrorCode.ROLE_FORBIDDEN,
        ErrorCode.RATE_LIMITED,
        ErrorCode.UNKNOWN_TYPE,
        -> Fatality.NEVER

        ErrorCode.INTERNAL -> Fatality.VARIES
    }
