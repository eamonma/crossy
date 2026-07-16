// The completion card's facts, derived only from what the wire carries: the
// `gameCompleted`/snapshot `stats` object (PROTOCOL.md section 4: solveTimeSeconds,
// totalEvents, participantCount, and the additive D29 pair activeSolveSeconds +
// sittingCount) plus the derived timer as the time's fallback while stats are in
// flight. Nothing here invents a number the server never sent; a missing
// stat renders as a quiet placeholder, never a guess. Future stats (accuracy, checks
// used, per-solver contribution once the Archive read models land, DESIGN.md D16)
// join this list and the card's grid takes them without layout surgery.
import type { Stats } from "@crossy/protocol";
import { formatDuration } from "./gameTime";
import { headlineSolveSeconds, sittingsSuffix } from "./sittingsReadout";

export interface CompletionCell {
  key: string;
  /** The caps-label heading over the value. */
  label: string;
  /** Render-ready text, tabular; "—" when the wire has not supplied the fact. */
  value: string;
  /** A quiet qualifier under the value ("2 sittings", D29: context, never a second
   * stat), or null for none. */
  context: string | null;
}

/** The placeholder for a fact the wire has not supplied (the PartyView convention). */
const MISSING = "—";

/**
 * The stat cells in display order. Time leads (the one fact everyone asks for; ID-2 on
 * iOS makes the frozen clock the headline for the same reason), then the people, then
 * the work. Time is ACTIVE time (D29 sittings): `activeSolveSeconds` when the stats
 * carry it, the wall-clock `solveTimeSeconds` on frozen pre-D29 rows, with the sitting
 * count as quiet context only when the room sat down more than once. `fallbackSeconds`
 * is the client's derived timer, used only while `stats` has not landed so the card
 * never shows a blank time over a completed board.
 */
export function completionCells(
  stats: Stats | null,
  fallbackSeconds: number,
): CompletionCell[] {
  return [
    {
      key: "time",
      label: "Time",
      value: formatDuration(
        stats === null ? fallbackSeconds : headlineSolveSeconds(stats),
      ),
      context: sittingsSuffix(stats?.sittingCount),
    },
    {
      key: "solvers",
      label: "Solvers",
      value: stats === null ? MISSING : String(stats.participantCount),
      context: null,
    },
    {
      key: "entries",
      label: "Entries",
      value: stats === null ? MISSING : String(stats.totalEvents),
      context: null,
    },
  ];
}

/**
 * The confetti palette. The house is warm (Sand + Gold, styles.css), and roster colors
 * are an arbitrary FNV-1a hash of the user id (DESIGN.md §8): raw, they can be any garish
 * hue and fight the warm field. So the base is the gold scale from step 5 to step 9 (the
 * same golds the progress bar and eyebrow already wear), and each person's hash color is
 * pulled most of the way toward the gold anchor: their hue survives as a warm tint,
 * recognizable beside their cursor, but the field never turns into party-store primaries.
 * Spectators watched, they did not write, so they lend no color. An empty room (or a
 * roster that has not landed) still celebrates in the house golds alone.
 */
export function celebrationPalette(
  members: readonly { color: string; role: "host" | "solver" | "spectator" }[],
): string[] {
  // Gold 5..9 (styles.css --color-gold-*): the warm field, light to deep.
  const base = ["#e1dccf", "#d8d0bf", "#cbc0a8", "#b9a88d", "#978365"];
  const anchor = "#b9a88d"; // gold-8, the warm midpoint every roster hue is pulled toward
  const people = members
    .filter((m) => m.role !== "spectator")
    .map((m) => warmTint(m.color, anchor, 0.62));
  return [...base, ...people];
}

/** Mix `hex` toward `toward` by `amount` (0 keeps hex, 1 becomes toward). Clamps, and
 *  leaves the field its warm anchor when a hash color arrives malformed. */
function warmTint(hex: string, toward: string, amount: number): string {
  const a = parseHex(hex);
  const b = parseHex(toward);
  if (a === null || b === null) return toward;
  const t = Math.min(1, Math.max(0, amount));
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return (
    "#" +
    [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** `#RRGGBB` -> [r, g, b], or null when the string is not a six-digit hex color. */
function parseHex(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
