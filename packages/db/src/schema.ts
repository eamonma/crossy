import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Scaffold-only marker table (Wave 0.2c). The seven real tables (DESIGN.md §9)
 * land in Wave 1.1f; this table exists only so the first migration has real DDL to
 * apply, proving the Drizzle Kit generate -> commit -> migrator-apply pipeline end
 * to end against Testcontainers Postgres. Wave 1.1f drops it in its own migration
 * (expand/contract, DESIGN.md §9) and defines the real schema here.
 *
 * Named with a leading underscore so it cannot collide with a real domain table.
 */
export const scaffoldMarker = pgTable("_scaffold_marker", {
  id: text("id").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
