// The one auth surface of this module (apps/ios/ROADMAP.md Phase I1d). Everything about
// where tokens come from (Keychain session, ASWebAuthenticationSession, refresh, the
// issuer-pinned handling in deploy/README.md) is Phase I3a and deliberately absent here.
//
// AD-2 (apps/ios/ARCHITECTURE.md sections 2 and 4): CrossyAPI imports CrossyProtocol and
// Foundation only, so it cannot see CrossyStore's `TokenProvider` port. This protocol is
// CrossyAPI's own minimal statement of what it needs; the app-target composition root
// adapts the two (it wires whichever session object implements the store's port into
// this one). Duplicating the two-line shape is cheaper than bending the module graph.

/// Supplies the current bearer token for an authenticated request. Async because the
/// eventual implementation reads a Keychain-backed session and may await a refresh;
/// throwing because "no signed-in session" is a real outcome the client must surface
/// (as `CrossyAPIError.tokenUnavailable`), not paper over.
///
/// Availability floor: the package manifest declares no platforms (and Phase I1d does
/// not edit it), so the module annotates the async URLSession floor itself; the app
/// target's own minimum is far above it.
@available(macOS 12.0, iOS 15.0, tvOS 15.0, watchOS 8.0, *)
public protocol BearerTokenProviding: Sendable {
    /// The token to place in `Authorization: Bearer <token>`, without the scheme prefix.
    func currentToken() async throws -> String
}
