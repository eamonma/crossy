// The reducer: (state, command) -> events + next state, or a rejection (DESIGN §5,
// PROTOCOL §5, §6), the Swift twin of packages/engine/src/reducer.ts. Pure and
// deterministic. Value normalization lives here, not in the actor, so both ports stay
// byte-identical (INV-1). The reducer never emits gameCompleted; the completion driver
// layers that on top (DESIGN §3).

/// ASCII-uppercase then validate against the [A-Z0-9]{1,10} charset, over UTF-8 bytes so
/// the length cap and the charset check are both byte-wise (INV-1). nil means INVALID_VALUE.
/// Any non-ASCII byte fails the charset check, so Turkish dotted/dotless i and any other
/// non-ASCII scalar are rejected here, never stored.
private func normalizeValue(_ raw: String) -> String? {
    let bytes = asciiUpperBytes(raw)
    guard bytes.count >= 1 && bytes.count <= 10 else { return nil }
    for byte in bytes {
        let isUpper = byte >= 0x41 && byte <= 0x5a  // A-Z
        let isDigit = byte >= 0x30 && byte <= 0x39  // 0-9
        if !(isUpper || isDigit) { return nil }
    }
    return String(decoding: bytes, as: UTF8.self)
}

private func cellCount(_ state: BoardState) -> Int {
    state.grid.cols * state.grid.rows
}

private func isPlayable(_ state: BoardState, _ cell: Int) -> Bool {
    cell >= 0 && cell < cellCount(state) && !state.grid.blocks.contains(cell)
}

public func reduce(_ state: BoardState, _ command: Command) -> ReduceResult {
    switch command {
    case .placeLetter(let commandId, let cell, let raw, let by, let at):
        return applyMutation(
            state, commandId: commandId, cell: cell, rawValue: raw, by: by, at: at)
    case .clearCell(let commandId, let cell, let by, let at):
        return applyMutation(
            state, commandId: commandId, cell: cell, rawValue: nil, by: by, at: at)
    case .checkPuzzle:
        // Not a cell mutation: the completion driver owns the check's gates and its
        // puzzleChecked event (PROTOCOL §10; Completion.swift). Reducing it directly
        // is a caller error; nothing changes and no seq is consumed (INV-2).
        return ReduceResult(events: [], state: state, error: nil)
    }
}

/// The shared placeLetter/clearCell body. `rawValue` nil is a clear (PROTOCOL §5).
private func applyMutation(
    _ state: BoardState, commandId: String, cell: Int, rawValue: String?, by: String,
    at: String
) -> ReduceResult {
    // Validation order follows PROTOCOL §5: terminal state, then cell, then value.
    if state.status != .ongoing {
        return ReduceResult(events: [], state: state, error: .gameNotOngoing)
    }

    if !isPlayable(state, cell) {
        return ReduceResult(events: [], state: state, error: .invalidCell)
    }

    let value: String?
    if let raw = rawValue {
        guard let normalized = normalizeValue(raw) else {
            return ReduceResult(events: [], state: state, error: .invalidValue)
        }
        value = normalized
    } else {
        value = nil  // clearCell always sets nil (PROTOCOL §5)
    }

    let seq = state.seq + 1
    let previous = state.cells[cell]
    let wasFilled = previous?.value != nil
    let nowFilled = value != nil

    var cells = state.cells
    cells[cell] = Cell(value: value, by: by)

    let filledCount = state.filledCount + (nowFilled ? 1 : 0) - (wasFilled ? 1 : 0)

    // A standing check mark survives until the cell's VALUE changes (PROTOCOL §10, D27):
    // a different letter or a clear removes the mark, a same-value rewrite keeps it
    // (stored values are already normalized, so == is byte-wise; INV-1).
    var checkedWrong = state.checkedWrong
    if previous?.value != value {
        checkedWrong.remove(cell)
    }

    // firstFillAt is set once, on the first placeLetter (PROTOCOL §4, §6). A clearCell never
    // sets it, and a later fill never moves it.
    let isPlace = rawValue != nil
    let firstFillAt =
        (state.firstFillAt == nil && isPlace) ? at : state.firstFillAt

    let event = CellSet(
        seq: seq,
        cell: cell,
        value: value,
        by: by,
        commandId: commandId,
        at: at)

    let next = BoardState(
        grid: state.grid,
        status: state.status,
        seq: seq,
        firstFillAt: firstFillAt,
        cells: cells,
        filledCount: filledCount,
        checkedWrong: checkedWrong,
        checkCount: state.checkCount)

    return ReduceResult(events: [event], state: next, error: nil)
}
