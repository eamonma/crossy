// Navigation: client-side cursor logic (DESIGN §5; the exact cases are the navigation
// vectors, PROTOCOL §13). Pure and fill-aware but never crossing the wire. Each named
// operation is pinned end to end by its own `when.op`, so both ports land identically
// and the caller-composition drift v2 shipped is foreclosed (vectors/README.md).

import type { Direction, Grid, Toward } from "./types";

function cellCount(grid: Grid): number {
  return grid.cols * grid.rows;
}

function isBlock(grid: Grid, cell: number): boolean {
  return grid.blocks.has(cell);
}

function inRange(grid: Grid, cell: number): boolean {
  return cell >= 0 && cell < cellCount(grid);
}

function strideOf(grid: Grid, direction: Direction): number {
  return direction === "across" ? 1 : grid.cols;
}

/** The smallest playable cell index, or 0 on a grid with none (the wrap/clamp target). */
function firstPlayable(grid: Grid): number {
  const n = cellCount(grid);
  for (let cell = 0; cell < n; cell += 1) if (!isBlock(grid, cell)) return cell;
  return 0;
}

/**
 * The cell one step along `direction` (delta -1 or +1), or null when that step would
 * leave the line: across stops at the row edges, down at the top and bottom grid edges.
 * This is the word-scan neighbor, which never crosses into another word's line.
 */
function lineNeighbor(
  grid: Grid,
  direction: Direction,
  cell: number,
  delta: number,
): number | null {
  if (direction === "across") {
    const col = cell % grid.cols;
    const next = col + delta;
    if (next < 0 || next >= grid.cols) return null;
    return cell + delta;
  }
  const row = Math.floor(cell / grid.cols);
  const next = row + delta;
  if (next < 0 || next >= grid.rows) return null;
  return cell + delta * grid.cols;
}

/**
 * The word's inclusive extent along `direction` from `from`, scanning to a block or a
 * grid edge each way (DESIGN §5).
 */
export function wordBounds(
  grid: Grid,
  direction: Direction,
  from: number,
): { start: number; end: number } {
  let start = from;
  for (;;) {
    const prev = lineNeighbor(grid, direction, start, -1);
    if (prev === null || isBlock(grid, prev)) break;
    start = prev;
  }
  let end = from;
  for (;;) {
    const next = lineNeighbor(grid, direction, end, +1);
    if (next === null || isBlock(grid, next)) break;
    end = next;
  }
  return { start, end };
}

/**
 * Single-cell advance, the seed's getNextCell (DESIGN §5). Fill-agnostic. With
 * `canEscapeWord` (default true) it skips blocks and may cross into the next word,
 * clamping at the grid edge. With it false the flag bites only at a word boundary:
 * forward stops at the word's last cell, backward at its first, and mid-word it is a
 * no-op. An out-of-range or empty-grid start clamps to the first playable cell.
 */
export function getNextCell(
  grid: Grid,
  direction: Direction,
  from: number,
  toward: Toward,
  canEscapeWord = true,
): number {
  if (cellCount(grid) === 0) return firstPlayable(grid);
  if (!inRange(grid, from)) return firstPlayable(grid);

  const stride = strideOf(grid, direction);

  if (!canEscapeWord) {
    const { start, end } = wordBounds(grid, direction, from);
    if (toward === "forward") return from < end ? from + stride : from;
    return from > start ? from - stride : from;
  }

  const step = toward === "forward" ? stride : -stride;
  let cell = from + step;
  while (inRange(grid, cell) && isBlock(grid, cell)) cell += step;
  if (!inRange(grid, cell)) return from; // ran off the grid: clamp, stay put
  return cell;
}

interface Clue {
  readonly start: number;
  readonly cells: readonly number[];
}

/**
 * The clues along `direction`: maximal runs of playable cells (singletons included),
 * ordered by start index. Iterating cell indices ascending yields the starts in order,
 * which is the crossword clue order for both axes.
 */
function clues(grid: Grid, direction: Direction): Clue[] {
  const list: Clue[] = [];
  const n = cellCount(grid);
  for (let cell = 0; cell < n; cell += 1) {
    if (isBlock(grid, cell)) continue;
    const prev = lineNeighbor(grid, direction, cell, -1);
    const startsHere = prev === null || isBlock(grid, prev);
    if (!startsHere) continue;
    const cells: number[] = [cell];
    let scan = cell;
    for (;;) {
      const next = lineNeighbor(grid, direction, scan, +1);
      if (next === null || isBlock(grid, next)) break;
      cells.push(next);
      scan = next;
    }
    list.push({ start: cell, cells });
  }
  return list;
}

