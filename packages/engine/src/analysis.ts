// Post-game analysis projections (design/post-game/ANALYSIS.md, the vectors/analysis
// family). Three pure readings of one seq-ordered replay of cell_events: the solve trace
// (firstCorrect plus timing), the momentum ribbon (bucketed tempo), and the named moments
// (opening, closing, turning point). One reducer, many projections, the note FIRST-CORRECT
// left for later.
//
// The trace is firstCorrect plus the timestamp firstCorrect ignores: for each cell, the
// first (min seq) matching write, kept as {cell, userId, seq, at}. Scheme 1, first-ever
// correct: once a cell is in the trace, no later clear, overwrite, or re-correction moves
// its entry or its at (the same immunity firstCorrect pins). Correctness is the shared
// matches comparator, so ASCII casing (INV-1) and the rebus first-character rule live in
// one place and never drift.
//
// INV-9: this file imports nothing outside packages/engine (only ./comparator and
// ./types), and takes its events, ids, and timestamps as plain data (at is epoch ms passed
// in, never a clock read). INV-6: every output carries userIds, cells, and numbers only,
// never a solution value, so a letter cannot leak through any projection. Times are
// relative seconds from the solve's start (t0 = min(at)); the engine subtracts, it does not
// round.

import { matches } from "./comparator";
import type { Solution } from "./types";

/**
 * One raw write event from the cell_events log, the firstCorrect WriteEvent shape plus the
 * `at` timestamp the owner-map read ignores. `value` is an uppercase ASCII token matching
 * `^[A-Z0-9]{1,10}$`, or null for a clear. `at` is epoch milliseconds, passed as data.
 */
export interface SolveEvent {
  readonly seq: number;
  readonly cell: number;
  readonly userId: string;
  readonly value: string | null;
  readonly at: number;
}

/**
 * One solve-trace entry: the first-correct event for a cell, retaining its timing.
 * Carries userId, cell, and numbers only (INV-6): no solution value ever rides the trace.
 */
export interface TraceEntry {
  readonly cell: number;
  readonly userId: string;
  readonly seq: number;
  readonly at: number;
}

/** Momentum sample count (N). A vector cites this constant, never a magic 40. */
export const MOMENTUM_SAMPLES = 40;

/** Turning-point burst window in milliseconds (30s). A vector cites this, not a magic number. */
export const BURST_WINDOW_MS = 30_000;

/**
 * The sitting boundary in milliseconds (30 minutes, DESIGN.md D29). A gap of at least this
 * between consecutive cell events (seq order) ends a sitting; exactly the threshold splits
 * (`>=`), a negative gap (clock skew) never does. Frozen with the same status as
 * BURST_WINDOW_MS: named, cited by vectors, never inlined.
 */
export const SITTING_GAP_MS = 1_800_000;

/** A named beat: the cell, its author, and its time in relative seconds from t0. */
export interface Beat {
  readonly cell: number;
  readonly userId: string;
  readonly atSeconds: number;
}

/** The turning point: the longest stall, the break that ended it, and the burst that followed. */
export interface TurningPoint {
  readonly stallSeconds: number;
  readonly breakSeconds: number;
  readonly burst: number;
}

/** One replay step: a cell and the relative second it went correct. Cells and numbers only (INV-6). */
export interface SequenceStep {
  readonly cell: number;
  readonly atSeconds: number;
}

/**
 * Project the write log to the solve trace (scheme 1). Events are walked in ascending seq
 * order (sorted defensively, as firstCorrect does); the first matching write to a solution
 * cell claims it, fixes its `at`, and is never displaced by a later clear or re-correction.
 * The result is seq-ordered naturally, since the walk is seq-ordered.
 */
export function solveTrace(
  events: readonly SolveEvent[],
  solution: Solution,
): TraceEntry[] {
  const seen = new Set<number>();
  const trace: TraceEntry[] = [];

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    // A clear is never correct.
    if (event.value === null) continue;
    // First correct write wins and never changes.
    if (seen.has(event.cell)) continue;
    // No solution entry means a block or absent cell: it can never go correct.
    const expected = solution.get(event.cell);
    if (expected === undefined) continue;
    // Correctness is the shared comparator (INV-1, rebus first-char).
    if (matches(expected, event.value)) {
      seen.add(event.cell);
      trace.push({
        cell: event.cell,
        userId: event.userId,
        seq: event.seq,
        at: event.at,
      });
    }
  }

  return trace;
}

/**
 * The room's tempo across its own duration: a fixed-length array of peak-normalized
 * intensity samples, plus the solve's duration in seconds. Each trace entry is bucketed by
 * its position in [t0, tEnd]; each sample is its bucket's count over the busiest bucket's
 * count. An empty trace is a flat, all-zero curve of zero duration (no division by zero).
 */
