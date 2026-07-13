// The Analysis tab's pure core: the arithmetic behind the summary stats, the momentum ribbon
// geometry, and the moment formatting, kept out of the React components so it is testable under
// the node vitest environment (vite.config.ts pins environment: "node", include src/**/*.test.ts),
// the same split mosaicReveal.ts and completionAttribution.ts already keep.
//
// It reads the AnalysisResponse bundle (completionAttribution.ts) plus the roster and shapes it for
// render: nothing here is load-bearing on a letter, so the whole surface stays tier-1.5 (userIds,
// cells, and numbers only), INV-6-safe by construction.
//
// Named analysisReadout.ts, not analysisPanel.ts: AnalysisPanel.tsx sits beside it, and on a
// case-insensitive filesystem (any macOS clone) TypeScript treats two basenames that differ only in
// case as the same file (TS1149). Module basenames here must differ in more than case, the same rule
// mosaicReveal.ts pins against ContributionMosaic.tsx.
import type { AnalysisResponse } from "./completionAttribution";
import type { Roster } from "./mosaicReveal";
import { identityColor } from "./identityRoster";

/**
 * M:SS from a seconds count, tabular-friendly: floor to whole seconds, zero-pad the seconds field,
 * never negative, never NaN. A malformed or negative input reads "0:00" so a degenerate solve (an
 * empty duration, a null moment time) never renders "NaN:NaN" or an empty span. Past an hour it
 * carries the hour (H:MM:SS), matching gameTime.ts's formatDuration so the tab and the toolbar agree
 * digit-for-digit; kept local (not imported) so this module stays free of the React time hook.
 */
