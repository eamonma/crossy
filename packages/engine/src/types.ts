// Engine domain types. These describe the game as the pure functions see it, with no
// notion of a socket, a JSON frame, or a protocol version. They are the engine's own
// world (INV-9): packages/engine imports nothing, so it cannot borrow the wire types
// from packages/protocol. The apps adapt between the two at their boundary, and the
// conformance vectors keep the two type worlds in agreement (see README.md).

export type Direction = "across" | "down";
export type Toward = "forward" | "backward";
export type Status = "ongoing" | "completed" | "abandoned";

/** A grid's immutable geometry. `blocks` are the black-square cell indices. */
export interface Grid {
  readonly cols: number;
  readonly rows: number;
  readonly blocks: ReadonlySet<number>;
}

/** One board cell: its value (null when empty) and the last writer (INV-1, PROTOCOL §4). */
export interface Cell {
  readonly v: string | null;
  readonly by: string | null;
}

/**
 * The mutable board state the reducer threads. `cells` holds only written cells; an
 * absent index is an empty, never-written cell. `filledCount` is maintained so the
 * completion gate stays cheap (DESIGN §3). `checkedWrong` is the standing room-check
 * marks and `checkCount` the permanent count of accepted checks (PROTOCOL §10, D32).
 *
 * `checkVote` is the open check vote, null when none (D32). It is optional so the pre-vote
 * board constructors stay valid while the session still holds the immediate-check path
 * (Wave 15.3 wires it through); the vote driver always populates it, and an absent value
 * reads as no vote open.
 */
export interface BoardState {
  readonly grid: Grid;
  readonly status: Status;
  readonly seq: number;
  readonly firstFillAt: string | null;
  readonly cells: ReadonlyMap<number, Cell>;
  readonly filledCount: number;
  readonly checkedWrong: ReadonlySet<number>;
  readonly checkCount: number;
  readonly checkVote?: CheckVote | null;
}

/**
 * The open check vote (PROTOCOL §10, D32), null on BoardState when none is open. The
 * `electorate` is frozen at open; `approvals` and `rejections` are the ascending-ASCII
 * userIds voted each way (INV-1), `approvals` opening as `[by]`. `needed` is not stored: it
 * derives as `floor(electorate.length / 2) + 1`, and the emitted checkVoteOpened carries
 * it. `openedSeq` is the vote's identity (the `voteSeq` a ballot names); `commandId` is the
 * proposal's, carried onto the passing `puzzleChecked` and never asserted in state.
 */
export interface CheckVote {
  readonly openedSeq: number;
  readonly by: string;
  readonly commandId: string;
  readonly electorate: readonly string[];
  readonly approvals: readonly string[];
  readonly rejections: readonly string[];
}

/** Sparse map of cell index to the cell's full solution string (completion only). */
export type Solution = ReadonlyMap<number, string>;

export interface PlaceLetter {
  readonly type: "placeLetter";
  readonly commandId: string;
  readonly cell: number;
  readonly value: string;
  readonly by: string;
  readonly at: string;
}

export interface ClearCell {
  readonly type: "clearCell";
  readonly commandId: string;
  readonly cell: number;
  readonly by: string;
  readonly at: string;
}

export type Command = PlaceLetter | ClearCell;

/**
 * The legacy immediate-check command (PROTOCOL §5, §10; D27), feeding `applyWithCompletion`.
 * The session still routes checks through it until Wave 15.3 swaps it for the vote driver.
 * The attributed vote flow (D32) uses `CheckProposal` instead.
 */
export interface CheckPuzzle {
  readonly type: "checkPuzzle";
  readonly commandId: string;
}

/**
 * A check proposal opens an attributed majority vote rather than checking at once (D32,
 * PROTOCOL §5, §10). The proposer and the frozen ascending electorate arrive as data
 * (INV-9); the session assembles the electorate from live presence. The wire type stays
 * `checkPuzzle`; this is the vote driver's view of it.
 */
export interface CheckProposal {
  readonly type: "checkPuzzle";
  readonly commandId: string;
  readonly by: string;
  readonly electorate: readonly string[];
}

/**
 * One immutable ballot on the open vote (D32, PROTOCOL §5, §10). `voteSeq` names the open
 * vote's `openedSeq`; `approve` is the direction. The sender arrives as data (INV-9).
 */
export interface CastCheckVote {
  readonly type: "castCheckVote";
  readonly commandId: string;
  readonly by: string;
  readonly voteSeq: number;
  readonly approve: boolean;
}

/**
 * The session's timeout tick (D32, PROTOCOL §10). No `commandId`: the session drives expiry
 * as an input when its timer fires, and an expiry with no vote open is a silent no-op.
 */
export interface ExpireCheckVote {
  readonly type: "expireCheckVote";
}

