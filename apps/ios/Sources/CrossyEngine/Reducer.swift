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
    // Validation order follows PROTOCOL §5: terminal state, then cell, then value.
    if state.status != .ongoing {
        return ReduceResult(events: [], state: state, error: .gameNotOngoing)
    }

    if !isPlayable(state, command.cell) {
        return ReduceResult(events: [], state: state, error: .invalidCell)
    }

    let value: String?
    switch command {
    case .placeLetter(_, _, let raw, _, _):
        guard let normalized = normalizeValue(raw) else {
            return ReduceResult(events: [], state: state, error: .invalidValue)
        }
        value = normalized
    case .clearCell:
        value = nil  // clearCell always sets nil (PROTOCOL §5)
    }

    let seq = state.seq + 1
    let previous = state.cells[command.cell]
    let wasFilled = previous?.value != nil
    let nowFilled = value != nil

    var cells = state.cells
    cells[command.cell] = Cell(value: value, by: command.by)

    let filledCount = state.filledCount + (nowFilled ? 1 : 0) - (wasFilled ? 1 : 0)

    // firstFillAt is set once, on the first placeLetter (PROTOCOL §4, §6). A clearCell never
    // sets it, and a later fill never moves it.
    let isPlace: Bool
    if case .placeLetter = command { isPlace = true } else { isPlace = false }
    let firstFillAt =
        (state.firstFillAt == nil && isPlace) ? command.at : state.firstFillAt

    let event = CellSet(
        seq: seq,
        cell: command.cell,
        value: value,
        by: command.by,
        commandId: command.commandId,
        at: command.at)

    let next = BoardState(
        grid: state.grid,
        status: state.status,
        seq: seq,
        firstFillAt: firstFillAt,
        cells: cells,
        filledCount: filledCount)

    return ReduceResult(events: [event], state: next, error: nil)
}
