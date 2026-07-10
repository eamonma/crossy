// Data and formatting for the signed-in home (GET /games, GET /puzzles, POST /games). These
// endpoints are additive and cursor-paginated (limit/before); the home reads the first page.
// Kept apart from the view so the pure formatters (relative time, the geometry+date name
// fallback, feature labels) stay trivially testable and the fetch shapes live in one place.
//
// There is deliberately no game status field: lifecycle lives in session-owned state, out of the
// API's reach (see apps/api games/routes.ts). So the home shows one "Your games" list, newest
// first, and never claims a game is ongoing or done.

/** The caller's role in a game (PROTOCOL roles). */
export type Role = "host" | "solver" | "spectator";

/** One row of GET /games. No status by design; ordering and time are createdAt. */
export interface GameSummary {
  gameId: string;
  name: string | null;
  role: Role;
  createdAt: string;
  createdBy: string;
  memberCount: number;
  puzzle: { puzzleId: string; rows: number; cols: number };
}

/** Detected puzzle features, the flags GET /puzzles returns (no solution content). */
export interface PuzzleFeatures {
  rebus?: boolean;
  circles?: boolean;
  shadedCircles?: boolean;
}

/** One row of GET /puzzles: the caller's own uploads. No title yet, only geometry + features. */
export interface PuzzleSummary {
  puzzleId: string;
  createdAt: string;
  rows: number;
  cols: number;
  features: PuzzleFeatures | null;
}

/** Bearer headers for the REST calls; the token is the identity (or the ?token= dogfood override). */
function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function fetchGames(
  apiBase: string,
  token: string,
): Promise<GameSummary[]> {
  const res = await fetch(`${apiBase}/games`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`GET /games ${res.status}`);
  const body = (await res.json()) as { games?: GameSummary[] };
  return body.games ?? [];
}

export async function fetchPuzzles(
  apiBase: string,
  token: string,
): Promise<PuzzleSummary[]> {
  const res = await fetch(`${apiBase}/puzzles`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`GET /puzzles ${res.status}`);
  const body = (await res.json()) as { puzzles?: PuzzleSummary[] };
  return body.puzzles ?? [];
}

/** Start a fresh game from an existing puzzle: the reusability story (replay with a new group). */
export async function startGameFromPuzzle(
  apiBase: string,
  token: string,
  puzzleId: string,
): Promise<{ gameId: string; inviteCode: string }> {
  const res = await fetch(`${apiBase}/games`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ puzzleId }),
  });
  if (!res.ok) throw new Error(`POST /games ${res.status}`);
  return (await res.json()) as { gameId: string; inviteCode: string };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Jul 9", or "Jul 9, 2024" when the year differs from now: a compact, calm absolute date. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? base
    : `${base}, ${d.getFullYear()}`;
}

/** The board geometry as the system writes it, e.g. "15 × 15" (the same glyph the toolbar uses). */
export function geometry(cols: number, rows: number): string {
  return `${cols} × ${rows}`;
}

/**
 * A game's display name. When the host left it unnamed, fall back to the puzzle geometry and the
 * day it was made ("15 × 15 · Jul 9") so a row is never blank and never reads as a machine id.
 */
export function gameTitle(g: GameSummary, now: Date = new Date()): string {
  const named = g.name?.trim();
  if (named !== undefined && named !== "") return named;
  return `${geometry(g.puzzle.cols, g.puzzle.rows)} · ${shortDate(g.createdAt, now)}`;
}

/** Feature chips for a puzzle row, in a fixed order; empty when the puzzle has none. */
export function featureLabels(features: PuzzleFeatures | null): string[] {
  if (features === null) return [];
  const labels: string[] = [];
  if (features.rebus) labels.push("Rebus");
  if (features.circles) labels.push("Circles");
  if (features.shadedCircles) labels.push("Shaded");
  return labels;
}

/**
 * A quiet relative time, calm and unabbreviated ("2 days ago", "just now"). One largest unit,
 * no compound phrases. Future timestamps clamp to "just now" (a clock skew should never read as
 * "in 3 hours" on a list of past events).
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return minutes <= 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours <= 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days <= 1 ? "yesterday" : `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return weeks <= 1 ? "a week ago" : `${weeks} weeks ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months <= 1 ? "a month ago" : `${months} months ago`;
  const years = Math.round(days / 365);
  return years <= 1 ? "a year ago" : `${years} years ago`;
}
