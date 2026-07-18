// Engine domain types, the Kotlin twin of packages/engine/src/types.ts and
// apps/ios/Sources/CrossyEngine/Types.swift. They describe the game as the pure functions
// see it, with no notion of a socket, a JSON frame, or a protocol version. This is the
// engine's own world (INV-9): :engine imports nothing, so it cannot borrow the wire types
// from :protocol. The apps adapt between the two at their boundary, and the shared
// conformance vectors keep the type worlds in agreement (vectors/README.md). These are
// idiomatic Kotlin data classes and enums, not JSON mirrors: the vectors, not a shared
// schema, are what hold the ports true.

package crossy.engine

/** Word axis. `wire` is the vector token, so serialization stays a byte-wise round trip. */
enum class Direction(val wire: String) {
    ACROSS("across"),
    DOWN("down"),
}

enum class Toward {
    FORWARD,
    BACKWARD,
}

/** `wire` is the PROTOCOL §4 status token the vectors pin. */
enum class Status(val wire: String) {
    ONGOING("ongoing"),
    COMPLETED("completed"),
    ABANDONED("abandoned"),
}

/** A grid's immutable geometry. `blocks` are the black-square cell indices. */
data class Grid(val cols: Int, val rows: Int, val blocks: Set<Int>)

/** One board cell: its value (null when empty) and the last writer (INV-1, PROTOCOL §4). */
data class Cell(val v: String?, val by: String?)

/**
 * The board state the reducer threads. `cells` holds only written cells; an absent index is
 * an empty, never-written cell. `filledCount` is maintained so the completion gate stays
 * cheap (DESIGN §3). `checkedWrong` is the standing room-check marks and `checkCount` the
 * permanent accepted-check count (PROTOCOL §10, D32). A data class gives the value semantics
 * the TS `readonly` shapes document.
 */
data class BoardState(
    val grid: Grid,
    val status: Status,
    val seq: Int,
    val firstFillAt: String?,
    val cells: Map<Int, Cell>,
    val filledCount: Int,
    /**
     * Cells marked wrong by the most recent check whose value has not changed since (PROTOCOL
     * §10). A set here; the wire and the vectors list it ascending. Defaults empty.
     */
    val checkedWrong: Set<Int> = emptySet(),
    /** Total accepted checks, permanent and never reset (PROTOCOL §10, D32). Defaults 0. */
    val checkCount: Int = 0,
    /**
     * The open check vote, null when none (PROTOCOL §10, D32). Optional with a null default so
     * the pre-vote board constructors and the immediate-check path stay valid; the vote driver
     * populates it, and an absent value reads as no vote open, exactly as the TS `checkVote?`.
     */
    val checkVote: CheckVote? = null,
)

/**
 * The open check vote (PROTOCOL §10, D32), null on BoardState when none is open. The Kotlin twin
 * of the TS `CheckVote`. `electorate` is frozen at open; `approvals` and `rejections` are the
 * ascending-ASCII userIds voted each way (INV-1), `approvals` opening as `[by]`. `needed` is not
 * stored: it derives as `floor(electorate.size / 2) + 1`. `openedSeq` is the vote's identity (the
 * `voteSeq` a ballot names); `commandId` is the proposal's, carried onto the passing puzzleChecked.
 */
data class CheckVote(
    val openedSeq: Int,
    val by: String,
    val commandId: String,
    val electorate: List<String>,
    val approvals: List<String>,
    val rejections: List<String>,
)

/** Sparse map of cell index to the cell's full solution string (completion only). */
typealias Solution = Map<Int, String>

/**
 * A wire command plus the server-side meta the engine receives as plain data (INV-9). Every
 * command carries a `commandId`; only the cell mutations carry cell/by/at, so the room check
 * is a sibling without them (PROTOCOL §5, §10; the TS `Command | CheckPuzzle` union).
 */
sealed interface Command {
    val commandId: String
}

