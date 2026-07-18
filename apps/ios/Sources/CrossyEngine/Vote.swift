// The attributed check vote (PROTOCOL §10, D32), the Swift twin of `applyWithVote` in
// packages/engine/src/completion.ts. A checkPuzzle no longer checks immediately: it proposes
// a check, opening a timeboxed majority vote whose passing is the accepted check. The state
// machine lives beside completion because a passing close runs the same comparator over the
// same solution, and a mutation that completes or breaks the grid cancels the open vote.
// Everything here is pure: the electorate arrives frozen on the proposal, expiry arrives as an
// input, and user ids and timestamps are data (INV-9).
//
// Port fidelity: TS builds each next state with `{...state, field}` spreads; Swift's `BoardState`
// is an immutable struct with `let` fields, so `board(_:...)` below is the spread's stand-in,
// a double-optional on `checkVote` distinguishing "leave unchanged" from "set to nil".

/// A structural copy of `state` overriding only the named fields. `checkVote` is a
/// double-optional so `.none` leaves it as it was and `.some(nil)` clears the vote, the two
/// spreads the driver needs (`{...state}` vs `{...state, checkVote: null}`).
private func board(
    _ state: BoardState,
    seq: Int? = nil,
    status: Status? = nil,
    checkedWrong: Set<Int>? = nil,
    checkCount: Int? = nil,
    checkVote: CheckVote?? = .none
) -> BoardState {
    BoardState(
        grid: state.grid,
        status: status ?? state.status,
        seq: seq ?? state.seq,
        firstFillAt: state.firstFillAt,
        cells: state.cells,
        filledCount: state.filledCount,
        checkedWrong: checkedWrong ?? state.checkedWrong,
        checkCount: checkCount ?? state.checkCount,
        checkVote: checkVote ?? state.checkVote)
}

/// The playable-cell count and the cheap full-board gate, matching Completion.swift.
private func voteIsFull(_ state: BoardState) -> Bool {
    state.filledCount == state.grid.cols * state.grid.rows - state.grid.blocks.count
}

/// Does every solution cell hold a value the comparator accepts (DESIGN §5, D12)?
private func voteBoardIsCorrect(_ state: BoardState, _ solution: Solution) -> Bool {
    for (cell, expected) in solution {
        guard let filled = state.cells[cell], let value = filled.value else { return false }
        if !matches(expected, value) { return false }
    }
    return true
}

/// Every comparator failure on the board, ascending (PROTOCOL §6), never dictionary order.
private func voteComparatorFailures(_ state: BoardState, _ solution: Solution) -> [Int] {
    var wrongCells: [Int] = []
    for (cell, expected) in solution {
        let value = state.cells[cell]?.value
        if value == nil || !matches(expected, value!) { wrongCells.append(cell) }
    }
    wrongCells.sort()
    return wrongCells
}

/// Strict majority (PROTOCOL §10): floor(E / 2) + 1 approvals close the vote passed.
private func needed(_ electorate: [String]) -> Int {
    electorate.count / 2 + 1
}

/// Add a voter to an ascending-ASCII userId array, returning a new sorted array (INV-1).
private func withVoter(_ voters: [String], _ userId: String) -> [String] {
    (voters + [userId]).sorted()
}

/// Close a passing vote (PROTOCOL §10, D32): emit checkVoteClosed (passed), then the
/// puzzleChecked at the next seq, computed against the board **at close time**. The count
/// increments and the marks replace any standing set wholesale; the check is attributed to
/// the proposer (`by`) and carries the proposal's commandId, not the deciding ballot's.
private func closePassed(
    _ state: BoardState, _ vote: CheckVote, _ solution: Solution
) -> (events: [VoteEvent], state: BoardState) {
    let closeSeq = state.seq + 1
    let closed = CheckVoteClosed(
        seq: closeSeq, voteSeq: vote.openedSeq, outcome: .passed, reason: nil)
    let wrongCells = voteComparatorFailures(state, solution)
    let checkedSeq = closeSeq + 1
    let checkCount = state.checkCount + 1
    let checked = PuzzleChecked(
        seq: checkedSeq, wrongCells: wrongCells, checkCount: checkCount,
        commandId: vote.commandId, by: vote.by)
    let next = board(
        state, seq: checkedSeq, checkedWrong: Set(wrongCells), checkCount: checkCount,
        checkVote: .some(nil))
    return ([.checkVoteClosed(closed), .puzzleChecked(checked)], next)
}

