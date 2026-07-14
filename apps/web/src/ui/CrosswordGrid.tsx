// SVG crossword grid: DESIGN.md section 10 with the SP6 v2 pixel constants, promoted
// to spec baseline by Decision 2.1d-6. One cell is a 36-unit module scaled to fit;
// background precedence black square > current cell > check > active word >
// teammate-here > default; teammate presence anchors to the cell's bottom-right,
// clear of the top-left clue number (DESIGN section 10, owner-approved Wave 2.1d).
// The active word derives from the engine's wordBounds, and the conflict flash
// (Decision 2.1d-1) renders as a 300 ms ease-out fade of the writer's color.
import type { ReactNode } from "react";
import { wordBounds } from "@crossy/engine";
import type { Direction, Grid } from "@crossy/engine";
import type { Selection } from "../input/actions";
import type { Puzzle } from "../domain/types";
import type { ReactionEntry } from "../reactions/reactionModel";

const CELL = 36;

// Reaction sticker geometry (Wave 7.3, retuned by owner ruling 2026-07-14). The sticker sits
// mostly within its cell: ~64% of the module, centered with a slight lower-left bias so it favors
// the corner away from the clue number (top-left) and the presence stack (bottom-right). Bleed is
// no longer a design goal, only a possibility: the layer paints above the grid strokes, and the
// wide seeded scatter (±8 units) can poke a sticker past its cell edges.
const STICKER_SIZE = 23; // ~64% of the 36-unit module
const STICKER_CENTER_X = 17; // sticker center, a hair left of the 18-unit cell center
const STICKER_CENTER_Y = 20; // and a hair below it
const STICKER_SCATTER = 8; // seeded jitter, ± units per axis: the pile's scatter spread
const STICKER_PILE_CAP = 4; // several on one cell pile; only the newest four paint

// A stable unsigned hash of the sprite key (FNV-1a), so a sprite's rotation and pile scatter are
// deterministic across re-renders and unique per sprite.
function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A stable default for the optional xref prop, so read-only surfaces (party view, demo) omit it.
const EMPTY: ReadonlySet<number> = new Set();

/** A teammate rendered in a cell: cursor arrow, avatar, and flash all use their color. */
export interface PresenceEntry {
  userId: string;
  initial: string;
  /**
   * The opaque avatar URL, or null (PROTOCOL.md §4). When present the puck paints the image inside
   * its circle; when null, still loading, or on a load error the colored initial underneath shows
   * through, so the existing initial puck is the render for every non-image case.
   */
  avatarUrl: string | null;
  color: string;
  direction: Direction;
}

/** One conflict flash in flight: the writer's color fading over the cell. */
export interface FlashEntry {
  color: string;
  nonce: number;
}

interface Props {
  puzzle: Puzzle;
  /** Null on read-only surfaces (the party view): no current cell, no active word. */
  selection: Selection | null;
  fills: ReadonlyMap<number, string>;
  presence: ReadonlyMap<number, readonly PresenceEntry[]>;
  flashes: ReadonlyMap<number, FlashEntry>;
  /** Cells of the clues the active clue references, painted faintly (DESIGN.md section 10).
   * Empty on read-only surfaces that carry no active clue (party view, demo). */
  xref?: ReadonlySet<number>;
  /** Live reaction stickers (Wave 7.3). Piled and positioned here; empty on read-only surfaces. */
  reactions?: readonly ReactionEntry[];
  onCellClick: (cell: number) => void;
  onFlashEnd: (cell: number, nonce: number) => void;
}

/** A stable default for the optional reactions prop (party view, demo mosaic, tests). */
const NO_REACTIONS: readonly ReactionEntry[] = [];

/**
 * One sticker: an emoji at a seeded scatter offset and a seeded ±8-12° tilt. Everything about its
 * placement derives from the entry's own stable key and NOTHING from its pile siblings, so a
 * sticker's position, lean, and rotation are fixed at creation and never move while it lives:
 * arrivals, coalesces, and expiries around it cannot re-derive an incumbent's transform (owner bug
 * 2026-07-14). Position and tilt are static (the wrapper's SVG transform and the text's CSS
 * `rotate`, never animated); the classes animate only scale and opacity, and at rest NO animation
 * applies, so the resting render is the element's natural state, identical from spring settle
 * through fade start. The React key carries the coalesce pulse so a re-tap remounts and replays
 * the gentler pulse in place.
 */
