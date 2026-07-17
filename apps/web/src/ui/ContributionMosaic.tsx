// The post-game contribution mosaic: a treatment of the actual solved board, not a parallel
// renderer. It reuses every CrosswordGrid convention (one 36-unit SVG cell, flat row-major
// index, the --cell-*/--stroke/--board-frame/--letter/--clue-number paint tokens) and adds one
// thing: each cell is painted by its owner, read from an abstract map the component never
// questions.
//
// States of the one board, the ratified reveal arc (plate-study.html; settle re-ratified by
// wash-blur-study 2026-07-17):
//   INK      the solved board as it normally looks: letters in --letter, no color.
//   FIELD    the peak: each cell its owner's full saturated color, letters HIDDEN, a pure textless
//            color field. This is the crescendo and the spoiler-safe share image (no letters = no
//            answers). Exposed as a static `plate` for a share/projector rendering.
//   WASH     the crisp per-cell tint at WASH_ALPHA under ink letters. The time-gated replay paints
//            revealed squares this way, and small static thumbnails keep it.
//   SETTLED  the on-screen record: the owner tints, gaussian-blurred and composited at
//            SETTLED_WASH_ALPHA under the crisp ink letters, blocks redrawn crisp on top so the
//            color flows behind the grid. Isolating a solver swaps back to crisp cells (a blurred
//            single hue has no shape to read).
//
// The reveal blooms INK -> FIELD along a diagonal sweep, holds the peak, then melts to SETTLED:
// the crisp cells fade out on the settle diagonal while the blurred field breathes in.
// prefers-reduced-motion crosses straight to the settled frame with no sweep. Letters come only
// from board state passed in (never a solution lookup), so this adds no data path (INV-6).
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { Puzzle } from "../domain/types";
import {
  BLOOM_SPREAD_MS,
  bloomDelay,
  blurOverscan,
  blurRadius,
  INK,
  JITTER_MS,
  MELT_DELAY_MS,
  MELT_EASE,
  MELT_FADE_MS,
  mosaicCells,
  overscanTintRect,
  type OwnerMap,
  PEAK_HOLD_MS,
  type Roster,
  SETTLED_WASH_ALPHA,
  settleDelay,
  WASH_ALPHA,
} from "./mosaicReveal";
import { isolationAlpha } from "./mosaicIsolation";

const CELL = 36;

/** The on-screen letter color: the theme's ink token (light ground = near-black, dark ground = light),
 * not the baked-in light-ground INK the share plate uses. The mosaic draws letters through this so the
 * solved board stays legible on the dark ground; in dark mode a hardcoded INK would be near-black on a
 * near-black cell. The share plate (spoiler-safe) hides letters entirely, so it never needs this. */
const ONSCREEN_INK = "var(--letter)";

/** A stable empty reveal map, so a non-replay render never hands the replay effect a fresh identity. */
const EMPTY_REVEALED: ReadonlyMap<number, number> = new Map();

/** The frames the mosaic renders: the reveal's INK/FIELD plus `settled` (the blurred record the
 * arc lands on), `wash` (the crisp per-cell tint replay and thumbnails keep), and `plate` (a
 * static FIELD at fuller saturation for a share/projector still). `plate` keeps the letters
 * hidden like FIELD; it is the peak held still, not a glyph-on-color variant. */
export type MosaicState = "ink" | "field" | "wash" | "settled" | "plate";

/**
 * How the mosaic behaves:
 *   - a fixed `state` renders one frame and never animates (the dial thumbnails, the plate).
 *   - `state: "reveal"` runs the arc once on mount (INK -> FIELD -> WASH), honoring reduced motion.
 *     `replayKey` re-arms the arc when it changes (a Replay button bumps it).
 *   - `kind: "replay"` is the time-gated solve replay (REPLAY.md): every cell whose solve time is
 *     `<= timeSeconds` wears the WASH look, the rest blank, driven by the shared clock. A forward
 *     crossing fades in over ~250ms; unchanged cells never restart their transition.
 */
