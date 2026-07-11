// The production Supabase admin adapter for account deletion (DESIGN.md §8). It implements the
// `VendorIdentityPort` the deletion tombstone pairs with: a `service_role` call to the Supabase
// Admin API that removes the vendor identity. It is constructed only in the composition root
// (server.ts) from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; tests inject a recording fake
// instead, so no suite touches a socket.
//
// The target id IS `users.userId`: `Identity.userId` is the JWT `sub` (packages/auth port.ts,
// verify-core.ts), the same UUID Supabase issues and our `users` table mirrors, so
// `DELETE /auth/v1/admin/users/{userId}` addresses the right vendor identity with no translation.
//
// Idempotence (deletion.ts contract): a 404 is success, because the identity is already gone and
// re-running deletion must not fault. Any other non-2xx throws, so the route surfaces INTERNAL
// (PROTOCOL.md §11) rather than reporting a false success.
import type { VendorIdentityPort } from "../context";

export interface SupabaseAdminConfig {
  /** The Supabase project URL (`SUPABASE_URL`), no trailing slash required. */
  readonly url: string;
  /**
   * The `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`). A privileged secret, owner-held and set
   * only in the deploy environment; it never reaches the client and is never logged.
   */
  readonly serviceRoleKey: string;
  /** Injected fetch, for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Build a `VendorIdentityPort` that deletes a Supabase identity via the Admin API:
 * `DELETE {url}/auth/v1/admin/users/{userId}` with the `service_role` bearer and `apikey`
 * headers. A 2xx or a 404 resolves (deletion is idempotent); any other status throws so the
 * route surfaces INTERNAL rather than a false success.
 */
export function createSupabaseAdminIdentity(
  config: SupabaseAdminConfig,
): VendorIdentityPort {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.url.replace(/\/$/, "");
  return {
    async deleteUser(userId: string): Promise<void> {
      const res = await doFetch(
        `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${config.serviceRoleKey}`,
            apikey: config.serviceRoleKey,
          },
        },
      );
      // 404 means the identity is already gone; deletion is idempotent, so that is success.
      if (res.ok || res.status === 404) return;
      throw new Error(
        `supabase admin deleteUser for ${userId} returned HTTP ${res.status}`,
      );
    },
  };
}
