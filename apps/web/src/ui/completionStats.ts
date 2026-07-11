// The completion card's facts, derived only from what the wire carries: the
// `gameCompleted`/snapshot `stats` object (PROTOCOL.md section 4: solveTimeSeconds,
// totalEvents, participantCount) plus the derived timer as the time's fallback while
// stats are in flight. Nothing here invents a number the server never sent; a missing
// stat renders as a quiet placeholder, never a guess. Future stats (accuracy, checks
// used, per-solver contribution once the Archive read models land, DESIGN.md D16)
// join this list and the card's grid takes them without layout surgery.
import type { Stats } from "@crossy/protocol";
import { formatDuration } from "./gameTime";

export interface CompletionCell {
  key: string;
  /** The caps-label heading over the value. */
  label: string;
  /** Render-ready text, tabular; "—" when the wire has not supplied the fact. */
  value: string;
}

/** The placeholder for a fact the wire has not supplied (the PartyView convention). */
const MISSING = "—";

/**
 * The stat cells in display order. Time leads (the one fact everyone asks for; ID-2 on
 * iOS makes the frozen clock the headline for the same reason), then the people, then
 * the work. `fallbackSeconds` is the client's derived timer, used only while `stats`
 * has not landed so the card never shows a blank time over a completed board.
 */
export function completionCells(
  stats: Stats | null,
  fallbackSeconds: number,
): CompletionCell[] {
  return [
    {
      key: "time",
      label: "Time",
      value: formatDuration(stats?.solveTimeSeconds ?? fallbackSeconds),
    },
    {
      key: "solvers",
      label: "Solvers",
      value: stats === null ? MISSING : String(stats.participantCount),
    },
    {
      key: "entries",
      label: "Entries",
      value: stats === null ? MISSING : String(stats.totalEvents),
    },
  ];
}

/**
 * The confetti palette: the room's people lead (their roster colors, the same hue their
 * cursors and flashes wear), doubled so the people outweigh the base gold-and-sand
 * tints. Spectators watched, they did not write, so they lend no color. An empty room
 * (or a roster that has not landed) still celebrates in the house golds.
 */
export function celebrationPalette(
  members: readonly { color: string; role: "host" | "solver" | "spectator" }[],
): string[] {
  const base = ["#978365", "#b9a88d", "#cbc0a8", "#e1dccf"];
  const people = members
    .filter((m) => m.role !== "spectator")
    .map((m) => m.color);
  return people.length > 0 ? [...base, ...people, ...people] : base;
}