/** Every command the vote driver accepts: the cell mutations plus the three vote commands. */
export type VoteCommand =
  Command | CheckProposal | CastCheckVote | ExpireCheckVote;

/** Emitted for every accepted mutation, including overwrites and no-ops (PROTOCOL §6). */
export interface CellSet {
  readonly type: "cellSet";
  readonly seq: number;
  readonly cell: number;
  readonly value: string | null;
  readonly by: string;
  readonly commandId: string;
  readonly at: string;
}

/** Emitted once, by the completion driver, on a full and correct board (INV-3). */
export interface GameCompleted {
  readonly type: "gameCompleted";
  readonly seq: number;
}

/**
 * Emitted as the immediate successor of a passing vote close (PROTOCOL §6, §10; D32).
 * `wrongCells` is every comparator failure, ascending, computed against the board at close
 * time; the marks replace any standing set wholesale. `by` is the proposer (absent on the
 * legacy immediate path until Wave 15.3). Cell indices and a count only, never values or
 * answers (INV-6).
 */
export interface PuzzleChecked {
  readonly type: "puzzleChecked";
  readonly seq: number;
  readonly wrongCells: readonly number[];
  readonly checkCount: number;
  readonly commandId: string;
  readonly by?: string;
}

/** Broadcast when a proposal opens a vote (PROTOCOL §6, §10; D32). `needed` = floor(E/2)+1. */
export interface CheckVoteOpened {
  readonly type: "checkVoteOpened";
  readonly seq: number;
  readonly by: string;
  readonly electorate: readonly string[];
  readonly needed: number;
  readonly commandId: string;
}

/** Broadcast for every accepted ballot (PROTOCOL §6, §10; D32). `voteSeq` is the vote's identity. */
export interface CheckVoteCast {
  readonly type: "checkVoteCast";
  readonly seq: number;
  readonly voteSeq: number;
  readonly by: string;
  readonly approve: boolean;
  readonly commandId: string;
}

export type CheckVoteOutcome = "passed" | "failed" | "cancelled";

/** The close reason accompanying a non-passing outcome (PROTOCOL §10; D32); absent when passed. */
export type CheckVoteCloseReason =
  "REJECTED" | "EXPIRED" | "GRID_BROKEN" | "TERMINAL";

/**
 * Broadcast when a vote closes (PROTOCOL §6, §10; D32). `reason` is absent when `passed`,
 * else the cause: `REJECTED` (majority unreachable), `EXPIRED` (timebox), `GRID_BROKEN` or
 * `TERMINAL` (a mutation left the state a check needs).
 */
export interface CheckVoteClosed {
  readonly type: "checkVoteClosed";
  readonly seq: number;
  readonly voteSeq: number;
  readonly outcome: CheckVoteOutcome;
  readonly reason?: CheckVoteCloseReason;
}

export type Event = CellSet | GameCompleted | PuzzleChecked;

/** Every event the vote driver emits: the completion stream plus the three vote events. */
export type VoteEvent =
  Event | CheckVoteOpened | CheckVoteCast | CheckVoteClosed;

/** The PROTOCOL §11 rejection codes the reducer and check gate can produce. */
export type RejectionCode =
  "GAME_NOT_ONGOING" | "INVALID_CELL" | "INVALID_VALUE" | "GRID_NOT_FULL";

/** The additional PROTOCOL §11 rejection codes the vote machine produces (D32). */
export type VoteRejectionCode =
  "VOTE_PENDING" | "NO_VOTE_OPEN" | "NOT_ELECTOR" | "ALREADY_VOTED";

/**
 * A single-command reduce outcome. A rejection carries `error`, an empty `events`, and
 * the unchanged `state` (a rejection consumes no seq; INV-2). An acceptance omits
 * `error` and emits exactly one `cellSet`.
 */
export interface ReduceResult {
  readonly events: readonly CellSet[];
  readonly state: BoardState;
  readonly error?: RejectionCode;
}

/**
 * The completion driver's outcome: the sequenced stream and the next state. A
 * rejection carries `error`, an empty `events`, and the unchanged `state`, matching
 * the ReduceResult convention (INV-2).
 */
export interface CompletionResult {
  readonly events: readonly Event[];
  readonly state: BoardState;
  readonly error?: RejectionCode;
}

/**
 * The vote driver's outcome: the sequenced stream (completion plus vote events) and the
 * next state. A rejection carries `error`, an empty `events`, and the unchanged `state`,
 * matching the ReduceResult convention (INV-2). A silent no-op (an expiry with no vote
 * open) carries neither events nor error.
 */
export interface VoteResult {
  readonly events: readonly VoteEvent[];
  readonly state: BoardState;
  readonly error?: RejectionCode | VoteRejectionCode;
}
