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

// The seven real tables (DESIGN.md §9), grouped by their single writer (INV-7).
const API_TABLES = [
  "users",
  "puzzles",
  "games",
  "memberships",
  "game_denylist",
] as const;
const SESSION_TABLES = ["game_state", "cell_events"] as const;
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
  it("creates all seven tables and drops the scaffold marker in the contract phase (INV-7)", async () => {
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
    // tombstoned user's id survives as attribution and INV-1 replay holds.
    expect(await fkDeleteType("cell_events", "user_id")).toBe("a");
    expect(await fkDeleteType("memberships", "user_id")).toBe("a");
    expect(await fkDeleteType("games", "created_by")).toBe("a");
    // game_id belongs to the game aggregate: cascade is the composition semantics.
    expect(await fkDeleteType("cell_events", "game_id")).toBe("c");
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

  it("limits the session role to users.display_name only, never avatar or is_anonymous (§9, INV-6-adjacent)", async () => {
    // Allowed: the display-name projection (user_id is the join key, not PII).
    const { rows } = await asRole("crossy_session", (c) =>
      c.query<{ display_name: string | null }>(
        "select user_id, display_name from users",
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Denied: any column outside the grant, and the whole-row projection.
    await expect(
      asRole("crossy_session", (c) => c.query("select avatar from users")),
    ).rejects.toThrow(/permission denied/i);
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
