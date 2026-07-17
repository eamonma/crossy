// The post-game contribution mosaic's pure core: the data the reveal renders, kept out of the
// component so it is testable under the node vitest environment and reused by any surface that
// wants a static plate. The component (ContributionMosaic.tsx) owns the SVG and the animation;
// this file owns the arithmetic: which owner paints a cell, which glyph color reads on that
// owner's field (WCAG, the plate-study.html logic), and the per-cell sweep delay.
//
// The owner map is abstract on purpose (the component takes a `Record<cellIndex, userId>` it
// never questions): today the caller derives it from the store's last-writer `by`, and a later
// first-correct read model (DESIGN.md D16) swaps the source with no change here.
//
// Named mosaicReveal.ts, not contributionMosaic.ts: ContributionMosaic.tsx sits beside it, and on
// a case-insensitive filesystem (any macOS clone) TypeScript treats two basenames that differ only
// in case as the same file (TS1149). Module basenames here must differ in more than case, the same
// rule roster.ts pins against SolvingNow.tsx.

/** Ink: the near-black the solved board wears for its glyphs (--letter, sand-12). */
export const INK = "#21201c";
/** The other pole for on-color glyphs: white letters on a deep field. */
export const WHITE = "#ffffff";

/** A player as the mosaic needs them: an id to key the owner map, and the color they paint. */
export interface MosaicPlayer {
  readonly color: string;
}

/** The abstract attribution the mosaic renders: cell index to the id of the owner who paints it.
 * A cell with no entry (a block, an unwritten square, an unknown id) stays uncolored. */
export type OwnerMap = Readonly<Record<number, string>>;

/** The roster the ids resolve through: id to player. Only `color` is load-bearing here. */
export type Roster = Readonly<Record<string, MosaicPlayer>>;