export function momentum(trace: readonly TraceEntry[]): {
  durationSeconds: number;
  samples: number[];
} {
  if (trace.length === 0) {
    return {
      durationSeconds: 0,
      samples: new Array<number>(MOMENTUM_SAMPLES).fill(0),
    };
  }

  // Walk with values (no indexing) so noUncheckedIndexedAccess stays happy, as firstCorrect
  // does. The empty case returned above, so at least one entry seeds t0/tEnd.
  let t0 = Infinity;
  let tEnd = -Infinity;
  for (const entry of trace) {
    if (entry.at < t0) t0 = entry.at;
    if (entry.at > tEnd) tEnd = entry.at;
  }

  const durationSeconds = (tEnd - t0) / 1000;

  const counts = new Array<number>(MOMENTUM_SAMPLES).fill(0);
  for (const entry of trace) {
    // A single-instant solve (tEnd == t0) puts every fill in bucket 0.
    const idx =
      tEnd > t0
        ? Math.floor(((entry.at - t0) / (tEnd - t0)) * (MOMENTUM_SAMPLES - 1))
        : 0;
    // idx is in [0, MOMENTUM_SAMPLES - 1] by construction; the ?? 0 satisfies
    // noUncheckedIndexedAccess without a non-null assertion.
    counts[idx] = (counts[idx] ?? 0) + 1;
  }

  const max = Math.max(...counts);
  const samples = counts.map((count) => (max === 0 ? 0 : count / max));

  return { durationSeconds, samples };
}

/**
 * Three named beats from timing alone (no geometry): the opening (earliest at, min-seq
 * tie-break), the closing (latest at, max-seq tie-break), and the turning point (the
 * longest consecutive gap, the break that ended it, and the burst inside BURST_WINDOW_MS
 * after it). All null for an empty trace; the turning point is null for a trace of fewer
 * than two entries (no gap to measure).
 */
export function moments(trace: readonly TraceEntry[]): {
  firstToFall: Beat | null;
  lastSquare: Beat | null;
  turningPoint: TurningPoint | null;
} {
  // firstToFall: min at (ties to min seq). lastSquare: max at (ties to max seq). The trace
  // is seq-ordered; walking with values (no indexing) keeps this clean under
  // noUncheckedIndexedAccess, as firstCorrect does. `first`/`last` seed on the first entry.
  let first: TraceEntry | null = null;
  let last: TraceEntry | null = null;
  // The largest consecutive gap and the entry that ended it (the break), ties to earliest.
  let prev: TraceEntry | null = null;
  let bestGap = -1;
  let breakEntry: TraceEntry | null = null;
  for (const entry of trace) {
    if (
      first === null ||
      entry.at < first.at ||
      (entry.at === first.at && entry.seq < first.seq)
    ) {
      first = entry;
    }
    if (
      last === null ||
      entry.at > last.at ||
      (entry.at === last.at && entry.seq > last.seq)
    ) {
      last = entry;
    }
    if (prev !== null) {
      const gap = entry.at - prev.at;
      if (gap > bestGap) {
        bestGap = gap;
        breakEntry = entry;
      }
    }
    prev = entry;
  }

  if (first === null || last === null) {
    return { firstToFall: null, lastSquare: null, turningPoint: null };
  }

  const t0 = first.at;

  const firstToFall: Beat = {
    cell: first.cell,
    userId: first.userId,
    atSeconds: (first.at - t0) / 1000,
  };
  const lastSquare: Beat = {
    cell: last.cell,
    userId: last.userId,
    atSeconds: (last.at - t0) / 1000,
  };

  let turningPoint: TurningPoint | null = null;
  if (breakEntry !== null) {
    const breakAt = breakEntry.at;
    let burst = 0;
    for (const entry of trace) {
      if (entry.at >= breakAt && entry.at <= breakAt + BURST_WINDOW_MS) {
        burst++;
      }
    }
    turningPoint = {
      stallSeconds: bestGap / 1000,
      breakSeconds: (breakAt - t0) / 1000,
      burst,
    };
  }

  return { firstToFall, lastSquare, turningPoint };
}

/**
 * The solve replay's foundation: the ordered "who fell when" as { cell, atSeconds }, sorted
 * ascending by (at, seq) and timed relative to the solve's start (t0 = min(at)). at-driven, not
 * an echo of trace order: clock skew across writers can put a later-seq fill at an earlier at.
 * No userId (INV-6): the client reads the owner from the bundle's owners map. Empty trace -> [].
 */
export function solveSequence(trace: readonly TraceEntry[]): SequenceStep[] {
  if (trace.length === 0) return [];
  let t0 = Infinity;
  for (const entry of trace) if (entry.at < t0) t0 = entry.at;
  const ordered = [...trace].sort((a, b) => a.at - b.at || a.seq - b.seq);
  return ordered.map((e) => ({ cell: e.cell, atSeconds: (e.at - t0) / 1000 }));
}

