// Postgres write adapter (DESIGN.md §4 adapters, §6 write-behind, §9 single-writer).
// The session service is the single writer for game_state, cell_events, and check_events
// (INV-7). Every flush is ONE transaction: append the buffered cellSet events to the
// append-only cell_events log, the buffered checks to the append-only check_events log
// (D27), and upsert the game_state snapshot together, so the restored snapshot-plus-log
// pair is always internally consistent (INV-5). Both logs are append-only by grant
// (INSERT + SELECT only), so this file never issues an UPDATE or DELETE against them;
// game_state is a full-DML upsert.
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

/**
 * The open check vote as the board snapshot persists it (DESIGN.md §9, D32). It carries the engine
 * `CheckVote` fields (so a rehydrated actor resumes the same vote, `commandId` included, and a
 * passing close after rehydrate still attributes `puzzleChecked`) plus the session-owned `expiresAt`
 * (the engine models no clock, INV-9), so the timer re-arms for the remaining time or the vote
 * closes EXPIRED on crash rehydrate. Server-side only; the wire §4 object drops `commandId` and
 * derives `needed` (adapt.ts checkVoteToWire). INV-6: no cell values or answers.
 */
export interface PersistedCheckVote {
  readonly openedSeq: number;
  readonly by: string;
  readonly commandId: string;
  readonly electorate: readonly string[];
  readonly approvals: readonly string[];
  readonly rejections: readonly string[];
  readonly expiresAt: string;
}

/**
 * The board jsonb the snapshot persists (PROTOCOL.md §4 facts, DESIGN.md §9): the per-cell
 * array plus the standing room-check marks, the permanent count, and the open check vote (D32), so
 * all of it survives passivation with the board it describes (D27, D32). hydrate.ts reads this
 * shape back, and still accepts the pre-check bare cell array a legacy row holds and a pre-vote
 * object with no `checkVote` (expand/contract: the reader widened before any writer produced the
 * new shape).
 */
export interface BoardSnapshot {
  /** Full per-cell array, length rows*cols; black/never-written cells are {v:null,by:null}. */
  readonly cells: readonly { v: string | null; by: string | null }[];
  /** The standing marks, ascending; `[]` when none stand (PROTOCOL.md §4, §10). */
  readonly checkedWrongCells: readonly number[];
  /** Total accepted checks, permanent and never reset (PROTOCOL.md §10). */
  readonly checkCount: number;
  /** The open vote, or `null` when none (D32). Absent on a pre-vote row (expand/contract). */
  readonly checkVote?: PersistedCheckVote | null;
}

/**
 * One accepted room check awaiting its check_events row (DESIGN.md §9, D27). `userId` is the
 * acting member the actor retains SERVER-SIDE only: it never rides the wire event (PROTOCOL.md
 * §6 neutrality), it lands solely in the append-only log for future scoring.
 */
export interface CheckEventRow {
  readonly seq: number;
  readonly userId: string;
  readonly at: string;
}

/**
 * One vote lifecycle event awaiting its check_vote_events row (DESIGN.md §9, D32). Buffered and
 * flushed exactly like a `CheckEventRow`, in the same transaction as the snapshot that carries the
 * vote state (INV-5). `kind` is `opened`, `cast`, or `closed`; `userId` is the proposer on `opened`,
 * the voter on `cast`, and null on `closed`; `approve` is the ballot on `cast`; `voteSeq` is the
 * opening event's seq (the vote's identity); `electorate` is the frozen array on `opened`; `outcome`
 * and `reason` are set on `closed`. Every field but the wire event's server-only companions matches
 * the row shape §9 names. INV-6: no cell values or answers.
 */
export interface VoteEventRow {
  readonly seq: number;
  readonly kind: "opened" | "cast" | "closed";
  readonly userId: string | null;
  readonly approve: boolean | null;
  readonly voteSeq: number;
  readonly electorate: readonly string[] | null;
  readonly outcome: string | null;
  readonly reason: string | null;
  readonly at: string;
}

