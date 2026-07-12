// The post-game contribution mosaic: a treatment of the actual solved board, not a parallel
// renderer. It reuses every CrosswordGrid convention (one 36-unit SVG cell, flat row-major
// index, the --cell-*/--stroke/--board-frame/--letter/--clue-number paint tokens) and adds one
// thing: each cell is painted by its owner, read from an abstract map the component never
// questions.
//
// Three states of the one board, the ratified reveal arc (plate-study.html):
//   INK    the solved board as it normally looks: letters in --letter, no color.
//   FIELD  the peak: each cell its owner's full saturated color, letters HIDDEN, a pure textless
//          color field. This is the crescendo and the spoiler-safe share image (no letters = no
//          answers). Exposed as a static `plate` for a share/projector rendering.
//   WASH   the rest: letters back in ink, the owner color dropped to a quiet ~0.34 tint under
//          the glyph, never a slab. The settled on-screen record.
//
// The reveal blooms INK -> FIELD along a diagonal sweep, holds the peak, then settles to WASH.
// prefers-reduced-motion crosses straight to WASH with no sweep. Letters come only from board
// state passed in (never a solution lookup), so this adds no data path (INV-6).
import { useEffect, useMemo, useRef } from "react";
import type { Puzzle } from "../domain/types";
import {
  BLOOM_SPREAD_MS,
  bloomDelay,
  INK,
  JITTER_MS,
  mosaicCells,
  type OwnerMap,
  PEAK_HOLD_MS,
  type Roster,
  settleDelay,
  WASH_ALPHA,
} from "./mosaicReveal";

const CELL = 36;

/** The three frames the reveal moves through, plus `plate` (a static FIELD at fuller saturation
 * for a share/projector still). `plate` keeps the letters hidden like FIELD; it is the peak held
 * still, not a glyph-on-color variant. */
export type MosaicState = "ink" | "field" | "wash" | "plate";

/**
 * How the mosaic behaves:
 *   - a fixed `state` renders one frame and never animates (the dial thumbnails, the plate).
 *   - `state: "reveal"` runs the arc once on mount (INK -> FIELD -> WASH), honoring reduced motion.
 * `replayKey` re-arms the arc when it changes (a Replay button bumps it).
 */
type Behavior =
  | { readonly kind: "static"; readonly state: MosaicState }
  | { readonly kind: "reveal"; readonly replayKey?: number };

