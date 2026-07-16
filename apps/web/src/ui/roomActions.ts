// Room-check derivations for the room-actions surface and the grid marks, kept pure so
// GameToolbar and the grids stay thin renders over tested data (the roomAdmin.ts /
// partyProgress.ts pattern; docs/design/room-actions-control.md). The store owns the wire
// state (checkedWrongCells, checkCount, the checkPuzzle intent); this module owns what the
// UI derives from it: whether the popover stands, whether the check row is enabled, which
// marks actually paint, and the two quiet lines of copy.
import type { GameStatus } from "@crossy/protocol";
import type { PendingCommand } from "../store/gameStore";

/**
 * Whether the room-actions popover renders at all. Ongoing only (R4: terminal means
 * terminal — an abandoned room must not offer acts the server answers with
 * GAME_NOT_ONGOING), and never for spectators, who see neither of its rows (check is
 * host/solver, end-game is host; design doc §5), so for them the trigger itself hides.
 */
export function showRoomActions(
  status: GameStatus,
  spectator: boolean,
): boolean {
  return status === "ongoing" && !spectator;
}

/**
 * Empty playable cells, counted over SEQUENCED values only (R9): `sequencedValue` must be
 * the store's sequenced read (GameStore.sequencedValue), never the overlay composite, so
 * this gate matches the server's own `filledCount` gate (PROTOCOL.md §10) and a just-typed
 * optimistic letter leaves the check row disabled for a beat. Zero means the grid is full.
 */
export function emptyPlayableCount(
  cellCount: number,
  blocks: ReadonlySet<number>,
  sequencedValue: (cell: number) => string | null,
): number {
  let empty = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    if (blocks.has(cell)) continue;
    if (sequencedValue(cell) === null) empty += 1;
  }
  return empty;
}

/**
 * The marks that actually paint (R6, PROTOCOL.md §10): a cell with a pending optimistic
 * overlay entry renders the overlay, not the mark. This is display suppression, never
 * clearing — the standing set is untouched, and if the pending command dies (rejection,
 * reconnect drop) the mark is back because it never left.
 */
export function visibleCheckMarks(
  checked: ReadonlySet<number>,
  overlay: readonly PendingCommand[],
): ReadonlySet<number> {
  if (checked.size === 0) return checked;
  const pending = new Set(overlay.map((entry) => entry.cell));
  if (pending.size === 0) return checked;
  const visible = new Set<number>();
  for (const cell of checked) {
    if (!pending.has(cell)) visible.add(cell);
  }
  return visible;
}

/** The disabled check row's quiet remaining-cells hint (design doc §5): the row teaches the
 * grid-full gate instead of erroring into it. */
export function emptyCellsHint(emptyCount: number): string {
  return emptyCount === 1 ? "1 cell empty" : `${emptyCount} cells empty`;
}

/** The mid-solve record on the check row (R10): a neutral count, no attribution, matching
 * the wire event's missing `by` (D27). Null before the first accepted check. */
export function checkedCountLabel(checkCount: number): string | null {
  if (checkCount <= 0) return null;
  return checkCount === 1 ? "Checked once" : `Checked ${checkCount} times`;
}