interface CycleClue extends Clue {
  readonly direction: Direction;
}

/**
 * The Tab cycle: every across clue in clue order, then every down clue in clue order,
 * traversed circularly (owner decision 2026-07-10). Each entry carries its axis so a
 * landing can report the direction it lands in.
 */
function tabCycle(grid: Grid): CycleClue[] {
  const across = clues(grid, "across").map((clue) => ({
    ...clue,
    direction: "across" as const,
  }));
  const down = clues(grid, "down").map((clue) => ({
    ...clue,
    direction: "down" as const,
  }));
  return [...across, ...down];
}

/**
 * Tab (`forward`) and Shift+Tab (`backward`): traverse the Tab cycle, every across clue
 * in clue order then every down clue in clue order, circular. Scan the cycle starting
 * after the current clue and land on the first clue with an empty cell, at that clue's
 * first empty cell scanned from its start; the returned `direction` is the landing
 * clue's axis, so Tab skips full clues, crosses from across into down, and wraps back
 * around. The current clue re-enters candidacy only after a full cycle. With nothing
 * empty anywhere, Tab still moves to the adjacent clue with no skipping: its first cell
 * on Tab, its last on Shift+Tab, axis crossing included. An out-of-range, block, or
 * empty-grid `from` clamps to the grid's first playable cell with `direction` unchanged.
 * Owner decision 2026-07-10 supersedes audit Verdict 1's same-axis no-cross wrap (DESIGN
 * §5; the exact cases are the next-word / previous-word / full-word-asymmetry vectors).
 */
export function tabTarget(
  grid: Grid,
  direction: Direction,
  from: number,
  toward: Toward,
  filled: ReadonlySet<number>,
): { cell: number; direction: Direction } {
  if (cellCount(grid) === 0 || !inRange(grid, from) || isBlock(grid, from))
    return { cell: firstPlayable(grid), direction };

  const cycle = tabCycle(grid);
  const n = cycle.length;
  const { start } = wordBounds(grid, direction, from);
  const current = cycle.findIndex(
    (clue) => clue.direction === direction && clue.start === start,
  );
  if (current === -1) return { cell: firstPlayable(grid), direction };

  const step = toward === "forward" ? 1 : -1;
  // Scan the cycle after the current clue for the first clue with an empty cell. The
  // current clue re-enters candidacy only after a full cycle (i === n).
  for (let i = 1; i <= n; i += 1) {
    const clue = cycle[(((current + step * i) % n) + n) % n];
    if (clue === undefined) continue;
    for (const cell of clue.cells)
      if (!filled.has(cell)) return { cell, direction: clue.direction };
  }

  // Nothing empty anywhere: move to the adjacent clue with no skipping so navigation
  // stays live after completion. Tab lands on its first cell, Shift+Tab on its last.
  const adjacent = cycle[(((current + step) % n) + n) % n];
  if (adjacent === undefined) return { cell: firstPlayable(grid), direction };
  const cells = adjacent.cells;
  const fallback = toward === "forward" ? cells[0] : cells[cells.length - 1];
  return { cell: fallback ?? from, direction: adjacent.direction };
}

/**
 * The cursor move after a letter is placed at `from`, with `filled` the board after that
 * keystroke (so `from` is filled). Advance forward with filled-skip inside the word to
 * the next empty cell; at the word's end, wrap to the word's first empty cell if the
 * word is incomplete, or stay on the last cell if the word is full (DESIGN §5).
 */
export function typingAdvance(
  grid: Grid,
  direction: Direction,
  from: number,
  filled: ReadonlySet<number>,
): number {
  const stride = strideOf(grid, direction);
  const { start, end } = wordBounds(grid, direction, from);

  for (let cell = from + stride; cell <= end; cell += stride)
    if (!filled.has(cell)) return cell;

  // Nothing empty after `from`: wrap to the word's first empty cell if any remains.
  for (let cell = start; cell <= end; cell += stride)
    if (!filled.has(cell)) return cell;

  return end; // the word is full: stay on its last cell
}

/**
 * The cursor move on Backspace. A non-empty `from` clears in place and stays. An
 * already-empty `from` steps back one cell with block-skip, crossing word boundaries
 * into the previous word, and clears wherever it lands (DESIGN §5).
 */
export function backspaceTarget(
  grid: Grid,
  direction: Direction,
  from: number,
  filled: ReadonlySet<number>,
): number {
  if (filled.has(from)) return from;
  return getNextCell(grid, direction, from, "backward", true);
}
