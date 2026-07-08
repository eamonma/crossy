/**
 * THROWAWAY UNTIL ENGINE (Wave 2.1d). This module is the client-side navigation model
 * for the UX playground. `packages/engine` implements the real, vector-conformant
 * navigation in Wave 2.1a and the web client adopts it in 2.1d, deleting this file.
 *
 * It is deliberately one pure module: grid in, position out, no React, no IO, no
 * clock, no identity (mirrors the INV-9 shape the engine must keep). The primitive is
 * `getNextCell`, whose observable behavior matches the 12 seed cases in
 * `vectors/v1/navigation/single-cell-advance.json` (see navigation.test.ts). Everything
 * else (arrows, typing, backspace, Tab, click) composes from it plus `wordCells`.
 *
 * Note on `canEscapeWord`: this implements v4's re-specified clamp semantics
 * (PROTOCOL.md §13, DESIGN.md §5), not v2's raw short-circuit. A straight port of v2's
 * getNextCell fails seed 11; v4's "hold at the word's last cell" passes it. See SP6
 * divergence 1.
 */
import type {
  BackspaceMode,
  Clue,
  Direction,
  Grid,
  Selection,
  ShiftTabMode,
  Toward,
} from "./types";

const otherDirection = (d: Direction): Direction =>
  d === "across" ? "down" : "across";

function isFilled(
  fills: ReadonlyMap<number, string> | undefined,
  cell: number,
): boolean {
  const v = fills?.get(cell);
  return typeof v === "string" && v.length > 0;
}

/**
 * The word (maximal run of playable cells along `direction`) that contains `cell`,
 * returned in ascending index order. Assumes `cell` is a playable cell; returns just
 * `[cell]` for an isolated cell and `[]` for an out-of-grid index.
 */
export function wordCells(
  grid: Grid,
  direction: Direction,
  cell: number,
): number[] {
  const { cols, rows, blocks } = grid;
  const total = cols * rows;
  if (cell < 0 || cell >= total) return [];
  if (blocks.has(cell)) return [cell];

  const cells = [cell];
  if (direction === "across") {
    const rowStart = Math.floor(cell / cols) * cols;
    const rowEnd = rowStart + cols;
    for (let c = cell - 1; c >= rowStart && !blocks.has(c); c--)
      cells.unshift(c);
    for (let c = cell + 1; c < rowEnd && !blocks.has(c); c++) cells.push(c);
  } else {
    for (let c = cell - cols; c >= 0 && !blocks.has(c); c -= cols)
      cells.unshift(c);
    for (let c = cell + cols; c < total && !blocks.has(c); c += cols)
      cells.push(c);
  }
  return cells;
}

/**
 * Single-cell navigation primitive. Given the grid, the axis, the origin cell, and the
 * direction of travel, return the next cell.
 *
 * - Skips blocks in the direction of travel.
 * - Moving forward, if `grid.fills` is present, also skips filled cells within the
 *   word, falling back to the immediately next cell when the word is full to its end.
 * - `canEscapeWord` (default true) only bites at a word boundary: false holds at the
 *   word's last cell instead of crossing into the next word; true crosses a block.
 * - Grid edges clamp: never returns an out-of-grid index.
 * - An out-of-grid or block origin (e.g. the initial position -1) scans outward for the
 *   first playable cell.
 */
export function getNextCell(
  grid: Grid,
  direction: Direction,
  from: number,
  toward: Toward,
  canEscapeWord = true,
): number {
  const { cols, rows, blocks } = grid;
  const total = cols * rows;
  if (total <= 0) return from; // empty grid is a no-op (seed 9)

  const stride = direction === "across" ? 1 : cols;
  const step = toward === "forward" ? stride : -stride;
  const inBounds = (i: number): boolean => i >= 0 && i < total;

  const scanForPlayable = (start: number): number => {
    for (let i = start; inBounds(i); i += step) {
      if (!blocks.has(i)) return i;
    }
    return from; // ran off the grid edge → clamp (seed 4)
  };

  // Invalid origin: first-playable-cell scan (seed 10, and the initial position -1).
  if (!inBounds(from) || blocks.has(from)) {
    return scanForPlayable(from + step);
  }

  const word = wordCells(grid, direction, from);
  const atWordEnd =
    toward === "forward" ? from === word[word.length - 1] : from === word[0];

  if (!atWordEnd) {
    // Move within the current word.
    if (toward === "forward" && grid.fills) {
      const pos = word.indexOf(from);
      for (let k = pos + 1; k < word.length; k++) {
        const c = word[k];
        if (c !== undefined && !isFilled(grid.fills, c)) return c;
      }
      // Word is full ahead: fall back to the immediately next cell (DESIGN.md §5).
    }
    return from + step;
  }

  if (!canEscapeWord) return from; // clamp at the word's last cell (seed 11)
  return scanForPlayable(from + step); // cross the block into the next word (seeds 3-6, 8)
}

// ---------------------------------------------------------------------------
// Higher-level interactions. Each is a pure transform: (puzzle geometry, fills,
// selection) in, a new selection (and for typing/backspace, new fills) out. The React
// layer only maps DOM events onto these and stores the result.
// ---------------------------------------------------------------------------

export interface Interaction {
  selection: Selection;
  fills?: Map<number, string>;
}

const ASCII_LETTER_OR_DIGIT = /^[A-Z0-9]$/;

/** ASCII-only uppercase (INV-1): map a-z to A-Z, leave every other code point alone. */
function asciiUpper(ch: string): string {
  let out = "";
  for (const c of ch) {
    const code = c.charCodeAt(0);
    out += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : c;
  }
  return out;
}

