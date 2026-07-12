// The roster as the chrome renders it: the room bar's puck cluster and the roster
// panel's rows, derived from plain participant facts (the view maps the store's
// participants here, the GridPresence pattern). Presence order is the one rule both
// surfaces share: connected people first, each group stable by name then id so the
// cluster never shuffles between renders. Color resolution reuses GridPresence's
// authority chain (wire color first, hash fallback). The spectator's one affordance
// is Join in (ID-5; EXPERIENCE.md roster sheet), stubbed to a closure until I3
// wires the seat change.

import CrossyDesign

/// A member's live cursor as the roster needs it (PROTOCOL.md §4, §9: `board.cursors`
/// carries `{userId, cell, direction}` for every connected solver, best-effort,
/// cleared when their last socket closes). Twin of the wire `Cursor`/store `Cursor`,
/// kept here so RosterList and RosterMenu stay plain-data consumers (the GridPresence
/// pattern) rather than importing the store or protocol types.
public struct RosterCursor: Sendable, Equatable {
    public let cell: Int
    public let isAcross: Bool

    public init(cell: Int, isAcross: Bool) {
        self.cell = cell
        self.isAcross = isAcross
    }
}

/// One participant as the chrome needs it, plain data.
public struct RosterMember: Sendable, Equatable, Identifiable {
    public let userId: String
    public let displayName: String
    /// The wire color string, authoritative for roster slotting.
    public let wireColor: String
    /// The opaque server-resolved avatar URL, nil when the server has none
    /// (PROTOCOL.md §4). The render layers the fetched image over the colored
    /// initial puck when this is present and returns to the initial when it is nil,
    /// still loading, or fails; the initial is always the floor.
    public let avatarUrl: String?
    public let isHost: Bool
    public let isSpectator: Bool
    public let connected: Bool
    /// The member's live cursor, or nil when they have none right now: never
    /// connected with a cursor yet, or a spectator (spectator cursors are
    /// suppressed client-side by default, PROTOCOL.md §9; DESIGN.md §15). This is
    /// the one fact the roster's "Go to" action gates on.
    public let cursor: RosterCursor?

    public var id: String { userId }

    public init(
        userId: String, displayName: String, wireColor: String,
        // No default: a construction site must decide the avatar url explicitly. The nil
        // default let the island's participant mapping omit it silently, and the island
        // shipped without avatars (owner device report 2026-07-11).
        avatarUrl: String?,
        isHost: Bool, isSpectator: Bool, connected: Bool,
        cursor: RosterCursor? = nil
    ) {
        self.userId = userId
        self.displayName = displayName
        self.wireColor = wireColor
        self.avatarUrl = avatarUrl
        self.isHost = isHost
        self.isSpectator = isSpectator
        self.connected = connected
        self.cursor = cursor
    }

    /// The member's roster identity (wire color first, hash-of-id fallback).
    public var identity: IdentityColor {
        GridPresence.rosterColor(wireColor: wireColor, userId: userId)
    }

    /// The puck initial, ASCII-uppercased (INV-1).
    public var initial: String {
        GridPresence.initial(of: displayName)
    }
}

public enum RosterList {
    /// The cluster shows at most this many pucks; a fuller room collapses the rest
    /// to a +N, the count-badge vocabulary the board already speaks.
    public static let puckCap = 4

    /// Presence order: connected first, then away; within each group by display
    /// name then userId (ASCII byte order on both keys, INV-1: no locale-aware
    /// collation anywhere values are compared).
    public static func ordered(_ members: [RosterMember]) -> [RosterMember] {
        members.sorted { a, b in
            if a.connected != b.connected { return a.connected }
            if a.displayName.utf8.elementsEqual(b.displayName.utf8) {
                return compareASCII(a.userId, b.userId)
            }
            return compareASCII(a.displayName, b.displayName)
        }
    }

