// The roster as the chrome renders it: the room bar's puck cluster and the roster
// panel's rows, derived from plain participant facts (the view maps the store's
// participants here, the GridPresence pattern). Presence order is the one rule both
// surfaces share: connected people first, each group stable by name then id so the
// cluster never shuffles between renders. Color resolution reuses GridPresence's
// authority chain (wire color first, hash fallback). The spectator's one affordance
// is Join in (ID-5; EXPERIENCE.md roster sheet), stubbed to a closure until I3
// wires the seat change.

import CrossyDesign

/// One participant as the chrome needs it, plain data.
public struct RosterMember: Sendable, Equatable, Identifiable {
    public let userId: String
    public let displayName: String
    /// The wire color string, authoritative for roster slotting.
    public let wireColor: String
    public let isHost: Bool
    public let isSpectator: Bool
    public let connected: Bool

    public var id: String { userId }

    public init(
        userId: String, displayName: String, wireColor: String,
        isHost: Bool, isSpectator: Bool, connected: Bool
    ) {
        self.userId = userId
        self.displayName = displayName
        self.wireColor = wireColor
        self.isHost = isHost
        self.isSpectator = isSpectator
        self.connected = connected
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

    /// The cluster: the first `puckCap` in presence order, plus how many collapsed.
    public static func cluster(_ members: [RosterMember]) -> (pucks: [RosterMember], overflow: Int) {
        let inOrder = ordered(members)
        let shown = Array(inOrder.prefix(puckCap))
        return (shown, inOrder.count - shown.count)
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

    private static func compareASCII(_ a: String, _ b: String) -> Bool {
        // Lexicographic over UTF-8 bytes: deterministic and locale-free (INV-1).
        for (x, y) in zip(a.utf8, b.utf8) where x != y { return x < y }
        return a.utf8.count < b.utf8.count
    }
}
