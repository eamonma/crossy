// The authenticated REST seam: resolve a bearer, issue the request, and recover from a
// server 401 with exactly one reactive refresh-and-retry. This is the web twin of iOS's
// CrossyAPIClient.perform: the retry policy lives here in the transport, in one place,
// never smeared across the callers, and it reaches the identity port only through
// Bearer.refresh. The REST fetchers (ui/homeData, ui/roomAdmin) issue every call through
// it; the WebSocket path has its own token source (it resolves once to open a socket, a
// different concern) and does not ride this.

/** Resolve an access token, or null when signed out. The identity port's shape. */
export type TokenSource = () => Promise<string | null>;

/**
 * A REST bearer: resolve the current token (the identity port refreshes it near expiry),
 * and force a rotation after a server 401 on a token the client still thought valid.
 * `refresh` returns null when there is no session or the rotation fails (the caller then
 * surfaces the original 401 rather than looping). Built once from the identity port
 * (ui/useResource useBearer); the `?token=` dogfood override supplies a fixed token and a
 * no-op refresh, so a stale override 401 surfaces instead of retrying pointlessly.
 */
export interface Bearer {
  getToken: TokenSource;
  refresh: TokenSource;
}

/** Merge the Authorization header onto an init, preserving any headers and body it carries. */
function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  return {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      authorization: `Bearer ${token}`,
    },
  };
}

/**
 * One authenticated request with a single reactive refresh-and-retry on a 401. Resolve the
 * bearer and issue the request; if the server answers 401 (clock skew, a server-side
 * revocation, a shortened TTL), force one refresh through the port and replay the request
 * once. Only 401 retries, at most once: every other status, and a 401 a forced refresh
 * cannot fix (refresh returns null, or the replay 401s again), returns as-is for the caller
 * to interpret. A signed-out bearer (null token) throws before any fetch, the same guard
 * the hand-rolled authHeaders had. Bodies are strings here, so replaying the same init is
 * safe.
 */
export async function authedFetch(
  bearer: Bearer,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await bearer.getToken();
  if (token === null) throw new Error("signed out: no bearer to send");
  const first = await fetch(input, withBearer(init, token));
  if (first.status !== 401) return first;

  const refreshed = await bearer.refresh();
  if (refreshed === null) return first;
  return fetch(input, withBearer(init, refreshed));
}