export function formatMSS(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const s = Math.max(0, Math.floor(safe));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** The headline stats above the ribbon: the solve's duration, how many distinct people first-solved
 * a square, and how many squares were solved (the owner map's entry count). Derived from the bundle
 * alone so the tab and the mosaic never disagree on the count. */
export interface AnalysisSummary {
  readonly durationSeconds: number;
  /** Distinct owning userIds across the owner map. */
  readonly solverCount: number;
  /** Number of owned (first-solved) squares. */
  readonly entryCount: number;
  /** M:SS of the duration, ready to render. */
  readonly durationLabel: string;
}

export function analysisSummary(bundle: AnalysisResponse): AnalysisSummary {
  const owners = bundle.owners;
  const entries = Object.values(owners);
  const distinct = new Set(entries);
  return {
    durationSeconds: bundle.momentum.durationSeconds,
    solverCount: distinct.size,
    entryCount: entries.length,
    durationLabel: formatMSS(bundle.momentum.durationSeconds),
  };
}

/** One solver in the legend: the color the mosaic paints them and the name to show, self resolved to
 * "You" (the same rule buildRoster uses). Ordered so self reads first, then room order. */
export interface LegendSolver {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  readonly self: boolean;
}

/** A minimal member view the legend needs: id, display name, and the presence color, the same
 * StackMember fields the mosaic's roster is built from. */
export interface LegendMember {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
}

/**
 * The legend rows: every member who owns at least one square, in the mosaic's colors. Self is named
 * "You" and floated to the front (the roster convention); the rest keep room order. A member with no
 * owned square is dropped (they contributed no color to the board, so a dot for them would name a
 * color that appears nowhere in the mosaic). Colors resolve through the shared identity palette
 * (identityRoster.ts, `isDark` for the ground) exactly as rosterOf resolves the board, so the legend,
 * the board, and the moment dots agree pixel-for-pixel and match iOS.
 */
export function legendSolvers(
  bundle: AnalysisResponse,
  members: readonly LegendMember[],
  selfId: string | null,
  isDark: boolean,
): LegendSolver[] {
  const owners = new Set(Object.values(bundle.owners));
  const rows: LegendSolver[] = [];
  for (const m of members) {
    if (!owners.has(m.userId)) continue;
    const self = m.userId === selfId;
    const row: LegendSolver = {
      userId: m.userId,
      name: self ? "You" : m.name,
      color: identityColor(m.color, isDark),
      self,
    };
    if (self) rows.unshift(row);
    else rows.push(row);
  }
  return rows;
}

/** Resolve a userId to its presence color through the roster, or null when the id is unknown (a
 * member who has since left the snapshot). A null color renders a neutral dot rather than crashing. */
export function colorOf(roster: Roster, userId: string): string | null {
  return roster[userId]?.color ?? null;
}

/** Resolve a userId to a display name, self as "You". Falls back to a plain label when the member is
 * not in the snapshot, so a moment card never renders an empty author. */
export function nameOf(
  members: readonly LegendMember[],
  userId: string,
  selfId: string | null,
): string {
  if (userId === selfId) return "You";
  const m = members.find((x) => x.userId === userId);
  return m?.name ?? "A solver";
}

// --- The momentum ribbon -------------------------------------------------------------------
// The server ships a fixed-length array of peak-normalized intensity samples (ANALYSIS.md: N = 40).
// The ribbon is a smoothed shape over them, not an interactive series, so this module turns the
// samples into an SVG path (a Catmull-Rom spline, the ratified mock's curve) and maps the turning
// point's break time to a sample index. The component draws the path; the math lives here so a test
// pins the curve and the index mapping without a renderer.

/** The number of samples the wire always ships (ANALYSIS.md momentum.samples length). A ribbon is
 * drawn against this fixed granularity, so the x-axis maps sample index -> [0, N-1]. */
export const RIBBON_SAMPLES = 40;

/** A point in the ribbon's own [0..1] x [0..1] space (x left-to-right over the solve, y intensity),
 * before the component scales it into the SVG viewBox. */
export interface RibbonPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Map a relative time (seconds from the solve's start) to a fractional sample index over the fixed
 * granularity: `t / duration * (N - 1)`, clamped to [0, N-1]. This is the exact inverse of the
 * server's bucketing (ANALYSIS.md: `idx = floor((at - t0) / (tEnd - t0) * (N - 1))`), so the break
 * marker lands on the same bucket the momentum samples were binned into. A zero (or non-finite)
 * duration puts everything at index 0 (a single-instant solve), never a divide-by-zero.
 */
export function timeToSampleIndex(
  seconds: number,
  durationSeconds: number,
  sampleCount = RIBBON_SAMPLES,
): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(durationSeconds)) return 0;
  if (durationSeconds <= 0) return 0;
  const raw = (seconds / durationSeconds) * (sampleCount - 1);
  return Math.max(0, Math.min(sampleCount - 1, raw));
}

/**
 * The ribbon's points in [0..1] space: x is the sample index normalized over the span, y is the
 * (already peak-normalized) sample value clamped to [0,1]. An empty or wrong-length array yields a
 * flat baseline (every y = 0), so a degenerate all-zero momentum draws a quiet flat line rather than
 * NaN. Pure: same samples, same points.
 */
export function ribbonPoints(samples: readonly number[]): RibbonPoint[] {
  const n = samples.length;
  if (n === 0) return [];
  if (n === 1) {
    const y = clamp01(samples[0] ?? 0);
    return [
      { x: 0, y },
      { x: 1, y },
    ];
  }
  const pts: RibbonPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    pts.push({ x: i / (n - 1), y: clamp01(samples[i] ?? 0) });
  }
  return pts;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** The ribbon's viewBox and insets. The component owns the numbers; the math scales into them. */
export interface RibbonBox {
  readonly width: number;
  readonly height: number;
  readonly padX: number;
  readonly padTop: number;
  readonly padBottom: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A smooth SVG path `d` through the points, a Catmull-Rom spline converted to cubic beziers (the
 * ratified mock's curve), scaled into the box with its insets. y is flipped (SVG's origin is
 * top-left, so a higher intensity draws higher on screen). Fewer than two points yields an empty
 * string (nothing to draw). The endpoints clamp their control tangents, so the curve never
 * overshoots past the first or last sample.
 */
export function ribbonLinePath(
  points: readonly RibbonPoint[],
  box: RibbonBox,
): string {
  if (points.length < 2) return "";
  const p = points.map((pt) => ({
    x: scaleX(pt.x, box),
    y: scaleY(pt.y, box),
  }));
  let d = `M${round(p[0]!.x)},${round(p[0]!.y)}`;
  for (let i = 0; i < p.length - 1; i += 1) {
    const p0 = p[i === 0 ? 0 : i - 1]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2 >= p.length ? p.length - 1 : i + 2]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${round(p2.x)},${round(p2.y)}`;
  }
  return d;
}

/** The closed area path under the line, for the ribbon's soft gradient fill. Drops to the baseline
 * at each end and closes. Empty when there is nothing to draw. */
export function ribbonAreaPath(
  points: readonly RibbonPoint[],
  box: RibbonBox,
): string {
  const line = ribbonLinePath(points, box);
  if (line === "") return "";
  const baseY = round(box.height - box.padBottom);
  const rightX = round(scaleX(points[points.length - 1]!.x, box));
  const leftX = round(scaleX(points[0]!.x, box));
  return `${line} L${rightX},${baseY} L${leftX},${baseY} Z`;
}

function scaleX(x: number, box: RibbonBox): number {
  return box.padX + x * (box.width - 2 * box.padX);
}

function scaleY(y: number, box: RibbonBox): number {
  return box.padTop + (1 - y) * (box.height - box.padTop - box.padBottom);
}

/** The x pixel for a fractional sample index, so the component can place the break marker on the
 * ribbon's baseline in the same coordinate space the path is drawn in. */
export function sampleIndexToX(
  index: number,
  sampleCount: number,
  box: RibbonBox,
): number {
  const frac = sampleCount <= 1 ? 0 : index / (sampleCount - 1);
  return round(scaleX(frac, box));
}

/**
 * The replay playhead's inverse: an SVG-local x back to a relative time in [0, durationSeconds].
 * The playhead is drawn at the SAME place the break marker is, `sampleIndexToX(timeToSampleIndex(t,
 * dur), N, box)`, and that round-trip is linear in t (the sample count cancels: index = t/dur*(N-1),
 * x = padX + index/(N-1)*(width - 2*padX) = padX + t/dur*(width - 2*padX)). So a drag inverts it in
 * closed form: the fraction of the plot width the pointer sits at, times the duration. Clamped to
 * [0, dur] so dragging past either end pins to that end, never off-axis. A zero or non-finite
 * duration returns 0 (a single-instant solve has one instant to seek to). Pure: same x, same t.
 */
export function xToTimeSeconds(
  x: number,
  box: RibbonBox,
  durationSeconds: number,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(durationSeconds)) return 0;
  if (durationSeconds <= 0) return 0;
  const span = box.width - 2 * box.padX;
  if (span <= 0) return 0;
  const frac = Math.max(0, Math.min(1, (x - box.padX) / span));
  return frac * durationSeconds;
}

/** The y pixel for the ribbon's baseline (intensity 0), where the time ticks and the break dot sit. */
export function ribbonBaselineY(box: RibbonBox): number {
  return round(scaleY(0, box));
}

/** True when the momentum has any signal at all (some sample above zero): a flat all-zero series is
 * the degenerate case (a single-instant solve), where the ribbon shows a quiet flat line and no
 * break marker rather than pretending to a shape. */
export function momentumHasSignal(samples: readonly number[]): boolean {
  return samples.some((s) => Number.isFinite(s) && s > 0);
}
