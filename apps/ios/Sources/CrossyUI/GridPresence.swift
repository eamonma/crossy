// Teammate presence for the board, assembled from plain inputs (the view maps the
// store's cursors and participants here). Placement is the Wave 2.1d module
// contract (GridModule); this file owns who appears and in what color: the server's
// wire color string is authoritative for roster slotting, spectator cursors are
// never rendered (root DESIGN.md §15), and your own cursor is the selection, not a
// presence mark.

import CrossyDesign

/// One teammate cursor rendered in a cell: the direction arrow, the avatar puck,
/// and any conflict flash all borrow this color.
public struct PresenceMark: Equatable, Sendable {
    public let userId: String
    /// Avatar fallback initial (Wave 2.1d: 8 px initial), ASCII-uppercased from the
    /// display name's first character (INV-1: no locale-aware casing).
    public let initial: String
    /// The roster color already resolved for the render ground.
    public let color: RGBColor
    public let isAcross: Bool

    public init(userId: String, initial: String, color: RGBColor, isAcross: Bool) {
        self.userId = userId
        self.initial = initial
        self.color = color
        self.isAcross = isAcross
    }
}

public enum GridPresence {
    /// A live cursor, plain data (mirrors the store's `Cursor`).
    public struct CursorInput: Sendable, Equatable {
        public let userId: String
        public let cell: Int
        public let isAcross: Bool

        public init(userId: String, cell: Int, isAcross: Bool) {
            self.userId = userId
            self.cell = cell
            self.isAcross = isAcross
        }
    }

    /// A participant view, plain data (mirrors the store's `Participant`).
    public struct ParticipantInput: Sendable, Equatable {
        public let userId: String
        public let displayName: String
        /// The wire color string, `#RRGGBB` (PROTOCOL.md §4); authoritative for
        /// roster slotting.
        public let color: String
        public let isSpectator: Bool

        public init(userId: String, displayName: String, color: String, isSpectator: Bool) {
            self.userId = userId
            self.displayName = displayName
            self.color = color
            self.isSpectator = isSpectator
        }
    }

    /// The roster identity for one participant: slot from the authoritative wire
    /// string; an unparseable wire color falls back to the local hash of the user id
    /// (deterministic, so a malformed wire still renders one stable color per user).
    public static func rosterColor(wireColor: String, userId: String) -> IdentityColor {
        IdentityRoster.color(forWireColor: wireColor) ?? IdentityRoster.color(for: userId)
    }

    /// Presence marks by cell. Excluded: the local player (your cursor renders as
    /// the selection, root DESIGN.md §10 draws teammate cursors only) and spectators
    /// (root DESIGN.md §15: spectator cursors are neither rendered nor broadcast by
    /// default; the store applies whatever arrives, so the renderer filters). A
    /// cursor with no participant entry still renders, colored by user-id fallback:
    /// presence is best-effort and a late roster must not blank a live cursor.
    /// Marks within a cell are ordered by userId so stacking is deterministic.
    public static func marks(
        cursors: [CursorInput],
        participants: [ParticipantInput],
        selfUserId: String?,
        ground: GridGround
    ) -> [Int: [PresenceMark]] {
        let roster = Dictionary(
            participants.map { ($0.userId, $0) },
            uniquingKeysWith: { first, _ in first })
        var marks: [Int: [PresenceMark]] = [:]
        for cursor in cursors.sorted(by: { $0.userId < $1.userId }) {
            if cursor.userId == selfUserId { continue }
            let participant = roster[cursor.userId]
            if participant?.isSpectator == true { continue }
            let identity = rosterColor(
                wireColor: participant?.color ?? "", userId: cursor.userId)
            let mark = PresenceMark(
                userId: cursor.userId,
                initial: initial(of: participant?.displayName ?? ""),
                color: ground.rosterColor(identity),
                isAcross: cursor.isAcross)
            marks[cursor.cell, default: []].append(mark)
        }
        return marks
    }

    /// The avatar's fallback initial: the display name's first character,
    /// ASCII-uppercased bytewise (INV-1; a non-ASCII initial passes through
    /// verbatim), empty when the name is empty.
    static func initial(of displayName: String) -> String {
        guard let first = displayName.first else { return "" }
        return String(
            decoding: String(first).utf8.map { $0 >= 0x61 && $0 <= 0x7A ? $0 - 0x20 : $0 },
            as: UTF8.self)
    }
}
