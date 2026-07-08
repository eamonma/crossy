// Wiring types shared across the API modules. `AppDeps` is the composition root's output:
// the ports and adapters a handler needs, injected so tests pass the in-memory auth fake
// and a `crossy_api`-role database while production passes the Supabase adapter and the
// live pool (DESIGN.md §8, §11). `ApiEnv` types Hono's per-request context: the auth
// middleware resolves an `Identity` and every downstream handler reads it type-safely.
import type { AuthPort, Identity } from "@crossy/auth";
import type { Db } from "./db/client";

/** The injected dependencies every route closure needs. */
export interface AppDeps {
  readonly db: Db;
  readonly authPort: AuthPort;
  /** Base URL for the session service WebSocket, used to build a game's `ws` endpoint. */
  readonly sessionWsBase: string;
  /**
   * Allowed browser origin for CORS, or omit to disable. The SPA and the API sit on
   * different origins in the two-service deploy (static host vs Railway), so the browser
   * needs an Access-Control-Allow-Origin to call REST. Off in tests (in-process, no
   * browser); the composition root sets it from CORS_ORIGIN. `*` allows any origin.
   */
  readonly corsOrigin?: string;
}

/** Hono environment: the request-scoped variables the auth middleware populates. */
export interface ApiEnv {
  Variables: {
    identity: Identity;
  };
}
