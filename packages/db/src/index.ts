// Shared DB package (DESIGN.md §9): the schema is one contract both services build
// against — the API writes users/puzzles/games/memberships/game_denylist, the
// session service writes game_state/cell_events, and single-writer-per-table (INV-7)
// governs writes only, enforced by the least-privilege Postgres roles the migration
// creates. Migrations are committed here and applied by `applyMigrations`. This
// package holds no business logic and no service code: it is a pure schema contract.
export * as schema from "./schema";
export { applyMigrations, migrationsFolder } from "./migrator";
