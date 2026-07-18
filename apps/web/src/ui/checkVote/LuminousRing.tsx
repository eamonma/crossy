// The luminous ring (the UX spec): a halo OUTSIDE the grid, offset off the board's edge, ~3px, in
// the warm brand gold (--color-gold-9, the solo-gold ramp hue; never a roster color). It is the
// ONLY clock, so there is no countdown text anywhere; it drains proportionally to remaining time via
// the stroke-dash technique (pathLength normalized to 1). Decorative and aria-hidden: the state
// lives in the Proscenium text. Under prefers-reduced-motion it does not sweep; it steps down in
// opacity at coarse intervals instead.
//
// Geometry: the SVG is rendered in PIXEL space. A ResizeObserver measures the halo box and the
// viewBox matches it 1:1, so there is no preserveAspectRatio stretch to thicken the stroke on one
// axis or distort the corner radius (the earlier `vector-effect: non-scaling-stroke` was not honored
// under the stretch). The result is a crisp, uniform 3px stroke with a uniform radius at every board
// aspect and width.
import { useCallback, useRef, useState } from "react";
import { coarseOpacityStep, remainingFraction } from "./voteView";
import type { CheckVoteRing } from "./useCheckVote";

const WEIGHT = 3;
const RADIUS = 14;

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

  const fraction =
    ring.expiresAt !== null ? remainingFraction(ring.expiresAt, ring.nowMs) : 0;

  const phaseClass =
    ring.phase === "passed"
      ? "vote-ring--passed"
      : ring.phase === "failed"
        ? "vote-ring--fading"
        : "vote-ring--igniting";

  // Full-time reads as a complete ring (dashoffset 0); at expiry the dash slides fully off
  // (dashoffset 1). Reduced motion holds the ring whole and drops its opacity in coarse steps.
  const dashOffset = reducedMotion ? 0 : 1 - fraction;
  const opacity = reducedMotion ? coarseOpacityStep(fraction) : undefined;

  const { w, h } = size;
  return (
    <div ref={hostRef} className={`vote-ring ${phaseClass}`} aria-hidden="true">
      {w > 0 && h > 0 && (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${h}`}
          style={opacity !== undefined ? { opacity } : undefined}
        >
          <rect
            x={WEIGHT / 2}
            y={WEIGHT / 2}
            width={w - WEIGHT}
            height={h - WEIGHT}
            rx={RADIUS}
            strokeWidth={WEIGHT}
            pathLength={1}
            strokeDashoffset={dashOffset}
          />
        </svg>
      )}
    </div>
  );
}
