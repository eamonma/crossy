import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the committed SQL migrations (Drizzle Kit `out`). */
export const migrationsFolder = resolve(here, "../drizzle");

/**
 * Apply every committed migration to the database at `connectionString`, in order,
 * exactly once (Drizzle records applied migrations in `drizzle.__drizzle_migrations`
 * and is idempotent on re-run). One shared applier keeps CI, deploy, and the
 * Testcontainers test on the same code path. Uses the direct connection; migrations
 * take advisory locks and run DDL, so they must not go through a transaction pooler.
 */
export async function applyMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
