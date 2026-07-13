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
 * cheap (DESIGN §3). A data class gives the value semantics the TS `readonly` shapes document.
 */
data class BoardState(
    val grid: Grid,
    val status: Status,
    val seq: Int,
    val firstFillAt: String?,
    val cells: Map<Int, Cell>,
    val filledCount: Int,
)

/** Sparse map of cell index to the cell's full solution string (completion only). */
typealias Solution = Map<Int, String>

/**
 * A wire command plus the server-side meta the engine receives as plain data (INV-9). The
 * shared members carry the fields both arms hold, so callers read them without a `when`.
 */
sealed interface Command {
    val commandId: String
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
) : Command

data class ClearCell(
    override val commandId: String,
    override val cell: Int,
    override val by: String,
    override val at: String,
) : Command

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

/** The PROTOCOL §11 rejection codes the reducer can produce. `wire` is the code the vectors pin. */
enum class RejectionCode(val wire: String) {
    GAME_NOT_ONGOING("GAME_NOT_ONGOING"),
    INVALID_CELL("INVALID_CELL"),
    INVALID_VALUE("INVALID_VALUE"),
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

/** The completion driver's outcome: the sequenced stream and the next state. */
data class CompletionResult(
    val events: List<Event>,
    val state: BoardState,
)
