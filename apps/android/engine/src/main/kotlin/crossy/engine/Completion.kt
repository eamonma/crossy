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
 */
fun applyWithCompletion(state: BoardState, command: Command, solution: Solution): CompletionResult {
    val result = reduce(state, command)
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

    return CompletionResult(events = events, state = next)
}
