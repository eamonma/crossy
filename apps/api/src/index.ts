// Core API: stateless modular monolith (DESIGN.md §7). Modules: identity and membership,
// puzzle catalog (owns the ingestion ACL), games, archive. The walking-skeleton slice (Wave
// 2.1b) ships POST /puzzles, POST /games, join, GET /games/{id}, and the JIT user upsert.
// Module boundaries are enforced by the root boundary rules. The public entry is `buildApp`;
// the runtime composition root that constructs the live ports and listens is `server.ts`.
export { buildApp } from "./app";
export type { AppDeps, ApiEnv } from "./context";
export { createDb } from "./db/client";
export type { Db } from "./db/client";