/**
 * A cell mutation (placeLetter or clearCell). The shared members carry the fields both arms
 * hold, so callers read them without a `when`. This is the reducer's input type: `reduce`
 * takes only mutations, so a `CheckPuzzle` can never reach it (the completion driver branches
 * first, PROTOCOL §10, exactly as TS `reduce` takes `Command`).
 *
 * A mutation is also a [VoteCommand]: the vote driver routes it to the mutation-with-cancellation
 * path, so `applyWithVote` accepts the same cell writes the completion driver does (D32).
 */
sealed interface MutationCommand : Command, VoteCommand {
    val cell: Int
    val by: String
    val at: String
}

data class PlaceLetter(
    override val commandId: String,
    override val cell: Int,
    val value: String,
    override val by: String,
    override val at: String,
) : MutationCommand

data class ClearCell(
    override val commandId: String,
    override val cell: Int,
    override val by: String,
    override val at: String,
) : MutationCommand

/**
 * The room-check command (PROTOCOL §5, §10; D27). Only a `commandId`: no `by` and no `at`, so
 * the wire event is neutral by construction and the adapter stamps `at`; the actor keeps the
 * sender off the wire. The completion driver, never the reducer, owns its gates and event.
 */
data class CheckPuzzle(override val commandId: String) : Command

// --- The attributed check vote commands (PROTOCOL §5, §10; D32) ---

/**
 * Every command the vote driver accepts: the cell mutations plus the three vote commands, the
 * Kotlin twin of the TS `VoteCommand`. A closed set: `applyWithVote`'s `when` is exhaustive over
 * [MutationCommand], [CheckProposal], [CastCheckVote], [ExpireCheckVote].
 */
sealed interface VoteCommand

/**
 * A check proposal opens an attributed majority vote rather than checking at once (PROTOCOL §5,
 * §10; D32). The wire type stays `checkPuzzle`; this is the vote driver's view of it. The proposer
 * and the frozen ascending electorate arrive as data (INV-9); the session assembles the electorate
 * from live presence. The twin of the TS `CheckProposal`.
 */
data class CheckProposal(
    val commandId: String,
    val by: String,
    val electorate: List<String>,
) : VoteCommand

/**
 * One immutable ballot on the open vote (PROTOCOL §5, §10; D32). `voteSeq` names the open vote's
 * `openedSeq`; `approve` is the direction. The sender arrives as data (INV-9). Twin of the TS
 * `CastCheckVote`.
 */
data class CastCheckVote(
    val commandId: String,
    val by: String,
    val voteSeq: Int,
    val approve: Boolean,
) : VoteCommand

/**
 * The session's timeout tick (PROTOCOL §10, D32). No `commandId`: the session drives expiry as an
 * input when its timer fires, and an expiry with no vote open is a silent no-op. Twin of the TS
 * `ExpireCheckVote`; a singleton because it carries no data.
 */
data object ExpireCheckVote : VoteCommand

/** The event kinds the engine sequences. `CellSet` is also a `ReduceResult` event on its own. */
sealed interface Event

/** Emitted for every accepted mutation, including overwrites and no-ops (PROTOCOL §6). */
data class CellSet(
    val seq: Int,
    val cell: Int,
    val value: String?,
    val by: String,
    val commandId: String,
    val at: String,
) : Event

/** Emitted once, by the completion driver, on a full and correct board (INV-3). */
data class GameCompleted(val seq: Int) : Event

/**
 * Emitted as the immediate successor of a passing vote close (PROTOCOL §6, §10; D32). `wrongCells`
 * lists, ascending, every playable cell whose value fails the comparator at close time; indices
 * only, never values or answers (INV-6). `by` is the proposer (D32 overturns the earlier wire
 * neutrality); it is null only on the legacy immediate path (`applyWithCompletion`).
 */
data class PuzzleChecked(
    val seq: Int,
    val wrongCells: List<Int>,
    val checkCount: Int,
    val commandId: String,
    val by: String? = null,
) : Event

