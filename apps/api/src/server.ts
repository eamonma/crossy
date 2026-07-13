// Runtime composition root (DESIGN.md §7, §8, §11). This is the ONLY place the live ports are
// constructed: the JWKS auth adapter behind config and the `pg` pool from `DATABASE_URL`.
// Tests never import this file; they inject the in-memory auth fake and a role-scoped pool, so
// the suite makes zero network calls. All configuration is read here (12-factor) and passed in.
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Pool } from "pg";
import { createJwksAuthPort } from "@crossy/auth";
import type { JwksAuthConfig } from "@crossy/auth";
import {
  createNoopAnalytics,
  createPosthogAnalytics,
  readPosthogConfig,
} from "./analytics/analytics";
import type { Analytics } from "./analytics/analytics";
import { buildApp } from "./app";
import { createDb } from "./db/client";
import { createHttpMembershipNotifier } from "./identity/http-notifier";
import { createSupabaseAdminIdentity } from "./identity/supabase-admin";

// The JWK Set shape the auth port expects, named without importing `jose` (a service never
// imports `jose`; only the auth package does). Deriving it from the port's own config type
// keeps this file honest about the boundary while satisfying the compiler.
type Jwks = Awaited<ReturnType<JwksAuthConfig["fetchJwks"]>>;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: required("DATABASE_URL") });
  // A pool with no error listener crashes the process when the DB drops an idle
  // connection (restart, network blip). Log and let the pool reconnect on the next query.
  pool.on("error", (err) => console.error("pg pool error:", err.message));
  const db = createDb(pool);

  // The JWKS adapter verifies tokens locally against a background-refreshed JWKS; the
  // service supplies the real `fetch`, the adapter never fetches on the verify path (SP2).
  const authPort = await createJwksAuthPort({
    issuer: required("SUPABASE_ISSUER"),
    fetchJwks: async (jwksUri) => {
      const response = await fetch(jwksUri);
      return (await response.json()) as Jwks;
    },
  });
  authPort.start();

  const corsOrigin = process.env["CORS_ORIGIN"];

  // Apple app identifier for the AASA file (apps/ios/ROADMAP.md SP-i4), `<TeamID>.<bundleID>`.
  // Optional and owner-held: until the owner creates the Apple app record and sets it, the
  // route fails closed with 404 and universal links stay dark.
  const appleAppId = process.env["APPLE_APP_ID"];

  // The invite host for short share links (PROTOCOL.md §12 "Invite links"), e.g. crossy.ing. It is
  // an owner-held domain pointed at this same service; when set, requests on that host are served
  // as the short-link surface. The redirect target is the web origin: its own WEB_ORIGIN, else
  // CORS_ORIGIN, since the SPA origin and the web origin coincide. INVITE_HOST without a resolvable
  // web origin leaves the host disabled (the middleware needs somewhere to send a browser).
  const inviteHost = process.env["INVITE_HOST"];
  const webOrigin = process.env["WEB_ORIGIN"] ?? corsOrigin;
  if (
    inviteHost !== undefined &&
    inviteHost !== "" &&
    (webOrigin === undefined || webOrigin === "")
  ) {
    console.warn(
      "INVITE_HOST set but no WEB_ORIGIN or CORS_ORIGIN: the invite host is disabled " +
        "(it needs a web origin to redirect a browser to)",
    );
  }

  // The membership notifier (DESIGN.md §6). Configured only when both the session's private
  // internal base URL and the shared static bearer are present; otherwise it is omitted and
  // membership changes stay authoritative in Postgres (a kicked user is still refused at
  // reconnect via the denylist), with the live disconnect and abandon deferred to M3b deploy.
  const internalBase = process.env["SESSION_INTERNAL_BASE"];
  const internalBearer = process.env["INTERNAL_BEARER_TOKEN"];
  const membershipNotifier =
    internalBase !== undefined &&
    internalBase !== "" &&
    internalBearer !== undefined &&
    internalBearer !== ""
      ? createHttpMembershipNotifier({
          baseUrl: internalBase,
          bearer: internalBearer,
        })
      : undefined;
  if (membershipNotifier === undefined) {
    console.warn(
      "membership notifier disabled: set SESSION_INTERNAL_BASE and INTERNAL_BEARER_TOKEN " +
        "to enable live kick/abandon signaling to the session service",
    );
  }

  // The vendor identity admin port for account deletion (DESIGN.md §8). Configured only when both
  // the Supabase URL and the service_role key are present; otherwise it is omitted and deletion
  // still runs the API-owned tombstone (display_name/avatar scrubbed, opaque user_id kept) but
  // skips the vendor call, exactly the M3a behavior. The service_role key is a privileged,
  // owner-held secret set only in the deploy environment.
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const vendorIdentity =
    supabaseUrl !== undefined &&
    supabaseUrl !== "" &&
    supabaseServiceRoleKey !== undefined &&
    supabaseServiceRoleKey !== ""
      ? createSupabaseAdminIdentity({
          url: supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
        })
      : undefined;
  if (vendorIdentity === undefined) {
    console.warn(
      "vendor identity deletion disabled: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "to remove the Supabase identity on account deletion (the tombstone still runs)",
    );
  }

  // Product analytics (posthog-node behind the src/analytics port). Absent POSTHOG_TOKEN
  // selects the noop and the SDK is never constructed, so dev machines and CI capture
  // nothing and make zero analytics network calls. POSTHOG_HOST defaults to the US cloud.
  const posthogConfig = readPosthogConfig(process.env);
  const analytics: Analytics =
    posthogConfig === null
      ? createNoopAnalytics()
      : createPosthogAnalytics(posthogConfig);
  if (posthogConfig === null) {
    console.warn("POSTHOG_TOKEN unset: product analytics is a no-op");
  }

  const app = buildApp({
    db,
    authPort,
    sessionWsBase: required("SESSION_WS_BASE"),
    // Every new full account gets a solo starter game on first sight (owner decision).
    starterSeedEnabled: true,
    analytics,
    ...(corsOrigin !== undefined && corsOrigin !== "" ? { corsOrigin } : {}),
    ...(appleAppId !== undefined && appleAppId !== "" ? { appleAppId } : {}),
    ...(inviteHost !== undefined && inviteHost !== "" ? { inviteHost } : {}),
    ...(webOrigin !== undefined && webOrigin !== "" ? { webOrigin } : {}),
    ...(membershipNotifier !== undefined ? { membershipNotifier } : {}),
    ...(vendorIdentity !== undefined ? { vendorIdentity } : {}),
  });

  const port = Number(process.env["PORT"] ?? "8080");
  const server = serve({ fetch: app.fetch, port });
  console.log(`core API listening on :${port}`);

  // Graceful shutdown: stop accepting connections, flush the analytics buffer, stop the
  // ports. The analytics client buffers events in memory, so exiting on the bare signal
  // (the previous behavior) would drop the unflushed tail.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: shutting down`);
    void (async () => {
      try {
        server.close();
        await analytics.shutdown();
        authPort.stop();
        await pool.end();
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Start only when run directly, so importing the module has no side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