// --- WCAG contrast: which glyph color reads on a saturated owner field ---------------------
// The relative-luminance path from WCAG 2.x, reused verbatim from plate-study.html so the two
// never drift. On a light swatch (amber, teal) ink letters win; on a deep one (indigo, red,
// purple) white wins. This only matters where letters are drawn on color (the plate and any
// share variant that keeps glyphs); the peak FIELD hides letters entirely.

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null || m[1] === undefined) return null;
  const h = m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` color; 0 for a malformed string (treated as black). */
export function luminance(color: string): number {
  const c = parseHex(color);
  if (c === null) return 0;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrast(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The glyph color that reads on a given owner field: white or ink, whichever carries the higher
 * WCAG contrast. Amber and teal come back ink; indigo, red, and purple come back white. Ties go
 * to white (the more legible default on a mid field). Used only on variants that draw letters on
 * color; the textless FIELD never calls it.
 */
export function textOn(color: string): string {
  const l = luminance(color);
  return contrast(l, luminance(WHITE)) >= contrast(l, luminance(INK))
    ? WHITE
    : INK;
}

// --- The rendered cell set -----------------------------------------------------------------

/** One playable cell the mosaic paints: its owner color (or null when unowned), the letter it
 * already holds from board state (never a solution lookup, INV-6), and the sweep timing inputs. */
export interface MosaicCell {
  /** Flat cell index (row-major), the CrosswordGrid convention. */
  readonly index: number;
  readonly col: number;
  readonly row: number;
  /** The owner's field color, or null for an unowned playable cell (renders as a plain square). */
  readonly color: string | null;
  /** The glyph color to use where letters are drawn on this cell's color (plate/share). */
  readonly onColor: string;
  /** The letter already in board state, or null (a blank playable cell). Never a solution. */
  readonly letter: string | null;
}

/** Inputs to build the cell set: geometry, the blocks, the letters already on the board, and the
 * abstract attribution plus the roster it resolves through. */
export interface MosaicInput {
  readonly cols: number;
  readonly rows: number;
  readonly blocks: ReadonlySet<number>;
  /** Letters the board already holds (the store's rendered values); the mosaic draws only these. */
  readonly letters: ReadonlyMap<number, string>;
  readonly ownerMap: OwnerMap;
  readonly roster: Roster;
}

/**
 * Resolve the playable cells the mosaic paints. Block cells are skipped (they are never owned and
 * never painted). Each playable cell carries its owner color (resolved id to roster to color, null
 * when unowned or the id is unknown) and its already-present letter. Pure: same input, same output.
 */
export function mosaicCells(input: MosaicInput): MosaicCell[] {
  const { cols, rows, blocks, letters, ownerMap, roster } = input;
  const cells: MosaicCell[] = [];
  for (let index = 0; index < cols * rows; index += 1) {
    if (blocks.has(index)) continue;
    const ownerId = ownerMap[index];
    const color =
      ownerId !== undefined ? (roster[ownerId]?.color ?? null) : null;
    cells.push({
      index,
      col: index % cols,
      row: Math.floor(index / cols),
      color,
      onColor: color === null ? INK : textOn(color),
      letter: letters.get(index) ?? null,
    });
  }
  return cells;
}

// --- The diagonal sweep --------------------------------------------------------------------
// The bloom sweeps from the top-left corner to the bottom-right along the anti-diagonal, so a
// cell's delay is its (col + row) distance normalized over the board's span. The ratified arc
// (plate-study.html) spreads the bloom across ~1050ms plus a little per-cell jitter so the wall
// of color reads as caught in air, not a mechanical wipe.

/** The bloom's spread, ms: the last corner starts this long after the first (plate-study.html). */
export const BLOOM_SPREAD_MS = 1050;
/** The peak's hold before the settle to wash, ms. */
export const PEAK_HOLD_MS = 1050;
/** The per-cell jitter ceiling layered on the diagonal delay, ms. */
export const JITTER_MS = 130;
/** The wash's quieter re-sweep spread once the peak lets go, ms. */
export const SETTLE_SPREAD_MS = 260;
/** The crisp per-cell tint weight of the WASH frame. The time-gated replay (REPLAY.md) paints
 * revealed squares at this weight, and the small static "wash" thumbnails keep it; the settled
 * record no longer wears it (it melts into the blurred field at SETTLED_WASH_ALPHA below).
 * Matched to iOS's GridMosaic.washAlpha (apps/ios CompletionMoment.swift) so the crisp tint reads
 * at the same weight on both platforms now that the owner colors are the shared identity palette. */
export const WASH_ALPHA = 0.3;

// --- The settled record: the blurred field ---------------------------------------------------
// At the settle the crisp field no longer drops to a hard per-cell tint. The crisp cells fade out
// on the settle diagonal while a gaussian-blurred duplicate of the tint layer fades in UNDER the
// ink letters, so contribution reads as territory flowing behind the grid, not a checkerboard
// (wash-blur-study, owner-ratified 2026-07-17; design/post-game/ANALYSIS.md). The peak FIELD and
// the share plate stay crisp and letterless; the replay keeps the crisp WASH_ALPHA tint; isolating
// a solver hides the blur and returns crisp cells (isolation has no shape in a blurred single hue).

/** The blur's stdDeviation as a fraction of the cell module: exactly 20 at the web's 36-unit
 * cell. iOS and Android carry the same cell-relative token, the way WASH_ALPHA is shared. */
export const MOSAIC_BLUR_RADIUS_RATIO = 20 / 36;

/** The blurred layer's settled weight over the ground (group opacity on the blur layer). The
 * blurred settled record wears this while replay keeps WASH_ALPHA; under isolation the crisp
 * cells return at this weight (times ISOLATION_DIM for everyone but the isolated owner). Shared
 * cross-platform like WASH_ALPHA: iOS and Android adopt the same 0.5 in parallel. */
export const SETTLED_WASH_ALPHA = 0.5;

/** The melt: how the blurred layer fades in at the settle while the crisp cells let go. */
export const MELT_FADE_MS = 900;
export const MELT_DELAY_MS = 120;
export const MELT_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/** The blur radius in board units for a given cell module (20 at the 36-unit cell). */
export function blurRadius(cell: number): number {
  return cell * MOSAIC_BLUR_RADIUS_RATIO;
}

/** How far a board-edge tint rect extends past the frame before blurring: 1.5x the blur radius,
 * so the clipped blur stays saturated at the frame instead of fading toward the ground. */
export function blurOverscan(cell: number): number {
  return 1.5 * blurRadius(cell);
}

/** An axis-aligned rect in board units. */
export interface TintRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The blurred layer's tint rect for a cell: the plain cell square, except sides on the board edge
 * extend outward by `overscan` (the blur layer is clipped to the board rect, so the overhang only
 * feeds the blur; it never paints outside the frame). Pure: same input, same output.
 */
export function overscanTintRect(
  col: number,
  row: number,
  cols: number,
  rows: number,
  cell: number,
  overscan: number,
): TintRect {
  const x0 = col === 0 ? -overscan : col * cell;
  const y0 = row === 0 ? -overscan : row * cell;
  const x1 = col === cols - 1 ? cols * cell + overscan : (col + 1) * cell;
  const y1 = row === rows - 1 ? rows * cell + overscan : (row + 1) * cell;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * A cell's bloom delay, ms: its anti-diagonal distance over the board's span, scaled to the
 * bloom spread, plus jitter. `jitter01` is a caller-supplied 0..1 (Math.random in the component,
 * a fixed value in a test) so this stays pure and the delay is deterministic under test.
 */
export function bloomDelay(
  col: number,
  row: number,
  cols: number,
  rows: number,
  jitter01: number,
): number {
  const span = cols + rows;
  const along = span === 0 ? 0 : (col + row) / span;
  return along * BLOOM_SPREAD_MS + jitter01 * JITTER_MS;
}

/** A cell's settle delay, ms: the same diagonal ordering as the bloom but a quicker, quieter
 * spread, so the wash washes back in the direction the color bloomed. */
export function settleDelay(
  col: number,
  row: number,
  cols: number,
  rows: number,
): number {
  const span = cols + rows;
  const along = span === 0 ? 0 : (col + row) / span;
  return along * SETTLE_SPREAD_MS;
}
