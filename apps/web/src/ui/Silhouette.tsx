// The puzzle's face: its black-square pattern rendered small, ink on paper. The mask is the
// server-derived silhouette (PROTOCOL section 12), an array of row strings of `#` (block) and
// `.` (playable); this draws it as an SVG grid using the board's own paint tokens, so a card
// reads like the real grid at a glance and follows light and dark for free. No letters, no
// numbers, no circles: the mask carries the pattern only, and the artwork is exactly that
// pattern. One strong object per card; typography does the rest.
import { useMemo } from "react";

/** The two glyphs a mask row is built from (PROTOCOL section 12). */
const BLOCK = "#";

interface Props {
  /** The black-square silhouette: `rows` strings, each `cols` chars of `#`/`.`. */
  mask: readonly string[];
  /**
   * The grid frame around the cells: drawn by default so a small silhouette reads as a board,
   * dropped for the tight index rows where a bare pattern sits quieter.
   */
  framed?: boolean;
  /**
   * A dimmed rendering for a room that is quietly done. Completion is calm, not loud: the
   * silhouette recedes rather than gaining a badge, so the shelf stays even.
   */
  muted?: boolean;
  className?: string;
}

/** One black square to paint, in mask (col, row) coordinates. */
interface Block {
  x: number;
  y: number;
}

/** Parse the mask once into geometry and the set of black squares to draw. */
function readMask(mask: readonly string[]): {
  cols: number;
  rows: number;
  blocks: Block[];
} {
  const rows = mask.length;
  const cols = rows === 0 ? 0 : mask[0]!.length;
  const blocks: Block[] = [];
  for (let y = 0; y < rows; y += 1) {
    const row = mask[y]!;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === BLOCK) blocks.push({ x, y });
    }
  }
  return { cols, rows, blocks };
}

/**
 * Render the silhouette as an inline SVG. The paper face is one background rect in the board's
 * `--cell-default`; each black square is a rect in `--cell-block`; a hairline grid and an
 * optional frame use the panel border so the pattern sits on paper, not on a void. The viewBox
 * is the mask's own cell units, so the same component scales from a 40px card thumbnail to a
 * larger hero tile with no per-size math. `aria-hidden`: the pattern is decorative, and the
 * card's name and facts carry the accessible label.
 */
export function Silhouette({
  mask,
  framed = true,
  muted = false,
  className,
}: Props) {
  const { cols, rows, blocks } = useMemo(() => readMask(mask), [mask]);
  if (cols === 0 || rows === 0) {
    // A degenerate mask never ships (ingestion always produces geometry), but a blank paper
    // tile is the calm fallback if one ever did, never a broken box.
    return (
      <div
        className={className}
        style={{ background: "var(--cell-default)" }}
        aria-hidden
      />
    );
  }
  return (
    <svg
      className={className}
      viewBox={`0 0 ${cols} ${rows}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      style={{ opacity: muted ? 0.5 : 1, display: "block" }}
    >
      {/* Paper: the playable field, the board's default cell paint. */}
      <rect x={0} y={0} width={cols} height={rows} fill="var(--cell-default)" />
      {/* Ink: the black squares, the board's block paint. */}
      {blocks.map((b) => (
        <rect
          key={`${b.x}-${b.y}`}
          x={b.x}
          y={b.y}
          width={1}
          height={1}
          fill="var(--cell-block)"
        />
      ))}
      {/* Hairline lattice: a whisper of the grid, drawn in the panel border so it never competes
          with the ink. Scaled to a fraction of a cell so it stays a hairline at any card size. */}
      <g
        stroke="var(--color-border)"
        strokeWidth={0.04}
        shapeRendering="crispEdges"
      >
        {Array.from({ length: cols - 1 }, (_, i) => (
          <line key={`v${i}`} x1={i + 1} y1={0} x2={i + 1} y2={rows} />
        ))}
        {Array.from({ length: rows - 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i + 1} x2={cols} y2={i + 1} />
        ))}
      </g>
      {framed && (
        <rect
          x={0}
          y={0}
          width={cols}
          height={rows}
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth={0.08}
        />
      )}
    </svg>
  );
}
