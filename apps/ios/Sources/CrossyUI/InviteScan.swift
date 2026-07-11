// The scanned invite's digest (the join panel, DESIGN.md §4 arrival notes). A QR
// in the wild carries one of three shapes: the web share link the projector shows
// (`/game/{id}?code=...`, apps/web domain/invite buildShareUrl), the §12 unfurl
// link (`/g/{code}`), or a bare read-aloud code. All three digest to the code —
// the only thing `POST /games/join` wants (PROTOCOL.md §12) — or nil when the
// payload names no room. Casing rides InviteCodeEntry (bytewise ASCII, INV-1);
// the server still owns lookup normalization.

import Foundation

public enum InviteScan {
    /// The invite code a scanned payload carries, or nil. Strict on bare codes:
    /// after dropping cosmetic separators (spaces, hyphens) the whole payload must
    /// BE the code — sanitize alone would happily fish eight valid glyphs out of
    /// arbitrary prose and join a room nobody named.
    public static func code(fromPayload payload: String) -> String? {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let stripped = trimmed.unicodeScalars.filter { $0 != " " && $0 != "-" }
        let sanitized = InviteCodeEntry.sanitize(trimmed)
        if InviteCodeEntry.isComplete(sanitized), stripped.count == InviteCodeEntry.length {
            return sanitized
        }

        guard let components = URLComponents(string: trimmed) else { return nil }

        // The share-link form: any URL whose query names a code (`?code=...`). The
        // parameter is explicit intent, so sanitize is enough; a garbage value is a
        // garbage link, never a fall-through to another parse.
        if let raw = components.queryItems?.first(where: { $0.name == "code" })?.value {
            let candidate = InviteCodeEntry.sanitize(raw)
            return InviteCodeEntry.isComplete(candidate) ? candidate : nil
        }

        // The unfurl form: /g/{code} (§12, the one public route).
        let segments = components.path.split(separator: "/")
        if segments.count == 2, segments[0] == "g" {
            let candidate = InviteCodeEntry.sanitize(String(segments[1]))
            if InviteCodeEntry.isComplete(candidate),
                segments[1].count == InviteCodeEntry.length
            {
                return candidate
            }
        }
        return nil
    }
}
