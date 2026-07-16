// Solver titles: the stat sheet and the award ladder (design/post-game/TITLES.md, the
// vectors/analysis/titles.json family). Two pure reducers: titleStats projects the raw
// write log to one per-solver row of counts plus a small room header, and awardTitles
// walks a fixed ladder over that sheet to hand every solver at most one superlative.
//
// Layer 1 counts, it never interprets (TITLES.md amendment 1): every column is an argmax
// ingredient literally countable in the event log. Layer 2 is data all the way down: each
// rung declares a gate, a claim, and an evidence column, so a future title is a ladder
// edit, never a new walk. The ladder is a fixed engine constant, not a parameter: two
// clients or two services must never disagree on who the saboteur was.
//
// Correctness is everywhere the shared `matches` comparator (INV-1 ASCII casing, the
// rebus first-character rule), never string equality; `brokeStall` and the room's
// stallSeconds are pinned byte-identical to the shipped `moments()` projection, so the
// ribbon's marker and the ice-breaker card can never name different people.
//
// INV-9: this file imports nothing outside packages/engine (only ./analysis,
// ./comparator, ./types); events, ids, timestamps, slots, and geometry arrive as data.
// INV-6: the sheet and the award array carry userIds, keys, and numbers only, never a
// solution value.

import { BURST_WINDOW_MS, moments, solveTrace } from "./analysis";
import type { SolveEvent, TraceEntry } from "./analysis";
import { matches } from "./comparator";
import type { Solution } from "./types";

// The pinned constants (TITLES.md; vectors cite these by name, never inlined).
// BURST_WINDOW_MS is shared with momentum and re-exported from ./analysis via the index.

/**
 * Share of the (at, seq)-ordered trace that is the opening stretch (and the closing).
 * A rational fifth: the window is `ceil(T / 5)`, computed as `ceil(T * num / den)` with
 * exact integers (below), never a float multiply. `0.2` is the design's readable name for
 * the same fifth (TITLES.md; vectors cite it), and stays the exported constant.
 */
export const OPENING_SHARE = 0.2;
/**
 * The opening/closing share as an exact rational, so the window is integer arithmetic:
 * `Math.ceil((T * OPENING_SHARE_NUMERATOR) / OPENING_SHARE_DENOMINATOR)`. This keeps the
 * stretch pinned to `ceil(T / 5)` regardless of any platform where `0.2 * T` could round a
 * boundary T up by one (an IEEE float edge); on V8 the two agree for every T, so this is a
 * behavior-preserving hardening, not a change.
 */
const OPENING_SHARE_NUMERATOR = 1;
const OPENING_SHARE_DENOMINATOR = 5;
/** The ice-breaker never awards on a stall shorter than this many whole seconds. */
export const STALL_FLOOR_SECONDS = 120;
/** The saboteur never awards under this many overwrites. */
export const SABOTEUR_MIN = 3;
/** The bullseye never awards under this many (flawless) fills. */
export const BULLSEYE_MIN_FILLS = 5;
/** The sprinter never awards under this burst. */
export const SPRINTER_MIN_BURST = 4;
/** The meddler never awards under this many meddles. */
export const MEDDLER_MIN = 2;
/** The length-tier marquee fallback never admits a slot shorter than this. */
export const MARQUEE_MIN_LENGTH = 7;

/**
 * One slot as data (TITLES.md: no slot model enters the engine): its ordered cell
 * indices and the constructor's starred flag, lifted by the API from the snapshot.
 */
export interface TitleSlot {
  readonly cells: readonly number[];
  readonly starred: boolean;
}

/** Grid geometry as data (INV-9): spread and quadrants need it; slots do not carry it. */
export interface Geometry {
  readonly rows: number;
  readonly cols: number;
}

/**
 * A raw (at, seq) ordering key, NOT relative seconds: firstFill/lastFill feed the award
 * tie-breaks and never render (vectors/analysis/README.md).
 */
export interface FillMark {
  readonly at: number;
  readonly seq: number;
}

/**
 * The columns the award ladder reads (vectors/analysis/README.md pins this as the
 * minimum award input row; extra columns are ignored). All counts; no letters (INV-6).
 */
