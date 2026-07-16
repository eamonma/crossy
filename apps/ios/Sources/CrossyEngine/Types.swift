// Engine domain types, the Swift twin of packages/engine/src/types.ts. They describe the
// game as the pure functions see it, with no notion of a socket, a JSON frame, or a
// protocol version. This is the engine's own world (INV-9): CrossyEngine imports nothing,
// so it cannot borrow the wire types from packages/protocol. The apps adapt between the
// two at their boundary, and the shared conformance vectors keep the two type worlds in
// agreement (packages/engine/README.md). These are Swift-native structs and enums, not
// JSON mirrors: the vectors, not a shared schema, are what hold the ports true.

public enum Direction: Sendable {
    case across
    case down
}

public enum Toward: Sendable {
    case forward
    case backward
}

public enum Status: Sendable {
    case ongoing
    case completed
    case abandoned
}

/// A grid's immutable geometry. `blocks` are the black-square cell indices.
public struct Grid: Sendable {
    public let cols: Int
    public let rows: Int
    public let blocks: Set<Int>

    public init(cols: Int, rows: Int, blocks: Set<Int>) {
        self.cols = cols
        self.rows = rows
        self.blocks = blocks
    }
}

/// One board cell: its value (nil when empty) and the last writer (INV-1, PROTOCOL §4).
public struct Cell: Sendable {
    public let value: String?
    public let by: String?

    public init(value: String?, by: String?) {
        self.value = value
        self.by = by
    }
}

/// The board state the reducer threads. `cells` holds only written cells; an absent index
/// is an empty, never-written cell. `filledCount` is maintained so the completion gate
/// stays cheap (DESIGN §3). `checkedWrong` is the standing room-check marks and
/// `checkCount` the permanent accepted-check count (PROTOCOL §10, D27). Value semantics
/// give the immutability the TS `readonly` shapes document.
public struct BoardState: Sendable {
    public let grid: Grid
    public let status: Status
    public let seq: Int
    public let firstFillAt: String?
    public let cells: [Int: Cell]
    public let filledCount: Int
    /// Cells marked wrong by the most recent check whose value has not changed since
    /// (PROTOCOL §10). A set here; the wire and the vectors list it ascending.
    public let checkedWrong: Set<Int>
    /// Total accepted checks, permanent and never reset (PROTOCOL §10, D27).
    public let checkCount: Int

    public init(
        grid: Grid, status: Status, seq: Int, firstFillAt: String?, cells: [Int: Cell],
        filledCount: Int, checkedWrong: Set<Int>, checkCount: Int
    ) {
        self.grid = grid
        self.status = status
        self.seq = seq
        self.firstFillAt = firstFillAt
        self.cells = cells
        self.filledCount = filledCount
        self.checkedWrong = checkedWrong
        self.checkCount = checkCount
    }
}

/// Sparse map of cell index to the cell's full solution string (completion only).
public typealias Solution = [Int: String]

/// A wire command plus the server-side meta the engine receives as plain data (INV-9).
/// `checkPuzzle` carries only its commandId: the check is a neutral room act with no
/// `by` on the wire and no `at` from the engine (PROTOCOL §6, §10; D27).
public enum Command: Sendable {
    case placeLetter(commandId: String, cell: Int, value: String, by: String, at: String)
    case clearCell(commandId: String, cell: Int, by: String, at: String)
    case checkPuzzle(commandId: String)

    public var commandId: String {
        switch self {
        case .placeLetter(let id, _, _, _, _): return id
        case .clearCell(let id, _, _, _): return id
        case .checkPuzzle(let id): return id
        }
    }
}

/// Emitted for every accepted mutation, including overwrites and no-ops (PROTOCOL §6).
public struct CellSet: Sendable {
    public let seq: Int
    public let cell: Int
    public let value: String?
    public let by: String
    public let commandId: String
    public let at: String
}

/// Emitted once, by the completion driver, on a full and correct board (INV-3).
public struct GameCompleted: Sendable {
    public let seq: Int
}

/// Emitted for every accepted checkPuzzle (PROTOCOL §6, §10; D27). `wrongCells` lists,
/// ascending, every playable cell whose value fails the comparator at the moment the
/// check runs; indices only, never values or answers (INV-6). Deliberately no `by`:
/// the check is recorded neutrally and no client can attribute it.
public struct PuzzleChecked: Sendable {
    public let seq: Int
    public let wrongCells: [Int]
    public let checkCount: Int
    public let commandId: String
}

public enum Event: Sendable {
    case cellSet(CellSet)
    case gameCompleted(GameCompleted)
    case puzzleChecked(PuzzleChecked)
}

/// The PROTOCOL §11 rejection codes the reducer can produce. Raw values are the wire codes
/// the vectors pin, so byte-wise comparison over the raw value stays trivial.
public enum RejectionCode: String, Sendable {
    case gameNotOngoing = "GAME_NOT_ONGOING"
    case invalidCell = "INVALID_CELL"
    case invalidValue = "INVALID_VALUE"
    case gridNotFull = "GRID_NOT_FULL"
}

/// A single-command reduce outcome. A rejection carries `error`, an empty `events`, and
/// the unchanged `state` (a rejection consumes no seq; INV-2). An acceptance leaves `error`
/// nil and emits exactly one `cellSet`.
public struct ReduceResult: Sendable {
    public let events: [CellSet]
    public let state: BoardState
    public let error: RejectionCode?
}

/// The completion driver's outcome: the sequenced stream and the next state. A rejected
/// command (a reducer rejection, or checkPuzzle's gates, PROTOCOL §10) carries `error`
/// with empty `events` and the unchanged `state`, the reducer convention (INV-2).
public struct CompletionResult: Sendable {
    public let events: [Event]
    public let state: BoardState
    public let error: RejectionCode?
}
