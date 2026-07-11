// Postgres write adapter (DESIGN.md §4 adapters, §6 write-behind, §9 single-writer).
// The session service is the single writer for game_state and cell_events (INV-7). Every
// flush is ONE transaction: append the buffered cellSet events to the append-only
// cell_events log and upsert the game_state snapshot together, so the restored
// snapshot-plus-log pair is always internally consistent (INV-5). cell_events is
// append-only by grant (INSERT + SELECT only), so this file never issues an UPDATE or
// DELETE against it; game_state is a full-DML upsert.
//
// participantCount (PROTOCOL.md §4) is authoritative here, not from actor memory: it is
// DISTINCT user_id over cell_events, computed inside the terminal flush transaction after
// the completing events are appended, so it survives passivation and counts every writer.

import type { CellSet } from "@crossy/engine";
import type { Stats } from "@crossy/protocol";
import type { Pool, PoolClient } from "pg";

/**
 * A snapshot flush the game_state guard refused (§9): the stored row already holds a newer
 * seq or a terminal status, so this writer is not the sole writer of the row (INV-7). Carries
 * the gameId and the attempted lastSeq for the log. The refusal rolls back the whole flush,
 * so the events that would have ridden the snapshot never land either (INV-5).
 */
export class SnapshotRegressionError extends Error {
  constructor(
    readonly gameId: string,
    readonly attemptedLastSeq: number,
  ) {
    super(
      `snapshot flush for game ${gameId} at last_seq ${attemptedLastSeq} lost single-writer status: a newer or terminal game_state row exists (INV-7)`,
    );
    this.name = "SnapshotRegressionError";
  }
}

/** The game_state row this flush upserts (DESIGN.md §9). Column shapes match hydrate.ts. */
export interface StateSnapshot {
  readonly status: "ongoing" | "completed" | "abandoned";
  /** Full per-cell array, length rows*cols; black/never-written cells are {v:null,by:null}. */
  readonly board: readonly { v: string | null; by: string | null }[];
  readonly lastSeq: number;
  readonly firstFillAt: string | null;
  readonly completedAt: string | null;
  readonly abandonedAt: string | null;
  /** null for an ongoing game; the completion stats for a terminal one. */
  readonly stats: Record<string, unknown> | null;
  readonly recentCommandIds: readonly string[];
}

/** Append buffered cellSets to the immutable log. INSERT only (§9): never UPDATE/DELETE. */
async function insertEvents(
  client: PoolClient,
  gameId: string,
  events: readonly CellSet[],
): Promise<void> {
  for (const event of events) {
    // ON CONFLICT DO NOTHING guards a retry after a partially-observed flush; it is still
    // an INSERT (no UPDATE privilege needed), so cell_events stays append-only.
    await client.query(
      `insert into cell_events (game_id, seq, cell, user_id, value, at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (game_id, seq) do nothing`,
      [gameId, event.seq, event.cell, event.by, event.value, event.at],
    );
  }
}

/**
 * Upsert the board snapshot. game_state is full DML for the session role (§9). The DO UPDATE
 * WHERE is a single-writer tripwire (INV-7), not a coordination mechanism: an update only
 * applies when the stored row is still ongoing, or the incoming snapshot repeats the stored
 * terminal status, AND the incoming seq is at least the stored seq. So seq never regresses, and
 * a terminal row is final (INV-4): it is never rolled back to ongoing, nor switched between
 * completed and abandoned, even by a snapshot carrying a higher seq. A terminal row accepts only
 * an identical-status reflush, and the bound is >= not >, so re-flushing the same terminal
 * snapshot at the same seq still applies (the idempotent retry after a partially-observed flush).
 * A rejected update leaves rowCount 0: for INSERT ... ON CONFLICT DO UPDATE a fresh insert and an
 * applied update both report 1, so 0 means only the guard refused, and this writer has lost the
 * row to a newer or terminal writer.
 */
