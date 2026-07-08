// Two-phase completion (DESIGN §3, PROTOCOL §10), the Swift twin of
// packages/engine/src/completion.ts. The reducer maintains filledCount as a cheap gate; on
// every accepted mutation, while the board is full, the whole board is checked against the
// solution. The check is level-triggered, not edge-triggered: a same-count overwrite
// re-runs it, so a full-but-wrong board corrected in place still completes. Only a full pass
// emits gameCompleted, exactly once (INV-3); a terminal board freezes and rejects further
// mutations (INV-4).
//
// The actor owns this orchestration in production; the engine exposes it here because the
// completion vectors are engine-bound, and it reuses the pure reducer and comparator rather
// than duplicating either.

/// The playable-cell count: the cheap filledCount gate compares against this.
private func playableCount(_ state: BoardState) -> Int {
    state.grid.cols * state.grid.rows - state.grid.blocks.count
}

/// Does every solution cell hold a value the comparator accepts (DESIGN §5, D12)?
private func boardIsCorrect(_ state: BoardState, _ solution: Solution) -> Bool {
    for (cell, expected) in solution {
        guard let filled = state.cells[cell], let value = filled.value else { return false }
        if !matches(expected, value) { return false }
    }
    return true
}

/// Apply one command, then run the level-triggered completion check. On a full and correct
/// board still ongoing, append a gameCompleted at the next seq and mark the state completed.
/// A rejected command, a not-yet-full board, or a full-but-wrong board appends nothing and
/// play continues.
public func applyWithCompletion(
    _ state: BoardState, _ command: Command, _ solution: Solution
) -> CompletionResult {
    let result = reduce(state, command)
    var events: [Event] = result.events.map { .cellSet($0) }
    var next = result.state

    if result.error == nil,
        next.status == .ongoing,
        next.filledCount == playableCount(next),
        boardIsCorrect(next, solution)
    {
        let seq = next.seq + 1
        next = BoardState(
            grid: next.grid,
            status: .completed,
            seq: seq,
            firstFillAt: next.firstFillAt,
            cells: next.cells,
            filledCount: next.filledCount)
        events.append(.gameCompleted(GameCompleted(seq: seq)))
    }

    return CompletionResult(events: events, state: next)
}