type Behavior =
  | { readonly kind: "static"; readonly state: MosaicState }
  | { readonly kind: "reveal"; readonly replayKey?: number }
  | {
      readonly kind: "replay";
      /** Cell index -> its solve time (relative seconds). A cell absent from the map never reveals. */
      readonly revealedAt: ReadonlyMap<number, number>;
      /** The playhead: cells solved at or before this time show, the rest are blank. */
      readonly timeSeconds: number;
    };

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
  /**
   * The isolated solver (the Analysis legend's spotlight), or null/absent for the full wash.
   * Isolation rides the color rect's `fill-opacity` — a plain React-rendered attribute — while
   * the reveal arc and the replay animate the independent `opacity` channel imperatively. The
   * two multiply, so toggling isolation repaints tints in place (over the bloom's field, or
   * whatever cells the replay has revealed at time T) and can never re-arm the sweep: it never
   * enters the reveal effect's dependency key (the #204 discipline).
   *
   * On the SETTLED record isolation also swaps blur for crisp: the blurred layer hides (its
   * isolation gate is a React-rendered group opacity, the same never-re-arms channel) and the
   * crisp cells return at SETTLED_WASH_ALPHA, the fill-opacity dim multiplying as everywhere
   * else. The crisp return is a dedicated effect keyed on `isolatedId` only; it writes opacities
   * in place and never touches the reveal effect's trigger.
   */
  readonly isolatedId?: string | null | undefined;
  /** Fires as the arc crosses each beat (0 solved, 1 bloom, 2 settled), for a beat indicator or
   * a settled gate. `| undefined` explicit under exactOptionalPropertyTypes: CompletedMosaicBoard
   * threads its own optional through. */
  readonly onBeat?: ((beat: 0 | 1 | 2) => void) | undefined;
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
      // The crisp per-cell tint under ink letters (replay's look, and the static thumbnails).
      return { rectOpacity: WASH_ALPHA, letterOpacity: 1, letterFill: INK };
    case "settled":
      // The settled record: the blurred layer carries the color, so the crisp tints rest at 0.
      // The isolation handoff raises them to SETTLED_WASH_ALPHA when a solver is isolated.
      return { rectOpacity: 0, letterOpacity: 1, letterFill: INK };
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
  isolatedId = null,
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

  // The blurred settled layer (the clip group). Its `opacity` is the arc/settled channel, written
  // imperatively like the rects' (React renders it once at 0 and never rewrites it); the inner
  // filter group's React-rendered opacity is the isolation gate, and the two multiply.
  const blurLayerRef = useRef<SVGGElement | null>(null);
  // Per-instance ids for the blur filter and the board clip (several mosaics share a page).
  // useId's delimiters are stripped so the ids stay plain url(#...) fragments.
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const clipId = `mosaic-clip-${uid}`;
  const filterId = `mosaic-blur-${uid}`;

  // For a static behavior, the frame is React-driven and needs no imperative pass.
  const staticState = behavior.kind === "static" ? behavior.state : null;

  // The arc reads the current cells and onBeat imperatively through refs, so the reveal effect below
  // depends ONLY on its trigger (mount + replayKey), never on the identity of cells/roster/letters.
  // This is the fix for the "blooms twice, with a false start" bug: the attribution fetch swaps the
  // owner map (a fresh `cells`) and store version bumps rebuild members/roster/letters mid-bloom; when
  // the effect depended on `cells`, each of those re-armed the whole INK -> FIELD -> WASH sweep. Now
  // a swap only re-paints the rect fills in place (a plain re-render), and the sweep runs exactly once.
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const onBeatRef = useRef(onBeat);
  onBeatRef.current = onBeat;
  // The arc reads isolation the same way: at the settle it decides whether the crisp cells rest
  // at 0 (blur showing) or at SETTLED_WASH_ALPHA (a solver is isolated), without isolation ever
  // entering its dependency key.
  const isolatedRef = useRef(isolatedId);
  isolatedRef.current = isolatedId;
  // Whether the reveal arc has reached its settled beat, so the isolation handoff below knows the
  // settled record is what is on screen. Owned by the arc (and cleared on replay entry).
  const settledBeatRef = useRef(false);
  // Whether the first paint has happened: the handoff snaps its very first application (a static
  // settled mount must not animate in) and crossfades every later one.
  const paintedRef = useRef(false);
  useEffect(() => {
    paintedRef.current = true;
  }, []);

  // The set of cells shown on the previous replay frame, so a crossing only re-transitions the cells
  // whose state actually changed (a forward crossing fades in; unchanged cells never restart their
  // fade). Cleared whenever replay is not the active behavior.
  const revealedSetRef = useRef<Set<number>>(new Set());

  // The time-gated replay: fill every cell solved at or before the playhead, blank the rest. Keyed
  // ONLY on the time and the behavior kind, reading cells through cellsRef so an owner-map or roster
  // identity change never disturbs a frame (the same discipline the bloom effect keeps). The reveal
  // is imperative through the same per-cell rect/text refs the bloom uses, so it adds no data path.
  const replayTime = behavior.kind === "replay" ? behavior.timeSeconds : null;
  const revealedAt =
    behavior.kind === "replay" ? behavior.revealedAt : EMPTY_REVEALED;
  const revealedAtRef = useRef(revealedAt);
  revealedAtRef.current = revealedAt;
  // Whether this replay session has painted its first (snap) frame. Reset whenever replay stops, so
  // the next entry snaps a fresh baseline.
  const replayInitRef = useRef(false);
  // A layout effect (pre-paint) so entering replay corrects the board before the browser paints,
  // never a blank flash; the crossing fades still animate because the crossed cells were painted at
  // their prior opacity last frame.
  useLayoutEffect(() => {
    if (behavior.kind !== "replay" || replayTime === null) {
      revealedSetRef.current = new Set();
      replayInitRef.current = false;
      return;
    }
    const cells = cellsRef.current;
    const at = revealedAtRef.current;
    const prev = revealedSetRef.current;
    const next = new Set<number>();
    const wash = frameStyle("wash");
    // On the first frame after entering replay, snap EVERY cell to its absolute state for the
    // playhead with no transition, so the frame is a pure function of the time and never inherits
    // whatever the board showed before scrubbing began (a settled wash, a held field, an earlier
    // scrub spot). This is the path-dependence fix: previously a cell whose shown-state matched the
    // empty baseline was skipped and kept its stale opacity, so one time could render solid, dimmed,
    // or blank depending on history. After entry, only the cells whose shown-state flips get the calm
    // ~250ms fade; the rest are already correct, so they are left untouched.
    const initializing = !replayInitRef.current;
    if (initializing) {
      // Replay never shows the blurred record: snap the layer off with the baseline frame and
      // mark the settled record off screen, so the isolation handoff below stays out of replay.
      settledBeatRef.current = false;
      const blur = blurLayerRef.current;
      if (blur) {
        blur.style.transition = "none";
        blur.style.opacity = "0";
      }
    }
    for (const cell of cells) {
      const t = at.get(cell.index);
      const shown = t !== undefined && t <= replayTime;
      if (shown) next.add(cell.index);
      const flipped = shown !== prev.has(cell.index);
      if (!initializing && !flipped) continue;
      const animate = !initializing;
      const rect = rectRefs.current.get(cell.index);
      const text = letterRefs.current.get(cell.index);
      if (rect) {
        rect.style.transition = animate ? "opacity 250ms ease-out" : "none";
        rect.style.transitionDelay = "0ms";
        rect.style.opacity = String(shown ? wash.rectOpacity : 0);
      }
      if (text) {
        text.style.transition = animate ? "opacity 250ms ease-out" : "none";
        text.style.transitionDelay = "0ms";
        text.style.fill = ONSCREEN_INK;
        text.style.opacity = String(shown ? wash.letterOpacity : 0);
      }
    }
    revealedSetRef.current = next;
    replayInitRef.current = true;
  }, [behavior.kind, replayTime]);

  // The reveal: apply INK, then bloom each cell to FIELD on its diagonal delay, hold the peak,
  // then melt: the crisp cells fade out on the settle diagonal while the blurred field breathes
  // in. Reduced motion crosses straight to the settled frame.
  const replayKey =
    behavior.kind === "reveal" ? (behavior.replayKey ?? 0) : null;
  useEffect(() => {
    if (behavior.kind !== "reveal") return;
    const cells = cellsRef.current;
    const onBeat = onBeatRef.current;
    // window.setTimeout returns a number in the DOM lib (Completion.tsx's convention); keep the
    // handles as numbers so the cleanup clears them without a NodeJS.Timeout mismatch.
    const timers: number[] = [];
    // The settled frame the arc lands on. Normally the crisp cells rest at 0 (the blur carries
    // the color); with a solver isolated mid-arc they settle straight to the crisp
    // SETTLED_WASH_ALPHA instead, since the blurred layer's isolation gate is holding it hidden.
    const settledFrame = (): CellStyle => ({
      rectOpacity: isolatedRef.current !== null ? SETTLED_WASH_ALPHA : 0,
      letterOpacity: 1,
      letterFill: INK,
    });
    const setBlur = (opacity: number, transition: string): void => {
      const blur = blurLayerRef.current;
      if (blur === null) return;
      blur.style.transition = transition;
      blur.style.opacity = String(opacity);
    };
    const applyAll = (
      f: CellStyle,
      delayOf: (col: number, row: number) => number,
      animate: boolean,
    ): void => {
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
          // On-screen letters ride the theme ink, not the baked light-ground INK, so the solved
          // board stays legible on the dark ground. The field hides letters, so its fill is moot.
          text.style.fill = ONSCREEN_INK;
        }
      }
    };

    onBeat?.(0);
    settledBeatRef.current = false;
    if (prefersReducedMotion()) {
      applyAll(settledFrame(), () => 0, false);
      setBlur(SETTLED_WASH_ALPHA, "none");
      settledBeatRef.current = true;
      onBeat?.(2);
      return;
    }

    // Jitter is fixed per cell for the run so bloom and settle order the same way.
    const jitter = new Map<number, number>();
    for (const cell of cells) jitter.set(cell.index, Math.random());

    applyAll(frameStyle("ink"), () => 0, false);
    setBlur(0, "none");
    // A frame later, arm the bloom so the ink->field transition actually animates.
    const bloom = window.setTimeout(() => {
      applyAll(
        frameStyle("field"),
        (col, row) =>
          bloomDelay(col, row, cols, rows, jitter.get(row * cols + col) ?? 0),
        true,
      );
      onBeat?.(1);
      const bloomEnd = BLOOM_SPREAD_MS + JITTER_MS + 480; // spread + jitter + the rect fade
      const settle = window.setTimeout(() => {
        // The melt: the crisp cells let go on the settle diagonal (same delays as before) while
        // the blurred field breathes in over MELT_FADE_MS after a short MELT_DELAY_MS.
        applyAll(
          settledFrame(),
          (col, row) => settleDelay(col, row, cols, rows),
          true,
        );
        setBlur(
          SETTLED_WASH_ALPHA,
          `opacity ${MELT_FADE_MS}ms ${MELT_EASE} ${MELT_DELAY_MS}ms`,
        );
        settledBeatRef.current = true;
        onBeat?.(2);
      }, bloomEnd + PEAK_HOLD_MS);
      timers.push(settle);
    }, 32);
    timers.push(bloom);

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
    // Only the trigger re-arms the arc: the first mount and each replayKey bump. cells/onBeat are
    // read through refs (above), so a mid-bloom owner-map swap or version bump never restarts it.
  }, [behavior.kind, replayKey, cols, rows]);

  // The settled record's crisp/blur handoff. While the settled record is on screen (the arc past
  // its settle beat, or a static "settled" frame), isolating a solver returns the crisp cells at
  // SETTLED_WASH_ALPHA (the React fill-opacity dim multiplies on top: the isolated owner reads at
  // 0.5, everyone else at 0.5 x ISOLATION_DIM) and clearing melts them back to 0 under the blur.
  // The blurred layer's own hide rides the inner group's React-rendered opacity below; this effect
  // only moves the crisp cells and keeps the layer's group weight correct. Keyed on isolation and
  // the frame ONLY, reading cells through the ref: a post-settle owner-map swap repaints fills in
  // a plain re-render and must not re-run this (it would overwrite the melt's per-cell diagonal
  // and the blur's 900ms breathe-in with a flat 250ms). It writes opacities imperatively like the
  // arc does and can never re-arm the sweep (the #204 discipline: the reveal effect above still
  // keys only on its trigger).
  const settledStatic = staticState === "settled";
  useLayoutEffect(() => {
    const blur = blurLayerRef.current;
    const settledOnScreen =
      settledStatic || (behavior.kind === "reveal" && settledBeatRef.current);
    if (!settledOnScreen) {
      // A static non-settled frame never shows the blur; the arc and the replay own it otherwise.
      if (behavior.kind === "static" && blur !== null) {
        blur.style.transition = "none";
        blur.style.opacity = "0";
      }
      return;
    }
    // The first application (a static settled mount, pre-paint) snaps; later ones crossfade. The
    // rects' inline transition carries fill-opacity too, so the dim and the return move together.
    const animate = paintedRef.current && !prefersReducedMotion();
    const crisp = isolatedId !== null;
    const transition = animate
      ? "opacity 250ms ease-out, fill-opacity 250ms ease-out"
      : "none";
    for (const cell of cellsRef.current) {
      const rect = rectRefs.current.get(cell.index);
      if (rect === undefined) continue;
      rect.style.transition = transition;
      rect.style.transitionDelay = "0ms";
      rect.style.opacity = String(crisp ? SETTLED_WASH_ALPHA : 0);
    }
    if (blur !== null) {
      blur.style.transition = animate ? "opacity 250ms ease-out" : "none";
      blur.style.opacity = String(SETTLED_WASH_ALPHA);
    }
  }, [isolatedId, settledStatic, behavior.kind]);

  const staticFrame = staticState === null ? null : frameStyle(staticState);
  // In reveal mode the board starts at INK (color hidden, letters shown) so nothing flashes before
  // the arc arms; the effect then animates it forward. In replay mode it starts fully blank (no
  // color, no letters) so a cell is invisible until the playhead reaches its solve time; the effect
  // fills it in. In static mode the chosen frame is React-driven straight to its opacities.
  const isReplay = behavior.kind === "replay";
  const initialRectStyle = staticFrame
    ? { opacity: staticFrame.rectOpacity }
    : { opacity: 0 };
  const initialLetterStyle = staticFrame
    ? { opacity: staticFrame.letterOpacity }
    : isReplay
      ? { opacity: 0 }
      : { opacity: 1 };

  return (
    <svg
      className="board board-mosaic ph-no-capture"
      viewBox={`0 0 ${cols * CELL} ${rows * CELL}`}
      role="img"
      aria-label={ariaLabel ?? `${cols} by ${rows} contribution mosaic`}
    >
      <defs>
        {/* The blurred layer clips to the board rect, so the overscanned edge tints feed the blur
            without ever painting past the frame. The generous filter region keeps the gaussian
            from clipping its own falloff inside the layer. */}
        <clipPath id={clipId}>
          <rect x={0} y={0} width={cols * CELL} height={rows * CELL} />
        </clipPath>
        <filter id={filterId} x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation={blurRadius(CELL)} />
        </filter>
      </defs>

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

      {/* The crisp tint layer: fill-opacity is the isolation channel, React-rendered, multiplying
          whatever `opacity` the arc, the replay, or the settled handoff painted imperatively.
          Ink letters never dim. */}
      {cells.map((cell) =>
        cell.color === null ? null : (
          <rect
            key={`tint-${cell.index}`}
            ref={(el) => {
              if (el) rectRefs.current.set(cell.index, el);
              else rectRefs.current.delete(cell.index);
            }}
            className="mosaic-color"
            x={cell.col * CELL}
            y={cell.row * CELL}
            width={CELL}
            height={CELL}
            fill={cell.color}
            fillOpacity={isolationAlpha(ownerMap[cell.index], isolatedId)}
            style={initialRectStyle}
          />
        ),
      )}

      {/* The blurred settled layer: the same owner tints at full saturation, board-edge cells
          overscanned outward, gaussian-blurred and clipped to the board. The outer group's
          `opacity` is the arc/settled channel (imperative, carries SETTLED_WASH_ALPHA); the inner
          group's React-rendered opacity is the isolation gate, so hiding the blur on isolation
          rides a plain re-render and can never re-arm the sweep. */}
      <g ref={blurLayerRef} clipPath={`url(#${clipId})`} style={{ opacity: 0 }}>
        <g
          className="mosaic-blur-iso"
          filter={`url(#${filterId})`}
          opacity={isolatedId === null ? 1 : 0}
        >
          {cells.map((cell) => {
            if (cell.color === null) return null;
            const r = overscanTintRect(
              cell.col,
              cell.row,
              cols,
              rows,
              CELL,
              blurOverscan(CELL),
            );
            return (
              <rect
                key={`blur-${cell.index}`}
                x={r.x}
                y={r.y}
                width={r.width}
                height={r.height}
                fill={cell.color}
              />
            );
          })}
        </g>
      </g>

      {/* Blocks redrawn crisp above the blur, so the color field reads as flowing behind the
          block grid instead of smearing over it. */}
      {(() => {
        const nodes = [];
        for (const index of puzzle.blocks) {
          nodes.push(
            <rect
              key={`block-${index}`}
              x={(index % cols) * CELL}
              y={Math.floor(index / cols) * CELL}
              width={CELL}
              height={CELL}
              fill="var(--cell-block)"
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
                fill={ONSCREEN_INK}
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
