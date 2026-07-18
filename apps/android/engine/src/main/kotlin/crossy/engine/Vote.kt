// The attributed check vote (PROTOCOL §10, D32), the Kotlin twin of the vote half of
// packages/engine/src/completion.ts (`applyWithVote` and its helpers). A checkPuzzle no longer
// checks immediately: it proposes a check, opening a timeboxed majority vote whose passing is the
// accepted check. The state machine lives beside completion because a passing close runs the same
// comparator over the same solution, and a mutation that completes or breaks the grid cancels the
// open vote. Everything here is pure: the electorate arrives frozen on the proposal, expiry arrives
// as an input, and user ids and timestamps are data (INV-9).

package crossy.engine

/** The playable-cell count: the cheap filledCount gate compares against this. */
private fun votePlayableCount(state: BoardState): Int =
    state.grid.cols * state.grid.rows - state.grid.blocks.size

/** Is the board full (every playable cell filled)? The cheap filledCount gate. */
private fun voteIsFull(state: BoardState): Boolean =
    state.filledCount == votePlayableCount(state)

/** Does every solution cell hold a value the comparator accepts (DESIGN §5, D12)? */
private fun voteBoardIsCorrect(state: BoardState, solution: Solution): Boolean {
    for ((cell, expected) in solution) {
        val filled = state.cells[cell]
        if (filled?.v == null) return false
        if (!matches(expected, filled.v)) return false
    }
    return true
}

/**
 * Every comparator failure on the board, ascending (PROTOCOL §6), never Map iteration order. The
 * passing-vote close computes wrongCells against the board at close time with this.
 */
private fun voteComparatorFailures(state: BoardState, solution: Solution): List<Int> {
    val wrongCells = mutableListOf<Int>()
    for ((cell, expected) in solution) {
        val filled = state.cells[cell]
        if (filled?.v == null || !matches(expected, filled.v)) wrongCells.add(cell)
    }
    wrongCells.sort()
    return wrongCells
}

/** Strict majority (PROTOCOL §10): floor(E / 2) + 1 approvals close the vote passed. */
private fun needed(electorate: List<String>): Int = electorate.size / 2 + 1

/** Add a voter to an ascending-ASCII userId list, returning a new sorted list (INV-1). */
private fun withVoter(voters: List<String>, userId: String): List<String> =
    (voters + userId).sorted()

/**
 * Close a passing vote (PROTOCOL §10, D32): emit checkVoteClosed (passed), then the puzzleChecked at
 * the next seq, computed against the board **at close time**. The count increments and the marks
 * replace any standing set wholesale; the check is attributed to the proposer (`by`) and carries the
 * proposal's commandId, not the deciding ballot's.
 */
private fun closePassed(
    state: BoardState,
    vote: CheckVote,
    solution: Solution,
): Pair<List<Event>, BoardState> {
    val closeSeq = state.seq + 1
    val closed = CheckVoteClosed(
        seq = closeSeq,
        voteSeq = vote.openedSeq,
        outcome = CheckVoteOutcome.PASSED,
    )
    val wrongCells = voteComparatorFailures(state, solution)
    val checkedSeq = closeSeq + 1
    val checkCount = state.checkCount + 1
    val checked = PuzzleChecked(
        seq = checkedSeq,
        wrongCells = wrongCells,
        checkCount = checkCount,
        commandId = vote.commandId,
        by = vote.by,
    )
    return listOf<Event>(closed, checked) to state.copy(
        seq = checkedSeq,
        checkedWrong = wrongCells.toSet(),
        checkCount = checkCount,
        checkVote = null,
    )
}

/** Close a vote failed REJECTED (PROTOCOL §10, D32): the majority is unreachable. */
private fun closeRejected(state: BoardState, vote: CheckVote): Pair<List<Event>, BoardState> {
    val seq = state.seq + 1
    val closed = CheckVoteClosed(
        seq = seq,
        voteSeq = vote.openedSeq,
        outcome = CheckVoteOutcome.FAILED,
        reason = CheckVoteCloseReason.REJECTED,
    )
    return listOf<Event>(closed) to state.copy(seq = seq, checkVote = null)
}

