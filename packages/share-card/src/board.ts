// The mosaic board: the finished grid drawn as the bona fide play grid players solved
// on (apps/web/src/ui/CrosswordGrid.tsx and the board tokens in apps/web/src/styles.css):
// square cells, NO rounded corners, pale hairlines running cell to cell, a quiet frame
// registered INSIDE the board edge (the stroke straddles the edge like the game's
// board-frame rect, so nothing spills outside the board box). Open cells carry a wash
// of whoever solved them (the caller decides the fill per cell); blocks are the game's
// near-black cell-block tone on both grounds (SHARE.md layout contract).

export interface BoardStyle {
  /** Block (black square) fill: the game's --cell-block tone. */
  readonly block: string;
  /** Gridline color: the game's pale --stroke hairline, per ground. */
  readonly line: string;
  /** Frame color: the game's --board-frame (alpha-black whisper on light). */
  readonly frame: string;
}

/**
 * The play grid's stroke module, mirrored VERBATIM from apps/web/src/styles.css
 * (--grid-cell: 36px, --grid-stroke: 0.6px, --grid-frame: 2px). This package imports
 * nothing (share-card-is-standalone), so the values are a copy; the boardChrome
 * tripwire test in apps/web pins this copy against the CSS source.
 */
export const GRID_MODULE = { cell: 36, line: 0.6, frame: 2 } as const;

/** The stroke widths the board draws at a given cell size: the play grid's ratios
 * (gridline 0.6/36 ~ 1.67% of a cell, frame 2/36 ~ 5.56%), each with a raster floor
 * (line 1, frame 1.5) so a hairline survives a 1x PNG pass (og renders a 15-wide at
 * ~34px cells, where the faithful 0.57px line would alias away; the floor is the one
 * deliberate nudge, recorded in SHARE.md). The frame draws inside the board edge, so
 * callers need no padding for it. */
export function boardStrokes(cell: number): { line: number; frame: number } {
  return {
    line: Math.max(1, round2(cell * (GRID_MODULE.line / GRID_MODULE.cell))),
    frame: Math.max(1.5, round2(cell * (GRID_MODULE.frame / GRID_MODULE.cell))),
  };
}

/**
 * Render the board group at (x, y): `cell` px squares, `cols` x `rows`, blocks from the
 * mask, every other cell filled by `fillOf(cell)`. Gridline width scales with the cell
 * (the play grid's ratio, ~1.67% of a cell). `classOf`, when given, stamps a class on OPEN
 * cell rects only (a block is chrome, never addressable), so a consumer's stylesheet
 * can animate the mosaic without touching the board's geometry; without it the emitted
 * bytes are unchanged.
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
  classOf?: (cellIndex: number) => string | undefined,
): string {
  const w = cols * cell;
  const h = rows * cell;
  const { line, frame } = boardStrokes(cell);

  const rects: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      const block = blocks.has(idx);
      const fill = block ? style.block : fillOf(idx);
      const cls = block ? undefined : classOf?.(idx);
      const classAttr =
        cls !== undefined && cls !== "" ? ` class="${cls}"` : "";
      // data-cell keys each square so a test can assert the mask's geometry without
      // re-deriving the layout arithmetic it is trying to check.
      rects.push(
        `<rect data-cell="${idx}" x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${fill}"${classAttr}/>`,
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

  // The frame straddles the board edge from the inside (the play grid's registration:
  // CrosswordGrid's board-frame rect at x=1,y=1 with width cols*36-2): inset by half
  // the stroke, so the painted stroke spans exactly [0, frame] and never spills
  // outside the board box.
  const inset = round2(frame / 2);
  return (
    `<g transform="translate(${x} ${y})">` +
    rects.join("") +
    (lines.length > 0
      ? `<path d="${lines.join("")}" stroke="${style.line}" stroke-width="${line}" fill="none"/>`
      : "") +
    `<rect x="${inset}" y="${inset}" width="${round2(w - frame)}" height="${round2(h - frame)}" fill="none" stroke="${style.frame}" stroke-width="${frame}"/>` +
    `</g>`
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