/// Close a vote failed REJECTED (PROTOCOL §10, D32): the majority is unreachable.
private func closeRejected(
    _ state: BoardState, _ vote: CheckVote
) -> (events: [VoteEvent], state: BoardState) {
    let seq = state.seq + 1
    let closed = CheckVoteClosed(
        seq: seq, voteSeq: vote.openedSeq, outcome: .failed, reason: .rejected)
    return ([.checkVoteClosed(closed)], board(state, seq: seq, checkVote: .some(nil)))
}

/// Resolve the open vote by tally, at open or after a ballot (PROTOCOL §10, D32). It passes the
/// instant approvals reach `needed` (possibly at open, a solo electorate), fails REJECTED the
/// instant `E - rejections < needed`, and otherwise stays open. Silence is never approval.
private func resolveByTally(
    _ state: BoardState, _ solution: Solution
) -> (events: [VoteEvent], state: BoardState) {
    guard let vote = state.checkVote else { return ([], state) }
    let need = needed(vote.electorate)
    if vote.approvals.count >= need { return closePassed(state, vote, solution) }
    if vote.electorate.count - vote.rejections.count < need {
        return closeRejected(state, vote)
    }
    return ([], state)
}

/// Open a vote (PROTOCOL §10, D32). Gates in order: ongoing, grid full, no vote already open
/// (GAME_NOT_ONGOING, GRID_NOT_FULL, VOTE_PENDING; a rejection consumes no seq, INV-2). An
/// acceptance freezes the electorate, opens approvals as [proposer], and emits checkVoteOpened
/// with `needed`; a solo electorate already reaches `needed`, so it passes in the same command.
private func openVote(
    _ state: BoardState, commandId: String, by: String, electorate rawElectorate: [String],
    _ solution: Solution
) -> VoteResult {
    if state.status != .ongoing {
        return VoteResult(events: [], state: state, error: .gameNotOngoing)
    }
    if !voteIsFull(state) { return VoteResult(events: [], state: state, error: .gridNotFull) }
    if state.checkVote != nil { return VoteResult(events: [], state: state, error: .votePending) }

    let seq = state.seq + 1
    let electorate = rawElectorate.sorted()
    let vote = CheckVote(
        openedSeq: seq, by: by, commandId: commandId, electorate: electorate,
        approvals: [by], rejections: [])
    let opened = CheckVoteOpened(
        seq: seq, by: by, electorate: electorate, needed: needed(electorate),
        commandId: commandId)
    let resolved = resolveByTally(board(state, seq: seq, checkVote: .some(vote)), solution)
    return VoteResult(events: [.checkVoteOpened(opened)] + resolved.events, state: resolved.state)
}

/// Cast one immutable ballot (PROTOCOL §10, D32). Gates in order: ongoing, an open vote whose
/// openedSeq equals the ballot's voteSeq (NO_VOTE_OPEN, covering a stale voteSeq too), the
/// sender in the frozen electorate (NOT_ELECTOR), the sender not having voted (ALREADY_VOTED).
/// An acceptance records the ballot, emits checkVoteCast, then resolves by tally.
private func castVote(
    _ state: BoardState, commandId: String, by: String, voteSeq: Int, approve: Bool,
    _ solution: Solution
) -> VoteResult {
    if state.status != .ongoing {
        return VoteResult(events: [], state: state, error: .gameNotOngoing)
    }
    guard let vote = state.checkVote, vote.openedSeq == voteSeq else {
        return VoteResult(events: [], state: state, error: .noVoteOpen)
    }
    if !vote.electorate.contains(by) {
        return VoteResult(events: [], state: state, error: .notElector)
    }
    if vote.approvals.contains(by) || vote.rejections.contains(by) {
        return VoteResult(events: [], state: state, error: .alreadyVoted)
    }

    let seq = state.seq + 1
    let cast = CheckVoteCast(
        seq: seq, voteSeq: vote.openedSeq, by: by, approve: approve, commandId: commandId)
    let nextVote =
        approve
        ? CheckVote(
            openedSeq: vote.openedSeq, by: vote.by, commandId: vote.commandId,
            electorate: vote.electorate, approvals: withVoter(vote.approvals, by),
            rejections: vote.rejections)
        : CheckVote(
            openedSeq: vote.openedSeq, by: vote.by, commandId: vote.commandId,
            electorate: vote.electorate, approvals: vote.approvals,
            rejections: withVoter(vote.rejections, by))
    let resolved = resolveByTally(board(state, seq: seq, checkVote: .some(nextVote)), solution)
    return VoteResult(events: [.checkVoteCast(cast)] + resolved.events, state: resolved.state)
}