/** Arrow key: move along the axis with block-skip, or toggle direction across it. */
export function moveByArrow(
  grid: Grid,
  selection: Selection,
  arrowAxis: Direction,
  arrowToward: Toward,
): Selection {
  if (arrowAxis !== selection.direction) {
    return { cell: selection.cell, direction: arrowAxis };
  }
  // Arrows use block-skip but not filled-skip: pass the grid without fills.
  const bareGrid: Grid = {
    cols: grid.cols,
    rows: grid.rows,
    blocks: grid.blocks,
  };
  const next = getNextCell(
    bareGrid,
    selection.direction,
    selection.cell,
    arrowToward,
  );
  return { cell: next, direction: selection.direction };
}

/**
 * Type a letter: write it, then advance with forward filled-skip. At the word's end,
 * wrap to the word's first empty cell if the word is incomplete, else stay on the last
 * cell (DESIGN.md §5, v2 parity). Non-alphanumeric input is ignored.
 */
export function typeLetter(
  grid: Grid,
  fills: ReadonlyMap<number, string>,
  selection: Selection,
  rawChar: string,
): Interaction {
  const ch = asciiUpper(rawChar);
  if (!ASCII_LETTER_OR_DIGIT.test(ch)) return { selection };

  const nextFills = new Map(fills);
  nextFills.set(selection.cell, ch);

  const word = wordCells(grid, selection.direction, selection.cell);
  const stepped = getNextCell(
    { ...grid, fills: nextFills },
    selection.direction,
    selection.cell,
    "forward",
    false,
  );

  let cell: number;
  if (stepped !== selection.cell && !isFilled(nextFills, stepped)) {
    cell = stepped;
  } else {
    const firstEmpty = word.find((c) => !isFilled(nextFills, c));
    cell = firstEmpty ?? word[word.length - 1] ?? selection.cell;
  }
  return {
    selection: { cell, direction: selection.direction },
    fills: nextFills,
  };
}

/**
 * Backspace. If the current cell is filled, clear it and stay. If it is already empty,
 * step back and clear the cell we land on. The step-back honors the open decision B:
 * `v2-cross-block` crosses the block into the previous word; `clamp-to-word` holds at
 * the word's start.
 */
export function backspace(
  grid: Grid,
  fills: ReadonlyMap<number, string>,
  selection: Selection,
  mode: BackspaceMode,
): Interaction {
  if (isFilled(fills, selection.cell)) {
    const nextFills = new Map(fills);
    nextFills.delete(selection.cell);
    return { selection, fills: nextFills };
  }

  const canEscapeWord = mode === "v2-cross-block";
  const bareGrid: Grid = {
    cols: grid.cols,
    rows: grid.rows,
    blocks: grid.blocks,
  };
  const prev = getNextCell(
    bareGrid,
    selection.direction,
    selection.cell,
    "backward",
    canEscapeWord,
  );
  if (prev === selection.cell) return { selection }; // clamped at the word's start

  const nextFills = new Map(fills);
  nextFills.delete(prev);
  return {
    selection: { cell: prev, direction: selection.direction },
    fills: nextFills,
  };
}

/** Toggle the solving axis on the focused cell. */
export function toggleDirection(selection: Selection): Selection {
  return {
    cell: selection.cell,
    direction: otherDirection(selection.direction),
  };
}

/**
 * Click a cell. Clicking the focused cell toggles direction. Clicking another cell
 * selects it, keeping the current axis when that cell belongs to a word on that axis,
 * otherwise switching to the axis where it does.
 */
export function selectCell(
  grid: Grid,
  selection: Selection,
  cell: number,
): Selection {
  if (grid.blocks.has(cell)) return selection;
  if (cell === selection.cell) return toggleDirection(selection);

  const sameAxis = wordCells(grid, selection.direction, cell).length > 1;
  const direction = sameAxis
    ? selection.direction
    : otherDirection(selection.direction);
  return { cell, direction };
}

function firstPlayableCell(grid: Grid): number {
  return getNextCell(grid, "across", -1, "forward");
}

/**
 * Tab and Shift+Tab. Forward jumps to the next clue on the current axis and lands on
 * its first empty cell, else its start. Backward honors the open decision A. Past
 * either end of the clue list, wrap to the grid's first playable cell (v2 parity).
 */
export function tabToClue(
  grid: Grid,
  fills: ReadonlyMap<number, string>,
  clues: readonly Clue[],
  selection: Selection,
  toward: Toward,
  shiftTabMode: ShiftTabMode,
): Selection {
  const list = clues.filter((c) => c.direction === selection.direction);
  const index = list.findIndex((c) => c.cells.includes(selection.cell));

  const targetClue = toward === "forward" ? list[index + 1] : list[index - 1];

  if (!targetClue) {
    return { cell: firstPlayableCell(grid), direction: selection.direction };
  }

  const cells = targetClue.cells;
  const firstEmpty = cells.find((c) => !isFilled(fills, c));
  const start = cells[0] ?? selection.cell;
  const end = cells[cells.length - 1] ?? start;

  let cell: number;
  if (toward === "forward") {
    cell = firstEmpty ?? start;
  } else if (shiftTabMode === "symmetric-first-empty") {
    cell = firstEmpty ?? start;
  } else {
    // v2-asymmetric: start if empty, else the clue's end. Never a mid-word empty.
    cell = isFilled(fills, start) ? end : start;
  }
  return { cell, direction: selection.direction };
}

/** The initial position: first playable cell, direction across (DESIGN.md §5). */
export function initialSelection(grid: Grid): Selection {
  return { cell: firstPlayableCell(grid), direction: "across" };
}
