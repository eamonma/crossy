// The board-anchored vote layers (the UX spec): the luminous ring around the grid, the beat-1 pulse
// from the proposer's cursor, and the reveal wash across the wrong cells. All decorative and
// pointer-transparent, mounted inside the board wrapper. Reduced motion drops the pulse and the wash
// at the view layer (they are null), and the ring steps instead of sweeping.
//
// Cell geometry: the wash is an SVG whose viewBox is the grid's own (CELL * cols by CELL * rows) with
// the same preserveAspectRatio as CrosswordGrid, so its rects land exactly on the cell rects at any
// board aspect. Percentage overlays drifted off the true cells, which matters for marks in a way it
// never did for stickers.
import { LuminousRing } from "./LuminousRing";
import type { CheckVoteView } from "./useCheckVote";

// The grid's cell module (CrosswordGrid CELL) and the deliberate stillness before the wash (the
// breath, useCheckVote BREATH_MS): tile zero starts only after "Checking…" has held.
const CELL = 36;
const BREATH_MS = 600;

export function VoteBoardOverlay({
  view,
  cols,
  rows,
}: {
  view: CheckVoteView;
  cols: number;
  rows: number;
}) {
  if (!view.active) return null;
  const wash = view.wash;
  const n = wash?.cells.length ?? 0;
  // Ascending-cell-index stagger, per-cell overlap, whole wash under ~900 ms after the breath (the
  // cell animation is 360 ms, so the last cell starts by ~500 ms past the breath).
  const perCell = n > 1 ? Math.min(60, 500 / (n - 1)) : 0;
  return (
    <>
      {view.ring !== null && (
        // Keyed by igniteKey so a new vote remounts the ring, replaying its ignite and re-measuring
        // the halo box; within one vote it persists so the pass/fail animations swap in place.
        <LuminousRing
          key={view.ring.igniteKey}
          ring={view.ring}
          reducedMotion={view.reducedMotion}
        />
      )}
      {view.pulse !== null && (
        <span
          key={view.pulse.key}
          className="vote-pulse"
          style={{ left: `${view.pulse.xPct}%`, top: `${view.pulse.yPct}%` }}
        />
      )}
      {wash !== null && (
        <svg
          key={wash.key}
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
          viewBox={`0 0 ${cols * CELL} ${rows * CELL}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {wash.cells.map((cell, rank) => (
            <rect
              key={cell}
              className="check-wash-cell"
              x={(cell % cols) * CELL}
              y={Math.floor(cell / cols) * CELL}
              width={CELL}
              height={CELL}
              rx={2}
              style={{
                ["--wash-delay" as string]: `${BREATH_MS + Math.round(rank * perCell)}ms`,
              }}
            />
          ))}
        </svg>
      )}
    </>
  );
}
