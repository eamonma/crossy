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

private struct CycleClue {
    let start: Int
    let cells: [Int]
    let direction: Direction
}

/// The Tab cycle: every across clue in clue order, then every down clue in clue order,
/// traversed circularly (owner decision 2026-07-10). Each entry carries its axis so a
/// landing can report the direction it lands in.
private func tabCycle(_ grid: Grid) -> [CycleClue] {
    let across = clues(grid, .across).map {
        CycleClue(start: $0.start, cells: $0.cells, direction: .across)
    }
    let down = clues(grid, .down).map {
        CycleClue(start: $0.start, cells: $0.cells, direction: .down)
    }
    return across + down
}

/// Tab (`forward`) and Shift+Tab (`backward`): traverse the Tab cycle, every across clue
/// in clue order then every down clue in clue order, circular. Scan the cycle starting
/// after the current clue and land on the first clue with an empty cell, at that clue's
/// first empty cell scanned from its start; the returned `direction` is the landing
/// clue's axis, so Tab skips full clues, crosses from across into down, and wraps back
/// around. The current clue re-enters candidacy only after a full cycle. With nothing
/// empty anywhere, Tab still moves to the adjacent clue with no skipping: its first cell
/// on Tab, its last on Shift+Tab, axis crossing included. An out-of-range, block, or
/// empty-grid `from` clamps to the grid's first playable cell with `direction` unchanged.
/// Owner decision 2026-07-10 supersedes audit Verdict 1's same-axis no-cross wrap (DESIGN
/// §5; the exact cases are the next-word / previous-word / full-word-asymmetry vectors).
public func tabTarget(
    _ grid: Grid, _ direction: Direction, _ from: Int, _ toward: Toward, _ filled: Set<Int>
) -> (cell: Int, direction: Direction) {
    if cellCount(grid) == 0 || !inRange(grid, from) || isBlock(grid, from) {
        return (firstPlayable(grid), direction)
    }

    let cycle = tabCycle(grid)
    let n = cycle.count
    let start = wordBounds(grid, direction, from).start
    guard let current = cycle.firstIndex(where: { $0.direction == direction && $0.start == start })
    else {
        return (firstPlayable(grid), direction)
    }

    let step = toward == .forward ? 1 : -1
    // Scan the cycle after the current clue for the first clue with an empty cell. The
    // current clue re-enters candidacy only after a full cycle (i == n).
    for i in 1...n {
        let clue = cycle[(((current + step * i) % n) + n) % n]
        for cell in clue.cells where !filled.contains(cell) {
            return (cell, clue.direction)
        }
    }

    // Nothing empty anywhere: move to the adjacent clue with no skipping so navigation
    // stays live after completion. Tab lands on its first cell, Shift+Tab on its last.
    let adjacent = cycle[(((current + step) % n) + n) % n]
    let fallback = toward == .forward ? adjacent.cells.first : adjacent.cells.last
    return (fallback ?? from, adjacent.direction)
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
