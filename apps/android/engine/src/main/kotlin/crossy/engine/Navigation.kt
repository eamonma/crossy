// Navigation: client-side cursor logic (DESIGN §5; the exact cases are the navigation
// vectors, PROTOCOL §13), the Kotlin twin of packages/engine/src/navigation.ts. Pure and
// fill-aware but never crossing the wire. Each named operation is pinned end to end by its
// own `when.op`, so both ports land identically and the caller-composition drift v2 shipped
// is foreclosed (vectors/README.md).

package crossy.engine

/** The inclusive extent of a word along an axis (wordBounds). */
data class WordBounds(val start: Int, val end: Int)

/** A Tab landing: the cell and the landing clue's axis (tabTarget). */
data class TabTarget(val cell: Int, val direction: Direction)

private fun cellCount(grid: Grid): Int = grid.cols * grid.rows

private fun isBlock(grid: Grid, cell: Int): Boolean = cell in grid.blocks

private fun inRange(grid: Grid, cell: Int): Boolean = cell >= 0 && cell < cellCount(grid)

private fun strideOf(grid: Grid, direction: Direction): Int =
    if (direction == Direction.ACROSS) 1 else grid.cols

/** The smallest playable cell index, or 0 on a grid with none (the wrap/clamp target). */
private fun firstPlayable(grid: Grid): Int {
    val n = cellCount(grid)
    for (cell in 0 until n) if (!isBlock(grid, cell)) return cell
    return 0
}

/**
 * The cell one step along `direction` (delta -1 or +1), or null when that step would leave the
 * line: across stops at the row edges, down at the top and bottom grid edges. This is the
 * word-scan neighbor, which never crosses into another word's line.
 */
private fun lineNeighbor(grid: Grid, direction: Direction, cell: Int, delta: Int): Int? {
    if (direction == Direction.ACROSS) {
        val col = cell % grid.cols
        val next = col + delta
        if (next < 0 || next >= grid.cols) return null
        return cell + delta
    }
    val row = cell / grid.cols
    val next = row + delta
    if (next < 0 || next >= grid.rows) return null
    return cell + delta * grid.cols
}

/**
 * The word's inclusive extent along `direction` from `from`, scanning to a block or a grid edge
 * each way (DESIGN §5).
 */
fun wordBounds(grid: Grid, direction: Direction, from: Int): WordBounds {
    var start = from
    while (true) {
        val prev = lineNeighbor(grid, direction, start, -1)
        if (prev == null || isBlock(grid, prev)) break
        start = prev
    }
    var end = from
    while (true) {
        val next = lineNeighbor(grid, direction, end, +1)
        if (next == null || isBlock(grid, next)) break
        end = next
    }
    return WordBounds(start, end)
}

/**
 * Single-cell advance, the seed's getNextCell (DESIGN §5). Fill-agnostic. With `canEscapeWord`
 * (default true) it skips blocks and may cross into the next word, clamping at the grid edge.
 * With it false the flag bites only at a word boundary: forward stops at the word's last cell,
 * backward at its first, and mid-word it is a no-op. An out-of-range or empty-grid start clamps
 * to the first playable cell.
 */
fun getNextCell(
    grid: Grid,
    direction: Direction,
    from: Int,
    toward: Toward,
    canEscapeWord: Boolean = true,
): Int {
    if (cellCount(grid) == 0) return firstPlayable(grid)
    if (!inRange(grid, from)) return firstPlayable(grid)

    val stride = strideOf(grid, direction)

    if (!canEscapeWord) {
        val bounds = wordBounds(grid, direction, from)
        return if (toward == Toward.FORWARD) {
            if (from < bounds.end) from + stride else from
        } else {
            if (from > bounds.start) from - stride else from
        }
    }

    val step = if (toward == Toward.FORWARD) stride else -stride
    var cell = from + step
    while (inRange(grid, cell) && isBlock(grid, cell)) cell += step
    if (!inRange(grid, cell)) return from // ran off the grid: clamp, stay put
    return cell
}

private data class Clue(val start: Int, val cells: List<Int>)

/**
 * The clues along `direction`: maximal runs of playable cells (singletons included), ordered by
 * start index. Iterating cell indices ascending yields the starts in order, which is the
 * crossword clue order for both axes.
 */
private fun clues(grid: Grid, direction: Direction): List<Clue> {
    val list = mutableListOf<Clue>()
    val n = cellCount(grid)
    for (cell in 0 until n) {
        if (isBlock(grid, cell)) continue
        val prev = lineNeighbor(grid, direction, cell, -1)
        val startsHere = prev == null || isBlock(grid, prev)
        if (!startsHere) continue
        val cells = mutableListOf(cell)
        var scan = cell
        while (true) {
            val next = lineNeighbor(grid, direction, scan, +1)
            if (next == null || isBlock(grid, next)) break
            cells.add(next)
            scan = next
        }
        list.add(Clue(start = cell, cells = cells))
    }
    return list
}

