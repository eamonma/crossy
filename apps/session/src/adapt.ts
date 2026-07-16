// The adapter ring (DESIGN.md §4, engine README "type ownership"): the session service
// is the one place the wire world (packages/protocol) and the domain world
// (packages/engine) meet. The engine imports nothing and owns its own types, so here we
// translate a decoded wire command into an engine Command and an engine board back into
// the PROTOCOL.md §4 board payload. The board is assembled only from board state and
// ClientPuzzle geometry (rows, cols, blocks); the solution never enters this file, so no
// outbound frame can carry it (INV-6).

import type {
  BoardState,
  Command,
  PlaceLetter,
  ClearCell,
  PuzzleChecked,
} from "@crossy/engine";
import type {
  Board,
  Cell,
  CellSetMessage,
  ClearCellMessage,
  Cursor,
  Participant,
  PlaceLetterMessage,
  PuzzleCheckedEvent,
  Stats,
} from "@crossy/protocol";
import type { CellSet } from "@crossy/engine";

/** A black square or a never-written cell (PROTOCOL.md §4). */
const EMPTY_CELL: Cell = { v: null, by: null };

/** Translate a decoded wire mutation into an engine Command, stamping server identity and clock. */
export function toEngineCommand(
  message: PlaceLetterMessage | ClearCellMessage,
  by: string,
  at: string,
): Command {
  if (message.type === "placeLetter") {
    const command: PlaceLetter = {
      type: "placeLetter",
      commandId: message.commandId,
      cell: message.cell,
      value: message.value,
      by,
      at,
    };
    return command;
  }
  const command: ClearCell = {
    type: "clearCell",
    commandId: message.commandId,
    cell: message.cell,
    by,
    at,
  };
  return command;
}

/**
 * An engine `cellSet` event and the wire `cellSet` frame share a shape; copy it across
 * explicitly. `firstFillAt` is threaded in by the actor only for the single cellSet that
 * establishes the first fill (PROTOCOL.md §6), so an already-connected client starts the
 * shared timer on the delta; every other cellSet omits it.
 */
export function cellSetToWire(
  event: CellSet,
  firstFillAt?: string,
): CellSetMessage {
  const frame: CellSetMessage = {
    type: "cellSet",
    seq: event.seq,
    cell: event.cell,
    value: event.value,
    by: event.by,
    commandId: event.commandId,
    at: event.at,
  };
  return firstFillAt === undefined ? frame : { ...frame, firstFillAt };
}

/**
 * An engine `puzzleChecked` event to the wire frame (PROTOCOL.md §6, §10). The adapter stamps
 * `at` from the server clock, like `gameCompleted`'s. Deliberately no `by`: the wire event is
 * neutral by construction (D27); the actor keeps the sender server-side in check_events only.
 */
export function puzzleCheckedToWire(
  event: PuzzleChecked,
  at: string,
): PuzzleCheckedEvent {
  return {
    type: "puzzleChecked",
    seq: event.seq,
    wrongCells: [...event.wrongCells],
    checkCount: event.checkCount,
    commandId: event.commandId,
    at,
  };
}

/**
 * The standing room-check marks, ascending (PROTOCOL.md §4, §6): the engine's set ordered for
 * the wire board and the persisted snapshot, so both carry one normative shape.
 */
export function checkedWrongAscending(state: BoardState): number[] {
  return [...state.checkedWrong].sort((a, b) => a - b);
}

/** Inputs the board payload needs beyond the engine board state. */
export interface BoardExtras {
  readonly participants: readonly Participant[];
  /** Current cursors of connected users (PROTOCOL.md §9); ephemeral, never from the solution. */
  readonly cursors: readonly Cursor[];
  readonly completedAt: string | null;
  readonly abandonedAt: string | null;
  readonly stats: Stats | null;
  readonly recentCommandIds: readonly string[];
}

/**
 * The full per-cell array for PROTOCOL.md §4 and the game_state.board snapshot: length
 * `rows * cols`, black squares and never-written cells `{v:null, by:null}`, a written cell
 * its last `{v, by}`. The single source for both the wire board and the persisted board,
 * so a rehydrated snapshot is byte-for-byte the board that was flushed (INV-5). Solution
 * data is structurally absent: nothing here reads it (INV-6).
 */
export function boardCells(state: BoardState): Cell[] {
  const total = state.grid.rows * state.grid.cols;
  const cells: Cell[] = new Array<Cell>(total);
  for (let i = 0; i < total; i++) {
    if (state.grid.blocks.has(i)) {
      cells[i] = EMPTY_CELL;
      continue;
    }
    const written = state.cells.get(i);
    cells[i] =
      written === undefined ? EMPTY_CELL : { v: written.v, by: written.by };
  }
  return cells;
}

/**
 * Build the PROTOCOL.md §4 board payload from engine board state plus presence and
 * timing extras.
 */
export function buildBoard(state: BoardState, extras: BoardExtras): Board {
  return {
    cells: boardCells(state),
    // The standing marks and the permanent count ride every snapshot, so reconnect and
    // resync heal the check state with no delta replay (PROTOCOL.md §4, §10).
    checkedWrongCells: checkedWrongAscending(state),
    checkCount: state.checkCount,
    seq: state.seq,
    status: state.status,
    firstFillAt: state.firstFillAt,
    completedAt: extras.completedAt,
    abandonedAt: extras.abandonedAt,
    participants: extras.participants,
    // Presence is ephemeral (never sequenced, never persisted), but the snapshot still carries
    // the current view so a fresh or resyncing client sees who is where (PROTOCOL.md §9).
    cursors: extras.cursors,
    recentCommandIds: extras.recentCommandIds,
    stats: extras.stats,
  };
}
