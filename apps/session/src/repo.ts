// Postgres read adapter (DESIGN.md §4 adapters, §9 read-coupling). The session service
// owns writes to game_state and cell_events, but this slice only reads: the puzzle
// snapshot and game_state for hydration, and memberships, the denylist, and
// users.display_name plus users.avatar for the handshake and the participant payload
// (INV-8: it verifies membership, never mutates it). Writes are the write-behind flush in
// Wave 2.2. Reads go through the least-privilege crossy_session role in production (the
// migration's column grant limits users to display_name and avatar); the queries here stay
// within that grant. users.avatar holds a resolved URL, never an email (the API's auth port
// hashed it), so reading it exposes no email to the session (INV-6 spirit).

import type { Pool } from "pg";
import type { Role } from "@crossy/protocol";
import type { GameStateRow, PuzzleSnapshot, StoredBoard } from "./hydrate";

/** A member of a game, for the participant payload (PROTOCOL.md §4). */
export interface MemberRow {
  readonly userId: string;
  readonly displayName: string | null;
  /** The resolved avatar URL, or null (PROTOCOL.md §4). Opaque; never an email (INV-6 spirit). */
  readonly avatarUrl: string | null;
  readonly role: Role;
  /** ISO-8601 join instant, feeding the room-aware color assignment's join order (D28). The
   * uniform format keeps ASCII order equal to time order (INV-1). */
  readonly joinedAt: string;
}

/** int8 (bigint) columns arrive from pg as strings; make them numbers. */
function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** timestamptz arrives as a Date; normalize to the ISO string the wire uses (PROTOCOL.md §3). */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Read `games.puzzle_snapshot`; `null` when the game does not exist (GAME_NOT_FOUND). */
export async function loadPuzzleSnapshot(
  pool: Pool,
  gameId: string,
): Promise<PuzzleSnapshot | null> {
  const { rows } = await pool.query<{ puzzle_snapshot: PuzzleSnapshot }>(
    "select puzzle_snapshot from games where game_id = $1",
    [gameId],
  );
  return rows[0]?.puzzle_snapshot ?? null;
}

/**
 * Read the game row the actor hydrates from: the puzzle snapshot plus the room's display name
 * (`games.name`, nullable). `null` when the game does not exist (GAME_NOT_FOUND). The name rides
 * here, on the one read the actor already makes at hydration, so the completion alert body needs no
 * extra query on the hot path (PROTOCOL.md 12a: the name rides the facts snapshot). Reads only
 * columns the session's SELECT grant on `games` already covers (INV-6: name is display content, no
 * solution).
 */
export async function loadGameRow(
  pool: Pool,
  gameId: string,
): Promise<{ snapshot: PuzzleSnapshot; roomName: string | null } | null> {
  const { rows } = await pool.query<{
    puzzle_snapshot: PuzzleSnapshot;
    name: string | null;
  }>("select puzzle_snapshot, name from games where game_id = $1", [gameId]);
  const row = rows[0];
  if (row === undefined) return null;
  return { snapshot: row.puzzle_snapshot, roomName: row.name ?? null };
}

/** Read the `game_state` row, or `null` when no one has played the game yet. */
export async function loadGameState(
  pool: Pool,
  gameId: string,
): Promise<GameStateRow | null> {
  const { rows } = await pool.query(
    `select status, board, last_seq, first_fill_at, completed_at,
            abandoned_at, stats, recent_command_ids
       from game_state where game_id = $1`,
    [gameId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    status: row.status,
    // Either board generation passes through as stored (hydrate.ts StoredBoard): the
    // current {cells, checkedWrongCells, checkCount} object or a legacy bare cell array.
    board: (row.board ?? []) as StoredBoard,
    lastSeq: toNumber(row.last_seq),
    firstFillAt: toIso(row.first_fill_at),
    completedAt: toIso(row.completed_at),
    abandonedAt: toIso(row.abandoned_at),
    stats: row.stats && Object.keys(row.stats).length > 0 ? row.stats : null,
    recentCommandIds: Array.isArray(row.recent_command_ids)
      ? row.recent_command_ids
      : [],
  };
}

/** The connecting user's role in the game, or `null` when they are not a member (NOT_PARTICIPANT). */
export async function findRole(
  pool: Pool,
  gameId: string,
  userId: string,
): Promise<Role | null> {
  const { rows } = await pool.query<{ role: Role }>(
    "select role from memberships where game_id = $1 and user_id = $2",
    [gameId, userId],
  );
  return rows[0]?.role ?? null;
}

/** Whether the user is on the game's denylist (DENIED). Checked at connect (DESIGN.md §7). */
export async function isDenied(
  pool: Pool,
  gameId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    "select 1 from game_denylist where game_id = $1 and user_id = $2",
    [gameId, userId],
  );
  return rows.length > 0;
}

/** All members of the game with their display names, for the participant payload. */
export async function loadMembers(
  pool: Pool,
  gameId: string,
): Promise<MemberRow[]> {
  const { rows } = await pool.query<{
    user_id: string;
    display_name: string | null;
    avatar: string | null;
    role: Role;
    joined_at: Date | string;
  }>(
    `select m.user_id, m.role, m.joined_at, u.display_name, u.avatar
       from memberships m
       join users u on u.user_id = m.user_id
      where m.game_id = $1
      order by m.joined_at, m.user_id`,
    [gameId],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar,
    role: r.role,
    // joined_at is NOT NULL (schema default now()); toIso never sees a null here.
    joinedAt: toIso(r.joined_at) ?? "",
  }));
}