/** The game_state row this flush upserts (DESIGN.md §9). Column shapes match hydrate.ts. */
export interface StateSnapshot {
  readonly status: "ongoing" | "completed" | "abandoned";
  readonly board: BoardSnapshot;
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

/** Append buffered room checks to the immutable check_events log (D27). INSERT only (§9). */
async function insertCheckEvents(
  client: PoolClient,
  gameId: string,
  checks: readonly CheckEventRow[],
): Promise<void> {
  for (const check of checks) {
    // Same retry guard as cell_events: ON CONFLICT DO NOTHING is still an INSERT, so the
    // log stays append-only at the grant layer.
    await client.query(
      `insert into check_events (game_id, seq, user_id, at)
       values ($1, $2, $3, $4)
       on conflict (game_id, seq) do nothing`,
      [gameId, check.seq, check.userId, check.at],
    );
  }
}

/** Append buffered vote events to the immutable check_vote_events log (D32). INSERT only (§9). */
async function insertVoteEvents(
  client: PoolClient,
  gameId: string,
  voteEvents: readonly VoteEventRow[],
): Promise<void> {
  for (const row of voteEvents) {
    // Same retry guard as cell_events / check_events: ON CONFLICT DO NOTHING is still an INSERT,
    // so the log stays append-only at the grant layer.
    await client.query(
      `insert into check_vote_events
         (game_id, seq, kind, user_id, approve, vote_seq, electorate, outcome, reason, at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       on conflict (game_id, seq) do nothing`,
      [
        gameId,
        row.seq,
        row.kind,
        row.userId,
        row.approve,
        row.voteSeq,
        row.electorate === null ? null : JSON.stringify(row.electorate),
        row.outcome,
        row.reason,
        row.at,
      ],
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

/**
 * The game's cell-event timestamps as epoch ms, in the actor's write order (seq). Read inside
 * the terminal flush transaction after the final append, so the list is the whole log the
 * sittings stats describe (PROTOCOL.md §4, D29). Like `participantCount`, this is authoritative
 * over cell_events rather than actor memory, which is lost on passivation. One narrow column
 * over the `(game_id, seq)` primary key, an index range scan.
 */
export async function selectEventTimesAsc(
  client: PoolClient,
  gameId: string,
): Promise<number[]> {
  const { rows } = await client.query<{ at: Date | string }>(
    "select at from cell_events where game_id = $1 order by seq asc",
    [gameId],
  );
  return rows.map((r) => new Date(r.at).getTime());
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
  checks: readonly CheckEventRow[],
  voteEvents: readonly VoteEventRow[],
  snap: StateSnapshot,
): Promise<void> {
  await inTransaction(pool, async (client) => {
    await insertEvents(client, gameId, events);
    await insertCheckEvents(client, gameId, checks);
    await insertVoteEvents(client, gameId, voteEvents);
    await upsertSnapshot(client, gameId, snap);
  });
}

/**
 * Terminal (completion) flush, synchronous before the broadcast (INV-3). The completing
 * cellSets are appended first, then participantCount is read DISTINCT over cell_events and
 * the event timestamps are read in seq order inside the same transaction (so both count the
 * completing writer's rows), then the snapshot is upserted with the stats. `buildSnapshot`
 * receives the authoritative participantCount and the full log's epoch-ms timestamps (the
 * sittings inputs, D29) and returns the snapshot to persist plus the stats to broadcast.
 */
export async function flushTerminalToPostgres(
  pool: Pool,
  gameId: string,
  events: readonly CellSet[],
  checks: readonly CheckEventRow[],
  voteEvents: readonly VoteEventRow[],
  buildSnapshot: (
    participantCount: number,
    eventAtMs: readonly number[],
  ) => {
    snap: StateSnapshot;
    stats: Stats;
  },
): Promise<Stats> {
  return inTransaction(pool, async (client) => {
    await insertEvents(client, gameId, events);
    await insertCheckEvents(client, gameId, checks);
    await insertVoteEvents(client, gameId, voteEvents);
    const participantCount = await countDistinctWriters(client, gameId);
    const eventAtMs = await selectEventTimesAsc(client, gameId);
    const { snap, stats } = buildSnapshot(participantCount, eventAtMs);
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
  /**
   * Write-behind flush: buffered cellSets, buffered checks, buffered vote events (D32), and the
   * snapshot in one transaction, so every consumed seq stays accounted for with the snapshot that
   * carries its state (INV-5).
   */
  flush(
    gameId: string,
    events: readonly CellSet[],
    checks: readonly CheckEventRow[],
    voteEvents: readonly VoteEventRow[],
    snap: StateSnapshot,
  ): Promise<void>;
  /**
   * Terminal flush: append all three logs, read the authoritative participantCount and the log's
   * event timestamps (seq order, epoch ms; the sittings inputs, D29), upsert snapshot.
   */
  flushTerminal(
    gameId: string,
    events: readonly CellSet[],
    checks: readonly CheckEventRow[],
    voteEvents: readonly VoteEventRow[],
    buildSnapshot: (
      participantCount: number,
      eventAtMs: readonly number[],
    ) => {
      snap: StateSnapshot;
      stats: Stats;
    },
  ): Promise<Stats>;
}

/** Bind the persistence port to a `pg` Pool (the crossy_session-role connection, §9). */
export function createPgPersistence(pool: Pool): GamePersistence {
  return {
    flush: (gameId, events, checks, voteEvents, snap) =>
      flushToPostgres(pool, gameId, events, checks, voteEvents, snap),
    flushTerminal: (gameId, events, checks, voteEvents, build) =>
      flushTerminalToPostgres(pool, gameId, events, checks, voteEvents, build),
  };
}
