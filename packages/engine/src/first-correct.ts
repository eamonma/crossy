// First-correct attribution (DESIGN §5, PROTOCOL §13, the vectors/first-correct family).
// A projection over the raw write log: for each cell that ever received a correct value,
// who wrote the FIRST (min seq) matching value. Scheme 1, first-ever-correct: once a cell
// has an owner, that owner NEVER changes, whatever later clear, overwrite, or re-correction
// occurs, by anyone. This is what the cleanup-pass-immunity vector pins against a scheme-2
// (last-correct) reading.
//
// Correctness is not decided here: this reuses matches from ./comparator, the same predicate
// the completion driver runs, so ASCII casing (INV-1) and the rebus first-character rule
// (matches("STAR", "S") is true) come from one place and never drift. A cleared value (null)
// is never correct; a cell with no solution entry (a block or absent cell) can never own.
//
// INV-9: this file imports nothing outside packages/engine (only ./comparator and ./types),
// and takes its events, ids, and timestamps as plain data. INV-6: the output is
// Map<cell, userId>. It carries user ids only, never a solution value, so a cell's expected
// letter can never leak through this projection; attribution, not answers.

import { matches } from "./comparator";
import type { Solution } from "./types";

/**
 * One raw write event from the cell_events log. This is deliberately NOT the reducer's
 * domain Command/Event union: the projection reads the persisted write shape directly
 * ({ seq, cell, userId, value }), not the sequenced protocol frames.
 *
 * `value` is an uppercase ASCII token matching `^[A-Z0-9]{1,10}$`, or null for a clear.
 */
export interface WriteEvent {
  readonly seq: number;
  readonly cell: number;
  readonly userId: string;
  readonly value: string | null;
}

/** Cell index to the owning user id (INV-6: user ids only, never a solution value). */
export type OwnerMap = ReadonlyMap<number, string>;

/**
 * Project the write log to first-correct ownership (scheme 1). Events are processed in
 * ascending seq order (sorted defensively; the log and the real query are already ordered).
 * The first matching write to a solution cell claims it and is never displaced.
 */
export function firstCorrect(
  events: readonly WriteEvent[],
  solution: Solution,
): OwnerMap {
  const owners = new Map<number, string>();

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    // A clear is never correct.
    if (event.value === null) continue;
    // First correct write wins and never changes.
    if (owners.has(event.cell)) continue;
    // No solution entry means a block or absent cell: it can never go correct.
    const expected = solution.get(event.cell);
    if (expected === undefined) continue;
    // Correctness is the shared comparator (INV-1, rebus first-char).
    if (matches(expected, event.value)) owners.set(event.cell, event.userId);
  }

  return owners;
}