export interface TitleRow {
  readonly fills: number;
  readonly firstFill: FillMark | null;
  readonly openingFills: number;
  readonly closingFills: number;
  readonly writes: number;
  readonly burst: number;
  readonly wrongWrites: number;
  readonly overwrites: number;
  readonly meddles: number;
  readonly slotsTouched: number;
  readonly marqueeLeads: number;
  readonly spread: number;
  readonly focus: number;
  readonly homeQuadrantFills: number;
  readonly span: number;
  readonly brokeStall: number;
}

/** The full per-solver stat-sheet row (TITLES.md layer 1). */
export interface SolverStats extends TitleRow {
  readonly lastFill: FillMark | null;
  readonly slotsStarted: number;
  readonly slotsFinished: number;
}

/** The stat sheet: one row per event-member solver, plus the room header. */
export interface TitleStatsResult {
  readonly solvers: Record<string, SolverStats>;
  readonly room: { readonly stallSeconds: number };
}

/** One award: the wire shape (PROTOCOL §12). Keys and counts only, never a letter. */
export interface TitleAward {
  readonly userId: string;
  readonly title: TitleKey;
  readonly evidence: number | null;
}

/** The pinned v1 title keys, lowercase ASCII kebab-case (TITLES.md ladder table). */
export type TitleKey =
  | "saboteur"
  | "one-hit-wonder"
  | "ice-breaker"
  | "bullseye"
  | "headliner"
  | "sprinter"
  | "meddler"
  | "quick-starter"
  | "closer"
  | "specialist"
  | "long-hauler"
  | "wanderer"
  | "scribbler"
  | "collector"
  | "workhorse";

/** Room-level context a gate may read: the header plus the room's max fills. */
export interface RungContext {
  readonly stallSeconds: number;
  readonly maxFills: number;
}

/** A numeric stat-sheet column an argmax claim or an evidence citation can name. */
export type StatColumn = keyof Omit<TitleRow, "firstFill">;

/**
 * One ladder rung: gate (the minimum signal below which it never awards), claim (which
 * column's argmax among the untitled gate-passers wins; the cameo alone claims the
 * latest firstFill), and evidence (which number rides the card; the ice-breaker cites
 * the room's stallSeconds; null is "none").
 */
export interface TitleRung {
  readonly key: TitleKey;
  readonly tier: "specialty" | "floor";
  readonly gate: (row: TitleRow, ctx: RungContext) => boolean;
  readonly claim:
    | {
        readonly kind: "max";
        readonly column: StatColumn;
        readonly tieByFills: boolean;
      }
    | { readonly kind: "latest-first-fill" };
  readonly evidence: StatColumn | "stallSeconds" | null;
}

/** The one-hit-wonder's room-signal: someone must have filled at least this much. */
const ONE_HIT_WONDER_ROOM_MAX_FILLS = 3;

/** The floor gate: fills >= 1, nothing else (the coverage theorem's whole premise). */
const floorGate = (row: TitleRow): boolean => row.fills >= 1;

/**
 * The v1 ladder, pinned (TITLES.md). Order is rank; the walk is top to bottom. Rungs 1-9
 * are the specialty tier (a gated rung may award nobody; that is the gate working);
 * rungs 10-15 are the floor (ordinal over solvers with a fill, so coverage is
 * arithmetic, six rungs deep). A fixed engine constant, never a parameter.
 */
