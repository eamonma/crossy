// The reducer: (state, command) -> events + next state, or a rejection (DESIGN §5,
// PROTOCOL §5, §6). Pure and deterministic. Value normalization lives here, not in the
// actor, so both ports stay byte-identical (INV-1). The reducer never emits
// gameCompleted; the completion driver layers that on top (DESIGN §3).

import { asciiUpper } from "./casing";
import type { BoardState, Cell, CellSet, Command, ReduceResult } from "./types";

const VALUE_PATTERN = /^[A-Z0-9]{1,10}$/;

/** ASCII-uppercase then validate against the charset; null means INVALID_VALUE. */
function normalizeValue(raw: string): string | null {
  const upper = asciiUpper(raw);
  return VALUE_PATTERN.test(upper) ? upper : null;
}

function cellCount(state: BoardState): number {
  return state.grid.cols * state.grid.rows;
}

function isPlayable(state: BoardState, cell: number): boolean {
  return (
    Number.isInteger(cell) &&
    cell >= 0 &&
    cell < cellCount(state) &&
    !state.grid.blocks.has(cell)
  );
}

export function reduce(state: BoardState, command: Command): ReduceResult {
  // Validation order follows PROTOCOL §5: terminal state, then cell, then value.
  if (state.status !== "ongoing")
    return { events: [], state, error: "GAME_NOT_ONGOING" };

  if (!isPlayable(state, command.cell))
    return { events: [], state, error: "INVALID_CELL" };

  let value: string | null;
  if (command.type === "placeLetter") {
    const normalized = normalizeValue(command.value);
    if (normalized === null)
      return { events: [], state, error: "INVALID_VALUE" };
    value = normalized;
  } else {
    value = null; // clearCell always sets null (PROTOCOL §5)
  }

  const seq = state.seq + 1;
  const previous = state.cells.get(command.cell);
  const previousValue = previous?.v ?? null;
  const wasFilled = previousValue !== null;
  const nowFilled = value !== null;

  const cells = new Map(state.cells);
  const written: Cell = { v: value, by: command.by };
  cells.set(command.cell, written);

  const filledCount =
    state.filledCount + (nowFilled ? 1 : 0) - (wasFilled ? 1 : 0);

  // firstFillAt is set once, on the first placeLetter (PROTOCOL §4, §6). A clearCell
  // never sets it, and a later fill never moves it.
  const firstFillAt =
    state.firstFillAt === null && command.type === "placeLetter"
      ? command.at
      : state.firstFillAt;

  // A marked cell's check mark clears exactly when its value changes (PROTOCOL §10,
  // D27): a different letter or a clear removes it; a same-value write keeps it, the
  // mark is still true.
  let checkedWrong = state.checkedWrong;
  if (checkedWrong.has(command.cell) && value !== previousValue) {
    const cleared = new Set(checkedWrong);
    cleared.delete(command.cell);
    checkedWrong = cleared;
  }

  const event: CellSet = {
    type: "cellSet",
    seq,
    cell: command.cell,
    value,
    by: command.by,
    commandId: command.commandId,
    at: command.at,
  };

  return {
    events: [event],
    state: { ...state, cells, seq, filledCount, firstFillAt, checkedWrong },
  };
}
