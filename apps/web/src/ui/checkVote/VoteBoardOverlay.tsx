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
import { washSchedule } from "./voteView";
import type { CheckVoteView } from "./useCheckVote";

// The grid's cell module (CrosswordGrid CELL). The wash order and per-cell delays come from
// washSchedule (voteView), the same pinned schedule that gates the per-cell mark reveal, so the gold
// tile and its standing mark land together and the timings can never drift between the two.
const CELL = 36;

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
  // The ring, pulse, and wash are sibling layers; their keys are prefixed so their independent
  // counters can never collide into a React duplicate-key error (they ran in lockstep before).
  const schedule = wash !== null ? washSchedule(wash.cells) : [];
  return (
    <>
      {view.ring !== null && (
        // Keyed by igniteKey so a new vote remounts the ring, replaying its ignite and re-measuring
        // the halo box; within one vote it persists so the pass/fail animations swap in place.
        <LuminousRing
          key={`ring-${view.ring.igniteKey}`}
          ring={view.ring}
          reducedMotion={view.reducedMotion}
        />
      )}
      {view.pulse !== null && (
        <span
          key={`pulse-${view.pulse.key}`}
          className="vote-pulse"
          style={{ left: `${view.pulse.xPct}%`, top: `${view.pulse.yPct}%` }}
        />
      )}
      {wash !== null && (
        <svg
          key={`wash-${wash.key}`}
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
          viewBox={`0 0 ${cols * CELL} ${rows * CELL}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {schedule.map((step) => (
            <rect
              key={step.cell}
              className="check-wash-cell"
              x={(step.cell % cols) * CELL}
              y={Math.floor(step.cell / cols) * CELL}
              width={CELL}
              height={CELL}
              rx={2}
              style={{
                ["--wash-delay" as string]: `${step.delayMs}ms`,
              }}
            />
          ))}
        </svg>
      )}
    </>
  );
}
