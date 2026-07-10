// The solving-now roster: who is on which clue, derived from the store's participants
// and best-effort cursors (PROTOCOL.md section 9). Pure data in, pure data out; the
// SolvingNow component renders it and owns the collapse state. Self reads from the local
// selection (fresher than the store's echo of our own cursor); teammates read from the
// cursor map. A cursor on an axis with no word yields a null clue: the person still
// counts as solving, but no row can name their clue.
//
// Named roster.ts, not solvingNow.ts: SolvingNow.tsx lives beside it, and on a
// case-insensitive filesystem (any macOS clone) TypeScript resolves "./SolvingNow" to
// whichever file it finds first, breaking `pnpm typecheck` (TS1149). Module basenames
// here must differ in more than case.
import type { Direction } from "@crossy/engine";
import type { Cursor, Participant } from "@crossy/protocol";
import type { Clue } from "../domain/types";

export interface SolverEntry {
  userId: string;
  name: string;
  initial: string;
  color: string;
  self: boolean;
  clue: Clue | null;
}

export interface ClueGroup {
  clue: Clue;
  people: readonly SolverEntry[];
}

export interface Roster {
  /** Connected hosts and solvers, self first, then store order. */
  solvers: readonly SolverEntry[];
  /** Display names of connected spectators (self excluded). */
  watching: readonly string[];
  /** Solvers with a resolvable clue, grouped by clue, by number then across before down. */
  groups: readonly ClueGroup[];
}

/** Past this many solvers the block groups rows by clue instead of one row per person. */
export const GROUP_PAST = 4;
/** Grouped mode shows at most this many clue rows before the tail line. */
export const GROUP_CAP = 5;

function clueAt(
  across: readonly Clue[],
  down: readonly Clue[],
  direction: Direction,
  cell: number,
): Clue | null {
  const list = direction === "across" ? across : down;
  return list.find((c) => c.cells.includes(cell)) ?? null;
}

export function buildRoster(opts: {
  participants: readonly Participant[];
  cursors: ReadonlyMap<string, Cursor>;
  selfUserId: string | null;
  /** The local cursor, or null when self is spectating (spectators have no cursor). */
  selfSelection: { cell: number; direction: Direction } | null;
  across: readonly Clue[];
  down: readonly Clue[];
}): Roster {
  const { participants, cursors, selfUserId, selfSelection, across, down } =
    opts;

  const solvers: SolverEntry[] = [];
  const watching: string[] = [];

  for (const p of participants) {
    if (!p.connected) continue;
    const self = p.userId === selfUserId;
    if (p.role === "spectator") {
      if (!self) watching.push(p.displayName);
      continue;
    }
    const at = self ? selfSelection : (cursors.get(p.userId) ?? null);
    const entry: SolverEntry = {
      userId: p.userId,
      name: self ? "You" : p.displayName,
      initial: (p.displayName.charAt(0) || "?").toUpperCase(),
      color: p.color,
      self,
      clue: at === null ? null : clueAt(across, down, at.direction, at.cell),
    };
    if (self) solvers.unshift(entry);
    else solvers.push(entry);
  }

  const byClue = new Map<string, { clue: Clue; people: SolverEntry[] }>();
  for (const s of solvers) {
    if (s.clue === null) continue;
    const key = `${s.clue.direction}-${s.clue.number}`;
    const group = byClue.get(key);
    if (group === undefined) byClue.set(key, { clue: s.clue, people: [s] });
    else group.people.push(s);
  }
  const groups = [...byClue.values()].sort(
    (a, b) =>
      a.clue.number - b.clue.number ||
      a.clue.direction.localeCompare(b.clue.direction),
  );

  return { solvers, watching, groups };
}
