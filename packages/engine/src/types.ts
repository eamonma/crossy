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
 * completion gate stays cheap (DESIGN §3).
 */
export interface BoardState {
  readonly grid: Grid;
  readonly status: Status;
  readonly seq: number;
  readonly firstFillAt: string | null;
  readonly cells: ReadonlyMap<number, Cell>;
  readonly filledCount: number;
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

export type Event = CellSet | GameCompleted;

/** The PROTOCOL §11 rejection codes the reducer can produce. */
export type RejectionCode =
  "GAME_NOT_ONGOING" | "INVALID_CELL" | "INVALID_VALUE";

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

/** The completion driver's outcome: the sequenced stream and the next state. */
export interface CompletionResult {
  readonly events: readonly Event[];
  readonly state: BoardState;
}