/** A vote's terminal outcome (PROTOCOL §6, §10; D32). `wire` is the pinned token. */
enum class CheckVoteOutcome(val wire: String) {
    PASSED("passed"),
    FAILED("failed"),
    CANCELLED("cancelled"),
}

/**
 * The close reason on a non-passing outcome (PROTOCOL §10; D32); null when passed. `wire` is the
 * pinned token: REJECTED/EXPIRED accompany `failed`, GRID_BROKEN/TERMINAL accompany `cancelled`.
 */
enum class CheckVoteCloseReason(val wire: String) {
    REJECTED("REJECTED"),
    EXPIRED("EXPIRED"),
    GRID_BROKEN("GRID_BROKEN"),
    TERMINAL("TERMINAL"),
}

/** Broadcast when a proposal opens a vote (PROTOCOL §6, §10; D32). `needed` = floor(E/2)+1. */
data class CheckVoteOpened(
    val seq: Int,
    val by: String,
    val electorate: List<String>,
    val needed: Int,
    val commandId: String,
) : Event

/** Broadcast for every accepted ballot (PROTOCOL §6, §10; D32). `voteSeq` is the vote's identity. */
data class CheckVoteCast(
    val seq: Int,
    val voteSeq: Int,
    val by: String,
    val approve: Boolean,
    val commandId: String,
) : Event

/**
 * Broadcast when a vote closes (PROTOCOL §6, §10; D32). `reason` is null when `passed`. A passing
 * close is immediately followed by one puzzleChecked at the next seq (same command processing).
 */
data class CheckVoteClosed(
    val seq: Int,
    val voteSeq: Int,
    val outcome: CheckVoteOutcome,
    val reason: CheckVoteCloseReason? = null,
) : Event

/**
 * The PROTOCOL §11 rejection codes the reducer, check gate, and vote machine can produce. `wire`
 * is the pinned code. The last four are the vote codes (D32); the engine holds them in one enum
 * (the TS splits `RejectionCode` and `VoteRejectionCode`, but a single code space serializes
 * uniformly and the vectors are the truth, not the TS type split).
 */
enum class RejectionCode(val wire: String) {
    GAME_NOT_ONGOING("GAME_NOT_ONGOING"),
    INVALID_CELL("INVALID_CELL"),
    INVALID_VALUE("INVALID_VALUE"),
    GRID_NOT_FULL("GRID_NOT_FULL"),
    VOTE_PENDING("VOTE_PENDING"),
    NO_VOTE_OPEN("NO_VOTE_OPEN"),
    NOT_ELECTOR("NOT_ELECTOR"),
    ALREADY_VOTED("ALREADY_VOTED"),
}

/**
 * A single-command reduce outcome. A rejection carries `error`, an empty `events`, and the
 * unchanged `state` (a rejection consumes no seq; INV-2). An acceptance leaves `error` null
 * and emits exactly one `cellSet`.
 */
data class ReduceResult(
    val events: List<CellSet>,
    val state: BoardState,
    val error: RejectionCode? = null,
)

/**
 * The completion driver's outcome: the sequenced stream and the next state. A rejected command
 * (a reducer rejection, or checkPuzzle's gates, PROTOCOL §10) carries `error` with empty `events`
 * and the unchanged `state`, the reducer convention (INV-2).
 */
data class CompletionResult(
    val events: List<Event>,
    val state: BoardState,
    val error: RejectionCode? = null,
)

/**
 * The vote driver's outcome (PROTOCOL §10, D32): the sequenced stream (completion plus vote events)
 * and the next state. A rejection carries `error`, an empty `events`, and the unchanged `state`,
 * matching the ReduceResult convention (INV-2). A silent no-op (an expiry with no vote open) carries
 * neither events nor error. Twin of the TS `VoteResult`.
 */
data class VoteResult(
    val events: List<Event>,
    val state: BoardState,
    val error: RejectionCode? = null,
)