export interface ContributionMosaicProps {
  /** The solved board's geometry and numbering (the same Puzzle the grid renders). */
  readonly puzzle: Puzzle;
  /** Letters already on the board (the store's rendered values). The mosaic draws only these;
   * it never reads a solution (INV-6). */
  readonly letters: ReadonlyMap<number, string>;
  /**
   * The abstract owner map: cell index to owner id. The component does not know or care where it
   * came from. Today the caller derives it from the store's last-writer `by`; a later first-correct
   * endpoint (DESIGN.md D16) swaps the source with no change here.
   */
  readonly ownerMap: OwnerMap;
  /** The roster the ids resolve through (id to player color). The demo supplies a fixture; a live
   * caller passes the room's participants. */
  readonly roster: Roster;
  /** Static frame or the running reveal. Defaults to the reveal. */
  readonly behavior?: Behavior;
  /** Fires as the arc crosses each beat (0 solved, 1 bloom, 2 settled), for a beat indicator. */
  readonly onBeat?: (beat: 0 | 1 | 2) => void;
  /** An accessible label for the SVG; defaults to a geometry description. */
  readonly ariaLabel?: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The per-cell style for a frame. `plate` is FIELD at fuller saturation for a still: same textless
 * field, drawn a touch bolder so it holds up as a share/projector image. */
interface CellStyle {
  rectOpacity: number;
  letterOpacity: number;
  letterFill: string;
}

function frameStyle(state: MosaicState): CellStyle {
  switch (state) {
    case "ink":
      // The plain solved board: no color, letters in ink.
      return { rectOpacity: 0, letterOpacity: 1, letterFill: INK };
    case "field":
      // The peak: full saturated color, letters hidden.
      return { rectOpacity: 1, letterOpacity: 0, letterFill: INK };
    case "plate":
      // The share/projector still: the field held, fuller, letters still hidden.
      return { rectOpacity: 1, letterOpacity: 0, letterFill: INK };
    case "wash":
      // The settled record: quiet tint under ink letters.
      return { rectOpacity: WASH_ALPHA, letterOpacity: 1, letterFill: INK };
  }
}

/**
 * The mosaic. Cells carry a color rect (opacity animates the state), the letter, and the clue
 * number. State is applied per cell so the sweep can stagger delays; a fixed `state` snaps every
 * cell at once with no transition.
 */
export function ContributionMosaic({
  puzzle,
  letters,
  ownerMap,
  roster,
  behavior = { kind: "reveal" },
  onBeat,
  ariaLabel,
}: ContributionMosaicProps) {
  const { cols, rows } = puzzle;
  const cells = useMemo(
    () =>
      mosaicCells({
        cols,
        rows,
        blocks: puzzle.blocks,
        letters,
        ownerMap,
        roster,
      }),
    [cols, rows, puzzle.blocks, letters, ownerMap, roster],
  );

  // Refs to each cell's animated nodes, so the arc can set per-cell delays imperatively (the same
  // shape plate-study.html uses; React drives the static frame, the arc drives the sweep).
  const rectRefs = useRef(new Map<number, SVGRectElement>());
  const letterRefs = useRef(new Map<number, SVGTextElement>());

  // For a static behavior, the frame is React-driven and needs no imperative pass.
  const staticState = behavior.kind === "static" ? behavior.state : null;

  // The reveal: apply INK, then bloom each cell to FIELD on its diagonal delay, hold the peak,
  // then settle each cell to WASH. Reduced motion crosses straight to WASH.
  const replayKey =
    behavior.kind === "reveal" ? (behavior.replayKey ?? 0) : null;
  useEffect(() => {
    if (behavior.kind !== "reveal") return;
    // window.setTimeout returns a number in the DOM lib (Completion.tsx's convention); keep the
    // handles as numbers so the cleanup clears them without a NodeJS.Timeout mismatch.
    const timers: number[] = [];
    const applyAll = (
      state: MosaicState,
      delayOf: (col: number, row: number) => number,
      animate: boolean,
    ): void => {
      const f = frameStyle(state);
      for (const cell of cells) {
        const rect = rectRefs.current.get(cell.index);
        const text = letterRefs.current.get(cell.index);
        const delay = animate ? delayOf(cell.col, cell.row) : 0;
        if (rect) {
          rect.style.transition = animate ? "" : "none";
          rect.style.transitionDelay = `${delay}ms`;
          rect.style.opacity = String(f.rectOpacity);
        }
        if (text) {
          text.style.transition = animate ? "" : "none";
          text.style.transitionDelay = `${delay}ms`;
          text.style.opacity = String(f.letterOpacity);
          text.style.fill = f.letterFill;
        }
      }
    };

    onBeat?.(0);
    if (prefersReducedMotion()) {
      applyAll("wash", () => 0, false);
      onBeat?.(2);
      return;
    }

    // Jitter is fixed per cell for the run so bloom and settle order the same way.
    const jitter = new Map<number, number>();
    for (const cell of cells) jitter.set(cell.index, Math.random());

    applyAll("ink", () => 0, false);
    // A frame later, arm the bloom so the ink->field transition actually animates.
    const bloom = window.setTimeout(() => {
      applyAll(
        "field",
        (col, row) =>
          bloomDelay(col, row, cols, rows, jitter.get(row * cols + col) ?? 0),
        true,
      );
      onBeat?.(1);
      const bloomEnd = BLOOM_SPREAD_MS + JITTER_MS + 480; // spread + jitter + the rect fade
      const settle = window.setTimeout(() => {
        applyAll("wash", (col, row) => settleDelay(col, row, cols, rows), true);
        onBeat?.(2);
      }, bloomEnd + PEAK_HOLD_MS);
      timers.push(settle);
    }, 32);
    timers.push(bloom);

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
    // replayKey re-arms the arc; cells/geometry re-run it too.
  }, [behavior.kind, replayKey, cells, cols, rows, onBeat]);

  const staticFrame = staticState === null ? null : frameStyle(staticState);
  // In reveal mode the board starts at INK (color hidden, letters shown) so nothing flashes
  // before the arc arms; the effect then animates it forward. In static mode the chosen frame
  // is React-driven straight to its opacities.
  const initialRectStyle = staticFrame
    ? { opacity: staticFrame.rectOpacity }
    : { opacity: 0 };
  const initialLetterStyle = staticFrame
    ? { opacity: staticFrame.letterOpacity }
    : { opacity: 1 };

  return (
    <svg
      className="board board-mosaic ph-no-capture"
      viewBox={`0 0 ${cols * CELL} ${rows * CELL}`}
      role="img"
      aria-label={ariaLabel ?? `${cols} by ${rows} contribution mosaic`}
    >
      {(() => {
        const nodes = [];
        for (let index = 0; index < cols * rows; index += 1) {
          const x = (index % cols) * CELL;
          const y = Math.floor(index / cols) * CELL;
          const isBlock = puzzle.blocks.has(index);
          nodes.push(
            <rect
              key={`bg-${index}`}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              fill={`var(--cell-${isBlock ? "block" : "default"})`}
              stroke="var(--stroke)"
              strokeWidth={0.6}
            />,
          );
        }
        return nodes;
      })()}

      {cells.map((cell) => {
        const x = cell.col * CELL;
        const y = cell.row * CELL;
        const number = puzzle.numbers.get(cell.index);
        return (
          <g key={cell.index}>
            {cell.color !== null && (
              <rect
                ref={(el) => {
                  if (el) rectRefs.current.set(cell.index, el);
                  else rectRefs.current.delete(cell.index);
                }}
                className="mosaic-color"
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                fill={cell.color}
                style={initialRectStyle}
              />
            )}
            {number !== undefined && (
              // The clue number rides in ink; the field never hides it enough to matter and the
              // wash keeps the solved board legible. It carries no attribution, so it never animates.
              <text
                x={x + 2}
                y={y + 10}
                fontSize={10}
                fontWeight={700}
                fill="var(--clue-number)"
                opacity={
                  staticState === "field" || staticState === "plate" ? 0 : 1
                }
              >
                {number}
              </text>
            )}
            {cell.letter !== null && (
              <text
                ref={(el) => {
                  if (el) letterRefs.current.set(cell.index, el);
                  else letterRefs.current.delete(cell.index);
                }}
                className="mosaic-letter"
                x={x + CELL / 2}
                y={y + 32}
                fontSize={24}
                textAnchor="middle"
                fill={staticFrame ? staticFrame.letterFill : "var(--letter)"}
                style={initialLetterStyle}
              >
                {cell.letter}
              </text>
            )}
          </g>
        );
      })}

      {/* The v2 outer frame, the same quiet 2-unit rule CrosswordGrid closes the board with. */}
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
