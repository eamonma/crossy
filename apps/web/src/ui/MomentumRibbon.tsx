// The room's tempo, drawn as a smooth ribbon over the 40 peak-normalized momentum samples the wire
// ships (ANALYSIS.md). A gold area under a gold-11 line (the app's accent, not a chart palette), a
// quiet baseline, and, when the turning point exists, a shaded stall region closing on the "picked
// up" marker at breakSeconds. When the bundle carries sittings (D29), a recessive hairline seam
// marks each interior sitting boundary on the same active axis; an older bundle draws none. The
// math lives in analysisReadout.ts and sittingsReadout.ts; this only draws it.
//
// When replay is wired (the Analysis tab on a rail or dock), the ribbon doubles as the replay
// transport: a scrub overlay captures the drag, a gold playhead marks the current time T, and the
// board fills to match on the same clock (REPLAY.md). The transport is opt-in through optional props,
// so any other caller or harness that passes only { bundle, idBase } renders the plain ribbon.
//
// Degenerate: an all-zero series (a single-instant solve) draws a flat baseline and no break marker,
// never a NaN path, and offers NO playhead or scrub (there is nothing to replay). The break maps
// through timeToSampleIndex, the exact inverse of the server's bucketing, so the dot lands on the bin
// its samples were counted into; the playhead uses the same forward mapping so the two align.
import { useRef } from "react";
import {
  formatMSS,
  momentumHasSignal,
  ribbonAreaPath,
  ribbonBaselineY,
  ribbonLinePath,
  ribbonPoints,
  sampleIndexToX,
  timeToSampleIndex,
  xToTimeSeconds,
  type RibbonBox,
} from "./analysisReadout";
import { seamTickSeconds } from "./sittingsReadout";
import type { AnalysisResponse } from "./completionAttribution";

const BOX: RibbonBox = {
  width: 340,
  height: 104,
  padX: 4,
  padTop: 20,
  padBottom: 22,
};

/** The momentum ribbon for a bundle. `idBase` namespaces the gradient id so two ribbons on one page
 * (the desktop panel and, in the harness, a second instance) never share a def.
 *
 * The replay props are optional and default to inert: without them the ribbon draws exactly as
 * before. With them (`durationSeconds > 0` and a series that has signal) the ribbon gains the scrub
 * overlay and, when `replayTime !== null`, the playhead. `onSeek` reports a time in [0, duration]. */
