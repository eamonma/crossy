// The API's database handle (DESIGN.md §9). `packages/db` is a pure schema contract with
// no query surface, so the app owns query construction: it builds a Drizzle client over a
// `pg` pool and imports the shared schema. Single-writer-per-table (INV-7) is enforced by
// the least-privilege `crossy_api` Postgres role the migration grants, not by this type;
// the app connects with a login role that carries `crossy_api`'s privileges (see the
// migration note), so a stray write to a session-owned table fails at the grant layer.
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { schema } from "@crossy/db";

/** The typed Drizzle database the API modules query against. */
export type Db = NodePgDatabase<typeof schema>;

/** The transaction handle inside `db.transaction(async (tx) => ...)`, for helpers that take one. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Build the API's Drizzle client over an already-configured `pg` pool. */
export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
