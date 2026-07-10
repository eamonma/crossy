// Apply the committed packages/db migrations to hosted Postgres. Run with tsx from the repo
// root: `MIGRATION_DATABASE_URL=<direct dsn> pnpm exec tsx deploy/migrate.ts`.
//
// This reuses the ONE shared applier (@crossy/db applyMigrations), the same code path CI,
// the Testcontainers test, and the local dev-stack use, so hosted and local never drift.
//
// Two hard requirements for the hosted run:
//   1. Never the TRANSACTION pooler (port 6543): migrations take advisory locks and run DDL,
//      and transaction pooling breaks both (migrator.ts says the same). The DIRECT connection
//      and the SESSION pooler (both port 5432) each hold one real backend per session, so
//      both are fine. From an IPv4-only environment (GitHub Actions runners) the session
//      pooler is the only reachable option: the direct host is IPv6-only (deploy/README.md).
//   2. Connect as a privileged role (Supabase `postgres`). The migration CREATEs the
//      crossy_api / crossy_session roles, sets grants, and enables RLS, which a service role
//      cannot do. See deploy/README.md for the Supabase caveat on ALTER ROLE ... BYPASSRLS.
//
// It CANNOT run until the Supabase project exists and MIGRATION_DATABASE_URL points at it.
import { applyMigrations } from "@crossy/db";

const url = process.env["MIGRATION_DATABASE_URL"];
if (url === undefined || url === "") {
  console.error(
    "error: set MIGRATION_DATABASE_URL to a privileged hosted Postgres DSN: the DIRECT\n" +
      "       connection or the SESSION pooler, both port 5432 (Supabase Dashboard >\n" +
      "       Connect). See deploy/README.md.",
  );
  process.exit(1);
}

if (url.includes(":6543")) {
  console.error(
    "error: MIGRATION_DATABASE_URL points at the TRANSACTION pooler (port 6543), which\n" +
      "       breaks advisory locks and DDL. Use the DIRECT connection or the SESSION\n" +
      "       pooler (both port 5432).",
  );
  process.exit(1);
}

await applyMigrations(url);
console.log("migrations applied to hosted Postgres");
