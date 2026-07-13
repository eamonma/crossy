// The reducer: (state, command) -> events + next state, or a rejection (DESIGN §5, PROTOCOL
// §5, §6), the Kotlin twin of packages/engine/src/reducer.ts. Pure and deterministic. Value
// normalization lives here, not in the actor, so both ports stay byte-identical (INV-1). The
// reducer never emits gameCompleted; the completion driver layers that on top (DESIGN §3).

package crossy.engine

/**
 * ASCII-uppercase then validate against the [A-Z0-9]{1,10} charset; null means INVALID_VALUE.
 * The manual scan mirrors the TS `/^[A-Z0-9]{1,10}$/` test: any non-ASCII unit fails the
 * charset check, so Turkish dotted/dotless i and any other non-ASCII scalar are rejected here,
 * never stored (INV-1).
 */
private fun normalizeValue(raw: String): String? {
    val upper = asciiUpper(raw)
    if (upper.length !in 1..10) return null
    for (ch in upper) {
        val ok = ch in 'A'..'Z' || ch in '0'..'9'
        if (!ok) return null
    }
    return upper
}

private fun cellCount(state: BoardState): Int = state.grid.cols * state.grid.rows

private fun isPlayable(state: BoardState, cell: Int): Boolean =
    cell >= 0 && cell < cellCount(state) && cell !in state.grid.blocks

fun reduce(state: BoardState, command: Command): ReduceResult {
    // Validation order follows PROTOCOL §5: terminal state, then cell, then value.
    if (state.status != Status.ONGOING) {
        return ReduceResult(events = emptyList(), state = state, error = RejectionCode.GAME_NOT_ONGOING)
    }

    if (!isPlayable(state, command.cell)) {
        return ReduceResult(events = emptyList(), state = state, error = RejectionCode.INVALID_CELL)
    }

    val value: String? = when (command) {
        is PlaceLetter ->
            normalizeValue(command.value)
                ?: return ReduceResult(events = emptyList(), state = state, error = RejectionCode.INVALID_VALUE)
        is ClearCell -> null // clearCell always sets null (PROTOCOL §5)
    }

    val seq = state.seq + 1
    val previous = state.cells[command.cell]
    val wasFilled = previous != null && previous.v != null
    val nowFilled = value != null

    val cells = state.cells.toMutableMap()
    cells[command.cell] = Cell(v = value, by = command.by)

    val filledCount = state.filledCount + (if (nowFilled) 1 else 0) - (if (wasFilled) 1 else 0)

    // firstFillAt is set once, on the first placeLetter (PROTOCOL §4, §6). A clearCell never
    // sets it, and a later fill never moves it.
    val firstFillAt =
        if (state.firstFillAt == null && command is PlaceLetter) command.at else state.firstFillAt

    val event = CellSet(
        seq = seq,
        cell = command.cell,
        value = value,
        by = command.by,
        commandId = command.commandId,
        at = command.at,
    )

    return ReduceResult(
        events = listOf(event),
        state = state.copy(cells = cells, seq = seq, filledCount = filledCount, firstFillAt = firstFillAt),
    )
}
