/**
 * Migration pipeline proof (ROADMAP Wave 0.2c; DESIGN.md §9, §11).
 *
 * Applies the committed Drizzle migrations against a real Postgres in a throwaway
 * container and asserts they land. This defends the fresh-clone reproducibility
 * launch gate (DESIGN.md §9: "migrations apply cleanly on Testcontainers") and the
 * single-writer schema contract (INV-7): one committed migration set is the shared
 * ground both services build on, so it must apply from an empty database with no
 * manual steps.
 *
 * No silent skips (repo rule): the container start is required. If the Docker
 * daemon is unreachable the suite FAILS with a clear message rather than skipping,
 * because a skipped infra test reads as a passing one.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "./migrator";
import { scaffoldMarker } from "./schema";

// Image pinned for determinism; pre-pulled in CI/dev before the run.
const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;

let container: StartedPostgreSqlContainer;
let connectionString: string;
let pool: Pool;

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
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
}, 60_000);

describe("migration pipeline applies against real Postgres (INV-7; DESIGN.md §9 fresh-clone gate)", () => {
  it("applies every committed migration and creates the schema from empty (INV-7)", async () => {
    await applyMigrations(connectionString);

    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = $1",
      ["_scaffold_marker"],
    );
    expect(rows.map((r) => r.table_name)).toContain("_scaffold_marker");

    // The generated DDL yields a table whose shape matches src/schema.ts: an insert
    // through the typed schema round-trips, and the defaulted column populates.
    const db = drizzle(pool, { schema: { scaffoldMarker } });
    await db.insert(scaffoldMarker).values({ id: "wave-0.2c" });
    const marker = await db.select().from(scaffoldMarker);
    expect(marker).toHaveLength(1);
    expect(marker[0]?.id).toBe("wave-0.2c");
    expect(marker[0]?.appliedAt).toBeInstanceOf(Date);
  });

  it("records each migration in the drizzle journal and is idempotent on re-run (INV-7)", async () => {
    const countApplied = async (): Promise<number> => {
      const { rows } = await pool.query<{ n: string }>(
        "select count(*)::text as n from drizzle.__drizzle_migrations",
      );
      return Number(rows[0]?.n ?? "0");
    };

    const afterFirst = await countApplied();
    expect(afterFirst).toBeGreaterThan(0);

    // Re-applying is a no-op: the journal is unchanged, no error thrown.
    await applyMigrations(connectionString);
    expect(await countApplied()).toBe(afterFirst);
  });
});
