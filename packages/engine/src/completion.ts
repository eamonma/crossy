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
  CastCheckVote,
  CheckProposal,
  CheckPuzzle,
  CheckVote,
  CheckVoteCast,
  CheckVoteClosed,
  CheckVoteOpened,
  Command,
  CompletionResult,
  Event,
  GameCompleted,
  PuzzleChecked,
  Solution,
  VoteCommand,
  VoteEvent,
  VoteResult,
} from "./types";

/** The playable-cell count: the cheap filledCount gate compares against this. */
function playableCount(state: BoardState): number {
  return state.grid.cols * state.grid.rows - state.grid.blocks.size;
}

/** Is the board full (every playable cell filled)? The cheap filledCount gate. */
function isFull(state: BoardState): boolean {
  return state.filledCount === playableCount(state);
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
 * Every comparator failure on the board, ascending (PROTOCOL §6), never Map iteration
 * order. Shared by the legacy immediate check and the passing-vote close.
 */
function comparatorFailures(state: BoardState, solution: Solution): number[] {
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
  return wrongCells;
}

/**
 * The room check (PROTOCOL §10, D27): legal only while ongoing and full, otherwise
 * GAME_NOT_ONGOING or GRID_NOT_FULL (a rejection consumes no seq; INV-2). An accepted
 * check emits one puzzleChecked carrying every comparator failure ascending; the marks
 * replace any standing set wholesale and the permanent count increments. Completion is
 * level-triggered, so a full and correct board is never ongoing: an accepted check
 * always finds at least one wrong cell.
 *
 * This is the legacy immediate path that the session still drives until Wave 15.3; the
 * attributed vote flow (D32) lives in `applyWithVote` below.
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

  const wrongCells = comparatorFailures(state, solution);
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

// --- The attributed check vote (PROTOCOL §10, D32) ---
//
// A checkPuzzle no longer checks immediately: it proposes a check, opening a timeboxed
// majority vote whose passing is the accepted check. The state machine lives beside
// completion because a passing close runs the same comparator over the same solution, and
// a mutation that completes or breaks the grid cancels the open vote. Everything here is
// pure: the electorate arrives frozen on the proposal, expiry arrives as an input, and
// user ids and timestamps are data (INV-9).

/** Strict majority (PROTOCOL §10): floor(E / 2) + 1 approvals close the vote passed. */
function needed(electorate: readonly string[]): number {
  return Math.floor(electorate.length / 2) + 1;
}

/** Add a voter to an ascending-ASCII userId array, returning a new sorted array (INV-1). */
function withVoter(voters: readonly string[], userId: string): string[] {
  return [...voters, userId].sort();
}

/**
 * Close a passing vote (PROTOCOL §10, D32): emit checkVoteClosed (passed), then the
 * puzzleChecked at the next seq, computed against the board **at close time**. The count
 * increments and the marks replace any standing set wholesale; the check is attributed to
 * the proposer (`by`) and carries the proposal's commandId, not the deciding ballot's.
 */
function closePassed(
  state: BoardState,
  vote: CheckVote,
  solution: Solution,
): { events: VoteEvent[]; state: BoardState } {
  const closeSeq = state.seq + 1;
  const closed: CheckVoteClosed = {
    type: "checkVoteClosed",
    seq: closeSeq,
    voteSeq: vote.openedSeq,
    outcome: "passed",
  };
  const wrongCells = comparatorFailures(state, solution);
  const checkedSeq = closeSeq + 1;
  const checkCount = state.checkCount + 1;
  const checked: PuzzleChecked = {
    type: "puzzleChecked",
    seq: checkedSeq,
    wrongCells,
    checkCount,
    by: vote.by,
    commandId: vote.commandId,
  };
  return {
    events: [closed, checked],
    state: {
      ...state,
      seq: checkedSeq,
      checkedWrong: new Set(wrongCells),
      checkCount,
      checkVote: null,
    },
  };
}

/** Close a vote failed REJECTED (PROTOCOL §10, D32): the majority is unreachable. */
function closeRejected(
  state: BoardState,
  vote: CheckVote,
): { events: VoteEvent[]; state: BoardState } {
  const seq = state.seq + 1;
  const closed: CheckVoteClosed = {
    type: "checkVoteClosed",
    seq,
    voteSeq: vote.openedSeq,
    outcome: "failed",
    reason: "REJECTED",
  };
  return { events: [closed], state: { ...state, seq, checkVote: null } };
}

/**
 * Resolve the open vote by tally, at open or after a ballot (PROTOCOL §10, D32). It passes
 * the instant approvals reach `needed` (possibly at open, a solo electorate), fails REJECTED
 * the instant `E - rejections < needed`, and otherwise stays open. Silence is never
 * approval. Appends onto the caller's stream.
 */
function resolveByTally(
  state: BoardState,
  solution: Solution,
): { events: VoteEvent[]; state: BoardState } {
  const vote = state.checkVote;
  if (vote === undefined || vote === null) return { events: [], state };
  const need = needed(vote.electorate);
  if (vote.approvals.length >= need) return closePassed(state, vote, solution);
  if (vote.electorate.length - vote.rejections.length < need)
    return closeRejected(state, vote);
  return { events: [], state };
}

/**
 * Open a vote (PROTOCOL §10, D32). Gates in order: ongoing, grid full, no vote already open
 * (GAME_NOT_ONGOING, GRID_NOT_FULL, VOTE_PENDING; a rejection consumes no seq, INV-2). An
 * acceptance freezes the electorate, opens approvals as [proposer], and emits checkVoteOpened
 * with `needed`; a solo electorate already reaches `needed`, so it passes in the same command.
 */
function openVote(
  state: BoardState,
  command: CheckProposal,
  solution: Solution,
): VoteResult {
  if (state.status !== "ongoing")
    return { events: [], state, error: "GAME_NOT_ONGOING" };
  if (!isFull(state)) return { events: [], state, error: "GRID_NOT_FULL" };
  if (state.checkVote !== undefined && state.checkVote !== null)
    return { events: [], state, error: "VOTE_PENDING" };

  const seq = state.seq + 1;
  const electorate = [...command.electorate].sort();
  const vote: CheckVote = {
    openedSeq: seq,
    by: command.by,
    commandId: command.commandId,
    electorate,
    approvals: [command.by],
    rejections: [],
  };
  const opened: CheckVoteOpened = {
    type: "checkVoteOpened",
    seq,
    by: command.by,
    electorate,
    needed: needed(electorate),
    commandId: command.commandId,
  };
  const resolved = resolveByTally({ ...state, seq, checkVote: vote }, solution);
  return { events: [opened, ...resolved.events], state: resolved.state };
}

/**
 * Cast one immutable ballot (PROTOCOL §10, D32). Gates in order: ongoing, an open vote whose
 * openedSeq equals the ballot's voteSeq (NO_VOTE_OPEN, covering a stale voteSeq too), the
 * sender in the frozen electorate (NOT_ELECTOR), the sender not having voted (ALREADY_VOTED).
 * An acceptance records the ballot, emits checkVoteCast, then resolves by tally.
 */
function castVote(
  state: BoardState,
  command: CastCheckVote,
  solution: Solution,
): VoteResult {
  if (state.status !== "ongoing")
    return { events: [], state, error: "GAME_NOT_ONGOING" };
  const vote = state.checkVote;
  if (vote === undefined || vote === null || vote.openedSeq !== command.voteSeq)
    return { events: [], state, error: "NO_VOTE_OPEN" };
  if (!vote.electorate.includes(command.by))
    return { events: [], state, error: "NOT_ELECTOR" };
  if (
    vote.approvals.includes(command.by) ||
    vote.rejections.includes(command.by)
  )
    return { events: [], state, error: "ALREADY_VOTED" };

  const seq = state.seq + 1;
  const cast: CheckVoteCast = {
    type: "checkVoteCast",
    seq,
    voteSeq: vote.openedSeq,
    by: command.by,
    approve: command.approve,
    commandId: command.commandId,
  };
  const nextVote: CheckVote = command.approve
    ? { ...vote, approvals: withVoter(vote.approvals, command.by) }
    : { ...vote, rejections: withVoter(vote.rejections, command.by) };
  const resolved = resolveByTally(
    { ...state, seq, checkVote: nextVote },
    solution,
  );
  return { events: [cast, ...resolved.events], state: resolved.state };
}

/**
 * Close an open vote on the expiry input (PROTOCOL §10, D32): failed EXPIRED. With no vote
 * open it is a silent no-op (no event, no seq, no error), since the session may race its
 * own timer.
 */
function expireVote(state: BoardState): VoteResult {
  const vote = state.checkVote;
  if (vote === undefined || vote === null) return { events: [], state };
  const seq = state.seq + 1;
  const closed: CheckVoteClosed = {
    type: "checkVoteClosed",
    seq,
    voteSeq: vote.openedSeq,
    outcome: "failed",
    reason: "EXPIRED",
  };
  return { events: [closed], state: { ...state, seq, checkVote: null } };
}

/**
 * Apply a cell mutation, then run completion and vote cancellation (PROTOCOL §10, D32). A
 * mutation that completes the game cancels an open vote TERMINAL between the cellSet and
 * gameCompleted; a clear that breaks the full grid cancels it GRID_BROKEN after the cellSet;
 * any mutation keeping the grid full leaves the vote open, play continues. With no vote
 * open this is exactly the two-phase completion path.
 */
function applyMutationWithVote(
  state: BoardState,
  command: Command,
  solution: Solution,
): VoteResult {
  const result = reduce(state, command);
  if (result.error !== undefined)
    return { events: [], state, error: result.error };

  const events: VoteEvent[] = [...result.events];
  let next = result.state; // reduce preserves checkVote through its spread
  const vote = next.checkVote;
  const willComplete =
    next.status === "ongoing" && isFull(next) && boardIsCorrect(next, solution);

  if (vote !== undefined && vote !== null) {
    if (willComplete) {
      const closeSeq = next.seq + 1;
      const compSeq = closeSeq + 1;
      events.push({
        type: "checkVoteClosed",
        seq: closeSeq,
        voteSeq: vote.openedSeq,
        outcome: "cancelled",
        reason: "TERMINAL",
      });
      events.push({ type: "gameCompleted", seq: compSeq });
      return {
        events,
        state: { ...next, status: "completed", seq: compSeq, checkVote: null },
      };
    }
    if (!isFull(next)) {
      const closeSeq = next.seq + 1;
      events.push({
        type: "checkVoteClosed",
        seq: closeSeq,
        voteSeq: vote.openedSeq,
        outcome: "cancelled",
        reason: "GRID_BROKEN",
      });
      return { events, state: { ...next, seq: closeSeq, checkVote: null } };
    }
    return { events, state: next }; // grid still full, no completion: vote rides
  }

  if (willComplete) {
    const seq = next.seq + 1;
    const completed: GameCompleted = { type: "gameCompleted", seq };
    events.push(completed);
    next = { ...next, status: "completed", seq };
  }
  return { events, state: next };
}

/**
 * The vote driver (PROTOCOL §10, D32). Routes each command: a proposal opens a vote, a
 * ballot resolves it, the expiry input closes it, and a cell mutation runs completion and
 * cancellation. Additive to `applyWithCompletion`: the session keeps the immediate path
 * until Wave 15.3 swaps it here.
 */
export function applyWithVote(
  state: BoardState,
  command: VoteCommand,
  solution: Solution,
): VoteResult {
  switch (command.type) {
    case "checkPuzzle":
      return openVote(state, command, solution);
    case "castCheckVote":
      return castVote(state, command, solution);
    case "expireCheckVote":
      return expireVote(state);
    default:
      return applyMutationWithVote(state, command, solution);
  }
}
