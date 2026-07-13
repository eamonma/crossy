// The room's shareable invite URL (the share card's payload: the link the copy
// row carries, the QR encodes, and the system share sheet sends). The canonical
// short form the web app emits: `https://crossy.ing/{CODE}`, the invite code as
// the sole capability a new visitor needs to self-join. No gameId, no query, no
// name: a member gets the room from GET /games/{id}, and no receiving surface
// reads anything but the code off the URL (InviteScan digests only the code). A
// nil code means there is nothing to share yet, exactly as the web popover's
// fallback message reads.

import Foundation

public enum ShareInvite {
    /// crossy.ing is the short-link host the web app emits and an app associated
    /// domain (Crossy.entitlements `applinks:crossy.ing`), the host Universal
    /// Links resolve the short form against.
    public static let origin = "https://crossy.ing"

    /// The shareable URL for a room, or nil when there is no code to share yet
    /// (a room the local client has not yet received `inviteCode` for). The
    /// `gameId` is retained for call-site symmetry with the room model; the
    /// short link carries only the code.
    public static func url(gameId: String, code: String?) -> URL? {
        guard let code, !code.isEmpty else { return nil }
        return URL(string: "\(origin)/\(code)")
    }
}
