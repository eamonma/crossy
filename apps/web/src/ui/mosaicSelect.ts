// The completed-mosaic selection geometry (reactions-11): where the aim overlay puts its per-cell
// pointer targets and its selection ring over the mosaic art. Pure so the legality it encodes is
// vector-greppable; the component (MosaicSelectLayer) is only the DOM around these numbers.
//
// The mosaic renders the solved board as a 36-unit-per-cell SVG that fills the board wrapper
// (ContributionMosaic CELL), so cell boxes are pure percentages of the wrapper, the same idiom the
// sticker and HUD overlays use (reactions/ReactionStickers.tsx). No script measures anything.
import type { Grid } from "@crossy/engine";

export interface CellBox {
  readonly cell: number;
  readonly leftPct: number;
  readonly topPct: number;
  readonly widthPct: number;
  readonly heightPct: number;
}

/** One cell's percentage box inside the board overlay, row-major (PROTOCOL.md §3:
 * `row = floor(cell / cols)`, `col = cell mod cols`). */
export function cellBox(cell: number, cols: number, rows: number): CellBox {
  const col = cell % cols;
  const row = Math.floor(cell / cols);
  return {
    cell,
    leftPct: (col / cols) * 100,
    topPct: (row / rows) * 100,
    widthPct: 100 / cols,
    heightPct: 100 / rows,
  };
}

/** Whether a cell can hold the mosaic selection: an integer in range that is not a black square,
 * the server's own cursor/react target rule (isCursorTarget, PROTOCOL.md §9), so a block is never
 * selectable (the live grid's cellClick rule) and never carries the ring. */
export function isMosaicSelectable(cell: number, grid: Grid): boolean {
  const total = grid.cols * grid.rows;
  return (
    Number.isInteger(cell) &&
    cell >= 0 &&
    cell < total &&
    !grid.blocks.has(cell)
  );
}

/** The pointer targets: a box for every playable cell, blocks excluded so a click on a block falls
 * through and never moves the selection (same rule as the live grid). */
export function mosaicTargets(grid: Grid): CellBox[] {
  const { cols, rows, blocks } = grid;
  const boxes: CellBox[] = [];
  for (let cell = 0; cell < cols * rows; cell += 1) {
    if (blocks.has(cell)) continue;
    boxes.push(cellBox(cell, cols, rows));
  }
  return boxes;
}
