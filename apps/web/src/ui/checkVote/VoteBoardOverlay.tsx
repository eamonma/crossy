// The board-anchored reveal wash (the UX spec): a gold tile sweeping across each wrong cell on a
// passed vote. Decorative and pointer-transparent, mounted inside the board wrapper. Reduced motion
// drops the wash at the view layer (it is null). No ring or pulse renders anymore (Wave 15.11): the
// chips settling are the vote's only live signal, and expiry reads as the calm "The vote lapsed".
//
// Cell geometry: the wash is an SVG whose viewBox is the grid's own (CELL * cols by CELL * rows) with
// the same preserveAspectRatio as CrosswordGrid, so its rects land exactly on the cell rects at any
// board aspect. Percentage overlays drifted off the true cells, which matters for marks in a way it
// never did for stickers.
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
  const wash = view.wash;
  if (wash === null) return null;
  const schedule = washSchedule(wash.cells);
  return (
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
  );
}
