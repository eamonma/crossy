// Standard crossword numbering, derived from grid geometry. A playable cell starts an
// across word when its left neighbor is a block or a grid edge and a playable cell sits
// to its right; likewise for down words vertically. Cells that start either get the
// next number, scanning row-major. This is the same structure ingestion produces on the
// server (DESIGN.md §7); here it runs locally on fake boards.
import type { Clue } from "./types";

export interface Layout {
  numbers: Map<number, number>;
  acrossClues: Clue[];
  downClues: Clue[];
}

export function computeLayout(
  cols: number,
  rows: number,
  blocks: ReadonlySet<number>,
): Layout {
  const numbers = new Map<number, number>();
  const acrossClues: Clue[] = [];
  const downClues: Clue[] = [];
  const isBlock = (i: number): boolean => blocks.has(i);
  let n = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (isBlock(i)) continue;

      const startsAcross =
        (c === 0 || isBlock(i - 1)) && c + 1 < cols && !isBlock(i + 1);
      const startsDown =
        (r === 0 || isBlock(i - cols)) && r + 1 < rows && !isBlock(i + cols);
      if (!startsAcross && !startsDown) continue;

      n += 1;
      numbers.set(i, n);

      if (startsAcross) {
        const cells: number[] = [];
        for (let cc = c, ii = i; cc < cols && !isBlock(ii); cc++, ii++) {
          cells.push(ii);
        }
        acrossClues.push({ number: n, direction: "across", cells });
      }
      if (startsDown) {
        const cells: number[] = [];
        for (let rr = r, ii = i; rr < rows && !isBlock(ii); rr++, ii += cols) {
          cells.push(ii);
        }
        downClues.push({ number: n, direction: "down", cells });
      }
    }
  }

  return { numbers, acrossClues, downClues };
}
