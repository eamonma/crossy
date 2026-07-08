// Runtime composition root (DESIGN.md §7, §8, §11). This is the ONLY place the live ports are
// constructed: the Supabase auth adapter behind config and the `pg` pool from `DATABASE_URL`.
// Tests never import this file; they inject the in-memory auth fake and a role-scoped pool, so
// the suite makes zero network calls. All configuration is read here (12-factor) and passed in.
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Pool } from "pg";
import { createSupabaseAuthPort } from "@crossy/auth";
import type { SupabaseAuthConfig } from "@crossy/auth";
import { buildApp } from "./app";
import { createDb } from "./db/client";

// The JWK Set shape the auth port expects, named without importing `jose` (a service never
// imports `jose`; only the auth package does). Deriving it from the port's own config type
// keeps this file honest about the boundary while satisfying the compiler.
type Jwks = Awaited<ReturnType<SupabaseAuthConfig["fetchJwks"]>>;

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

  // The Supabase adapter verifies tokens locally against a background-refreshed JWKS; the
  // service supplies the real `fetch`, the adapter never fetches on the verify path (SP2).
  const authPort = await createSupabaseAuthPort({
    issuer: required("SUPABASE_ISSUER"),
    fetchJwks: async (jwksUri) => {
      const response = await fetch(jwksUri);
      return (await response.json()) as Jwks;
    },
  });
  authPort.start();

  const corsOrigin = process.env["CORS_ORIGIN"];
  const app = buildApp({
    db,
    authPort,
    sessionWsBase: required("SESSION_WS_BASE"),
    ...(corsOrigin !== undefined && corsOrigin !== "" ? { corsOrigin } : {}),
  });

  const port = Number(process.env["PORT"] ?? "8080");
  serve({ fetch: app.fetch, port });
  console.log(`core API listening on :${port}`);
}

// Start only when run directly, so importing the module has no side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
