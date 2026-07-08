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
} from "@crossy/engine";
import type {
  Board,
  Cell,
  CellSetMessage,
  ClearCellMessage,
  Participant,
  PlaceLetterMessage,
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

/** An engine `cellSet` event and the wire `cellSet` frame share a shape; copy it across explicitly. */
export function cellSetToWire(event: CellSet): CellSetMessage {
  return {
    type: "cellSet",
    seq: event.seq,
    cell: event.cell,
    value: event.value,
    by: event.by,
    commandId: event.commandId,
    at: event.at,
  };
}

/** Inputs the board payload needs beyond the engine board state. */
export interface BoardExtras {
  readonly participants: readonly Participant[];
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
    seq: state.seq,
    status: state.status,
    firstFillAt: state.firstFillAt,
    completedAt: extras.completedAt,
    abandonedAt: extras.abandonedAt,
    participants: extras.participants,
    cursors: [], // presence is ephemeral and out of this slice (PROTOCOL.md §9)
    recentCommandIds: extras.recentCommandIds,
    stats: extras.stats,
  };
}
