// The luminous ring (U4; the Meridian redesign, Wave 15.7): a halo OUTSIDE the grid and a true
// parallel offset of the square-cornered board. The corner radius EQUALS the offset gap, so the curve
// is optically parallel to the board's square corners (the old rx=14 at ~8.5px pinched them). It is
// the ONLY clock, so there is no countdown text anywhere; it drains CLOCKWISE from a top-center seam
// via a custom path (meridianPath) whose start is the seam, not the SVG rect's top-left. Decorative
// and aria-hidden: the state lives in the Proscenium text. Under prefers-reduced-motion it does not
// sweep; it holds whole and steps opacity in quarters.
//
// Light rides the blur, not the line: the stroke drops to a hairline 2px gold-9 core, and the glow is
// a soft drop-shadow halo, so brightness comes from luminosity rather than stroke weight.
//
// Geometry: the SVG is rendered in PIXEL space. A ResizeObserver measures the halo box and the viewBox
// matches it 1:1, so there is no preserveAspectRatio stretch to thicken the stroke on one axis or
// distort the corner radius (the earlier `vector-effect: non-scaling-stroke` was not honored under the
// stretch). Do not swap this for a percentage viewBox: it fixed a real Chromium bug.
import { useCallback, useRef, useState } from "react";
import { coarseOpacityStep, meridianPath, ringDashOffset } from "./voteView";
import type { CheckVoteRing } from "./useCheckVote";

// The hairline core; luminosity is carried by the CSS glow, not the line (U4 Meridian).
const WEIGHT = 2;
// The halo's offset off the board (matches the CSS `--vote-ring-offset`). The corner radius equals the
// offset gap (offset minus half the stroke), so the ring is a true parallel offset of the square board.
const OFFSET = 10;
const RADIUS = OFFSET - WEIGHT / 2;

export function LuminousRing({
  ring,
  reducedMotion,
}: {
  ring: CheckVoteRing;
  reducedMotion: boolean;
}) {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);

  // A callback ref so the halo box is measured on every attach (mount or remount), not just once:
  // reading clientWidth forces layout, so the first measure is correct, and a ResizeObserver keeps
  // it live as the board reflows.
  const hostRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (el === null) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver !== "undefined") {
      roRef.current = new ResizeObserver(measure);
      roRef.current.observe(el);
    }
  }, []);

  const phaseClass =
    ring.phase === "passed"
      ? "vote-ring--passed"
      : ring.phase === "failed"
        ? "vote-ring--fading"
        : "vote-ring--igniting";

  // The seam is the path start (top-center); the drain runs clockwise from it. Reduced motion holds
  // the ring whole (offset 0) and steps opacity down in quarters instead of sweeping.
  const dashOffset = ringDashOffset(ring.fraction, reducedMotion);
  const opacity = reducedMotion ? coarseOpacityStep(ring.fraction) : undefined;

  const { w, h } = size;
  return (
    <div
      ref={hostRef}
      className={`vote-ring ${phaseClass}`}
      style={{ inset: `-${OFFSET}px` }}
      aria-hidden="true"
    >
      {w > 0 && h > 0 && (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${h}`}
          style={opacity !== undefined ? { opacity } : undefined}
        >
          <path
            d={meridianPath(w, h, RADIUS, WEIGHT)}
            strokeWidth={WEIGHT}
            pathLength={1}
            strokeDashoffset={dashOffset}
          />
        </svg>
      )}
    </div>
  );
}