function Sticker({
  entry,
  x,
  y,
}: {
  entry: ReactionEntry;
  x: number;
  y: number;
}) {
  const seed = seedOf(entry.key);
  const magnitude = 8 + (seed % 5); // 8..12 degrees
  const rot = (seed & 1) === 0 ? magnitude : -magnitude;
  const spread = STICKER_SCATTER * 2 + 1;
  const jitterX = ((seed >> 1) % spread) - STICKER_SCATTER;
  const jitterY = ((seed >> 4) % spread) - STICKER_SCATTER;
  const cx = x + STICKER_CENTER_X + jitterX;
  const cy = y + STICKER_CENTER_Y + jitterY;
  return (
    <g transform={`translate(${cx} ${cy})`} pointerEvents="none">
      <text
        key={`${entry.key}:${entry.pulse}`}
        className={
          entry.pulse > 0 ? "sticker sticker--repulse" : "sticker sticker--in"
        }
        fontSize={STICKER_SIZE}
        textAnchor="middle"
        dominantBaseline="central"
        // The tilt feeds the CSS `rotate` property through --tilt (styles.css), never the
        // animated `transform`: it stays static for the sticker's whole life, composes under the
        // animated scale, and the reduced-motion rule zeroes it (an inline `rotate` would win
        // over that rule, a custom property does not).
        style={{ ["--tilt" as string]: `${rot}deg` }}
      >
        {entry.emoji}
      </text>
    </g>
  );
}

// Background precedence (SP6, DESIGN.md section 10):
// black square > current cell > check/cross-reference > active word > teammate-here > default.
// The cross-reference slot is live: a referenced cell outranks the active word, so where a
// referenced word crosses the active one the crossing cell paints xref, not word.
function cellRole(
  cell: number,
  puzzle: Puzzle,
  selection: Selection | null,
  activeWord: ReadonlySet<number>,
  teammateCells: ReadonlySet<number>,
  xref: ReadonlySet<number>,
): string {
  if (puzzle.blocks.has(cell)) return "block";
  if (cell === selection?.cell) return "current";
  if (puzzle.wrong.has(cell)) return "wrong";
  if (xref.has(cell)) return "xref";
  if (activeWord.has(cell)) return "word";
  if (teammateCells.has(cell)) return "teammate";
  return "default";
}

// Across cursor is a right-pointing triangle, down is a downward one, in a 12x12 box
// scaled to 7x7 at the cell's top-right (SP6: 7x7 at +27,+3).
function cursorPath(direction: Direction): string {
  return direction === "across" ? "M0 0 L12 6 L0 12 Z" : "M0 0 L6 12 L12 0 Z";
}

/** The active word: the wordBounds run through the cursor on the current axis. */
function activeWordCells(grid: Grid, selection: Selection | null): Set<number> {
  if (selection === null || grid.blocks.has(selection.cell)) return new Set();
  const { start, end } = wordBounds(grid, selection.direction, selection.cell);
  const stride = selection.direction === "across" ? 1 : grid.cols;
  const cells = new Set<number>();
  for (let cell = start; cell <= end; cell += stride) cells.add(cell);
  return cells;
}

