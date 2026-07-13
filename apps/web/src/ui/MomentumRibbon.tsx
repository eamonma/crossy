// The room's tempo, drawn as a smooth ribbon over the 40 peak-normalized momentum samples the wire
// ships (ANALYSIS.md). A gold area under a gold-11 line (the app's accent, not a chart palette), a
// quiet baseline, and, when the turning point exists, a shaded stall region closing on the "picked
// up" marker at breakSeconds. The math lives in analysisReadout.ts; this only draws it.
//
// Degenerate: an all-zero series (a single-instant solve) draws a flat baseline and no break marker,
// never a NaN path. The break maps through timeToSampleIndex, the exact inverse of the server's
// bucketing, so the dot lands on the bin its samples were counted into.
import {
  momentumHasSignal,
  ribbonAreaPath,
  ribbonBaselineY,
  ribbonLinePath,
  ribbonPoints,
  sampleIndexToX,
  timeToSampleIndex,
  type RibbonBox,
} from "./analysisReadout";
import type { AnalysisResponse } from "./completionAttribution";

const BOX: RibbonBox = {
  width: 340,
  height: 104,
  padX: 4,
  padTop: 20,
  padBottom: 22,
};

/** The momentum ribbon for a bundle. `idBase` namespaces the gradient id so two ribbons on one page
 * (the desktop panel and, in the harness, a second instance) never share a def. */
export function MomentumRibbon({
  bundle,
  idBase,
}: {
  bundle: AnalysisResponse;
  idBase: string;
}) {
  const { samples, durationSeconds } = bundle.momentum;
  const points = ribbonPoints(samples);
  const line = ribbonLinePath(points, BOX);
  const area = ribbonAreaPath(points, BOX);
  const hasSignal = momentumHasSignal(samples);
  const baselineY = ribbonBaselineY(BOX);
  const gradId = `${idBase}-momentum-fill`;

  const turning = bundle.moments.turningPoint;
  // The break only marks when there is a turning point AND the series has a shape to mark on.
  const breakX =
    turning !== null && hasSignal
      ? sampleIndexToX(
          timeToSampleIndex(turning.breakSeconds, durationSeconds),
          samples.length || 1,
          BOX,
        )
      : null;
  // The stall runs from the fill that opened it back to the break; shade [stallStart, break] where
  // stallStart = breakSeconds - stallSeconds. Both map through the same inverse bucketing.
  const stallX =
    turning !== null && hasSignal
      ? sampleIndexToX(
          timeToSampleIndex(
            Math.max(0, turning.breakSeconds - turning.stallSeconds),
            durationSeconds,
          ),
          samples.length || 1,
          BOX,
        )
      : null;

  return (
    <svg
      className="block w-full h-auto"
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      role="img"
      aria-label={
        hasSignal
          ? "The room's solving tempo over time, with the longest pause shaded and the point where solving picked back up marked"
          : "The room's solving tempo, a quiet flat line for a short solve"
      }
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-gold-8)" stopOpacity={0.5} />
          <stop
            offset="100%"
            stopColor="var(--color-gold-8)"
            stopOpacity={0.05}
          />
        </linearGradient>
      </defs>

      {/* The stall region: a soft sand wash from the pause's start to the break, so the eye reads the
          quiet stretch before the room broke through. */}
      {stallX !== null && breakX !== null && breakX > stallX && (
        <rect
          x={stallX}
          y={BOX.padTop - 6}
          width={breakX - stallX}
          height={baselineY - (BOX.padTop - 6)}
          fill="var(--color-sand-4)"
          opacity={0.6}
        />
      )}

      {/* Baseline: the quiet sand rule the tempo rides on. */}
      <line
        x1={BOX.padX}
        y1={baselineY}
        x2={BOX.width - BOX.padX}
        y2={baselineY}
        stroke="var(--color-border)"
        strokeWidth={1}
      />

      {area !== "" && <path d={area} fill={`url(#${gradId})`} />}
      {line !== "" && (
        <path
          d={line}
          fill="none"
          stroke="var(--color-gold-11)"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* The break: a gold dot with a soft halo on the baseline, labeled once. */}
      {breakX !== null && (
        <g>
          <line
            x1={breakX}
            y1={BOX.padTop - 6}
            x2={breakX}
            y2={baselineY}
            stroke="var(--color-gold-9)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.7}
          />
          <circle
            cx={breakX}
            cy={baselineY}
            r={3.4}
            fill="var(--color-gold-9)"
          />
          <circle
            cx={breakX}
            cy={baselineY}
            r={6.5}
            fill="none"
            stroke="var(--color-gold-9)"
            strokeOpacity={0.3}
            strokeWidth={1}
          />
          <text
            x={clampLabelX(breakX)}
            y={BOX.padTop - 9}
            fontSize={9}
            textAnchor={breakX > BOX.width - 60 ? "end" : "start"}
            fill="var(--color-gold-11)"
            fontFamily="var(--font-sans)"
            fontWeight={600}
          >
            picked up
          </text>
        </g>
      )}
    </svg>
  );
}

/** Keep the marker label inside the box: nudge in from whichever edge it is near. */
function clampLabelX(x: number): number {
  if (x > BOX.width - 60) return x - 6;
  return x + 7;
}