async function upsertSnapshot(
  client: PoolClient,
  gameId: string,
  snap: StateSnapshot,
): Promise<void> {
  const result = await client.query(
    `insert into game_state
       (game_id, status, board, last_seq, first_fill_at,
        completed_at, abandoned_at, stats, recent_command_ids)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     on conflict (game_id) do update set
       status = excluded.status,
       board = excluded.board,
       last_seq = excluded.last_seq,
       first_fill_at = excluded.first_fill_at,
       completed_at = excluded.completed_at,
       abandoned_at = excluded.abandoned_at,
       stats = excluded.stats,
       recent_command_ids = excluded.recent_command_ids
     where (game_state.status = 'ongoing' or excluded.status = game_state.status)
       and excluded.last_seq >= game_state.last_seq`,
    [
      gameId,
      snap.status,
      JSON.stringify(snap.board),
      snap.lastSeq,
      snap.firstFillAt,
      snap.completedAt,
      snap.abandonedAt,
      JSON.stringify(snap.stats ?? {}),
      JSON.stringify(snap.recentCommandIds),
    ],
  );
  if (result.rowCount === 0) {
    throw new SnapshotRegressionError(gameId, snap.lastSeq);
  }
}

/** DISTINCT writers over cell_events: the authoritative participantCount (PROTOCOL.md §4). */
export async function countDistinctWriters(
  client: PoolClient,
  gameId: string,
): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    "select count(distinct user_id)::text as n from cell_events where game_id = $1",
    [gameId],
  );
  return Number(rows[0]?.n ?? "0");
}

/** Run `fn` inside one transaction on a dedicated client; rollback and rethrow on error. */
async function inTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The connection is being discarded; a failed rollback changes nothing durable.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Write-behind flush (DESIGN.md §6): the buffered events and the snapshot land in ONE
 * transaction. A fault anywhere rolls back both, so neither the events nor the snapshot
 * are ever half-written (INV-5). Called on the ~25-event / ~5-second thresholds, on
 * transition to idle, and on drain (SIGTERM).
 */
export async function flushToPostgres(
  pool: Pool,
  gameId: string,
  events: readonly CellSet[],
  snap: StateSnapshot,
): Promise<void> {
  await inTransaction(pool, async (client) => {
    await insertEvents(client, gameId, events);
    await upsertSnapshot(client, gameId, snap);
  });
}

/**
 * Terminal (completion) flush, synchronous before the broadcast (INV-3). The completing
 * cellSets are appended first, then participantCount is read DISTINCT over cell_events
 * inside the same transaction so it counts the completing writer, then the snapshot is
 * upserted with the stats. `buildSnapshot` receives the authoritative participantCount and
 * returns the snapshot to persist plus the stats to broadcast.
 */
export async function flushTerminalToPostgres(
  pool: Pool,
  gameId: string,
  events: readonly CellSet[],
  buildSnapshot: (participantCount: number) => {
    snap: StateSnapshot;
    stats: Stats;
  },
): Promise<Stats> {
  return inTransaction(pool, async (client) => {
    await insertEvents(client, gameId, events);
    const participantCount = await countDistinctWriters(client, gameId);
    const { snap, stats } = buildSnapshot(participantCount);
    await upsertSnapshot(client, gameId, snap);
    return stats;
  });
}

/**
 * The actor's persistence port (DESIGN.md §4 application ring depends on a port, the
 * adapter binds it to Postgres). The actor holds this, never a `Pool`, so its flush logic
 * stays testable and IO stays at the boundary.
 */
export interface GamePersistence {
  /** Write-behind flush: buffered events plus the snapshot in one transaction. */
  flush(
    gameId: string,
    events: readonly CellSet[],
    snap: StateSnapshot,
  ): Promise<void>;
  /** Terminal flush: append events, read authoritative participantCount, upsert snapshot. */
  flushTerminal(
    gameId: string,
    events: readonly CellSet[],
    buildSnapshot: (participantCount: number) => {
      snap: StateSnapshot;
      stats: Stats;
    },
  ): Promise<Stats>;
}

/** Bind the persistence port to a `pg` Pool (the crossy_session-role connection, §9). */
export function createPgPersistence(pool: Pool): GamePersistence {
  return {
    flush: (gameId, events, snap) =>
      flushToPostgres(pool, gameId, events, snap),
    flushTerminal: (gameId, events, build) =>
      flushTerminalToPostgres(pool, gameId, events, build),
  };
}
