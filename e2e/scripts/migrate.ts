// One-off migration runner, spawned under tsx by the smoke harness (so the harness, which
// runs in Playwright's context, never imports the workspace's TypeScript sources). Applies
// the committed migrations to the Testcontainers database passed as argv[2].
import { applyMigrations } from "@crossy/db";

const url = process.argv[2];
if (url === undefined || url === "") {
  console.error("usage: migrate <DATABASE_URL>");
  process.exit(1);
}
await applyMigrations(url);
console.log("migrations applied");
