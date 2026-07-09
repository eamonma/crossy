// The production membership notifier (DESIGN.md §6): an HTTP client that POSTs to the session
// service's private internal endpoint with the static bearer. It is constructed only in the
// composition root (server.ts); tests inject a recording fake instead, so no suite touches a
// socket. A non-2xx response throws, so a caller that requires delivery (the abandon route)
// surfaces the fault rather than reporting a false success.
//
// The bearer's blast radius stays a forced re-verification, disconnect, or abandon, never data
// access (DESIGN.md §6): the endpoint re-reads authoritative state from Postgres and treats the
// body only as a hint.
import type { MembershipChange, MembershipNotifier } from "../context";

export interface HttpNotifierConfig {
  /** Session service base URL on the provider's private network, no trailing slash. */
  readonly baseUrl: string;
  /** The static internal bearer, shared with the session service (INTERNAL_BEARER_TOKEN). */
  readonly bearer: string;
  /** Injected fetch, for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/** Build an HTTP `MembershipNotifier` that calls `POST /internal/games/{id}/membership-changed`. */
export function createHttpMembershipNotifier(
  config: HttpNotifierConfig,
): MembershipNotifier {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/$/, "");
  return {
    async membershipChanged(
      gameId: string,
      change: MembershipChange,
    ): Promise<void> {
      const res = await doFetch(
        `${base}/internal/games/${gameId}/membership-changed`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.bearer}`,
          },
          body: JSON.stringify(change),
        },
      );
      if (!res.ok) {
        throw new Error(
          `session membership-changed for ${gameId} returned HTTP ${res.status}`,
        );
      }
    },
  };
}
