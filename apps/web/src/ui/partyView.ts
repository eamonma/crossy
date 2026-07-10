// Party-view derivations: the progress race bar's counts, kept pure so the projector screen
// (PartyView.tsx) stays a thin render over tested data. INV-6: progress is measured from filled
// cells alone, never from a solution the client does not hold. A fully filled clue counts as
// "solved" whether or not its letters are correct, because correctness is a server-side check the
// party screen never receives; the bar reads "how much of the grid is filled", not "how much is
// right". The QR's join target is derived elsewhere (domain/invite `buildShareUrl`), reused as-is.
import type { Clue } from "../domain/types";

export interface PartyProgress {
  /** Clues whose every cell is currently filled. */
  readonly solved: number;
  /** Total clues across both axes. */
  readonly total: number;
  /** solved / total in [0, 1]; 0 when the puzzle has no clues (no divide by zero). */
  readonly ratio: number;
}

/**
 * Count filled clues across both axes. A clue is "filled" when every one of its cells is in
 * `filled` (the store's render state), so a crossing letter counts toward both its clues. Pure:
 * `filled` is client render state, never a solution, so this stays INV-6-safe.
 */
export function partyProgress(
  across: readonly Clue[],
  down: readonly Clue[],
  filled: ReadonlySet<number>,
): PartyProgress {
  const total = across.length + down.length;
  let solved = 0;
  for (const clue of [...across, ...down]) {
    if (clue.cells.length > 0 && clue.cells.every((c) => filled.has(c))) {
      solved += 1;
    }
  }
  return { solved, total, ratio: total === 0 ? 0 : solved / total };
}
