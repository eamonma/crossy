import { wordBounds } from "@crossy/engine";
import type { Direction, Grid } from "@crossy/engine";
import type { Clue } from "../domain/types";

export interface PercentRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface WordLoupeGeometry {
  /** The active word in board-relative percentages. */
  readonly lens: PercentRect;
  /** The selected cell in board-relative percentages, independent of the morphing lens. */
  readonly focus: PercentRect;
}

const LOUPE_OVERHANG_CELLS = 0.1;

/**
 * Whether the completed board shows the word loupe at all: only over the SETTLED record, never
 * over the reveal arc (ink -> field -> settle) and never over a running replay. This is the
 * cross-platform contract web was missing: iOS gates on `analysisResting &&
 * completion.mosaicSettled` (SolveScreen) and Android on `showsWordLoupe(roomStatus,
 * moment.settled)` (RoomScreen). `settled` is the mosaic's settled signal (true on a non-bloom
 * mount, true again at the arc's settle beat); `replaying` is a non-null replay playhead. Only
 * the loupe visual is gated; the selection targets stay live throughout (reactions are legal in
 * any game status, PROTOCOL.md section 9). Pure: same input, same output.
 */
export function showsWordLoupe(settled: boolean, replaying: boolean): boolean {
  return settled && !replaying;
}

/**
 * Project one clue into the board coordinate spaces the liquid-glass loupe needs. Its small
 * overhang is deliberately not clamped, so an edge answer can float beyond the paper. The focus
 * stays in board coordinates so an Across/Down morph never stretches the selected-cell marker.
 */
export function wordLoupeGeometry(
  clue: Pick<Clue, "cells">,
  selectedCell: number,
  cols: number,
  rows: number,
): WordLoupeGeometry {
  if (cols <= 0 || rows <= 0 || clue.cells.length === 0) {
    throw new Error("word loupe needs a non-empty grid and clue");
  }

  const cell = clue.cells.includes(selectedCell)
    ? selectedCell
    : clue.cells[0]!;
  const coordinates = clue.cells.map((index) => ({
    col: index % cols,
    row: Math.floor(index / cols),
  }));
  const minCol = Math.min(...coordinates.map((point) => point.col));
  const maxCol = Math.max(...coordinates.map((point) => point.col));
  const minRow = Math.min(...coordinates.map((point) => point.row));
  const maxRow = Math.max(...coordinates.map((point) => point.row));
  const selectedCol = cell % cols;
  const selectedRow = Math.floor(cell / cols);
  const lensStartCol = minCol - LOUPE_OVERHANG_CELLS;
  const lensEndCol = maxCol + 1 + LOUPE_OVERHANG_CELLS;
  const lensStartRow = minRow - LOUPE_OVERHANG_CELLS;
  const lensEndRow = maxRow + 1 + LOUPE_OVERHANG_CELLS;

  return {
    lens: {
      left: (lensStartCol / cols) * 100,
      top: (lensStartRow / rows) * 100,
      width: ((lensEndCol - lensStartCol) / cols) * 100,
      height: ((lensEndRow - lensStartRow) / rows) * 100,
    },
    focus: {
      left: (selectedCol / cols) * 100,
      top: (selectedRow / rows) * 100,
      width: 100 / cols,
      height: 100 / rows,
    },
  };
}

/** The active word through one selectable grid cell, projected for the production mosaic. */
export function wordLoupeForSelection(
  grid: Grid,
  direction: Direction,
  selectedCell: number,
): WordLoupeGeometry | null {
  const total = grid.cols * grid.rows;
  if (
    !Number.isInteger(selectedCell) ||
    selectedCell < 0 ||
    selectedCell >= total ||
    grid.blocks.has(selectedCell)
  ) {
    return null;
  }

  const { start, end } = wordBounds(grid, direction, selectedCell);
  const stride = direction === "across" ? 1 : grid.cols;
  const cells: number[] = [];
  for (let cell = start; cell <= end; cell += stride) cells.push(cell);
  return wordLoupeGeometry({ cells }, selectedCell, grid.cols, grid.rows);
}
