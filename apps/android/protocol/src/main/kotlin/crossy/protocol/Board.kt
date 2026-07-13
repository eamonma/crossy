// The board payload (PROTOCOL.md §4), carried inside `welcome` and `sync`. Twin of
// packages/protocol/src/board.ts and apps/ios Board.swift. It holds only mutable game
// state; the puzzle (geometry, clues) comes from REST and is immutable per game.
//
// Nullable-and-present discipline: `firstFillAt`, `completedAt`, `abandonedAt`, `stats`,
// and a cell's `v`/`by` are always on the wire, null when empty (the §4 example writes
// them explicitly). They are nullable fields with NO default, so the key is required on
// decode and an explicit null is written on encode. `avatarUrl` is the one absent-optional
// field here: a null default, so an absent key decodes to null and a null re-encodes absent.

package crossy.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A participant's role in a game (DESIGN.md §8). Twin of `Role`. */
@Serializable
public enum class Role {
    @SerialName("host") HOST,
    @SerialName("solver") SOLVER,
    @SerialName("spectator") SPECTATOR,
}

/** Cursor / word orientation (PROTOCOL.md §5). Twin of `Direction`. */
@Serializable
public enum class Direction {
    @SerialName("across") ACROSS,
    @SerialName("down") DOWN,
}

/** Game lifecycle status (PROTOCOL.md §4). Twin of `GameStatus`. */
@Serializable
public enum class GameStatus {
    @SerialName("ongoing") ONGOING,
    @SerialName("completed") COMPLETED,
    @SerialName("abandoned") ABANDONED,
}

/**
 * One grid cell's mutable state. `{v:null,by:null}` is a black square or a never-written
 * cell; a cleared cell keeps its clearer as `by` with `v:null` (PROTOCOL.md §4, §6). A
 * filled cell has both. `v` may be a multi-character rebus string. Twin of `Cell`.
 *
 * `v` and `by` are nullable-and-present: no default, so the key is required on decode
 * (matching the TS codec's `asNullableString`, which fails on a missing key) and an
 * explicit null is written on encode.
 */
@Serializable
public data class Cell(
    val v: String?,
    val by: String?,
)

/**
 * A participant view at snapshot time (PROTOCOL.md §4). Twin of `Participant`. `avatarUrl`
 * is the opaque, server-resolved avatar URL, null when the server has none: a client renders
 * the image when present and falls back to the initial when it is null, loading, or fails.
 * Absent-tolerant on the wire (a null default), unlike the nullable-and-present fields above:
 * a missing key and an explicit null both read as null, so a pre-avatar server still decodes,
 * a present non-string still fails the decode, and a null re-encodes to an absent key.
 */
@Serializable
public data class Participant(
    val userId: String,
    val displayName: String,
    val color: String,
    val role: Role,
    val connected: Boolean,
    val avatarUrl: String? = null,
)

/** A cursor position at snapshot time (PROTOCOL.md §4). Best-effort, never sequenced (§9). Twin of `Cursor`. */
@Serializable
public data class Cursor(
    val userId: String,
    val cell: Int,
    val direction: Direction,
)

/** Completion stats, non-null only when the game is completed (PROTOCOL.md §4). Twin of `Stats`. */
@Serializable
public data class Stats(
    val solveTimeSeconds: Int,
    val totalEvents: Int,
    val participantCount: Int,
)

/**
 * The full board snapshot (PROTOCOL.md §4). `cells` has length `rows * cols`.
 * `recentCommandIds` is the last K applied `commandId`s for snapshot reconciliation (§8).
 * Reconnect always transfers the whole board; there are no deltas (§1). Twin of `Board`.
 * Timestamps stay `String` (ISO 8601, server clock, §3): the wire type is a string, and
 * parsing to a date is a consumer concern, never a codec transform.
 */
@Serializable
public data class Board(
    val seq: Int,
    val status: GameStatus,
    val firstFillAt: String?,
    val completedAt: String?,
    val abandonedAt: String?,
    val cells: List<Cell>,
    val participants: List<Participant>,
    val cursors: List<Cursor>,
    val recentCommandIds: List<String>,
    val stats: Stats?,
)
