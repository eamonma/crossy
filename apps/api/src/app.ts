// The core API application (DESIGN.md §7): a modular monolith wiring the puzzle-catalog and
// games modules over one Hono app. `buildApp` takes its dependencies as arguments (the auth
// port, the database, the session base URL) so a test injects the in-memory auth fake and a
// `crossy_api`-role database with zero network, and production injects the Supabase adapter
// and the live pool. Identity and membership is not a mounted module here; it is the auth
// middleware each module installs.
import { Hono } from "hono";
import type { AppDeps, ApiEnv } from "./context";
import { puzzleRoutes } from "./puzzles/routes";
import { gameRoutes } from "./games/routes";

/** Compose the API from its injected dependencies. */
export function buildApp(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // CORS for the cross-origin SPA (DESIGN.md §7 link-preview aside; the SPA is a separate
  // origin). Off unless a corsOrigin is injected, so the in-process test suite is
  // unaffected. A GET carrying Authorization triggers a preflight, so OPTIONS is answered.
  const corsOrigin = deps.corsOrigin;
  if (corsOrigin !== undefined) {
    app.use("*", async (c, next) => {
      c.header("access-control-allow-origin", corsOrigin);
      c.header("access-control-allow-headers", "authorization, content-type");
      c.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
      c.header("vary", "origin");
      if (c.req.method === "OPTIONS") return c.body(null, 204);
      await next();
    });
  }

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/puzzles", puzzleRoutes(deps));
  app.route("/games", gameRoutes(deps));
  return app;
}
