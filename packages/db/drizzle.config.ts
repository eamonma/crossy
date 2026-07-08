import { defineConfig } from "drizzle-kit";

// Drizzle Kit config for the shared schema package (DESIGN.md §9). `generate` is
// offline: it diffs src/schema.ts against the committed snapshot and writes SQL to
// ./drizzle, which is checked in and applied by the migrator in CI. No DATABASE_URL
// is read here; applying migrations is the migrator's job (see src/migrator.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
