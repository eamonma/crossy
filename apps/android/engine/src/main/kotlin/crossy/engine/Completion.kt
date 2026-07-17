// Two-phase completion (DESIGN §3, PROTOCOL §10), the Kotlin twin of
// packages/engine/src/completion.ts. The reducer maintains filledCount as a cheap gate; on
// every accepted mutation, while the board is full, the whole board is checked against the
// solution. The check is level-triggered, not edge-triggered: a same-count overwrite re-runs
// it, so a full-but-wrong board corrected in place still completes. Only a full pass emits
// gameCompleted, exactly once (INV-3); a terminal board freezes and rejects further mutations
// (INV-4).
//
// The actor owns this orchestration in production; the engine exposes it here because the
// completion vectors are engine-bound, and it reuses the pure reducer and comparator rather
// than duplicating either.

package crossy.engine

/** The playable-cell count: the cheap filledCount gate compares against this. */
private fun playableCount(state: BoardState): Int =
    state.grid.cols * state.grid.rows - state.grid.blocks.size

/** Does every solution cell hold a value the comparator accepts (DESIGN §5, D12)? */
private fun boardIsCorrect(state: BoardState, solution: Solution): Boolean {
    for ((cell, expected) in solution) {
        val filled = state.cells[cell]
        if (filled?.v == null) return false
        if (!matches(expected, filled.v)) return false
    }
    return true
}

/**
 * Apply one command, then run the level-triggered completion check. On a full and correct board
 * still ongoing, append a gameCompleted at the next seq and mark the state completed. A rejected
 * command, a not-yet-full board, or a full-but-wrong board appends nothing and play continues.
 * A checkPuzzle routes to the check gate instead of the reducer (PROTOCOL §10): it sets no cell,
 * so it can never trigger completion.
 */
fun applyWithCompletion(state: BoardState, command: Command, solution: Solution): CompletionResult {
    // A checkPuzzle branches to the check gate before the reducer ever sees it (PROTOCOL §10); a
    // mutation flows through reduce. The `when` is exhaustive over the sealed Command.
    val result = when (command) {
        is CheckPuzzle -> return checkPuzzle(state, command, solution)
        is MutationCommand -> reduce(state, command)
    }
    val events = result.events.toMutableList<Event>()
    var next = result.state

    if (result.error == null &&
        next.status == Status.ONGOING &&
        next.filledCount == playableCount(next) &&
        boardIsCorrect(next, solution)
    ) {
        val seq = next.seq + 1
        next = next.copy(status = Status.COMPLETED, seq = seq)
        events.add(GameCompleted(seq))
    }

    // A reduce rejection propagates verbatim (empty events, unchanged state, its code); an
    // acceptance leaves error null (INV-2).
    return CompletionResult(events = events, state = next, error = result.error)
}

/**
 * The room check (PROTOCOL §10, D27): legal only while ongoing and full, otherwise
 * GAME_NOT_ONGOING or GRID_NOT_FULL (a rejection consumes no seq; INV-2). An accepted check
 * emits one puzzleChecked carrying every comparator failure ascending; the marks replace any
 * standing set wholesale and the permanent count increments. Completion is level-triggered, so a
 * full and correct board is never ongoing: an accepted check always finds at least one wrong cell.
 */
private fun checkPuzzle(state: BoardState, command: CheckPuzzle, solution: Solution): CompletionResult {
    if (state.status != Status.ONGOING) {
        return CompletionResult(events = emptyList(), state = state, error = RejectionCode.GAME_NOT_ONGOING)
    }
    if (state.filledCount < playableCount(state)) {
        return CompletionResult(events = emptyList(), state = state, error = RejectionCode.GRID_NOT_FULL)
    }

    // Sorted explicitly: wrongCells is normative ascending (PROTOCOL §6), never Map iteration order.
    val wrongCells = mutableListOf<Int>()
    for ((cell, expected) in solution) {
        val filled = state.cells[cell]
        if (filled?.v == null || !matches(expected, filled.v)) wrongCells.add(cell)
    }
    wrongCells.sort()

    val seq = state.seq + 1
    val checkCount = state.checkCount + 1
    val event = PuzzleChecked(
        seq = seq,
        wrongCells = wrongCells,
        checkCount = checkCount,
        commandId = command.commandId,
    )
    return CompletionResult(
        events = listOf(event),
        state = state.copy(seq = seq, checkedWrong = wrongCells.toSet(), checkCount = checkCount),
    )
}