private data class CycleClue(val start: Int, val cells: List<Int>, val direction: Direction)

/**
 * The Tab cycle: every across clue in clue order, then every down clue in clue order, traversed
 * circularly (owner decision 2026-07-10). Each entry carries its axis so a landing can report
 * the direction it lands in.
 */
private fun tabCycle(grid: Grid): List<CycleClue> {
    val across = clues(grid, Direction.ACROSS).map { CycleClue(it.start, it.cells, Direction.ACROSS) }
    val down = clues(grid, Direction.DOWN).map { CycleClue(it.start, it.cells, Direction.DOWN) }
    return across + down
}

/**
 * Tab (`forward`) and Shift+Tab (`backward`): traverse the Tab cycle, every across clue in clue
 * order then every down clue in clue order, circular. Scan the cycle starting after the current
 * clue and land on the first clue with an empty cell, at that clue's first empty cell scanned
 * from its start; the returned `direction` is the landing clue's axis, so Tab skips full clues,
 * crosses from across into down, and wraps back around. The current clue re-enters candidacy only
 * after a full cycle. With nothing empty anywhere, Tab still moves to the adjacent clue with no
 * skipping: its first cell on Tab, its last on Shift+Tab, axis crossing included. An out-of-range,
 * block, or empty-grid `from` clamps to the grid's first playable cell with `direction` unchanged.
 * Owner decision 2026-07-10 supersedes audit Verdict 1's same-axis no-cross wrap (DESIGN §5; the
 * exact cases are the next-word / previous-word / full-word-asymmetry vectors).
 */
fun tabTarget(
    grid: Grid,
    direction: Direction,
    from: Int,
    toward: Toward,
    filled: Set<Int>,
): TabTarget {
    if (cellCount(grid) == 0 || !inRange(grid, from) || isBlock(grid, from)) {
        return TabTarget(firstPlayable(grid), direction)
    }

    val cycle = tabCycle(grid)
    val n = cycle.size
    val start = wordBounds(grid, direction, from).start
    val current = cycle.indexOfFirst { it.direction == direction && it.start == start }
    if (current == -1) return TabTarget(firstPlayable(grid), direction)

    val step = if (toward == Toward.FORWARD) 1 else -1
    // Scan the cycle after the current clue for the first clue with an empty cell. The current
    // clue re-enters candidacy only after a full cycle (i == n).
    for (i in 1..n) {
        val clue = cycle[(((current + step * i) % n) + n) % n]
        for (cell in clue.cells) if (cell !in filled) return TabTarget(cell, clue.direction)
    }

    // Nothing empty anywhere: move to the adjacent clue with no skipping so navigation stays
    // live after completion. Tab lands on its first cell, Shift+Tab on its last.
    val adjacent = cycle[(((current + step) % n) + n) % n]
    val fallback = if (toward == Toward.FORWARD) adjacent.cells.first() else adjacent.cells.last()
    return TabTarget(fallback, adjacent.direction)
}

/**
 * The cursor move after a letter is placed at `from`, with `filled` the board after that
 * keystroke (so `from` is filled). Advance forward with filled-skip inside the word to the next
 * empty cell; at the word's end, wrap to the word's first empty cell if the word is incomplete,
 * or stay on the last cell if the word is full (DESIGN §5).
 */
fun typingAdvance(grid: Grid, direction: Direction, from: Int, filled: Set<Int>): Int {
    val stride = strideOf(grid, direction)
    val bounds = wordBounds(grid, direction, from)

    var cell = from + stride
    while (cell <= bounds.end) {
        if (cell !in filled) return cell
        cell += stride
    }

    // Nothing empty after `from`: wrap to the word's first empty cell if any remains.
    cell = bounds.start
    while (cell <= bounds.end) {
        if (cell !in filled) return cell
        cell += stride
    }

    return bounds.end // the word is full: stay on its last cell
}

/**
 * The cursor move on Backspace. A non-empty `from` clears in place and stays. An already-empty
 * `from` steps back one cell with block-skip, crossing word boundaries into the previous word,
 * and clears wherever it lands (DESIGN §5).
 */
fun backspaceTarget(grid: Grid, direction: Direction, from: Int, filled: Set<Int>): Int {
    if (from in filled) return from
    return getNextCell(grid, direction, from, Toward.BACKWARD, canEscapeWord = true)
}
