// The magic-link callback's digest (roadmap I3b). A Supabase email magic link lands
// on the app as a Universal Link (applinks:crossy.party, AASA /auth/confirm*): the
// path is `/auth/confirm` and the query carries `token_hash` and `type`, the two
// values `POST {auth}/verify` needs to complete the link (SupabaseAuthClient
// verifyEmailLink). This digests that one shape to those two values, or nil for any
// other URL, so CrossyApp's browsing-activity handler can tell a magic link from a
// `/game/<id>` invite and route each to its own seam. The parser stays here beside
// InviteScan (the deep-link parsers live in CrossyUI, tested by SwiftPM) rather than
// in the Xcode-only app target.

import Foundation

/// The two values a magic-link callback carries, ready for `completeMagicLink`.
public struct AuthConfirmLink: Equatable, Sendable {
    /// The one-time hash the verify grant exchanges for a session.
    public let tokenHash: String
    /// The link's own type, passed to verify verbatim (`magiclink`, `email`,
    /// `recovery`, ...); GoTrue owns the vocabulary, so nothing here validates it
    /// beyond non-empty.
    public let type: String

    public init(tokenHash: String, type: String) {
        self.tokenHash = tokenHash
        self.type = type
    }
}

public enum AuthConfirm {
    /// The magic-link values a browsing-activity URL carries, or nil. Matches only the
    /// `/auth/confirm` path with BOTH `token_hash` and `type` present and non-empty; any
    /// other path (a `/game/<id>` invite, a bare open) or a half-formed query digests to
    /// nil, so the caller falls through to the invite parser or ignores the link. The
    /// values pass through verbatim (they are opaque server tokens, not normalized like
    /// an invite code, INV-1 has no bearing here).
    public static func link(fromURL url: URL) -> AuthConfirmLink? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.path == "/auth/confirm"
        else { return nil }
        let items = components.queryItems ?? []
        guard let tokenHash = value(of: "token_hash", in: items), !tokenHash.isEmpty,
            let type = value(of: "type", in: items), !type.isEmpty
        else { return nil }
        return AuthConfirmLink(tokenHash: tokenHash, type: type)
    }

    private static func value(of name: String, in items: [URLQueryItem]) -> String? {
        items.first { $0.name == name }?.value
    }
}
