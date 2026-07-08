// Shared DB package (DESIGN.md §9): the schema is one contract both services build
// against — the API writes users/puzzles/games/memberships/game_denylist, the
// session service writes game_state/cell_events, and single-writer-per-table (INV-7)
// governs writes only. Migrations are committed here and applied by `applyMigrations`.
// The seven real tables arrive in Wave 1.1f; today this is the scaffold marker.
export * as schema from "./schema";
export { applyMigrations, migrationsFolder } from "./migrator";