    /// The presence split for the roster menu (PROTOCOL.md §4: each participant carries
    /// `connected`; no wire change): the people here now lead, the away members gather below.
    /// Each side keeps `ordered`'s rule (byte order by name then id, INV-1), so the split only
    /// groups, never reshuffles. The viewer is always here: a self row can echo `connected:
    /// false` mid-reconnect, but the person reading the roster is present by definition, the same
    /// rule the web twin (partitionRoster) holds.
    ///
    /// A disconnected spectator drops out of both sides: a guest seats as a spectator
    /// (PROTOCOL.md §12), and an away guest is neither here nor a lingering away ghost, matching
    /// the cluster's playing-only rule and the web AvatarStack display rule. A connected
    /// spectator stays in the here section, where their quiet Watching word still names them.
    public static func sections(
        _ members: [RosterMember], selfUserId: String?
    ) -> (here: [RosterMember], away: [RosterMember]) {
        var here: [RosterMember] = []
        var away: [RosterMember] = []
        for member in ordered(members) {
            let isSelf = selfUserId != nil && member.userId == selfUserId
            if member.connected || isSelf {
                here.append(member)
            } else if !member.isSpectator {
                // Away only when they hold a seat that persists (host or solver); a disconnected
                // guest-spectator drops entirely so no permanent away ghost stands.
                away.append(member)
            }
        }
        return (here, away)
    }

    /// The cluster (owner ruling 2026-07-10): only the people who are playing,
    /// host or solver, never a spectator. Guests always seat as spectators
    /// (PROTOCOL.md §12), so guests leave the top bar without any wire change,
    /// and a puck in the pill means "solving". The menu still lists everyone
    /// (RosterMenu.rows reads `ordered`, not this): spectators keep their quiet
    /// Watching word there, and the self-spectator Join in flow is unchanged.
    /// The first `puckCap` in presence order show, the rest collapse to +N.
    public static func cluster(_ members: [RosterMember]) -> (pucks: [RosterMember], overflow: Int) {
        let playing = ordered(members).filter { !$0.isSpectator }
        let shown = Array(playing.prefix(puckCap))
        return (shown, playing.count - shown.count)
    }

    /// The quiet trailing word (ID-5 lexicon: plain, no metaphors), the roster
    /// menu's subtitle: Away beats the role because presence is what the room
    /// asks first; Watching is the spectator word; Host names the seat; a
    /// connected solver needs no word.
    public static func stateWord(_ member: RosterMember) -> String? {
        if !member.connected { return "Away" }
        if member.isSpectator { return "Watching" }
        if member.isHost { return "Host" }
        return nil
    }

    /// Whether the room shows the spectator edge (EXPERIENCE.md: Watching): the
    /// local participant holds the spectator role. Absent or unknown selves are not
    /// spectators; the room never guesses someone out of a seat.
    public static func selfIsSpectator(_ members: [RosterMember], selfUserId: String?) -> Bool {
        guard let selfUserId else { return false }
        return members.first { $0.userId == selfUserId }?.isSpectator ?? false
    }

    /// Whether the local participant is the host: the gate on the roster menu's
    /// kick affordance (owner ruling 2026-07-10: the host can remove from the
    /// participants panel). Absent or unknown selves are never host; the server
    /// enforces host-only regardless, so this only decides what the menu offers.
    public static func selfIsHost(_ members: [RosterMember], selfUserId: String?) -> Bool {
        guard let selfUserId else { return false }
        return members.first { $0.userId == selfUserId }?.isHost ?? false
    }

    /// Whether the host may kick this member: everyone but the host's own row
    /// (the server refuses a self-target with 403; the menu never offers it).
    public static func canKick(_ member: RosterMember, selfUserId: String?) -> Bool {
        guard let selfUserId else { return false }
        return member.userId != selfUserId
    }

    /// Whether the roster's "Go to" action is live for this member: only when they
    /// hold a live cursor right now (PROTOCOL.md §4, §9). No cursor means the
    /// action is absent or disabled, never a jump to a stale or guessed cell. A
    /// spectator never carries a cursor here (client-side suppression, DESIGN.md
    /// §15), so this predicate alone keeps the action off their row with no extra
    /// role check.
    public static func canJump(_ member: RosterMember) -> Bool {
        member.cursor != nil
    }

    private static func compareASCII(_ a: String, _ b: String) -> Bool {
        // Lexicographic over UTF-8 bytes: deterministic and locale-free (INV-1).
        for (x, y) in zip(a.utf8, b.utf8) where x != y { return x < y }
        return a.utf8.count < b.utf8.count
    }
}
