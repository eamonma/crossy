// Runtime composition root for the session service (DESIGN.md §3, §6, §8). This is the
// ONLY place the live ports are constructed: the Supabase auth adapter behind config and
// the `pg` pool from DATABASE_URL. Tests never import this file; the integration suite
// injects the in-memory auth fake and a role-scoped pool, so it makes zero network calls.
// All configuration is read here (12-factor) and passed in.
//
// On SIGTERM (and SIGINT) it drains: stop accepting connections, flush every live actor,
// close all sockets with 1001, then exit. Graceful shutdown loses nothing (INV-5).

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createSupabaseAuthPort } from "@crossy/auth";
import type { SupabaseAuthConfig } from "@crossy/auth";
import { createSessionServer } from "./server";

// The JWK Set shape the auth port expects, named without importing `jose` (a service never
// imports `jose`; only the auth package does).
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

  // The static internal bearer (DESIGN.md §6), injected via env, never hardcoded. When unset
  // the `/internal` endpoint is disabled (503) and membership changes are enforced only at
  // reconnect via the denylist; a deploy that wants live kick/abandon signaling must set it.
  const internalBearer = process.env["INTERNAL_BEARER_TOKEN"];
  if (internalBearer === undefined || internalBearer === "") {
    console.warn(
      "INTERNAL_BEARER_TOKEN unset: /internal/games/{id}/membership-changed is disabled (503)",
    );
  }

  const server = await createSessionServer({
    authPort,
    pool,
    host: process.env["HOST"] ?? "0.0.0.0",
    port: Number(process.env["PORT"] ?? "8081"),
    ...(internalBearer !== undefined && internalBearer !== ""
      ? { internalBearer }
      : {}),
  });
  console.log(`session service listening on ${server.url}`);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: draining`);
    void (async () => {
      try {
        await server.drain();
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
