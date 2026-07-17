// The mosaic board: the finished grid drawn in the approved mock's idiom (itself the
// og.svg board language): square cells, NO rounded corners, gridlines running cell to
// cell inside a slightly heavier frame. Open cells carry a wash of whoever solved them
// (the caller decides the fill per cell); blocks are ink on light and near-black on
// dark, where the gridlines sit a step LIGHTER than the blocks so the lattice reads
// against Observatory (SHARE.md layout contract).

export interface BoardStyle {
  /** Block (black square) fill. */
  readonly block: string;
  /** Gridline color: ink on light; on dark a lifted tone so lines read over blocks. */
  readonly line: string;
  /** Frame color, drawn a touch heavier than the gridlines. */
  readonly frame: string;
}

/**
 * Render the board group at (x, y): `cell` px squares, `cols` x `rows`, blocks from the
 * mask, every other cell filled by `fillOf(cell)`. Gridline width scales with the cell
 * (the og.svg ratio, ~4.5% of a cell).
 */
export function boardSvg(
  x: number,
  y: number,
  cols: number,
  rows: number,
  cell: number,
  blocks: ReadonlySet<number>,
  fillOf: (cellIndex: number) => string,
  style: BoardStyle,
): string {
  const w = cols * cell;
  const h = rows * cell;
  const line = Math.max(1.5, round2(cell * 0.045));
  const frame = round2(line * 1.6);

  const rects: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      const fill = blocks.has(idx) ? style.block : fillOf(idx);
      // data-cell keys each square so a test can assert the mask's geometry without
      // re-deriving the layout arithmetic it is trying to check.
      rects.push(
        `<rect data-cell="${idx}" x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`,
      );
    }
  }

  const lines: string[] = [];
  for (let c = 1; c < cols; c += 1) {
    lines.push(`M${c * cell} 0V${h}`);
  }
  for (let r = 1; r < rows; r += 1) {
    lines.push(`M0 ${r * cell}H${w}`);
  }

  return (
    `<g transform="translate(${x} ${y})">` +
    rects.join("") +
    (lines.length > 0
      ? `<path d="${lines.join("")}" stroke="${style.line}" stroke-width="${line}" fill="none"/>`
      : "") +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="${style.frame}" stroke-width="${frame}"/>` +
    `</g>`
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
