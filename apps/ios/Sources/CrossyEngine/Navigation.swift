// Navigation: client-side cursor logic (DESIGN §5; the exact cases are the navigation
// vectors, PROTOCOL §13), the Swift twin of packages/engine/src/navigation.ts. Pure and
// fill-aware but never crossing the wire. Each named operation is pinned end to end by its
// own `when.op`, so both ports land identically and the caller-composition drift v2 shipped
// is foreclosed (vectors/README.md).

private func cellCount(_ grid: Grid) -> Int {
    grid.cols * grid.rows
}

private func isBlock(_ grid: Grid, _ cell: Int) -> Bool {
    grid.blocks.contains(cell)
}

private func inRange(_ grid: Grid, _ cell: Int) -> Bool {
    cell >= 0 && cell < cellCount(grid)
}

private func strideOf(_ grid: Grid, _ direction: Direction) -> Int {
    direction == .across ? 1 : grid.cols
}

/// The smallest playable cell index, or 0 on a grid with none (the wrap/clamp target).
private func firstPlayable(_ grid: Grid) -> Int {
    let n = cellCount(grid)
    var cell = 0
    while cell < n {
        if !isBlock(grid, cell) { return cell }
        cell += 1
    }
    return 0
}

/// The cell one step along `direction` (delta -1 or +1), or nil when that step would leave
/// the line: across stops at the row edges, down at the top and bottom grid edges. This is
/// the word-scan neighbor, which never crosses into another word's line.
private func lineNeighbor(_ grid: Grid, _ direction: Direction, _ cell: Int, _ delta: Int) -> Int? {
    if direction == .across {
        let col = cell % grid.cols
        let next = col + delta
        if next < 0 || next >= grid.cols { return nil }
        return cell + delta
    }
    let row = cell / grid.cols
    let next = row + delta
    if next < 0 || next >= grid.rows { return nil }
    return cell + delta * grid.cols
}

/// The word's inclusive extent along `direction` from `from`, scanning to a block or a grid
/// edge each way (DESIGN §5).
public func wordBounds(_ grid: Grid, _ direction: Direction, _ from: Int) -> (start: Int, end: Int) {
    var start = from
    while true {
        guard let prev = lineNeighbor(grid, direction, start, -1), !isBlock(grid, prev) else { break }
        start = prev
    }
    var end = from
    while true {
        guard let next = lineNeighbor(grid, direction, end, 1), !isBlock(grid, next) else { break }
        end = next
    }
    return (start, end)
}

/// Single-cell advance, the seed's getNextCell (DESIGN §5). Fill-agnostic. With
/// `canEscapeWord` (default true) it skips blocks and may cross into the next word, clamping
/// at the grid edge. With it false the flag bites only at a word boundary: forward stops at
/// the word's last cell, backward at its first, and mid-word it is a no-op. An out-of-range
/// or empty-grid start clamps to the first playable cell.
public func getNextCell(
    _ grid: Grid, _ direction: Direction, _ from: Int, _ toward: Toward, canEscapeWord: Bool = true
) -> Int {
    if cellCount(grid) == 0 { return firstPlayable(grid) }
    if !inRange(grid, from) { return firstPlayable(grid) }

    let stride = strideOf(grid, direction)

    if !canEscapeWord {
        let bounds = wordBounds(grid, direction, from)
        if toward == .forward { return from < bounds.end ? from + stride : from }
        return from > bounds.start ? from - stride : from
    }

    let step = toward == .forward ? stride : -stride
    var cell = from + step
    while inRange(grid, cell) && isBlock(grid, cell) { cell += step }
    if !inRange(grid, cell) { return from }  // ran off the grid: clamp, stay put
    return cell
}

private struct Clue {
    let start: Int
    let cells: [Int]
}

/// The clues along `direction`: maximal runs of playable cells (singletons included),
/// ordered by start index. Iterating cell indices ascending yields the starts in order,
/// which is the crossword clue order for both axes.
private func clues(_ grid: Grid, _ direction: Direction) -> [Clue] {
    var list: [Clue] = []
    let n = cellCount(grid)
    var cell = 0
    while cell < n {
        defer { cell += 1 }
        if isBlock(grid, cell) { continue }
        let prev = lineNeighbor(grid, direction, cell, -1)
        let startsHere = prev == nil || isBlock(grid, prev!)
        if !startsHere { continue }
        var cells = [cell]
        var scan = cell
        while true {
            guard let next = lineNeighbor(grid, direction, scan, 1), !isBlock(grid, next) else { break }
            cells.append(next)
            scan = next
        }
        list.append(Clue(start: cell, cells: cells))
    }
    return list
}

/// Tab (`forward`) and Shift+Tab (`backward`): move to the adjacent clue in `direction`'s
/// clue list and land on its first empty cell scanning from its start. A full target clue
/// falls back to its start on Tab, its end on Shift+Tab. Past either end of the clue list,
/// wrap to the grid's first playable cell with `direction` unchanged: the wrap never crosses
/// axes (DESIGN §5; audit Verdict 1).
public func tabTarget(
    _ grid: Grid, _ direction: Direction, _ from: Int, _ toward: Toward, _ filled: Set<Int>
) -> (cell: Int, direction: Direction) {
    let list = clues(grid, direction)
    let start = wordBounds(grid, direction, from).start
    let current = list.firstIndex { $0.start == start } ?? -1
    let targetIndex = toward == .forward ? current + 1 : current - 1

    if current == -1 || targetIndex < 0 || targetIndex >= list.count {
        return (firstPlayable(grid), direction)
    }

    let target = list[targetIndex]
    for cell in target.cells where !filled.contains(cell) {
        return (cell, direction)
    }

    // The target clue is full: fall back to its start (Tab) or its end (Shift+Tab).
    let fallback = toward == .forward ? target.cells.first : target.cells.last
    return (fallback ?? from, direction)
}

/// The cursor move after a letter is placed at `from`, with `filled` the board after that
/// keystroke (so `from` is filled). Advance forward with filled-skip inside the word to the
/// next empty cell; at the word's end, wrap to the word's first empty cell if the word is
/// incomplete, or stay on the last cell if the word is full (DESIGN §5).
public func typingAdvance(
    _ grid: Grid, _ direction: Direction, _ from: Int, _ filled: Set<Int>
) -> Int {
    let stride = strideOf(grid, direction)
    let bounds = wordBounds(grid, direction, from)

    var cell = from + stride
    while cell <= bounds.end {
        if !filled.contains(cell) { return cell }
        cell += stride
    }

    // Nothing empty after `from`: wrap to the word's first empty cell if any remains.
    cell = bounds.start
    while cell <= bounds.end {
        if !filled.contains(cell) { return cell }
        cell += stride
    }

    return bounds.end  // the word is full: stay on its last cell
}

/// The cursor move on Backspace. A non-empty `from` clears in place and stays. An
/// already-empty `from` steps back one cell with block-skip, crossing word boundaries into
/// the previous word, and clears wherever it lands (DESIGN §5).
public func backspaceTarget(
    _ grid: Grid, _ direction: Direction, _ from: Int, _ filled: Set<Int>
) -> Int {
    if filled.contains(from) { return from }
    return getNextCell(grid, direction, from, .backward, canEscapeWord: true)
}