/** One sitting's extent on the active axis, in relative seconds. Numbers only (INV-6). */
export interface SittingSpan {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/**
 * The wire `sittings` field (PROTOCOL.md section 12, DESIGN.md D29): the partition's size,
 * its spans on the active axis, and the wall-clock trace span kept for flavor copy.
 */
export interface SittingsResult {
  readonly count: number;
  readonly spans: SittingSpan[];
  readonly wallSeconds: number;
}

/**
 * Remap the event log onto concatenated active time (design/post-game/SITTINGS.md, D29).
 * Events are walked in ascending seq order (sorted defensively, as solveTrace does); every
 * gap of SITTING_GAP_MS or more between consecutive events collapses to exactly zero, so
 * `activeAt = at - (sum of collapsed gaps before it)`. A collapsed gap is subtracted in
 * full: the boundary events share one active instant (the seam), the axis has no holes and
 * no overlaps. A negative gap (clock skew) is under the threshold and never splits. A log
 * with no gap at the threshold is the identity mapping, which is the D29 compat proof:
 * every single-sitting game reads byte-identically to the pre-sittings pipeline.
 *
 * Production composes `solveTrace(collapseIdle(events), solution)`; the composition itself
 * belongs to the caller, the engine only exports the pieces.
 */
export function collapseIdle(events: readonly SolveEvent[]): SolveEvent[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const active: SolveEvent[] = [];
  let shift = 0;
  let prevAt: number | null = null;
  for (const event of ordered) {
    if (prevAt !== null && event.at - prevAt >= SITTING_GAP_MS) {
      shift += event.at - prevAt;
    }
    prevAt = event.at;
    active.push({ ...event, at: event.at - shift });
  }
  return active;
}

/** Min/max `at` over a trace, or null when the trace is empty. */
function traceBounds(
  trace: readonly TraceEntry[],
): { t0: number; tEnd: number } | null {
  if (trace.length === 0) return null;
  let t0 = Infinity;
  let tEnd = -Infinity;
  for (const entry of trace) {
    if (entry.at < t0) t0 = entry.at;
    if (entry.at > tEnd) tEnd = entry.at;
  }
  return { t0, tEnd };
}

/**
 * The sittings wire projection (design/post-game/SITTINGS.md, D29): partition the full
 * seq-ordered event log into sittings (any event is presence: writes, wrong writes, and
 * clears alike, never the first-correct trace, so a struggling solver bridges a gap), then
 * express each sitting as a span on the active axis of the remapped trace, the same axis
 * momentum's durationSeconds and sequence's atSeconds live on.
 *
 * Spans are contiguous by construction (spans[k+1].startSeconds == spans[k].endSeconds,
 * first start 0, last end durationSeconds): each boundary is the seam's active instant in
 * seconds relative to the remapped trace's t0, clamped to [0, durationSeconds] and
 * non-decreasing, so a sitting holding no trace entry (a wrong-writes-only sitting)
 * degenerates to a zero-width span at the axis edge while the count stays honest.
 * `wallSeconds` is the wall-clock span of the UNREMAPPED trace, the number durationSeconds
 * reported before the re-base, flavor copy only. Exact division throughout: the engine
 * subtracts and divides, it does not round.
 */
export function sittings(
  events: readonly SolveEvent[],
  solution: Solution,
): SittingsResult {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  if (ordered.length === 0) return { count: 0, spans: [], wallSeconds: 0 };

  // The remap; collapseIdle sorts by the same key, so active[i] mirrors ordered[i].
  const active = collapseIdle(ordered);

  // Each boundary's seam: the shared active instant of the events on either side of a
  // collapsed gap (>= SITTING_GAP_MS between consecutive wall timestamps, seq order).
  const seamActiveAts: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    const currActive = active[i];
    // Guards satisfy noUncheckedIndexedAccess; the indices exist by construction.
    if (prev === undefined || curr === undefined || currActive === undefined) {
      continue;
    }
    if (curr.at - prev.at >= SITTING_GAP_MS) seamActiveAts.push(currActive.at);
  }

  // Both traces: spans anchor to the remapped (active) trace, wallSeconds to the raw one.
  const activeBounds = traceBounds(solveTrace(active, solution));
  const wallBounds = traceBounds(solveTrace(ordered, solution));
  const durationSeconds =
    activeBounds === null ? 0 : (activeBounds.tEnd - activeBounds.t0) / 1000;
  const wallSeconds =
    wallBounds === null ? 0 : (wallBounds.tEnd - wallBounds.t0) / 1000;

  // Boundaries in relative seconds, clamped to [0, durationSeconds] and non-decreasing.
  const cuts: number[] = [];
  let floor = 0;
  for (const seamAt of seamActiveAts) {
    let boundary =
      activeBounds === null ? 0 : (seamAt - activeBounds.t0) / 1000;
    if (boundary < floor) boundary = floor;
    if (boundary > durationSeconds) boundary = durationSeconds;
    cuts.push(boundary);
    floor = boundary;
  }

  // Contiguous spans: each sitting starts exactly where the previous ended.
  const spans: SittingSpan[] = [];
  let start = 0;
  for (const cut of cuts) {
    spans.push({ startSeconds: start, endSeconds: cut });
    start = cut;
  }
  spans.push({ startSeconds: start, endSeconds: durationSeconds });

  return { count: spans.length, spans, wallSeconds };
}
