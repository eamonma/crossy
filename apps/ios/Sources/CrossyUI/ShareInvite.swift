// The room's shareable invite URL (the share card's payload: the link the copy
// row carries, the QR encodes, and the system share sheet sends). A pure Swift
// port of apps/web/src/domain/invite.ts's `buildShareUrl`: the path-route form
// the web router serves (`/game/{gameId}?code=...`), the invite code as the
// capability a new visitor needs to self-join. The room name is not appended:
// a member gets it from GET /games/{id}, and no receiving surface reads it off
// the URL (InviteScan digests only the code). A nil code means there is nothing
// to share yet, exactly as the web popover's fallback message reads.

import Foundation

public enum ShareInvite {
    /// crossy.party is the app's associated domain (Crossy.entitlements
    /// `applinks:crossy.party`), the same host Universal Links resolve against.
    public static let origin = "https://crossy.party"

    /// The shareable URL for a room, or nil when there is no code to share yet
    /// (a room the local client has not yet received `inviteCode` for).
    public static func url(gameId: String, code: String?) -> URL? {
        guard let code, !code.isEmpty else { return nil }
        var components = URLComponents(string: "\(origin)/game/\(gameId)")
        components?.queryItems = [URLQueryItem(name: "code", value: code)]
        return components?.url
    }
}
