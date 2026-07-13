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
import type { Bearer } from "../net/authedFetch";
import { authedFetch } from "../net/authedFetch";

/** The caller's role in a game (PROTOCOL roles). */
export type Role = "host" | "solver" | "spectator";

/**
 * One member on a GET /games row (PROTOCOL section 12): display identity only. `name` is the
 * resolved display name the live roster shows, never null on the wire (a nameless mirror reads
 * "former participant" server-side, the same section 4 fallback). `avatarUrl` is the same opaque
 * nullable field the participant carries (PROTOCOL section 4): render the image when present,
 * fall back to the initial when null. `role` is the member's seat, so the standing solvers-only
 * display filters apply; a guest seats spectator and there is no guest flag on the wire.
 */
export interface GameMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
}

/**
 * One row of GET /games. The list arrives most-recently-active first within the page; completedAt
 * marks a finished game, lastActivityAt is the newest board event (null when no one has played).
 */
export interface GameSummary {
  gameId: string;
  name: string | null;
  role: Role;
  createdAt: string;
  createdBy: string;
  memberCount: number;
  /**
   * The full membership as display identity, join-ordered (first joiner first; PROTOCOL section
   * 12), so the home can render identity-true avatar stacks without a second fetch. Additive
   * (section 14): an older server omits it, so read through membersOf(), which folds absent to
   * empty rather than leaking undefined into a render.
   */
  members?: GameMember[];
  /**
   * The game's invite code, under exactly the game view's member-only rule (PROTOCOL section
   * 12): the list is member-scoped, so every row's reader is a member and the code travels no
   * wider than GET /games/{id} already sends it. Additive (section 14): an older server omits
   * it, which reads as none.
   */
  inviteCode?: string;
  /**
   * When the game completed (ISO), or null while ongoing (also null for an abandoned game, which
   * never completed). Read from the session-owned game_state, never a solution (INV-6-safe).
   */
  completedAt: string | null;
  /**
   * The game's last activity: the newest board event's timestamp (ISO), or null when no one has
   * played yet. `MAX(cell_events.at)` read server-side under a SELECT-only grant, never a cell
   * value or a solution (INV-6-safe). The list is ordered by this field, most recent first.
   */
  lastActivityAt: string | null;
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

/**
 * A row's member stack, absent-tolerant (PROTOCOL section 14): an older server omits `members`,
 * which reads as empty. Every consumer goes through here so the fallback lives once.
 */
export function membersOf(g: GameSummary): GameMember[] {
  return g.members ?? [];
}

/**
 * The timestamp a game row is "about": its last activity when someone has played, else its
 * creation time. This is the time the row shows ("active X ago" vs "started X ago") and the key it
 * sorts on, so a played game reads by when it was last touched and an unplayed one by when it was
 * made.
 */
export function lastTouched(g: GameSummary): string {
  return g.lastActivityAt ?? g.createdAt;
}

/**
 * Order rooms by when they were last touched, most recent first, matching the server's within-page
 * order (PROTOCOL section 12). The sort key is COALESCE(lastActivityAt, createdAt), the same key
 * lastTouched() already returns for display: creating a room is its first activity, so a freshly
 * created unplayed game sorts by its createdAt (at the top of a fresh page), not below every played
 * game. Ties on the coalesced key fall back to createdAt, then gameId, so the order is total and
 * stable. The server already sends the page in this order; sorting again on the client keeps
 * rendering correct even if pages are ever merged, and it never fights the server since the rule is
 * the same. Pure and non-mutating (returns a new array).
 */
export function sortByActivity(games: readonly GameSummary[]): GameSummary[] {
  return [...games].sort((a, b) => {
    // COALESCE(lastActivityAt, createdAt), the same key lastTouched() reads for display.
    const keyDelta = Date.parse(lastTouched(b)) - Date.parse(lastTouched(a));
    if (keyDelta !== 0) return keyDelta; // more recently touched first
    const createdDelta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return a.gameId < b.gameId ? 1 : a.gameId > b.gameId ? -1 : 0;
  });
}

/**
 * Split rooms into the two shelves the home and the sidebar render (Home.tsx GamesList, AppShell
 * RecentGames): live rooms lead, solved rooms gather trailing. The partition PRESERVES the input
 * order within each group and never re-sorts, so a caller's activity order carries through. When
 * nothing is solved the `solved` group is empty and the caller draws no trailing header. The iOS
 * twin is RoomCardModel.shelved. Pure and non-mutating.
 */
export function partitionBySolved(games: readonly GameSummary[]): {
  live: GameSummary[];
  solved: GameSummary[];
} {
  const live: GameSummary[] = [];
  const solved: GameSummary[] = [];
  for (const g of games) {
    (isCompleted(g) ? solved : live).push(g);
  }
  return { live, solved };
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

// The REST bearer and the authenticated-fetch seam live in the transport layer
// (net/authedFetch): the bearer resolves the token per call (never a string frozen at
// mount, which outlives its own expiry and rides a dead bearer into a 401), and the seam
// recovers from a 401 with one refresh-and-retry. Re-exported here so the WebSocket path
// and other callers keep importing the TokenSource shape from one place.
export type { Bearer, TokenSource } from "../net/authedFetch";

export async function fetchGames(
  apiBase: string,
  bearer: Bearer,
): Promise<GameSummary[]> {
  const res = await authedFetch(bearer, `${apiBase}/games`);
  if (!res.ok) throw new Error(`GET /games ${res.status}`);
  const body = (await res.json()) as { games?: GameSummary[] };
  return body.games ?? [];
}

export async function fetchPuzzles(
  apiBase: string,
  bearer: Bearer,
): Promise<PuzzleSummary[]> {
  const res = await authedFetch(bearer, `${apiBase}/puzzles`);
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
  bearer: Bearer,
): Promise<void> {
  const res = await authedFetch(bearer, `${apiBase}/account`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE /account ${res.status}`);
}

/** Start a fresh game from an existing puzzle: the reusability story (replay with a new group). */
export async function startGameFromPuzzle(
  apiBase: string,
  bearer: Bearer,
  puzzleId: string,
): Promise<{ gameId: string; inviteCode: string }> {
  const res = await authedFetch(bearer, `${apiBase}/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