export function CrosswordGrid({
  puzzle,
  fills,
  selection,
  presence,
  flashes,
  xref = EMPTY,
  reactions = NO_REACTIONS,
  onCellClick,
  onFlashEnd,
}: Props) {
  const { cols, rows } = puzzle;
  const grid: Grid = { cols, rows, blocks: puzzle.blocks };
  const activeWord = activeWordCells(grid, selection);
  const teammateCells = new Set(presence.keys());

  const cells = [];
  for (let cell = 0; cell < cols * rows; cell++) {
    const x = (cell % cols) * CELL;
    const y = Math.floor(cell / cols) * CELL;
    const isBlock = puzzle.blocks.has(cell);
    const role = cellRole(
      cell,
      puzzle,
      selection,
      activeWord,
      teammateCells,
      xref,
    );
    const number = puzzle.numbers.get(cell);
    const value = fills.get(cell);
    const here = presence.get(cell) ?? [];
    const letterX = here.length > 0 ? x + CELL / 2 - 3 : x + CELL / 2;

    cells.push(
      <g key={cell}>
        <rect
          x={x}
          y={y}
          width={CELL}
          height={CELL}
          fill={`var(--cell-${role})`}
          stroke="var(--stroke)"
          strokeWidth={0.6}
          onClick={isBlock ? undefined : () => onCellClick(cell)}
          style={{ cursor: isBlock ? "default" : "pointer" }}
        />
        {puzzle.circles.has(cell) && (
          <circle
            cx={x + CELL / 2}
            cy={y + CELL / 2}
            r={CELL / 2.1}
            fill="none"
            stroke="var(--circle)"
            strokeWidth={0.8}
          />
        )}
        {number !== undefined && (
          <text
            x={x + 2}
            y={y + 10}
            fontSize={10}
            fontWeight={700}
            fill="var(--clue-number)"
          >
            {number}
          </text>
        )}
        {value !== undefined && !isBlock && (
          <text
            x={letterX}
            y={y + 32}
            fontSize={24}
            textAnchor="middle"
            fill="var(--letter)"
          >
            {value}
          </text>
        )}
        {here.length === 1 && here[0] && (
          <>
            <g
              transform={`translate(${x + 27},${y + 3}) scale(${7 / 12})`}
              fill={here[0].color}
            >
              <path d={cursorPath(here[0].direction)} />
            </g>
            <circle cx={x + 30} cy={y + 30} r={5} fill={here[0].color} />
            <text
              x={x + 30}
              y={y + 30}
              fontSize={8}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--presence-avatar-fg)"
            >
              {here[0].initial}
            </text>
            {/* The avatar paints over the colored initial when it loads; a null URL or a load
                failure leaves the initial puck below untouched (PROTOCOL.md §4 fallback). */}
            {here[0].avatarUrl !== null && (
              <>
                <clipPath id={`presence-clip-${cell}`}>
                  <circle cx={x + 30} cy={y + 30} r={5} />
                </clipPath>
                <image
                  href={here[0].avatarUrl}
                  x={x + 25}
                  y={y + 25}
                  width={10}
                  height={10}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#presence-clip-${cell})`}
                />
              </>
            )}
          </>
        )}
        {here.length > 1 && (
          <>
            <circle
              cx={x + 29}
              cy={y + 29}
              r={7}
              fill="var(--presence-badge)"
            />
            <text
              x={x + 29}
              y={y + 29}
              fontSize={9}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--presence-avatar-fg)"
            >
              {here.length}
            </text>
          </>
        )}
      </g>,
    );
  }

  // Conflict flashes paint above everything: the cell fills with the writer's color
  // at full opacity and fades to transparent over 300 ms, ease-out, leaving the new
  // letter (Decision 2.1d-1; PROTOCOL.md section 8).
  const flashRects = [];
  for (const [cell, flash] of flashes) {
    const x = (cell % cols) * CELL;
    const y = Math.floor(cell / cols) * CELL;
    flashRects.push(
      <rect
        key={`${cell}:${flash.nonce}`}
        className="conflict-flash"
        x={x}
        y={y}
        width={CELL}
        height={CELL}
        fill={flash.color}
        pointerEvents="none"
        onAnimationEnd={() => onFlashEnd(cell, flash.nonce)}
      />,
    );
  }

  // Reaction stickers paint above the cells and flashes so they bleed on top; grouped by cell,
  // oldest first, capped at the newest four (older ones are decaying and vanish on their own).
  const stickers: ReactNode[] = [];
  if (reactions.length > 0) {
    const byCell = new Map<number, ReactionEntry[]>();
    for (const entry of reactions) {
      if (puzzle.blocks.has(entry.cell)) continue; // never anchor on a black square
      const list = byCell.get(entry.cell);
      if (list === undefined) byCell.set(entry.cell, [entry]);
      else list.push(entry);
    }
    for (const [cell, list] of byCell) {
      const x = (cell % cols) * CELL;
      const y = Math.floor(cell / cols) * CELL;
      // Oldest first so the newest paints on top; the cap keeps the newest four. Ordering only
      // picks paint order and the shown set: a sticker's own placement never reads its index, so
      // a re-sort (a coalesce refreshing `at`) or an eviction cannot move an incumbent.
      const ordered = [...list].sort((a, b) => a.at - b.at);
      const shown = ordered.slice(-STICKER_PILE_CAP);
      for (const entry of shown) {
        stickers.push(<Sticker key={entry.key} entry={entry} x={x} y={y} />);
      }
    }
  }

  return (
    // ph-no-capture is the INV-6 belt: board letters converge on the solution, so nothing
    // under this node may ride an analytics event. PostHog autocapture skips the subtree
    // (session replay is disabled outright at init; see ANALYTICS.md).
    <svg
      className="board ph-no-capture"
      viewBox={`0 0 ${cols * CELL} ${rows * CELL}`}
      role="img"
      aria-label={`${cols} by ${rows} crossword grid`}
    >
      {cells}
      {flashRects}
      {stickers}
      {/* The v2 outer frame: a quiet 2-unit rule closing the board (border-width-2 in the
          kit). Painted last so it sits over the cell hairlines; turns gold on keyboard
          focus of the wrapper (styles.css) in place of a halo ring. */}
      <rect
        className="board-frame"
        x={1}
        y={1}
        width={cols * CELL - 2}
        height={rows * CELL - 2}
        fill="none"
        stroke="var(--board-frame)"
        strokeWidth={2}
        pointerEvents="none"
      />
    </svg>
  );
}
