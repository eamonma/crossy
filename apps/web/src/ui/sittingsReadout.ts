// Sittings, read for render (DESIGN.md D29; design/post-game/SITTINGS.md "Presentation"): the
// owner's three rules, kept pure so the components only place text and ticks, the same split
// mosaicIsolation.ts and analysisReadout.ts keep.
//   - Active time is THE headline Time stat wherever a solve time renders: prefer the additive
//     `activeSolveSeconds` and fall back to the wall-clock `solveTimeSeconds` on stats frozen
//     before sittings shipped (PROTOCOL §4). The analysis bundle needs no preference: its
//     `momentum.durationSeconds` is already active seconds by contract (PROTOCOL §12).
//   - The sitting count is context, never a second stat ("24:13 · 2 sittings"): a quiet suffix
//     rendered only when the count is 2 or more, so a single-sitting game reads exactly as today.
//   - The ribbon marks each interior sitting boundary with a seam tick on the shared active axis
//     (spans are contiguous, PROTOCOL §12), and a zero-width edge span (the clamp corner) yields
//     no tick.
import type { Sittings } from "./completionAttribution";

/** The stats fields the headline reads (the protocol Stats, PROTOCOL §4): the wall-clock time
 * that always exists and the additive active time that may not (frozen pre-D29 rows). */
export interface SolveTimeStats {
  readonly solveTimeSeconds: number;
  readonly activeSolveSeconds?: number;
}

/**
 * The headline solve seconds (D29: active time is THE time): `activeSolveSeconds` when the stats
 * carry it, else the wall-clock `solveTimeSeconds` (stats frozen before sittings shipped are
 * never backfilled, PROTOCOL §4). A malformed active value falls back too, never a NaN headline.
 */
export function headlineSolveSeconds(stats: SolveTimeStats): number {
  const active = stats.activeSolveSeconds;
  return typeof active === "number" && Number.isFinite(active)
    ? active
    : stats.solveTimeSeconds;
}

/**
 * The sitting-count context beside the headline time ("2 sittings"), or null when there is
 * nothing to say. The owner's rule (D29): rendered only at 2 or more, so a single-sitting game
 * (or a count the wire never sent) reads exactly as today, no suffix. Always plural, since the
 * suffix exists only at 2+.
 */
export function sittingsSuffix(
  count: number | null | undefined,
): string | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  if (count < 2) return null;
  return `${Math.floor(count)} sittings`;
}

/**
 * The interior sitting boundaries in active seconds: `spans[k].endSeconds` for k < count-1, the
 * seam where one sitting ends and the next begins on the shared active axis (PROTOCOL §12). The
 * ribbon maps each through its existing time-to-x pipeline, so a seam tick lands on the same
 * axis the break marker and the playhead use. Empty when sittings are absent (an older bundle)
 * or single (no seams to mark). A boundary pinned to the axis edge — the zero-width-span clamp
 * corner, PROTOCOL §12 — is dropped: a zero-width seam tick draws nothing. Coincident boundaries
 * dedupe to one tick.
 */
export function seamTickSeconds(sittings: Sittings | undefined): number[] {
  if (sittings === undefined || sittings.spans.length < 2) return [];
  const end = sittings.spans[sittings.spans.length - 1]!.endSeconds;
  const ticks: number[] = [];
  for (const span of sittings.spans.slice(0, -1)) {
    const t = span.endSeconds;
    if (!Number.isFinite(t) || t <= 0 || t >= end) continue;
    if (ticks.length > 0 && ticks[ticks.length - 1] === t) continue;
    ticks.push(t);
  }
  return ticks;
}