export function MomentumRibbon({
  bundle,
  idBase,
  durationSeconds = 0,
  replayTime = null,
  playing = false,
  onSeek,
}: {
  bundle: AnalysisResponse;
  idBase: string;
  durationSeconds?: number | undefined;
  replayTime?: number | null | undefined;
  playing?: boolean | undefined;
  onSeek?: ((t: number) => void) | undefined;
}) {
  const { samples, durationSeconds: bundleDuration } = bundle.momentum;
  const points = ribbonPoints(samples);
  const line = ribbonLinePath(points, BOX);
  const area = ribbonAreaPath(points, BOX);
  const hasSignal = momentumHasSignal(samples);
  const baselineY = ribbonBaselineY(BOX);
  const gradId = `${idBase}-momentum-fill`;
  const svgRef = useRef<SVGSVGElement>(null);

  // The transport rides only where there is a solve to scrub: a real duration and a shaped series.
  // A single-instant solve keeps the quiet flat line and offers no playhead or scrub overlay.
  const transport = durationSeconds > 0 && hasSignal && onSeek !== undefined;

  const turning = bundle.moments.turningPoint;
  // The break only marks when there is a turning point AND the series has a shape to mark on.
  const breakX =
    turning !== null && hasSignal
      ? sampleIndexToX(
          timeToSampleIndex(turning.breakSeconds, bundleDuration),
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
            bundleDuration,
          ),
          samples.length || 1,
          BOX,
        )
      : null;

  // The sitting seams (D29): each interior sitting boundary, mapped through the SAME forward
  // pipeline the break marker uses (the spans share the bundle's active axis, PROTOCOL §12), so a
  // seam sits exactly where the axis stitched two sittings together. Absent sittings (an older
  // cached bundle) or a single sitting draws none, and a flat series has no shape to seam.
  const seamXs = hasSignal
    ? seamTickSeconds(bundle.sittings).map((t) =>
        sampleIndexToX(
          timeToSampleIndex(t, bundleDuration),
          samples.length || 1,
          BOX,
        ),
      )
    : [];

  // The playhead's x: the SAME forward mapping the break uses, so a playhead and the break marker
  // align pixel-for-pixel when they sit at the same time.
  const headX =
    transport && replayTime !== null
      ? sampleIndexToX(
          timeToSampleIndex(replayTime, durationSeconds),
          samples.length || 1,
          BOX,
        )
      : null;

  // Convert a pointer event's client x to the SVG's own viewBox x, then to a time, and report it.
  // getScreenCTM handles the box's scale-to-fit so a drag lands under the pointer at any width.
  const seekFromClientX = (clientX: number): void => {
    if (!transport || onSeek === undefined) return;
    const svg = svgRef.current;
    if (svg === null) return;
    const ctm = svg.getScreenCTM();
    if (ctm === null) return;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = 0;
    const local = pt.matrixTransform(ctm.inverse());
    onSeek(xToTimeSeconds(local.x, BOX, durationSeconds));
  };

  const step = durationSeconds / 40;
  const onScrubKeyDown = (e: React.KeyboardEvent): void => {
    if (!transport || onSeek === undefined) return;
    const at = replayTime ?? 0;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        onSeek(Math.max(0, at - step));
        break;
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        onSeek(Math.min(durationSeconds, at + step));
        break;
      case "Home":
        e.preventDefault();
        onSeek(0);
        break;
      case "End":
        e.preventDefault();
        onSeek(durationSeconds);
        break;
      default:
        break;
    }
  };

  return (
    <svg
      ref={svgRef}
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

      {/* Sitting seams (D29): a recessive hairline where one sitting ends and the next begins.
          The baseline's own border color, no dash, no dot, no label — deliberately quieter than
          the break marker — and drawn under the gold area/line so the ribbon paints over it. */}
      {seamXs.map((x, i) => (
        <line
          key={`seam-${i}`}
          data-seam
          x1={x}
          y1={BOX.padTop}
          x2={x}
          y2={baselineY}
          stroke="var(--color-border)"
          strokeWidth={1}
        />
      ))}

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

      {/* The playhead: a full-height gold rule with a handle on the baseline and a compact time
          label, drawn at the same mapping the break uses so the two line up. Shown only while
          replaying (replayTime !== null); the resting board has no head. */}
      {headX !== null && replayTime !== null && (
        <g pointerEvents="none">
          <line
            x1={headX}
            y1={BOX.padTop - 8}
            x2={headX}
            y2={baselineY + 3}
            stroke="var(--color-gold-11)"
            strokeWidth={1.5}
          />
          <circle
            cx={headX}
            cy={baselineY + 3}
            r={3.6}
            fill="var(--color-gold-11)"
          />
          <text
            x={clampLabelX(headX)}
            y={baselineY + 15}
            fontSize={9}
            textAnchor={headX > BOX.width - 60 ? "end" : "start"}
            fill="var(--color-gold-11)"
            fontFamily="var(--font-sans)"
            fontWeight={600}
          >
            {formatMSS(replayTime)}
          </text>
        </g>
      )}

      {/* The scrub overlay: a transparent full-height rect over the plot that captures the drag and
          the keyboard. It sits last so it wins the pointer, and it is a slider for assistive tech. */}
      {transport && (
        <rect
          role="slider"
          aria-label="Scrub the solve replay"
          aria-valuemin={0}
          aria-valuemax={durationSeconds}
          aria-valuenow={replayTime ?? 0}
          aria-valuetext={`${formatMSS(replayTime ?? 0)}${playing ? ", playing" : ""}`}
          tabIndex={0}
          x={BOX.padX}
          y={0}
          width={BOX.width - 2 * BOX.padX}
          height={BOX.height}
          fill="transparent"
          style={{ cursor: "ew-resize", outline: "none" }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            seekFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (
              (e.target as Element).hasPointerCapture?.(e.pointerId) === true
            ) {
              seekFromClientX(e.clientX);
            }
          }}
          onPointerUp={(e) => {
            (e.target as Element).releasePointerCapture?.(e.pointerId);
          }}
          onKeyDown={onScrubKeyDown}
        />
      )}
    </svg>
  );
}

/** Keep the marker label inside the box: nudge in from whichever edge it is near. */
function clampLabelX(x: number): number {
  if (x > BOX.width - 60) return x - 6;
  return x + 7;
}
