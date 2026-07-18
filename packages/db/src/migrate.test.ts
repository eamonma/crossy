/**
 * Schema + roles + RLS conformance against real Postgres (ROADMAP Wave 1.1f;
 * DESIGN.md §7, §9; §11).
 *
 * Applies the committed Drizzle migrations to a throwaway container and asserts the
 * data model DESIGN.md §9 specifies: the seven tables and their keys, single-writer
 * ownership enforced by least-privilege Postgres roles (INV-7), the append-only
 * immutability of `cell_events` (§9), the session service's read-coupling contract
 * (§9), and the deny-all RLS tripwire (§7). The assertions are the spec; the schema
 * is written to satisfy them (DESIGN.md §11: the spec is the failing test).
 *
 * No silent skips (repo rule): the container start is required. If the Docker daemon
 * is unreachable the suite FAILS with a clear message rather than skipping, because a
 * skipped infra test reads as a passing one.
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "./migrator";
import * as schema from "./schema";

// Image pinned for determinism; pre-pulled in CI/dev before the run.
const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;

// The real tables (DESIGN.md §9), grouped by their single writer (INV-7).
const API_TABLES = [
  "users",
  "puzzles",
  "games",
  "memberships",
  "game_denylist",
] as const;
const SESSION_TABLES = [
  "game_state",
  "cell_events",
  "check_events",
  "check_vote_events",
] as const;
const ALL_TABLES = [...API_TABLES, ...SESSION_TABLES];

let container: StartedPostgreSqlContainer;
let connectionString: string;
let pool: Pool;

// Seed identifiers, inserted once via the typed schema (which doubles as a proof that
// src/schema.ts matches the generated DDL) and reused by the role tests.
const seed = {
  userId: randomUUID(),
  puzzleId: randomUUID(),
  gameId: randomUUID(),
};

/** Run `fn` on a dedicated connection whose current role is `role`, then reset. Role
 * names are trusted in-repo constants, so string interpolation is safe here. */
