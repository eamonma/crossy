// Wiring types shared across the API modules. `AppDeps` is the composition root's output:
// the ports and adapters a handler needs, injected so tests pass the in-memory auth fake
// and a `crossy_api`-role database while production passes the Supabase adapter and the
// live pool (DESIGN.md §8, §11). `ApiEnv` types Hono's per-request context: the auth
// middleware resolves an `Identity` and every downstream handler reads it type-safely.
import type { AuthPort, Identity } from "@crossy/auth";
import type { Db } from "./db/client";

/**
 * A membership change the API has already committed and now signals to the session service
 * (DESIGN.md §6). The session treats this only as a hint: for a kick or role change it
 * re-reads authoritative membership and the denylist from Postgres, and for an abandon the
 * host was authorized by the API before the call. The body never carries authority, so a
 * leaked bearer's blast radius is a forced re-verification, disconnect, or abandon, never
 * data access (DESIGN.md §6, INV-8).
 */
export type MembershipChange =
  | { readonly change: "kick"; readonly userId: string }
  | { readonly change: "role"; readonly userId: string }
  | { readonly change: "abandon"; readonly by: string };

/**
 * The port the API calls to notify the session service that a game's membership changed
 * (`POST /internal/games/{id}/membership-changed`, DESIGN.md §6). Production posts over the
 * provider's private network with the static internal bearer; tests inject a recording fake,
 * so no suite touches a socket. Absent from `AppDeps` means a no-op notifier (the local
 * denylist write stays authoritative and a kicked user is still refused at reconnect).
 */
export interface MembershipNotifier {
  membershipChanged(gameId: string, change: MembershipChange): Promise<void>;
}

/**
 * The vendor identity mutation the API's identity module owns (DESIGN.md §8; boundary
 * recorded in `packages/auth`). `deleteUser` removes the Supabase identity; it is a
 * `service_role` network call in production and a fake in tests, kept behind this port so
 * no test touches the network. It lives here, not on the per-request `AuthPort`, because it
 * is a rare admin mutation paired with the API-owned `users` tombstone write (single writer,
 * INV-7). The real Supabase admin adapter is M3b; M3a ships the port and a fake.
 */
export interface VendorIdentityPort {
  deleteUser(userId: string): Promise<void>;
}

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
  /**
   * Notifier for membership changes (kick, role upgrade, abandon). Omit to disable the
   * cross-service signal: the DB write stays authoritative and a kicked user is still
   * refused at reconnect via the denylist, but a live socket is not disconnected until the
   * next connect. The composition root sets it when the internal endpoint is configured.
   */
  readonly membershipNotifier?: MembershipNotifier;
  /**
   * Vendor identity admin port for account deletion. Omit to skip the vendor call (the
   * API-owned tombstone still runs); the composition root sets the real adapter at M3b.
   */
  readonly vendorIdentity?: VendorIdentityPort;
}

/** Hono environment: the request-scoped variables the auth middleware populates. */
export interface ApiEnv {
  Variables: {
    identity: Identity;
  };
}
