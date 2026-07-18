// The luminous ring (the UX spec): a halo OUTSIDE the grid, offset off the board's edge, ~3px, in
// the warm brand gold (--color-gold-9, the solo-gold ramp hue; never a roster color). It is the
// ONLY clock, so there is no countdown text anywhere; it drains proportionally to remaining time via
// the stroke-dash technique (pathLength normalized to 1). Decorative and aria-hidden: the state
// lives in the Proscenium text. Under prefers-reduced-motion it does not sweep; it steps down in
// opacity at coarse intervals instead.
import { coarseOpacityStep, remainingFraction } from "./voteView";
import type { CheckVoteRing } from "./useCheckVote";

export function LuminousRing({
  ring,
  reducedMotion,
}: {
  ring: CheckVoteRing;
  reducedMotion: boolean;
}) {
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

  return (
    <div
      key={ring.igniteKey}
      className={`vote-ring ${phaseClass}`}
      aria-hidden="true"
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={opacity !== undefined ? { opacity } : undefined}
      >
        <rect
          x="1.5"
          y="1.5"
          width="97"
          height="97"
          rx="3"
          pathLength={1}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </div>
  );
}
