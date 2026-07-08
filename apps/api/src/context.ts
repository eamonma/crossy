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
}

/** Hono environment: the request-scoped variables the auth middleware populates. */
export interface ApiEnv {
  Variables: {
    identity: Identity;
  };
}