export const TITLE_LADDER: readonly TitleRung[] = [
  {
    key: "saboteur",
    tier: "specialty",
    gate: (row) => row.overwrites >= SABOTEUR_MIN,
    claim: { kind: "max", column: "overwrites", tieByFills: false },
    evidence: "overwrites",
  },
  {
    key: "one-hit-wonder",
    tier: "specialty",
    gate: (row, ctx) =>
      row.fills === 1 &&
      row.wrongWrites === 0 &&
      ctx.maxFills >= ONE_HIT_WONDER_ROOM_MAX_FILLS,
    claim: { kind: "latest-first-fill" },
    evidence: null,
  },
  {
    key: "ice-breaker",
    tier: "specialty",
    gate: (row, ctx) =>
      row.brokeStall === 1 && ctx.stallSeconds >= STALL_FLOOR_SECONDS,
    claim: { kind: "max", column: "brokeStall", tieByFills: false },
    evidence: "stallSeconds",
  },
  {
    key: "bullseye",
    tier: "specialty",
    gate: (row) => row.wrongWrites === 0 && row.fills >= BULLSEYE_MIN_FILLS,
    claim: { kind: "max", column: "fills", tieByFills: false },
    evidence: "fills",
  },
  {
    key: "headliner",
    tier: "specialty",
    gate: (row) => row.marqueeLeads >= 1,
    claim: { kind: "max", column: "marqueeLeads", tieByFills: false },
    evidence: "marqueeLeads",
  },
  {
    key: "sprinter",
    tier: "specialty",
    gate: (row) => row.burst >= SPRINTER_MIN_BURST,
    claim: { kind: "max", column: "burst", tieByFills: false },
    evidence: "burst",
  },
  {
    key: "meddler",
    tier: "specialty",
    gate: (row) => row.meddles >= MEDDLER_MIN,
    claim: { kind: "max", column: "meddles", tieByFills: false },
    evidence: "meddles",
  },
  {
    key: "quick-starter",
    tier: "specialty",
    gate: (row) => row.openingFills >= 1,
    claim: { kind: "max", column: "openingFills", tieByFills: false },
    evidence: "openingFills",
  },
  {
    key: "closer",
    tier: "specialty",
    gate: (row) => row.closingFills >= 1,
    claim: { kind: "max", column: "closingFills", tieByFills: false },
    evidence: "closingFills",
  },
  {
    key: "specialist",
    tier: "floor",
    gate: floorGate,
    claim: { kind: "max", column: "focus", tieByFills: true },
    evidence: "homeQuadrantFills",
  },
  {
    key: "long-hauler",
    tier: "floor",
    gate: floorGate,
    claim: { kind: "max", column: "span", tieByFills: true },
    evidence: "span",
  },
  {
    key: "wanderer",
    tier: "floor",
    gate: floorGate,
    claim: { kind: "max", column: "spread", tieByFills: true },
    evidence: null,
  },
  {
    key: "scribbler",
    tier: "floor",
    gate: floorGate,
    claim: { kind: "max", column: "writes", tieByFills: false },
    evidence: "writes",
  },
  {
    key: "collector",
    tier: "floor",
    gate: floorGate,
    claim: { kind: "max", column: "slotsTouched", tieByFills: true },
    evidence: "slotsTouched",
  },
  {
    key: "workhorse",
    tier: "floor",
    gate: floorGate,
    claim: { kind: "max", column: "fills", tieByFills: false },
    evidence: "fills",
  },
];

/** Ascending (at, seq): the ordering key of the trace and every temporal tie-break. */
function byAtSeq(a: FillMark, b: FillMark): number {
  return a.at - b.at || a.seq - b.seq;
}

/** Whole seconds are floor(), everywhere (TITLES.md). */
function wholeSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** A mutable accumulator behind one SolverStats row. */
interface RowAcc {
  ownFills: TraceEntry[]; // the solver's trace entries, in (at, seq) order
  openingFills: number;
  closingFills: number;
  writes: number;
  wrongWrites: number;
  overwrites: number;
  slotsStarted: number;
  slotsFinished: number;
  meddles: number;
  slotsTouched: number;
  marqueeLeads: number;
  brokeStall: number;
}

function emptyAcc(): RowAcc {
  return {
    ownFills: [],
    openingFills: 0,
    closingFills: 0,
    writes: 0,
    wrongWrites: 0,
    overwrites: 0,
    slotsStarted: 0,
    slotsFinished: 0,
    meddles: 0,
    slotsTouched: 0,
    marqueeLeads: 0,
    brokeStall: 0,
  };
}

/**
 * The marquee set (TITLES.md, two signals, best first): the starred slots if any exist
 * (exactly the constructor's own marking, no length gate); otherwise every slot whose
 * length is within the top two distinct lengths, gated to MARQUEE_MIN_LENGTH. A mini has
 * no marquee tier.
 */
function marqueeSlots(slots: readonly TitleSlot[]): TitleSlot[] {
  const starred = slots.filter((slot) => slot.starred);
  if (starred.length > 0) return starred;
  const distinct = [...new Set(slots.map((slot) => slot.cells.length))]
    .sort((a, b) => b - a)
    .slice(0, 2);
  return slots.filter(
    (slot) =>
      slot.cells.length >= MARQUEE_MIN_LENGTH &&
      distinct.includes(slot.cells.length),
  );
}

