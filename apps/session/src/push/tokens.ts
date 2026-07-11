// Token reads for the push emitter (PROTOCOL.md "Live Activity push"; DESIGN.md §9 read-coupling).
// The registry is API-owned (single writer crossy_api, INV-7); the session reads it under the
// SELECT grant migration 0007 adds. This file is the only place the emitter touches the table, and
// it only ever SELECTs.
//
// TTL window: a lock-screen Live Activity caps at about 12 hours (LIVE_ACTIVITY_MAX_AGE_MS in
// packages/protocol), so a token older than that is dead. The read filters by `created_at` rather
// than trusting a sweeper, so no sweeper job is required for correctness (PROTOCOL.md): a stale row
// simply falls outside the window and is never pushed to. INV-6: the row carries a token, the
// owning user and game, the environment, and a created_at, nothing solution-bearing; this read
// selects exactly those columns.

import type { Pool } from "pg";
import { LIVE_ACTIVITY_MAX_AGE_MS } from "@crossy/protocol";
import type { ApnsEnvironment } from "./apns";

/** One live-activity token row the emitter pushes to. */
export interface LiveActivityToken {
  readonly token: string;
  readonly userId: string;
  readonly environment: ApnsEnvironment;
}

/** The `apns_environment` domain is a two-value CHECK; narrow the string to the union on read. */
function toEnvironment(value: string): ApnsEnvironment {
  return value === "sandbox" ? "sandbox" : "production";
}

/**
 * All live tokens for a game inside the TTL window, in insertion order (created_at). The
 * `created_at > now - MAX_AGE` predicate is the window; `nowMs` is the clock as data so the caller
 * (and tests) control it. Uses the game_id index (0007) with the created_at filter as a residual.
 */
export async function loadLiveTokens(
  pool: Pool,
  gameId: string,
  nowMs: number,
): Promise<LiveActivityToken[]> {
  const cutoff = new Date(nowMs - LIVE_ACTIVITY_MAX_AGE_MS).toISOString();
  const { rows } = await pool.query<{
    token: string;
    user_id: string;
    apns_environment: string;
  }>(
    `select token, user_id, apns_environment
       from live_activity_tokens
      where game_id = $1 and created_at > $2
      order by created_at`,
    [gameId, cutoff],
  );
  return rows.map((r) => ({
    token: r.token,
    userId: r.user_id,
    environment: toEnvironment(r.apns_environment),
  }));
}