/// Close an open vote on the expiry input (PROTOCOL §10, D32): failed EXPIRED. With no vote
/// open it is a silent no-op (no event, no seq, no error), since the session may race its own
/// timer.
private func expireVote(_ state: BoardState) -> VoteResult {
    guard let vote = state.checkVote else { return VoteResult(events: [], state: state) }
    let seq = state.seq + 1
    let closed = CheckVoteClosed(
        seq: seq, voteSeq: vote.openedSeq, outcome: .failed, reason: .expired)
    return VoteResult(
        events: [.checkVoteClosed(closed)], state: board(state, seq: seq, checkVote: .some(nil)))
}

/// Apply a cell mutation, then run completion and vote cancellation (PROTOCOL §10, D32). A
/// mutation that completes the game cancels an open vote TERMINAL between the cellSet and
/// gameCompleted; a clear that breaks the full grid cancels it GRID_BROKEN after the cellSet;
/// any mutation keeping the grid full leaves the vote open, play continues. With no vote open
/// this is exactly the two-phase completion path.
private func applyMutationWithVote(
    _ state: BoardState, _ command: Command, _ solution: Solution
) -> VoteResult {
    let result = reduce(state, command)
    if let error = result.error {
        return VoteResult(events: [], state: state, error: error)
    }

    var events: [VoteEvent] = result.events.map { .cellSet($0) }
    var next = result.state  // reduce preserves checkVote through its copy
    let willComplete =
        next.status == .ongoing && voteIsFull(next) && voteBoardIsCorrect(next, solution)

    if let vote = next.checkVote {
        if willComplete {
            let closeSeq = next.seq + 1
            let compSeq = closeSeq + 1
            events.append(
                .checkVoteClosed(
                    CheckVoteClosed(
                        seq: closeSeq, voteSeq: vote.openedSeq, outcome: .cancelled,
                        reason: .terminal)))
            events.append(.gameCompleted(GameCompleted(seq: compSeq)))
            return VoteResult(
                events: events,
                state: board(next, seq: compSeq, status: .completed, checkVote: .some(nil)))
        }
        if !voteIsFull(next) {
            let closeSeq = next.seq + 1
            events.append(
                .checkVoteClosed(
                    CheckVoteClosed(
                        seq: closeSeq, voteSeq: vote.openedSeq, outcome: .cancelled,
                        reason: .gridBroken)))
            return VoteResult(
                events: events, state: board(next, seq: closeSeq, checkVote: .some(nil)))
        }
        return VoteResult(events: events, state: next)  // grid still full, no completion: vote rides
    }

    if willComplete {
        let seq = next.seq + 1
        events.append(.gameCompleted(GameCompleted(seq: seq)))
        next = board(next, seq: seq, status: .completed)
    }
    return VoteResult(events: events, state: next)
}

/// The vote driver (PROTOCOL §10, D32), the Swift twin of `applyWithVote`. Routes each command:
/// a proposal opens a vote, a ballot resolves it, the expiry input closes it, and a cell
/// mutation runs completion and cancellation.
public func applyWithVote(
    _ state: BoardState, _ command: VoteCommand, _ solution: Solution
) -> VoteResult {
    switch command {
    case .checkProposal(let commandId, let by, let electorate):
        return openVote(state, commandId: commandId, by: by, electorate: electorate, solution)
    case .castCheckVote(let commandId, let by, let voteSeq, let approve):
        return castVote(
            state, commandId: commandId, by: by, voteSeq: voteSeq, approve: approve, solution)
    case .expireCheckVote:
        return expireVote(state)
    case .placeLetter(let commandId, let cell, let value, let by, let at):
        return applyMutationWithVote(
            state, .placeLetter(commandId: commandId, cell: cell, value: value, by: by, at: at),
            solution)
    case .clearCell(let commandId, let cell, let by, let at):
        return applyMutationWithVote(
            state, .clearCell(commandId: commandId, cell: cell, by: by, at: at), solution)
    }
}
