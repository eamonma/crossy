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
import { meRoutes } from "./identity/me";
import { wellKnownRoutes } from "./well-known/routes";
import { unfurlRoutes } from "./games/unfurl";
import { inviteHostMiddleware } from "./invite-host/routes";

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

  // The invite host (PROTOCOL.md §12 "Invite links"), first so it owns a short-link request end
  // to end before CORS or any core route sees it. Host-scoped: a no-op pass-through unless the
  // request hostname matches the configured `inviteHost` (and a `webOrigin` is set to redirect
  // to), so the core API host is untouched. Off in tests and any deploy that leaves it unset.
  app.use("*", inviteHostMiddleware(deps));

  // CORS for the cross-origin SPA (DESIGN.md §7 link-preview aside; the SPA is a separate
  // origin). Off unless a corsOrigin is injected, so the in-process test suite is
  // unaffected. A GET carrying Authorization triggers a preflight, so OPTIONS is answered.
  const corsOrigin = deps.corsOrigin;
  if (corsOrigin !== undefined) {
    app.use("*", async (c, next) => {
      c.header("access-control-allow-origin", corsOrigin);
      c.header("access-control-allow-headers", "authorization, content-type");
      // Every method any route serves must appear here or its preflight fails; PATCH covers
      // PATCH /me (the display-name write).
      c.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
      c.header("vary", "origin");
      if (c.req.method === "OPTIONS") return c.body(null, 204);
      await next();
    });
  }

  app.get("/health", (c) => c.json({ ok: true }));
  // Public, unauthenticated: Apple's CDN fetches the AASA anonymously (SP-i4).
  app.route("/.well-known", wellKnownRoutes(deps));
  // Public, unauthenticated: link unfurlers fetch invite links anonymously (PROTOCOL.md §12).
  app.route("/g", unfurlRoutes(deps));
  app.route("/puzzles", puzzleRoutes(deps));
  app.route("/games", gameRoutes(deps));
  app.route("/account", identityRoutes(deps));
  // Self display identity (DESIGN.md name-onboarding, PROTOCOL.md §12): the caller's own name
  // read + write, in the identity module for cohesion. Works before any game exists.
  app.route("/me", meRoutes(deps));
  return app;
}
