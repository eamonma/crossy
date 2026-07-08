// The core API application (DESIGN.md §7): a modular monolith wiring the puzzle-catalog and
// games modules over one Hono app. `buildApp` takes its dependencies as arguments (the auth
// port, the database, the session base URL) so a test injects the in-memory auth fake and a
// `crossy_api`-role database with zero network, and production injects the Supabase adapter
// and the live pool. Identity and membership is not a mounted module here; it is the auth
// middleware each module installs. Modules mount as their walking-skeleton slices land.
import { Hono } from "hono";
import type { AppDeps, ApiEnv } from "./context";

/** Compose the API from its injected dependencies. */
export function buildApp(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.get("/health", (c) =>
    c.json({ ok: true, sessionConfigured: deps.sessionWsBase.length > 0 }),
  );
  return app;
}
