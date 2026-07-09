// Apply the committed packages/db migrations to hosted Postgres. Run with tsx from the repo
// root: `MIGRATION_DATABASE_URL=<direct dsn> pnpm exec tsx deploy/migrate.ts`.
//
// This reuses the ONE shared applier (@crossy/db applyMigrations), the same code path CI,
// the Testcontainers test, and the local dev-stack use, so hosted and local never drift.
//
// Two hard requirements for the hosted run:
//   1. Use the DIRECT connection (Supabase "Direct connection", port 5432), never the
//      transaction pooler. Migrations take advisory locks and run DDL; a transaction pooler
//      breaks both (migrator.ts says the same).
//   2. Connect as a privileged role (Supabase `postgres`). The migration CREATEs the
//      crossy_api / crossy_session roles, sets grants, and enables RLS, which a service role
//      cannot do. See deploy/README.md for the Supabase caveat on ALTER ROLE ... BYPASSRLS.
//
// It CANNOT run until the Supabase project exists and MIGRATION_DATABASE_URL points at it.
import { applyMigrations } from "@crossy/db";

const url = process.env["MIGRATION_DATABASE_URL"];
if (url === undefined || url === "") {
  console.error(
    "error: set MIGRATION_DATABASE_URL to the hosted Postgres DIRECT connection string\n" +
      "       (Supabase Dashboard > Project Settings > Database > Connection string >\n" +
      "        Direct connection). This is a privileged, one-time step; see deploy/README.md.",
  );
  process.exit(1);
}

if (url.includes("pooler") || url.includes(":6543")) {
  console.error(
    "error: MIGRATION_DATABASE_URL looks like a pooled connection. Migrations must use the\n" +
      "       DIRECT connection (port 5432): pooling breaks advisory locks and DDL.",
  );
  process.exit(1);
}

await applyMigrations(url);
console.log("migrations applied to hosted Postgres");