/**
 * Resolve the open vote by tally, at open or after a ballot (PROTOCOL §10, D32). It passes the
 * instant approvals reach `needed` (possibly at open, a solo electorate), fails REJECTED the instant
 * `E - rejections < needed`, and otherwise stays open. Silence is never approval.
 */
private fun resolveByTally(state: BoardState, solution: Solution): Pair<List<Event>, BoardState> {
    val vote = state.checkVote ?: return emptyList<Event>() to state
    val need = needed(vote.electorate)
    if (vote.approvals.size >= need) return closePassed(state, vote, solution)
    if (vote.electorate.size - vote.rejections.size < need) return closeRejected(state, vote)
    return emptyList<Event>() to state
}

/**
 * Open a vote (PROTOCOL §10, D32). Gates in order: ongoing, grid full, no vote already open
 * (GAME_NOT_ONGOING, GRID_NOT_FULL, VOTE_PENDING; a rejection consumes no seq, INV-2). An acceptance
 * freezes the electorate, opens approvals as [proposer], and emits checkVoteOpened with `needed`; a
 * solo electorate already reaches `needed`, so it passes in the same command.
 */
private fun openVote(state: BoardState, command: CheckProposal, solution: Solution): VoteResult {
    if (state.status != Status.ONGOING) {
        return VoteResult(events = emptyList(), state = state, error = RejectionCode.GAME_NOT_ONGOING)
    }
    if (!voteIsFull(state)) {
        return VoteResult(events = emptyList(), state = state, error = RejectionCode.GRID_NOT_FULL)
    }
    if (state.checkVote != null) {
        return VoteResult(events = emptyList(), state = state, error = RejectionCode.VOTE_PENDING)
    }

    val seq = state.seq + 1
    val electorate = command.electorate.sorted()
    val vote = CheckVote(
        openedSeq = seq,
        by = command.by,
        commandId = command.commandId,
        electorate = electorate,
        approvals = listOf(command.by),
        rejections = emptyList(),
    )
    val opened = CheckVoteOpened(
        seq = seq,
        by = command.by,
        electorate = electorate,
        needed = needed(electorate),
        commandId = command.commandId,
    )
    val (resolvedEvents, resolvedState) =
        resolveByTally(state.copy(seq = seq, checkVote = vote), solution)
    return VoteResult(events = listOf<Event>(opened) + resolvedEvents, state = resolvedState)
}

/**
 * Cast one immutable ballot (PROTOCOL §10, D32). Gates in order: ongoing, an open vote whose
 * openedSeq equals the ballot's voteSeq (NO_VOTE_OPEN, covering a stale voteSeq too), the sender in
 * the frozen electorate (NOT_ELECTOR), the sender not having voted (ALREADY_VOTED). An acceptance
 * records the ballot, emits checkVoteCast, then resolves by tally.
 */
private fun castVote(state: BoardState, command: CastCheckVote, solution: Solution): VoteResult {
    if (state.status != Status.ONGOING) {
        return VoteResult(events = emptyList(), state = state, error = RejectionCode.GAME_NOT_ONGOING)
    }
    val vote = state.checkVote
    if (vote == null || vote.openedSeq != command.voteSeq) {
        return VoteResult(events = emptyList(), state = state, error = RejectionCode.NO_VOTE_OPEN)
    }
    if (command.by !in vote.electorate) {
        return VoteResult(events = emptyList(), state = state, error = RejectionCode.NOT_ELECTOR)
    }
    if (command.by in vote.approvals || command.by in vote.rejections) {
        return VoteResult(events = emptyList(), state = state, error = RejectionCode.ALREADY_VOTED)
    }

    val seq = state.seq + 1
    val cast = CheckVoteCast(
        seq = seq,
        voteSeq = vote.openedSeq,
        by = command.by,
        approve = command.approve,
        commandId = command.commandId,
    )
    val nextVote = if (command.approve) {
        vote.copy(approvals = withVoter(vote.approvals, command.by))
    } else {
        vote.copy(rejections = withVoter(vote.rejections, command.by))
    }
    val (resolvedEvents, resolvedState) =
        resolveByTally(state.copy(seq = seq, checkVote = nextVote), solution)
    return VoteResult(events = listOf<Event>(cast) + resolvedEvents, state = resolvedState)
}

