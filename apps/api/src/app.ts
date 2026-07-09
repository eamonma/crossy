// The core API application (DESIGN.md §7): a modular monolith wiring the puzzle-catalog,
// games, and identity modules over one Hono app. `buildApp` takes its dependencies as
// arguments (the auth port, the database, the session base URL, the membership notifier) so a
// test injects the in-memory auth fake and a `crossy_api`-role database with zero network, and
// production injects the Supabase adapter and the live pool. Identity and membership is the
// auth middleware each module installs, plus the account-deletion routes mounted here.
import { Hono } from "hono";
import type { AppDeps, ApiEnv } from "./context";
import { fail } from "./http/errors";
import { puzzleRoutes } from "./puzzles/routes";
import { gameRoutes } from "./games/routes";
import { identityRoutes } from "./identity/routes";

/** Compose the API from its injected dependencies. */
export function buildApp(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // An uncaught handler fault (e.g. a configured vendor deleteUser that threw) returns the
  // typed contract body, so a client always keys on a stable `error` string (PROTOCOL.md §11
  // INTERNAL) rather than Hono's default HTML.
  app.onError((err, c) => {
    console.error(
      "unhandled API error:",
      err instanceof Error ? err.stack : err,
    );
    return fail(c, "INTERNAL", "internal server error");
  });

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
  app.route("/account", identityRoutes(deps));
  return app;
}