/**
 * Layer 1, the stat sheet: one pass over the events, the trace, and the slot geometry
 * produces a per-solver row of counts plus the room header. No judgment, only numbers.
 * The pool is event membership: any writer (write or clear) owns a row; a zero-fill row
 * is all zeros with null firstFill/lastFill (focus 0, never NaN). Events are sorted
 * defensively by seq (the solveTrace posture); `at` and ids arrive as data (INV-9).
 */
export function titleStats(
  events: readonly SolveEvent[],
  solution: Solution,
  slots: readonly TitleSlot[],
  geometry: Geometry,
): TitleStatsResult {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const trace = solveTrace(ordered, solution);
  const traceByAt = [...trace].sort(byAtSeq);

  // One accumulator per event member, in first-appearance (seq) order, so the output's
  // key order is deterministic under any input shuffle.
  const accs = new Map<string, RowAcc>();
  for (const event of ordered) {
    if (!accs.has(event.userId)) accs.set(event.userId, emptyAcc());
  }

  // Own fills, in (at, seq) order (feeds firstFill/lastFill, burst, spread, quadrants).
  const ownerByCell = new Map<number, TraceEntry>();
  for (const entry of traceByAt) {
    accs.get(entry.userId)?.ownFills.push(entry);
  }
  for (const entry of trace) ownerByCell.set(entry.cell, entry);

  // Opening/closing stretches: ordinal slices of the (at, seq)-ordered trace, dual
  // counting when they overlap (the pinned T = 1 corner counts one entry in both).
  const stretch = Math.ceil(
    (traceByAt.length * OPENING_SHARE_NUMERATOR) / OPENING_SHARE_DENOMINATOR,
  );
  for (const entry of traceByAt.slice(0, stretch)) {
    const acc = accs.get(entry.userId);
    if (acc) acc.openingFills++;
  }
  for (const entry of traceByAt.slice(traceByAt.length - stretch)) {
    const acc = accs.get(entry.userId);
    if (acc) acc.closingFills++;
  }

  // writes, wrongWrites, overwrites: one seq-ordered replay with a running board.
  // An overwrite destroys a currently-matching cell whose trace owner is ANOTHER solver
  // (owner ruling: second-guessing yourself is not sabotage); a correct-to-correct
  // rewrite (the rebus first-char upgraded to the full string) is never an overwrite.
  // wrongWrites reads independently of the board: a non-null value that does not match
  // the solution at its cell (dual counting with overwrites is deliberate).
  const board = new Map<number, string | null>();
  for (const event of ordered) {
    const acc = accs.get(event.userId);
    if (!acc) continue; // unreachable: membership was seeded from the same walk
    acc.writes++;
    const expected = solution.get(event.cell);
    const valueMatches =
      event.value !== null &&
      expected !== undefined &&
      matches(expected, event.value);
    if (event.value !== null && !valueMatches) acc.wrongWrites++;
    const current = board.get(event.cell);
    if (
      current !== undefined &&
      current !== null &&
      expected !== undefined &&
      matches(expected, current) &&
      ownerByCell.get(event.cell)?.userId !== event.userId &&
      !valueMatches
    ) {
      acc.overwrites++;
    }
    board.set(event.cell, event.value);
  }

  // Slot stats: a slot's first/last trace entry among its cells (by (at, seq)) names its
  // starter/finisher; meddles are slots finished by u but started by someone else;
  // slotsTouched counts distinct slots holding at least one of u's fills.
  const marquee = new Set(marqueeSlots(slots));
  for (const slot of slots) {
    let first: TraceEntry | null = null;
    let last: TraceEntry | null = null;
    const fillsByOwner = new Map<string, number>();
    for (const cell of slot.cells) {
      const entry = ownerByCell.get(cell);
      if (!entry) continue;
      if (first === null || byAtSeq(entry, first) < 0) first = entry;
      if (last === null || byAtSeq(entry, last) > 0) last = entry;
      fillsByOwner.set(entry.userId, (fillsByOwner.get(entry.userId) ?? 0) + 1);
    }
    if (first !== null && last !== null) {
      const starter = accs.get(first.userId);
      const finisher = accs.get(last.userId);
      if (starter) starter.slotsStarted++;
      if (finisher) {
        finisher.slotsFinished++;
        if (last.userId !== first.userId) finisher.meddles++;
      }
    }
    for (const owner of fillsByOwner.keys()) {
      const acc = accs.get(owner);
      if (acc) acc.slotsTouched++;
    }
    // marqueeLeads: strictly more of the slot's first-correct cells than every other
    // solver; a tied slot has no leader.
    if (marquee.has(slot) && fillsByOwner.size > 0) {
      let leader: string | null = null;
      let best = -1;
      let tied = false;
      for (const [owner, count] of fillsByOwner) {
        if (count > best) {
          best = count;
          leader = owner;
          tied = false;
        } else if (count === best) {
          tied = true;
        }
      }
      if (leader !== null && !tied) {
        const acc = accs.get(leader);
        if (acc) acc.marqueeLeads++;
      }
    }
  }

  // The turning point, byte-identical to the shipped moments() (its seq-order gap scan,
  // its first-wins tie-break): reuse the projection, then recover the break entry from
  // its own numbers. The break is the first consecutive pair, in the same trace order
  // moments() walks, whose gap reproduces the projection's stallSeconds; comparing the
  // /1000 quotients replays moments()'s own arithmetic exactly.
  const turningPoint = moments(trace).turningPoint;
  const stallSeconds =
    turningPoint === null ? 0 : Math.floor(turningPoint.stallSeconds);
  let breakOwner: string | null = null;
  if (turningPoint !== null) {
    let prev: TraceEntry | null = null;
    for (const entry of trace) {
      if (
        prev !== null &&
        (entry.at - prev.at) / 1000 === turningPoint.stallSeconds
      ) {
        breakOwner = entry.userId;
        break;
      }
      prev = entry;
    }
  }

  // Quadrants split the grid at ceil(rows/2) / ceil(cols/2), 0-indexed (TITLES.md).
  const rowSplit = Math.ceil(geometry.rows / 2);
  const colSplit = Math.ceil(geometry.cols / 2);

  const solvers: Record<string, SolverStats> = {};
  for (const [userId, acc] of accs) {
    const fills = acc.ownFills.length;
    const first = acc.ownFills[0] ?? null;
    const last = acc.ownFills[acc.ownFills.length - 1] ?? null;

    // burst: max own fills inside any closed window [t, t + BURST_WINDOW_MS] (the same
    // inclusivity as momentum's burst); the optimum window opens on one of u's fills.
    let burst = 0;
    for (const anchor of acc.ownFills) {
      let count = 0;
      for (const fill of acc.ownFills) {
        if (fill.at >= anchor.at && fill.at <= anchor.at + BURST_WINDOW_MS) {
          count++;
        }
      }
      if (count > burst) burst = count;
    }

    // spread (distinct rows + distinct cols) and the home quadrant (busiest, ties to
    // the earliest-reached by (at, seq): ownFills is walked in that order).
    const rows = new Set<number>();
    const cols = new Set<number>();
    const quadrantCounts = [0, 0, 0, 0];
    const quadrantFirstSeen = [Infinity, Infinity, Infinity, Infinity];
    acc.ownFills.forEach((fill, index) => {
      const row = Math.floor(fill.cell / geometry.cols);
      const col = fill.cell % geometry.cols;
      rows.add(row);
      cols.add(col);
      const quadrant = (row < rowSplit ? 0 : 2) + (col < colSplit ? 0 : 1);
      quadrantCounts[quadrant] = (quadrantCounts[quadrant] ?? 0) + 1;
      if (quadrantFirstSeen[quadrant] === Infinity) {
        quadrantFirstSeen[quadrant] = index;
      }
    });
    let homeQuadrantFills = 0;
    let homeFirstSeen = Infinity;
    for (let q = 0; q < 4; q++) {
      const count = quadrantCounts[q] ?? 0;
      const seen = quadrantFirstSeen[q] ?? Infinity;
      if (
        count > homeQuadrantFills ||
        (count === homeQuadrantFills && seen < homeFirstSeen)
      ) {
        homeQuadrantFills = count;
        homeFirstSeen = seen;
      }
    }

    solvers[userId] = {
      fills,
      firstFill: first === null ? null : { at: first.at, seq: first.seq },
      lastFill: last === null ? null : { at: last.at, seq: last.seq },
      openingFills: acc.openingFills,
      closingFills: acc.closingFills,
      writes: acc.writes,
      burst,
      wrongWrites: acc.wrongWrites,
      overwrites: acc.overwrites,
      slotsStarted: acc.slotsStarted,
      slotsFinished: acc.slotsFinished,
      meddles: acc.meddles,
      slotsTouched: acc.slotsTouched,
      marqueeLeads: acc.marqueeLeads,
      spread: rows.size + cols.size,
      // A zero-fill row is all zeros: focus 0, never NaN (pinned corner).
      focus: fills === 0 ? 0 : homeQuadrantFills / fills,
      homeQuadrantFills,
      span:
        first === null || last === null ? 0 : wholeSeconds(last.at - first.at),
      brokeStall: userId === breakOwner ? 1 : 0,
    };
  }

  return { solvers, room: { stallSeconds } };
}