async function asRole<T>(
  role: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET ROLE "${role}"`);
    return await fn(client);
  } finally {
    try {
      await client.query("RESET ROLE");
    } catch {
      // connection is being discarded anyway
    }
    client.release();
  }
}

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (cause) {
    throw new Error(
      "Testcontainers could not start Postgres. This test requires a running " +
        "Docker daemon and does not skip when it is missing (repo rule: no silent " +
        "skips). Start Docker and re-run `pnpm test`.",
      { cause },
    );
  }
  connectionString = container.getConnectionUri();
  pool = new Pool({ connectionString });

  await applyMigrations(connectionString);

  // Seed one row per API-owned table through the typed schema. A successful insert
  // proves the Drizzle model in src/schema.ts maps onto the migrated columns.
  const db = drizzle(pool, { schema });
  await db.insert(schema.users).values({
    userId: seed.userId,
    displayName: "Ada",
    avatar: "https://example.test/ada.png",
    isAnonymous: false,
  });
  await db
    .insert(schema.puzzles)
    .values({ puzzleId: seed.puzzleId, data: { grid: "mini" } });
  await db.insert(schema.games).values({
    gameId: seed.gameId,
    puzzleId: seed.puzzleId,
    puzzleSnapshot: { cells: [] },
    inviteCode: "ABCDEFGH",
    createdBy: seed.userId,
    // Optional display name written through the typed schema, proving the expand-only
    // column round-trips (0002_games_name). Nullable, so unnamed games omit it entirely.
    name: "Seed game",
  });
  await db
    .insert(schema.memberships)
    .values({ gameId: seed.gameId, userId: seed.userId, role: "host" });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
}, 60_000);

describe("data model shape (DESIGN.md §9)", () => {
  it("creates every §9 table and drops the scaffold marker in the contract phase (INV-7)", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ALL_TABLES) expect(names).toContain(t);
    // Expand/contract: removing _scaffold_marker is exactly the contract phase (§9).
    expect(names).not.toContain("_scaffold_marker");
  });

  it("gives each table its DESIGN.md §9 key columns (INV-7)", async () => {
    const columnsOf = async (table: string): Promise<string[]> => {
      const { rows } = await pool.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
        [table],
      );
      return rows.map((r) => r.column_name);
    };
    // §9 names cell_events(game_id, seq, cell, user_id, value, at) exactly.
    expect((await columnsOf("cell_events")).sort()).toEqual(
      ["at", "cell", "game_id", "seq", "user_id", "value"].sort(),
    );
    // §9 names check_events(game_id, seq, user_id, at) exactly (D27): the cell-less twin.
    expect((await columnsOf("check_events")).sort()).toEqual(
      ["at", "game_id", "seq", "user_id"].sort(),
    );
    // §9 names check_vote_events(game_id, seq, kind, user_id, approve, vote_seq, electorate,
    // outcome, reason, at) exactly (D32): one row per vote lifecycle event.
    expect((await columnsOf("check_vote_events")).sort()).toEqual(
      [
        "approve",
        "at",
        "electorate",
        "game_id",
        "kind",
        "outcome",
        "reason",
        "seq",
        "user_id",
        "vote_seq",
      ].sort(),
    );
    // §9 game_state carries the board, last_seq, terminal timestamps, stats, and the
    // bounded command-id ring.
    expect(await columnsOf("game_state")).toEqual(
      expect.arrayContaining([
        "game_id",
        "status",
        "board",
        "last_seq",
        "first_fill_at",
        "completed_at",
        "abandoned_at",
        "stats",
        "recent_command_ids",
      ]),
    );
    // §9 games session identity, plus the expand-only optional display name (0002_games_name).
    expect(await columnsOf("games")).toEqual(
      expect.arrayContaining([
        "game_id",
        "puzzle_id",
        "puzzle_snapshot",
        "invite_code",
        "name",
        "created_by",
        "created_at",
      ]),
    );
    // §8 users identity mirror; PII columns present (nullable for tombstoning).
    expect(await columnsOf("users")).toEqual(
      expect.arrayContaining([
        "user_id",
        "display_name",
        "avatar",
        "is_anonymous",
      ]),
    );
  });

  it("makes (game_id, seq) unique on cell_events and (game_id, user_id) unique on memberships (INV-2, INV-7)", async () => {
    // §9: cell_events UNIQUE(game_id, seq) — here the composite primary key subsumes it.
    // memberships UNIQUE(game_id, user_id) — likewise the primary key.
    const pkCols = async (table: string): Promise<string[]> => {
      const { rows } = await pool.query<{ attname: string }>(
        `select a.attname
           from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
          where c.contype = 'p' and c.conrelid = $1::regclass
          order by a.attname`,
        [table],
      );
      return rows.map((r) => r.attname);
    };
    expect(await pkCols("cell_events")).toEqual(["game_id", "seq"]);
    // §9: check_events UNIQUE(game_id, seq) — the composite primary key subsumes it (D27).
    expect(await pkCols("check_events")).toEqual(["game_id", "seq"]);
    // §9: check_vote_events UNIQUE(game_id, seq) — the composite primary key subsumes it (D32).
    expect(await pkCols("check_vote_events")).toEqual(["game_id", "seq"]);
    expect(await pkCols("memberships")).toEqual(["game_id", "user_id"]);
    // §9: games.invite_code is a unique lookup key.
    const { rows: uniq } = await pool.query<{ n: string }>(
      `select count(*)::text as n from pg_constraint
        where contype = 'u' and conrelid = 'games'::regclass`,
    );
    expect(Number(uniq[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("never cascades a user_id foreign key, so the event log survives tombstoning (INV-1, §8)", async () => {
    // confdeltype: 'a' no action, 'r' restrict, 'c' cascade, 'n' set null.
    const fkDeleteType = async (
      table: string,
      column: string,
    ): Promise<string> => {
      const { rows } = await pool.query<{ confdeltype: string }>(
        `select c.confdeltype
           from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.conrelid = $1::regclass and a.attname = $2`,
        [table, column],
      );
      return rows[0]?.confdeltype ?? "";
    };
    // The load-bearing rule: cell_events.user_id is ON DELETE NO ACTION (§9), so a
    // tombstoned user's id survives as attribution and INV-1 replay holds. check_events
    // carries the same rule (D27): the server-only check attribution outlives the account.
    expect(await fkDeleteType("cell_events", "user_id")).toBe("a");
    expect(await fkDeleteType("check_events", "user_id")).toBe("a");
    // check_vote_events carries the same tombstone rule (D32): a vote's server-only attribution
    // (proposer, voter) outlives the account, so replay stays deterministic (INV-1).
    expect(await fkDeleteType("check_vote_events", "user_id")).toBe("a");
    expect(await fkDeleteType("memberships", "user_id")).toBe("a");
    expect(await fkDeleteType("games", "created_by")).toBe("a");
    // game_id belongs to the game aggregate: cascade is the composition semantics.
    expect(await fkDeleteType("cell_events", "game_id")).toBe("c");
    expect(await fkDeleteType("check_events", "game_id")).toBe("c");
    expect(await fkDeleteType("check_vote_events", "game_id")).toBe("c");
    // A puzzle referenced by a game cannot be hard-deleted; the snapshot decouples it.
    expect(await fkDeleteType("games", "puzzle_id")).toBe("r");
  });

  it("enforces the value charset and invite-code format as defense in depth (INV-1)", async () => {
    // Values are normalized to ^[A-Z0-9]{1,10}$ at the engine boundary; the CHECK is a
    // backstop. A clear is value NULL and must be allowed.
    await expect(
      pool.query(
        `insert into cell_events (game_id, seq, cell, user_id, value) values ($1, 999, 0, $2, 'toolong1234')`,
        [seed.gameId, seed.userId],
      ),
    ).rejects.toThrow(/cell_events_value_charset/);
    await expect(
      pool.query(
        `insert into games (puzzle_id, puzzle_snapshot, invite_code, created_by) values ($1, '{}'::jsonb, 'lower123', $2)`,
        [seed.puzzleId, seed.userId],
      ),
    ).rejects.toThrow(/games_invite_code_format/);
  });
});

describe("single writer per table via least-privilege roles (INV-7; DESIGN.md §9)", () => {
  it("lets the api role write its five owned tables but NOT the session-owned tables (INV-7)", async () => {
    // Positive: api owns users — an insert succeeds under the api role.
    await asRole("crossy_api", (c) =>
      c.query("insert into users (user_id) values (gen_random_uuid())"),
    );
    // Negative: api may not write game_state or cell_events (session-owned).
    await expect(
      asRole("crossy_api", (c) =>
        c.query("insert into game_state (game_id) values (gen_random_uuid())"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_api", (c) =>
        c.query(
          "insert into cell_events (game_id, seq, cell, user_id) values (gen_random_uuid(), 1, 0, gen_random_uuid())",
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("lets the session role write game_state and cell_events but NOT the api-owned tables (INV-7)", async () => {
    // Positive: session owns game_state and cell_events.
    await asRole("crossy_session", async (c) => {
      await c.query(
        "insert into game_state (game_id, last_seq) values ($1, 1) on conflict (game_id) do nothing",
        [seed.gameId],
      );
      await c.query(
        "insert into cell_events (game_id, seq, cell, user_id, value) values ($1, 1, 0, $2, 'A')",
        [seed.gameId, seed.userId],
      );
    });
    // Negative: session may not write any API-owned table (INV-8 too: it never mutates
    // membership).
    for (const table of API_TABLES) {
      await expect(
        asRole("crossy_session", (c) =>
          c.query(`insert into "${table}" default values`),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("keeps cell_events append-only: the session role cannot UPDATE or DELETE it (§9 immutability)", async () => {
    await expect(
      asRole("crossy_session", (c) =>
        c.query("update cell_events set value = 'Z'"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_session", (c) => c.query("delete from cell_events")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("gives check_events the cell_events posture: session appends, nobody rewrites (INV-7, §9, D27)", async () => {
    // Positive: the session role appends the room-check log (the write-behind flush path).
    await asRole("crossy_session", (c) =>
      c.query(
        "insert into check_events (game_id, seq, user_id, at) values ($1, 50, $2, now())",
        [seed.gameId, seed.userId],
      ),
    );
    // Append-only at the grant layer: UPDATE and DELETE are denied even to the writer.
    await expect(
      asRole("crossy_session", (c) =>
        c.query("update check_events set seq = 51"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_session", (c) => c.query("delete from check_events")),
    ).rejects.toThrow(/permission denied/i);
    // The API holds no grant at all: a future scoring read would be its own SELECT-only expand.
    await expect(
      asRole("crossy_api", (c) => c.query("select count(*) from check_events")),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_api", (c) =>
        c.query(
          "insert into check_events (game_id, seq, user_id) values ($1, 51, $2)",
          [seed.gameId, seed.userId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("gives check_vote_events the cell_events posture: session appends, nobody rewrites (INV-7, §9, D32)", async () => {
    // Positive: the session role appends the vote log (the write-behind flush path). An opened row.
    await asRole("crossy_session", (c) =>
      c.query(
        `insert into check_vote_events
           (game_id, seq, kind, user_id, vote_seq, electorate, at)
         values ($1, 60, 'opened', $2, 60, $3::jsonb, now())`,
        [seed.gameId, seed.userId, JSON.stringify([seed.userId])],
      ),
    );
    // A closed row carries a null user_id and an outcome/reason (D32): the nullable columns round-trip.
    await asRole("crossy_session", (c) =>
      c.query(
        `insert into check_vote_events
           (game_id, seq, kind, user_id, vote_seq, outcome, reason, at)
         values ($1, 61, 'closed', null, 60, 'failed', 'EXPIRED', now())`,
        [seed.gameId],
      ),
    );
    // Append-only at the grant layer: UPDATE and DELETE are denied even to the writer.
    await expect(
      asRole("crossy_session", (c) =>
        c.query("update check_vote_events set outcome = 'passed'"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_session", (c) => c.query("delete from check_vote_events")),
    ).rejects.toThrow(/permission denied/i);
    // The kind CHECK pins the three-value domain (D32): an unknown kind is rejected.
    await expect(
      asRole("crossy_session", (c) =>
        c.query(
          "insert into check_vote_events (game_id, seq, kind, vote_seq) values ($1, 62, 'abstained', 60)",
          [seed.gameId],
        ),
      ),
    ).rejects.toThrow(/check_vote_events_kind/);
    // The API holds no grant at all: a future scoring read would be its own SELECT-only expand.
    await expect(
      asRole("crossy_api", (c) =>
        c.query("select count(*) from check_vote_events"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("grants the api role SELECT on game_state for the completion read, but never a write (INV-7)", async () => {
    // Read expand (migration 0005, DESIGN.md §9): the API reports a game's completion on the
    // signed-in home from the session-owned game_state.completed_at. The grant is read only, so
    // the session stays the single writer (INV-7 governs writes, not reads).
    await asRole("crossy_api", async (c) => {
      const { rows } = await c.query<{ n: string }>(
        "select count(*)::text as n from game_state",
      );
      expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(0);
      // The one column the home needs is readable; the read touches no other table.
      await c.query("select completed_at from game_state");
    });
    // The read grant is not a write grant: game_state stays session-owned (INV-7).
    await expect(
      asRole("crossy_api", (c) =>
        c.query("insert into game_state (game_id) values (gen_random_uuid())"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_api", (c) =>
        c.query("update game_state set completed_at = now()"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_api", (c) => c.query("delete from game_state")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("grants the api role SELECT on cell_events for activity ordering, but never a write (INV-7)", async () => {
    // Read expand (migration 0008, DESIGN.md §9): the API orders the signed-in home's rooms by
    // most recent activity, MAX(cell_events.at) per game (PROTOCOL.md §12). The grant is read only,
    // so the session stays the single writer and the log stays append-only for it too (§9).
    await asRole("crossy_api", async (c) => {
      // The aggregate the list needs is readable; the read touches only the timestamp, not value.
      const { rows } = await c.query<{ last: Date | null }>(
        "select max(at) as last from cell_events",
      );
      expect(rows.length).toBe(1);
    });
    // The read grant is not a write grant: cell_events stays session-owned and append-only (INV-7,
    // §9 immutability). The api role can INSERT/UPDATE/DELETE none of it.
    await expect(
      asRole("crossy_api", (c) =>
        c.query(
          "insert into cell_events (game_id, seq, cell, user_id, value) values ($1, 2, 0, $2, 'A')",
          [seed.gameId, seed.userId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_api", (c) =>
        c.query("update cell_events set value = 'Z'"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_api", (c) => c.query("delete from cell_events")),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("session read-coupling contract (INV-7; DESIGN.md §9)", () => {
  it("grants the session role read access to games, memberships, and game_denylist (§9)", async () => {
    await asRole("crossy_session", async (c) => {
      for (const table of ["games", "memberships", "game_denylist"] as const) {
        const { rows } = await c.query<{ n: string }>(
          `select count(*)::text as n from "${table}"`,
        );
        expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(0);
      }
    });
    // It actually sees the seeded game (BYPASSRLS service role; RLS does not gate it).
    const { rows } = await asRole("crossy_session", (c) =>
      c.query<{ n: string }>("select count(*)::text as n from games"),
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("limits the session role to users.display_name and avatar, never is_anonymous (§9, INV-6-adjacent)", async () => {
    // Allowed: the participant-payload projection (user_id is the join key, not PII). avatar is
    // the resolved avatar URL the session renders (PROTOCOL.md §4), granted by 0006; it is never
    // an email, so this grant exposes no email to the session (INV-6 spirit).
    const { rows } = await asRole("crossy_session", (c) =>
      c.query<{ display_name: string | null; avatar: string | null }>(
        "select user_id, display_name, avatar from users",
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Denied: any column outside the grant, and the whole-row projection.
    await expect(
      asRole("crossy_session", (c) =>
        c.query("select is_anonymous from users"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_session", (c) => c.query("select * from users")),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("live_activity_tokens registry: API single writer, session reader (0007; INV-7; DESIGN.md §9)", () => {
  it("gives the table its key columns and the two-value environment CHECK", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='live_activity_tokens'",
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(
      ["apns_environment", "created_at", "game_id", "token", "user_id"].sort(),
    );
    // The CHECK is defense in depth: only 'sandbox' or 'production' (a Debug build mints sandbox,
    // so the emitter targets the matching APNs host).
    await expect(
      pool.query(
        "insert into live_activity_tokens (token, user_id, game_id, apns_environment) values ('t-bad', $1, $2, 'staging')",
        [seed.userId, seed.gameId],
      ),
    ).rejects.toThrow(/live_activity_tokens_environment/);
  });

  it("cascades on game delete but never on user delete, so a tombstoned user's registry row still keyed the id (INV-7, §8)", async () => {
    const fkDeleteType = async (column: string): Promise<string> => {
      const { rows } = await pool.query<{ confdeltype: string }>(
        `select c.confdeltype
           from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.conrelid = 'live_activity_tokens'::regclass and a.attname = $1`,
        [column],
      );
      return rows[0]?.confdeltype ?? "";
    };
    // 'c' cascade on game_id (the token belongs to the game aggregate), 'a' no action on user_id
    // (users are tombstoned, never hard-deleted, §8).
    expect(await fkDeleteType("game_id")).toBe("c");
    expect(await fkDeleteType("user_id")).toBe("a");
  });

  it("lets the api role write the registry (single writer) and the session role only read it (INV-7)", async () => {
    // API is the single writer: an insert under the api role succeeds.
    await asRole("crossy_api", (c) =>
      c.query(
        "insert into live_activity_tokens (token, user_id, game_id, apns_environment) values ('t-api', $1, $2, 'sandbox') on conflict (token) do nothing",
        [seed.userId, seed.gameId],
      ),
    );
    // Session reads the registry (the emitter's "all tokens for this game" read) but cannot write.
    const { rows } = await asRole("crossy_session", (c) =>
      c.query<{ n: string }>(
        "select count(*)::text as n from live_activity_tokens where game_id = $1",
        [seed.gameId],
      ),
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
    await expect(
      asRole("crossy_session", (c) =>
        c.query(
          "insert into live_activity_tokens (token, user_id, game_id, apns_environment) values ('t-sess', $1, $2, 'sandbox')",
          [seed.userId, seed.gameId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_session", (c) =>
        c.query("delete from live_activity_tokens"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("share_tokens: API single writer, no session grant (0013; INV-7; DESIGN.md §9)", () => {
  it("gives the table its SHARE.md S2 key columns", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='share_tokens'",
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(
      ["created_at", "created_by", "game_id", "revoked_at", "token"].sort(),
    );
  });

  it("cascades on game delete but never on user delete, so a tombstoned minter's row still keyed the id (INV-7, §8)", async () => {
    const fkDeleteType = async (column: string): Promise<string> => {
      const { rows } = await pool.query<{ confdeltype: string }>(
        `select c.confdeltype
           from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.conrelid = 'share_tokens'::regclass and a.attname = $1`,
        [column],
      );
      return rows[0]?.confdeltype ?? "";
    };
    // 'c' cascade on game_id (the token belongs to the game aggregate), 'a' no action on created_by
    // (users are tombstoned, never hard-deleted, §8).
    expect(await fkDeleteType("game_id")).toBe("c");
    expect(await fkDeleteType("created_by")).toBe("a");
  });

  it("pins ONE active token per game via the partial unique index, so the mint is idempotent (SHARE.md S2)", async () => {
    // Two active (non-revoked) tokens for one game collide; a revoked one coexists with a fresh one.
    await asRole("crossy_api", (c) =>
      c.query(
        "insert into share_tokens (token, game_id, created_by) values ('s-active-1', $1, $2)",
        [seed.gameId, seed.userId],
      ),
    );
    await expect(
      asRole("crossy_api", (c) =>
        c.query(
          "insert into share_tokens (token, game_id, created_by) values ('s-active-2', $1, $2)",
          [seed.gameId, seed.userId],
        ),
      ),
    ).rejects.toThrow(/share_tokens_active_game_key/);
    // Revoking the first frees the slot: a second active token is then allowed.
    await asRole("crossy_api", async (c) => {
      await c.query(
        "update share_tokens set revoked_at = now() where token = 's-active-1'",
      );
      await c.query(
        "insert into share_tokens (token, game_id, created_by) values ('s-active-2', $1, $2)",
        [seed.gameId, seed.userId],
      );
    });
  });

  it("lets the api role write share_tokens (single writer) and grants the session role nothing (INV-7)", async () => {
    // API is the single writer: full DML under the api role. Insert already-revoked so it never
    // collides with an active token an earlier test left on the shared seed game (the partial index
    // constrains only non-revoked rows); the grant, not activeness, is what this proves.
    await asRole("crossy_api", (c) =>
      c.query(
        "insert into share_tokens (token, game_id, created_by, revoked_at) values ('s-api', $1, $2, now()) on conflict (token) do nothing",
        [seed.gameId, seed.userId],
      ),
    );
    // The session holds no grant at all: it neither reads nor writes share links.
    await expect(
      asRole("crossy_session", (c) =>
        c.query("select count(*) from share_tokens"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("crossy_session", (c) =>
        c.query(
          "insert into share_tokens (token, game_id, created_by) values ('s-sess', $1, $2)",
          [seed.gameId, seed.userId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("carries the deny-all RLS tripwire despite the authenticated SELECT grant (§7)", async () => {
    const { rows } = await pool.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'share_tokens' and relnamespace = 'public'::regnamespace",
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
    // The `authenticated` role holds a SELECT grant, yet deny-all RLS returns nothing: RLS is the
    // guard, not a missing privilege (the future PostgREST path the tripwire protects against).
    const seen = await asRole("authenticated", (c) =>
      c.query<{ n: string }>("select count(*)::text as n from share_tokens"),
    );
    expect(Number(seen.rows[0]?.n)).toBe(0);
  });
});

describe("deny-all RLS tripwire (DESIGN.md §7)", () => {
  it("enables row-level security with zero policies on every table (§7)", async () => {
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    const secured = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const t of ALL_TABLES) expect(secured.get(t)).toBe(true);
    // No policies exist: deny-all is the absence of any permit rule.
    const { rows: policies } = await pool.query<{ n: string }>(
      "select count(*)::text as n from pg_policies where schemaname = 'public'",
    );
    expect(Number(policies[0]?.n)).toBe(0);
  });

  it("denies a non-service role every row despite holding a SELECT grant (§7)", async () => {
    // `authenticated` is granted SELECT on all seven tables, yet deny-all RLS returns
    // nothing — proving RLS is the guard, not a missing privilege. This is the future
    // Supabase/PostgREST path the tripwire protects against.
    for (const table of ALL_TABLES) {
      const { rows } = await asRole("authenticated", (c) =>
        c.query<{ n: string }>(`select count(*)::text as n from "${table}"`),
      );
      expect(Number(rows[0]?.n)).toBe(0);
    }
    // Contrast: the seeded rows do exist and a BYPASSRLS service role sees them.
    const { rows: seen } = await asRole("crossy_api", (c) =>
      c.query<{ n: string }>("select count(*)::text as n from users"),
    );
    expect(Number(seen[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});

describe("migration pipeline (INV-7; DESIGN.md §9 fresh-clone gate)", () => {
  it("records each migration in the drizzle journal and is idempotent on re-run (INV-7)", async () => {
    const countApplied = async (): Promise<number> => {
      const { rows } = await pool.query<{ n: string }>(
        "select count(*)::text as n from drizzle.__drizzle_migrations",
      );
      return Number(rows[0]?.n ?? "0");
    };
    const afterFirst = await countApplied();
    expect(afterFirst).toBeGreaterThan(0);

    // Re-applying is a no-op: the journal is unchanged and, crucially, re-running the
    // cluster-level role creation does not error (idempotent CREATE ROLE guards).
    await applyMigrations(connectionString);
    expect(await countApplied()).toBe(afterFirst);
  });
});
