// Data and formatting for the signed-in home (GET /games, GET /puzzles, POST /games). These
// endpoints are additive and cursor-paginated (limit/before); the home reads the first page.
// Kept apart from the view so the pure formatters (relative time, the geometry+date name
// fallback, feature labels) stay trivially testable and the fetch shapes live in one place.
//
// The home shows one "Your games" list, newest first. It reports completion (completedAt) but no
// full lifecycle status enum: the API reads the session-owned completed_at under a read grant
// (see apps/api games/routes.ts), and "done" is the one lifecycle fact the sidebar needs. Each
// row also carries the puzzle's `mask`, its black-square silhouette (PROTOCOL section 12), the
// face the home renders per room and per upload.
import type { Mask } from "@crossy/protocol";

/** The caller's role in a game (PROTOCOL roles). */
export type Role = "host" | "solver" | "spectator";

/** One row of GET /games. Ordering and time are createdAt; completedAt marks a finished game. */
export interface GameSummary {
  gameId: string;
  name: string | null;
  role: Role;
  createdAt: string;
  createdBy: string;
  memberCount: number;
  /**
   * When the game completed (ISO), or null while ongoing (also null for an abandoned game, which
   * never completed). Read from the session-owned game_state, never a solution (INV-6-safe).
   */
  completedAt: string | null;
  /** `title` is the puzzle's display title (never solution content), null when it has none. */
  puzzle: {
    puzzleId: string;
    rows: number;
    cols: number;
    title: string | null;
    /** The black-square silhouette, row strings of `#`/`.`, pattern only (PROTOCOL section 12). */
    mask: Mask;
  };
}

/** True when a game has finished (a non-null completion timestamp); the sidebar marks these. */
export function isCompleted(g: GameSummary): boolean {
  return g.completedAt !== null;
}

/** Detected puzzle features, the flags GET /puzzles returns (no solution content). */
export interface PuzzleFeatures {
  rebus?: boolean;
  circles?: boolean;
  shadedCircles?: boolean;
}

/** One row of GET /puzzles: the caller's own uploads. `title`/`author` are the display
 * metadata ingestion parses (null when the document carried none), never solution content. */
export interface PuzzleSummary {
  puzzleId: string;
  createdAt: string;
  rows: number;
  cols: number;
  features: PuzzleFeatures | null;
  title: string | null;
  author: string | null;
  /** The black-square silhouette, row strings of `#`/`.`, pattern only (PROTOCOL section 12). */
  mask: Mask;
}

/**
 * Resolves the bearer for one REST call: the identity port's access token (refreshed near
 * expiry) or the fixed `?token=` dogfood override. Every fetcher here takes the source and
 * resolves it per call, never a pre-resolved string: a string frozen in state at mount
 * outlives its own expiry in any tab open past the token's TTL, and every read after that
 * rides a dead bearer into a 401. Null means signed out.
 */
export type TokenSource = () => Promise<string | null>;

/** Bearer headers for the REST calls, resolved fresh through the source per call. */
async function authHeaders(
  getToken: TokenSource,
): Promise<Record<string, string>> {
  const token = await getToken();
  if (token === null) throw new Error("signed out: no bearer to send");
  return { authorization: `Bearer ${token}` };
}

export async function fetchGames(
  apiBase: string,
  getToken: TokenSource,
): Promise<GameSummary[]> {
  const res = await fetch(`${apiBase}/games`, {
    headers: await authHeaders(getToken),
  });
  if (!res.ok) throw new Error(`GET /games ${res.status}`);
  const body = (await res.json()) as { games?: GameSummary[] };
  return body.games ?? [];
}

export async function fetchPuzzles(
  apiBase: string,
  getToken: TokenSource,
): Promise<PuzzleSummary[]> {
  const res = await fetch(`${apiBase}/puzzles`, {
    headers: await authHeaders(getToken),
  });
  if (!res.ok) throw new Error(`GET /puzzles ${res.status}`);
  const body = (await res.json()) as { puzzles?: PuzzleSummary[] };
  return body.puzzles ?? [];
}

/**
 * Delete the caller's own account (DELETE /account, DESIGN.md §8): the API tombstones the mirror
 * row (display name and avatar scrubbed, the opaque id kept so past contributions replay), hands
 * off or ends every hosted game, and removes the vendor identity. Resolves on success; throws on
 * any non-2xx so the caller shows an inline error rather than a silent failure.
 */
export async function deleteAccount(
  apiBase: string,
  getToken: TokenSource,
): Promise<void> {
  const res = await fetch(`${apiBase}/account`, {
    method: "DELETE",
    headers: await authHeaders(getToken),
  });
  if (!res.ok) throw new Error(`DELETE /account ${res.status}`);
}

/** Start a fresh game from an existing puzzle: the reusability story (replay with a new group). */
export async function startGameFromPuzzle(
  apiBase: string,
  getToken: TokenSource,
  puzzleId: string,
): Promise<{ gameId: string; inviteCode: string }> {
  const res = await fetch(`${apiBase}/games`, {
    method: "POST",
    headers: {
      ...(await authHeaders(getToken)),
      "content-type": "application/json",
    },
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
 * A game's display name: the host's room name first, then the puzzle's own title (the API
 * returns it since the title/author persistence landed), then the geometry-and-date fallback
 * ("15 × 15 · Jul 9") so a row is never blank and never reads as a machine id.
 */
export function gameTitle(g: GameSummary, now: Date = new Date()): string {
  const named = g.name?.trim();
  if (named !== undefined && named !== "") return named;
  const puzzleName = g.puzzle.title?.trim();
  if (puzzleName !== undefined && puzzleName !== "") return puzzleName;
  return `${geometry(g.puzzle.cols, g.puzzle.rows)} · ${shortDate(g.createdAt, now)}`;
}

/** A puzzle row's display name: its parsed title, or a quiet "Untitled" (geometry and upload
 * date already have their own columns, so repeating them here would just double the row). */
export function puzzleTitle(p: PuzzleSummary): string {
  const named = p.title?.trim();
  return named !== undefined && named !== "" ? named : "Untitled";
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

/**
 * The sidebar's compact relative time ("now", "5m", "3h", "2d", "4w", "7mo", "2y"): one
 * largest unit, mono numerals, narrow enough that a recent-game row keeps its whole name.
 * Same clamp rule as relativeTime: a future timestamp reads "now", never a negative.
 */
export function compactTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}