/** One award candidate: the id and its row, bound for the walk. */
interface Candidate {
  readonly userId: string;
  readonly row: TitleRow;
}

/**
 * The universal tie-break (TITLES.md determinism, INV-9, INV-1): earlier firstFill by
 * (at, seq); a solver with no fills sorts after every solver with one; the final tie is
 * ascending ASCII userId. Total, so every walk resolves without randomness.
 */
function universalCompare(a: Candidate, b: Candidate): number {
  const fa = a.row.firstFill;
  const fb = b.row.firstFill;
  if (fa !== null && fb !== null) {
    const order = byAtSeq(fa, fb);
    if (order !== 0) return order;
  } else if (fa !== null) {
    return -1;
  } else if (fb !== null) {
    return 1;
  }
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/** Rung order: negative when a beats b for this rung's claim. */
function rungCompare(rung: TitleRung, a: Candidate, b: Candidate): number {
  if (rung.claim.kind === "latest-first-fill") {
    // The cameo: latest firstFill by (at, seq) wins. The gate (fills == 1) guarantees a
    // firstFill; a null row (unreachable through the gate) falls to the universal rule.
    const fa = a.row.firstFill;
    const fb = b.row.firstFill;
    if (fa !== null && fb !== null) {
      const order = byAtSeq(fb, fa);
      if (order !== 0) return order;
    }
  } else {
    const va = a.row[rung.claim.column];
    const vb = b.row[rung.claim.column];
    if (va !== vb) return vb - va;
    // "Tie by fills": more fills wins first, then the universal rule (TITLES.md).
    if (rung.claim.tieByFills && a.row.fills !== b.row.fills) {
      return b.row.fills - a.row.fills;
    }
  }
  return universalCompare(a, b);
}

/**
 * Layer 2, the award walk (TITLES.md): top to bottom over TITLE_LADDER; each rung awards
 * at most once; each solver receives at most one title; a rung whose room-wide argmax is
 * already titled falls to the next eligible solver (the claim runs over the untitled, so
 * the winner's own number rides the card). The solo rule: fewer than two event-member
 * solvers award nothing, whatever the sheet says. Output is ordered by ladder rank.
 */
export function awardTitles(stats: {
  readonly solvers: Readonly<Record<string, TitleRow>>;
  readonly room: { readonly stallSeconds: number };
}): TitleAward[] {
  const pool: Candidate[] = Object.entries(stats.solvers).map(
    ([userId, row]) => ({ userId, row }),
  );
  // A superlative is social: a solo room titles nobody (TITLES.md solo rule).
  if (pool.length < 2) return [];

  const ctx: RungContext = {
    stallSeconds: stats.room.stallSeconds,
    maxFills: pool.reduce((max, c) => Math.max(max, c.row.fills), 0),
  };

  const titled = new Set<string>();
  const awards: TitleAward[] = [];
  for (const rung of TITLE_LADDER) {
    let winner: Candidate | null = null;
    for (const candidate of pool) {
      if (titled.has(candidate.userId)) continue;
      if (!rung.gate(candidate.row, ctx)) continue;
      if (winner === null || rungCompare(rung, candidate, winner) < 0) {
        winner = candidate;
      }
    }
    if (winner === null) continue; // a gated rung may award nobody: the gate working
    titled.add(winner.userId);
    awards.push({
      userId: winner.userId,
      title: rung.key,
      evidence:
        rung.evidence === null
          ? null
          : rung.evidence === "stallSeconds"
            ? ctx.stallSeconds
            : winner.row[rung.evidence],
    });
  }
  return awards;
}
