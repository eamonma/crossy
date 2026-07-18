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
    /// The open check vote, nil when none (PROTOCOL §10, D32). Optional with a nil default so
    /// every pre-vote constructor (the reducer, the completion path, the vector adapter) stays
    /// valid; the vote driver populates it and threads it through mutations. The TS twin makes
    /// `checkVote` optional for the same reason (types.ts).
    public let checkVote: CheckVote?

    public init(
        grid: Grid, status: Status, seq: Int, firstFillAt: String?, cells: [Int: Cell],
        filledCount: Int, checkedWrong: Set<Int>, checkCount: Int, checkVote: CheckVote? = nil
    ) {
        self.grid = grid
        self.status = status
        self.seq = seq
        self.firstFillAt = firstFillAt
        self.cells = cells
        self.filledCount = filledCount
        self.checkedWrong = checkedWrong
        self.checkCount = checkCount
        self.checkVote = checkVote
    }
}

/// The open check vote (PROTOCOL §10, D32), nil on BoardState when none is open, the Swift
/// twin of the TS `CheckVote`. The `electorate` is frozen at open; `approvals` and
/// `rejections` are the ascending-ASCII userIds voted each way (INV-1), `approvals` opening
/// as `[by]`. `needed` is not stored: it derives as `floor(electorate.count / 2) + 1`, and
/// the emitted checkVoteOpened carries it. `openedSeq` is the vote's identity (the `voteSeq`
/// a ballot names); `commandId` is the proposal's, carried onto the passing puzzleChecked.
public struct CheckVote: Sendable, Equatable {
    public let openedSeq: Int
    public let by: String
    public let commandId: String
    public let electorate: [String]
    public let approvals: [String]
    public let rejections: [String]

    public init(
        openedSeq: Int, by: String, commandId: String, electorate: [String],
        approvals: [String], rejections: [String]
    ) {
        self.openedSeq = openedSeq
        self.by = by
        self.commandId = commandId
        self.electorate = electorate
        self.approvals = approvals
        self.rejections = rejections
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

/// Emitted for every accepted checkPuzzle (PROTOCOL §6, §10; D27, D32). `wrongCells` lists,
/// ascending, every playable cell whose value fails the comparator at the moment the
/// check runs; indices only, never values or answers (INV-6). Under the attributed vote
/// flow (D32) `by` is the proposer, carried onto the passing close; nil on the legacy
/// immediate path, where the check was recorded neutrally.
public struct PuzzleChecked: Sendable {
    public let seq: Int
    public let wrongCells: [Int]
    public let checkCount: Int
    public let commandId: String
    public let by: String?

    public init(
        seq: Int, wrongCells: [Int], checkCount: Int, commandId: String, by: String? = nil
    ) {
        self.seq = seq
        self.wrongCells = wrongCells
        self.checkCount = checkCount
        self.commandId = commandId
        self.by = by
    }
}

public enum Event: Sendable {
    case cellSet(CellSet)
    case gameCompleted(GameCompleted)
    case puzzleChecked(PuzzleChecked)
}

/// The PROTOCOL §11 rejection codes the engine can produce. The first four are the
/// reducer's and the check gate's; the last four (D32) are the vote machine's. Raw values
/// are the wire codes the vectors pin, so byte-wise comparison over the raw value stays
/// trivial. The TS twin keeps `RejectionCode` and `VoteRejectionCode` as separate unions;
/// Swift folds them into one raw-value enum since `VoteResult.error` accepts either.
public enum RejectionCode: String, Sendable {
    case gameNotOngoing = "GAME_NOT_ONGOING"
    case invalidCell = "INVALID_CELL"
    case invalidValue = "INVALID_VALUE"
    case gridNotFull = "GRID_NOT_FULL"
    case votePending = "VOTE_PENDING"
    case noVoteOpen = "NO_VOTE_OPEN"
    case notElector = "NOT_ELECTOR"
    case alreadyVoted = "ALREADY_VOTED"
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

// MARK: - The attributed check vote (PROTOCOL §10, D32)

/// Broadcast when a proposal opens a vote (PROTOCOL §6, §10; D32). `needed` = floor(E/2)+1.
public struct CheckVoteOpened: Sendable {
    public let seq: Int
    public let by: String
    public let electorate: [String]
    public let needed: Int
    public let commandId: String
}

/// Broadcast for every accepted ballot (PROTOCOL §6, §10; D32). `voteSeq` is the vote's identity.
public struct CheckVoteCast: Sendable {
    public let seq: Int
    public let voteSeq: Int
    public let by: String
    public let approve: Bool
    public let commandId: String
}

/// The outcome of a closed vote (PROTOCOL §10, D32). Raw values are the wire strings.
public enum CheckVoteOutcome: String, Sendable {
    case passed
    case failed
    case cancelled
}

/// The close reason accompanying a non-passing outcome (PROTOCOL §10, D32); nil when passed.
/// Raw values are the wire codes the vectors pin.
public enum CheckVoteCloseReason: String, Sendable {
    case rejected = "REJECTED"
    case expired = "EXPIRED"
    case gridBroken = "GRID_BROKEN"
    case terminal = "TERMINAL"
}

/// Broadcast when a vote closes (PROTOCOL §6, §10; D32). `reason` is nil when `passed`, else
/// the cause: `REJECTED` (majority unreachable), `EXPIRED` (timebox), `GRID_BROKEN` or
/// `TERMINAL` (a mutation left the state a check needs).
public struct CheckVoteClosed: Sendable {
    public let seq: Int
    public let voteSeq: Int
    public let outcome: CheckVoteOutcome
    public let reason: CheckVoteCloseReason?
}

/// Every event the vote driver emits: the completion stream plus the three vote events, the
/// Swift twin of the TS `VoteEvent` union. A superset of `Event`; the completion cases are
/// duplicated here rather than nesting an `Event` so a single `switch` serializes the stream.
public enum VoteEvent: Sendable {
    case cellSet(CellSet)
    case gameCompleted(GameCompleted)
    case puzzleChecked(PuzzleChecked)
    case checkVoteOpened(CheckVoteOpened)
    case checkVoteCast(CheckVoteCast)
    case checkVoteClosed(CheckVoteClosed)
}

/// Every command the vote driver accepts (PROTOCOL §5, §10; D32): the two cell mutations plus
/// the three vote commands, the Swift twin of the TS `VoteCommand` union. `checkProposal`
/// carries the proposer and the frozen ascending electorate as data (INV-9); the wire type
/// stays `checkPuzzle`, this is the driver's view of it. `expireCheckVote` carries nothing:
/// the session drives expiry as an input when its timer fires.
public enum VoteCommand: Sendable {
    case placeLetter(commandId: String, cell: Int, value: String, by: String, at: String)
    case clearCell(commandId: String, cell: Int, by: String, at: String)
    case checkProposal(commandId: String, by: String, electorate: [String])
    case castCheckVote(commandId: String, by: String, voteSeq: Int, approve: Bool)
    case expireCheckVote
}

/// The vote driver's outcome: the sequenced stream (completion plus vote events) and the next
/// state. A rejection carries `error`, an empty `events`, and the unchanged `state`, the
/// reducer convention (INV-2). A silent no-op (an expiry with no vote open) carries neither
/// events nor error.
public struct VoteResult: Sendable {
    public let events: [VoteEvent]
    public let state: BoardState
    public let error: RejectionCode?

    public init(events: [VoteEvent], state: BoardState, error: RejectionCode? = nil) {
        self.events = events
        self.state = state
        self.error = error
    }
}