/**
 * Close an open vote on the expiry input (PROTOCOL §10, D32): failed EXPIRED. With no vote open it
 * is a silent no-op (no event, no seq, no error), since the session may race its own timer.
 */
private fun expireVote(state: BoardState): VoteResult {
    val vote = state.checkVote ?: return VoteResult(events = emptyList(), state = state)
    val seq = state.seq + 1
    val closed = CheckVoteClosed(
        seq = seq,
        voteSeq = vote.openedSeq,
        outcome = CheckVoteOutcome.FAILED,
        reason = CheckVoteCloseReason.EXPIRED,
    )
    return VoteResult(events = listOf<Event>(closed), state = state.copy(seq = seq, checkVote = null))
}

/**
 * Apply a cell mutation, then run completion and vote cancellation (PROTOCOL §10, D32). A mutation
 * that completes the game cancels an open vote TERMINAL between the cellSet and gameCompleted; a
 * clear that breaks the full grid cancels it GRID_BROKEN after the cellSet; any mutation keeping the
 * grid full leaves the vote open, play continues. With no vote open this is exactly the two-phase
 * completion path.
 */
private fun applyMutationWithVote(
    state: BoardState,
    command: MutationCommand,
    solution: Solution,
): VoteResult {
    val result = reduce(state, command)
    if (result.error != null) {
        return VoteResult(events = emptyList(), state = state, error = result.error)
    }

    val events = result.events.toMutableList<Event>()
    var next = result.state // reduce preserves checkVote through its copy
    val vote = next.checkVote
    val willComplete =
        next.status == Status.ONGOING && voteIsFull(next) && voteBoardIsCorrect(next, solution)

    if (vote != null) {
        if (willComplete) {
            val closeSeq = next.seq + 1
            val compSeq = closeSeq + 1
            events.add(
                CheckVoteClosed(
                    seq = closeSeq,
                    voteSeq = vote.openedSeq,
                    outcome = CheckVoteOutcome.CANCELLED,
                    reason = CheckVoteCloseReason.TERMINAL,
                ),
            )
            events.add(GameCompleted(compSeq))
            return VoteResult(
                events = events,
                state = next.copy(status = Status.COMPLETED, seq = compSeq, checkVote = null),
            )
        }
        if (!voteIsFull(next)) {
            val closeSeq = next.seq + 1
            events.add(
                CheckVoteClosed(
                    seq = closeSeq,
                    voteSeq = vote.openedSeq,
                    outcome = CheckVoteOutcome.CANCELLED,
                    reason = CheckVoteCloseReason.GRID_BROKEN,
                ),
            )
            return VoteResult(events = events, state = next.copy(seq = closeSeq, checkVote = null))
        }
        return VoteResult(events = events, state = next) // grid still full, no completion: vote rides
    }

    if (willComplete) {
        val seq = next.seq + 1
        events.add(GameCompleted(seq))
        next = next.copy(status = Status.COMPLETED, seq = seq)
    }
    return VoteResult(events = events, state = next)
}

/**
 * The vote driver (PROTOCOL §10, D32), the Kotlin twin of `applyWithVote`. Routes each command: a
 * proposal opens a vote, a ballot resolves it, the expiry input closes it, and a cell mutation runs
 * completion and cancellation. The `when` is exhaustive over the sealed [VoteCommand].
 */
fun applyWithVote(state: BoardState, command: VoteCommand, solution: Solution): VoteResult =
    when (command) {
        is CheckProposal -> openVote(state, command, solution)
        is CastCheckVote -> castVote(state, command, solution)
        is ExpireCheckVote -> expireVote(state)
        is MutationCommand -> applyMutationWithVote(state, command, solution)
    }
