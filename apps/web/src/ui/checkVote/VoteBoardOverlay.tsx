// The board-anchored vote layers (the UX spec): the luminous ring around the grid, the beat-1 pulse
// from the proposer's cursor, and the reveal wash across the wrong cells. All decorative and
// pointer-transparent, mounted inside the board wrapper (percentage geometry, so they land at any
// board scale, the ReactionStickers pattern). Reduced motion drops the pulse and the wash at the
// view layer (they are null), and the ring steps instead of sweeping.
import { LuminousRing } from "./LuminousRing";
import type { CheckVoteView } from "./useCheckVote";

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
  // Ascending-cell-index stagger, per-cell overlap, whole wash under ~900 ms (the cell animation is
  // 360 ms, so the last cell may start by ~500 ms).
  const perCell = n > 1 ? Math.min(60, 500 / (n - 1)) : 0;
  return (
    <>
      {view.ring !== null && (
        <LuminousRing ring={view.ring} reducedMotion={view.reducedMotion} />
      )}
      {view.pulse !== null && (
        <span
          key={view.pulse.key}
          className="vote-pulse"
          style={{ left: `${view.pulse.xPct}%`, top: `${view.pulse.yPct}%` }}
        />
      )}
      {wash !== null &&
        wash.cells.map((cell, rank) => (
          <span
            key={`${wash.key}-${cell}`}
            className="check-wash-cell"
            style={{
              left: `${((cell % cols) / cols) * 100}%`,
              top: `${(Math.floor(cell / cols) / rows) * 100}%`,
              width: `${100 / cols}%`,
              height: `${100 / rows}%`,
              ["--wash-delay" as string]: `${Math.round(rank * perCell)}ms`,
            }}
          />
        ))}
    </>
  );
}
