// Two-phase completion (DESIGN §3, PROTOCOL §10). The reducer maintains filledCount as
// a cheap gate; on every accepted mutation, while the board is full, the whole board is
// checked against the solution. The check is level-triggered, not edge-triggered: a
// same-count overwrite re-runs it, so a full-but-wrong board corrected in place still
// completes. Only a full pass emits gameCompleted, exactly once (INV-3); a terminal
// board freezes and rejects further mutations (INV-4).
//
// The actor owns this orchestration in production; the engine exposes it here because
// the completion vectors are engine-bound, and it reuses the pure reducer and
// comparator rather than duplicating either.

import { matches } from "./comparator";
import { reduce } from "./reducer";
import type {
  BoardState,
  CheckPuzzle,
  Command,
  CompletionResult,
  Event,
  GameCompleted,
  PuzzleChecked,
  Solution,
} from "./types";

/** The playable-cell count: the cheap filledCount gate compares against this. */
function playableCount(state: BoardState): number {
  return state.grid.cols * state.grid.rows - state.grid.blocks.size;
}

/** Does every solution cell hold a value the comparator accepts (DESIGN §5, D12)? */
function boardIsCorrect(state: BoardState, solution: Solution): boolean {
  for (const [cell, expected] of solution) {
    const filled = state.cells.get(cell);
    if (filled === undefined || filled.v === null) return false;
    if (!matches(expected, filled.v)) return false;
  }
  return true;
}

/**
 * The room check (PROTOCOL §10, D27): legal only while ongoing and full, otherwise
 * GAME_NOT_ONGOING or GRID_NOT_FULL (a rejection consumes no seq; INV-2). An accepted
 * check emits one puzzleChecked carrying every comparator failure ascending; the marks
 * replace any standing set wholesale and the permanent count increments. Completion is
 * level-triggered, so a full and correct board is never ongoing: an accepted check
 * always finds at least one wrong cell.
 */
function checkPuzzle(
  state: BoardState,
  command: CheckPuzzle,
  solution: Solution,
): CompletionResult {
  if (state.status !== "ongoing")
    return { events: [], state, error: "GAME_NOT_ONGOING" };
  if (state.filledCount < playableCount(state))
    return { events: [], state, error: "GRID_NOT_FULL" };

  // Sorted explicitly: wrongCells is normative ascending (PROTOCOL §6), never Map
  // iteration order.
  const wrongCells: number[] = [];
  for (const [cell, expected] of solution) {
    const filled = state.cells.get(cell);
    if (
      filled === undefined ||
      filled.v === null ||
      !matches(expected, filled.v)
    )
      wrongCells.push(cell);
  }
  wrongCells.sort((a, b) => a - b);

  const seq = state.seq + 1;
  const checkCount = state.checkCount + 1;
  const event: PuzzleChecked = {
    type: "puzzleChecked",
    seq,
    wrongCells,
    checkCount,
    commandId: command.commandId,
  };
  return {
    events: [event],
    state: { ...state, seq, checkedWrong: new Set(wrongCells), checkCount },
  };
}

/**
 * Apply one command, then run the level-triggered completion check. On a full and
 * correct board still ongoing, append a gameCompleted at the next seq and mark the
 * state completed. A rejected command, a not-yet-full board, or a full-but-wrong board
 * appends nothing and play continues. A checkPuzzle routes to the check gate instead
 * of the reducer (PROTOCOL §10): it sets no cell, so it can never trigger completion.
 */
export function applyWithCompletion(
  state: BoardState,
  command: Command | CheckPuzzle,
  solution: Solution,
): CompletionResult {
  if (command.type === "checkPuzzle")
    return checkPuzzle(state, command, solution);

  const result = reduce(state, command);
  const events: Event[] = [...result.events];
  let next = result.state;

  if (
    result.error === undefined &&
    next.status === "ongoing" &&
    next.filledCount === playableCount(next) &&
    boardIsCorrect(next, solution)
  ) {
    const seq = next.seq + 1;
    const completed: GameCompleted = { type: "gameCompleted", seq };
    next = { ...next, status: "completed", seq };
    events.push(completed);
  }

  return result.error === undefined
    ? { events, state: next }
    : { events, state: next, error: result.error };
}
