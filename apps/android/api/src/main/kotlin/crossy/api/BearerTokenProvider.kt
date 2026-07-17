// The one auth surface the REST client needs. Twin of apps/ios BearerTokenProviding.swift.
//
// AAD-1 (ARCHITECTURE.md): `:api` imports `:protocol` only, so it cannot see the store's
// token port. This interface is `:api`'s own minimal statement of what it needs; the app
// composition root adapts whichever session object it wires (AuthSession here, or an injected
// dev-token provider) into this one. Duplicating the two-method shape is cheaper than bending
// the module graph.

package crossy.api

/**
 * Supplies the current bearer token for an authenticated request. `suspend` because the
 * implementation reads a stored session and may await a refresh; it throws when there is no
 * signed-in session (surfaced at the client as [CrossyApiError.TokenUnavailable]), never
 * papering that over.
 */
public interface BearerTokenProvider {
    /** The token to place in `Authorization: Bearer <token>`, without the scheme prefix. */
    public suspend fun currentToken(): String

    /**
     * Force a token refresh, ignoring any local not-yet-expired shortcut. The REST client
     * calls this after a server 401 on a token the client still thought valid (clock skew, a
     * server-side revocation, a shortened TTL), so the same rejected token is not replayed.
     * Throws when there is no session to refresh or the refresh is terminally refused.
     *
     * The default forwards to [currentToken]: a provider that never refreshes (the injected
     * dev-token path and every fixed-token fixture) simply returns its fixed token again, which
     * is correct because it has nothing to rotate. Only [AuthSession] overrides this.
     */
    public suspend fun refreshedToken(): String = currentToken()
}

/**
 * The dev-token injection path (AAD-3): a bearer provider over a fixed token, the twin of iOS
 * `FixedTokenProvider` and the `?token=` / `CROSSY_IT_*` override. It never refreshes (the
 * default), so a 401 on an injected token surfaces as UNAUTHORIZED rather than looping.
 */
public class InjectedTokenProvider(private val token: String) : BearerTokenProvider {
    override suspend fun currentToken(): String = token
}
