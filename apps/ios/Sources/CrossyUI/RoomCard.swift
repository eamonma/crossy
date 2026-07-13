// One room card (EXPERIENCE.md §3 Rooms): geometry fingerprint, member dots, puzzle
// title, optional game name. Cards sell people, not progress: no fill fraction, and no
// lifecycle chip on the card face. The endpoint DOES carry a lifecycle fact
// (`completedAt`, PROTOCOL.md §12, the completed read expand), but a solved room's
// quiet is the section's to tell, not a chip's: the Rooms screen gathers solved rooms
// into a trailing "Solved" shelf and dims their silhouette, so the card stays about
// people. The card is paper, not glass (DESIGN.md §1: glass is what you hold, and a
// scrolling list is content); people are the only color on it.

import CrossyDesign
import SwiftUI

/// One member as the room layer reads it, plain data (the RosterMember pattern:
/// CrossyUI names its own types, protocol twins stay in their ring, AD-2). The
/// composition root maps a `GET /games` row's member stack here, so the room-open
/// chrome and a future card stack can be born true at tap time (PROTOCOL.md §12)
/// without a second fetch.
public struct RoomCardMember: Equatable, Sendable {
    public let userId: String
    /// The resolved display name, never empty on a current server (a nameless mirror
    /// reads "former participant" server-side, the same fallback the live roster shows).
    public let name: String
    /// The opaque server-resolved avatar URL, nil when the server has none (PROTOCOL.md
    /// §4 fallback rule: the colored initial is always the floor). No default, the
    /// RosterMember lesson: a construction site must decide the avatar explicitly.
    public let avatarUrl: String?
    public let isHost: Bool
    /// True for a spectator seat, so the standing solvers-only filters apply from the
    /// seat alone (a guest seats spectator; there is no guest flag on the wire, §12).
    public let isSpectator: Bool

    public init(userId: String, name: String, avatarUrl: String?, isHost: Bool, isSpectator: Bool)
    {
        self.userId = userId
        self.name = name
        self.avatarUrl = avatarUrl
        self.isHost = isHost
        self.isSpectator = isSpectator
    }
}

/// A room as the card renders it, plain data (the RosterMember pattern: CrossyUI
/// names its own types, protocol twins stay in their ring, AD-2). The composition
/// root maps `GET /games` rows here.
public struct RoomCardModel: Identifiable, Equatable, Sendable {
    public let gameId: String
    /// Optional display label, shown back verbatim (never normalized, §12).
    public let name: String?
    /// Display metadata, null when the document carried none.
    public let puzzleTitle: String?
    public let rows: Int
    public let cols: Int
    /// The puzzle's black-square silhouette, pattern only (PROTOCOL.md §12): rows of
    /// `#`/`.`, painted as the card's face by `PuzzleSilhouetteView`. Empty from an older
    /// server that predates the field (§14) or a fixture that carries none, which falls
    /// back to the bare geometry lattice. INV-6-safe (no letters, numbers, or solution).
    public let mask: [String]
    public let memberCount: Int
    /// The creator's user id: the one member the list row names, so the one honest
    /// person-color the card can carry.
    public let createdBy: String
    /// When the room was created (ISO 8601), the fallback sort key for a room no one
    /// has played yet (§12). Kept off the card face; it feeds ordering only.
    public let createdAt: String
    /// When the room completed (ISO 8601), or nil while it is ongoing AND nil for an
    /// abandoned room, which never completed (§12, the completed read expand). A non-nil
    /// value gathers the room into the trailing "Solved" shelf. INV-6-safe (a bare timestamp,
    /// never a cell value). Kept off the card face; the section tells the story.
    public let completedAt: String?
    /// When a host ended the room (ISO 8601), or nil unless it was abandoned (§12). The twin
    /// terminal fact to `completedAt` and mutually exclusive with it: a non-nil value gathers
    /// the room into the trailing "Ended" shelf rather than leaving it in the live shelf (both
    /// nil reads ongoing). INV-6-safe (a bare timestamp, never a cell value). Kept off the card
    /// face; the section tells the story.
    public let abandonedAt: String?
    /// The room's last activity (ISO 8601), or nil when no one has played yet: the
    /// newest board event's time, `MAX(cell_events.at)` server-side (§12). The rooms list
    /// orders on `lastActivityAt ?? createdAt` (COALESCE), most recent first, so a fresh
    /// unplayed room keys on its creation time and is not banished below every played room.
    /// INV-6-safe (a bare timestamp, never a cell value). Kept off the card face; it feeds
    /// ordering.
    public let lastActivityAt: String?
    /// The room's full membership as display identity, join-ordered (first joiner first,
    /// PROTOCOL.md §12), so the arrival layer can seed the room-open chrome true at tap
    /// time. Empty when the server predates the row stack (§14) or in fixtures that carry
    /// none; `memberCount` stays the honest total either way. Not rendered on the card
    /// face: the identity-true stack feeds the seeded-birth choreography (the room-open
    /// chrome), not the card silhouette.
    public let members: [RoomCardMember]
    /// The room's invite code (§12), member-only and on every list row under the same
    /// member-scoped rule the game view carries it (the list is member-scoped, so every
    /// row's reader is a member). Nil when the server predates the field (§14) or in
    /// fixtures that carry none. Not on the card face: it feeds the seeded-birth share
    /// pill (born from this code, so the share payload exists pre-REST) and never a
    /// visible label.
    public let inviteCode: String?

    public var id: String { gameId }

    /// True when the room has a completion time: the fact the trailing "Solved" shelf
    /// gathers on (§12). Null (ongoing, or an abandoned room) reads as not solved.
    public var isSolved: Bool { completedAt != nil }

    /// True when a host ended the room: the fact the trailing "Ended" shelf gathers on (§12).
    /// Mutually exclusive with `isSolved` (a terminal room is one or the other, never both).
    public var isAbandoned: Bool { abandonedAt != nil }

    /// True when the room is terminal (solved or ended): both dim their silhouette and drop the
    /// activity line, the quiet the two trailing shelves share. Neither is ever featured.
    public var isTerminal: Bool { isSolved || isAbandoned }

    public init(
        gameId: String, name: String?, puzzleTitle: String?,
        rows: Int, cols: Int,
        // No default, the members/inviteCode lesson: a construction site must decide the
        // silhouette explicitly rather than silently ship a room that renders no face.
        mask: [String],
        memberCount: Int, createdBy: String,
        createdAt: String, completedAt: String?, abandonedAt: String?, lastActivityAt: String?,
        // No default: a construction site must decide the stack explicitly (the
        // RosterMember avatar lesson; a silent [] shipped the island without avatars).
        members: [RoomCardMember],
        // No default either, for the same reason: the seeded-birth share pill is born
        // from this code, so a construction site must decide it explicitly rather than
        // silently ship a room that cannot share pre-REST.
        inviteCode: String?
    ) {
        self.gameId = gameId
        self.name = name
        self.puzzleTitle = puzzleTitle
        self.rows = rows
        self.cols = cols
        self.mask = mask
        self.memberCount = memberCount
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.abandonedAt = abandonedAt
        self.lastActivityAt = lastActivityAt
        self.members = members
        self.inviteCode = inviteCode
    }

    /// The headline: the game's own name when it has one, else the puzzle title,
    /// else the honest geometry.
    public var headline: String {
        if let name, !name.isEmpty { return name }
        if let puzzleTitle, !puzzleTitle.isEmpty { return puzzleTitle }
        return "\(rows)\u{00D7}\(cols) crossword"
    }

    /// The subline under a named game: the puzzle title, absent when it would
    /// repeat the headline.
    public var subline: String? {
        guard let name, !name.isEmpty else { return nil }
        guard let puzzleTitle, !puzzleTitle.isEmpty, puzzleTitle != name else { return nil }
        return puzzleTitle
    }

    /// Order rooms by when they were last touched, most recent first, matching the server's
    /// within-page order (PROTOCOL.md §12). The sort key is `lastActivityAt ?? createdAt`
    /// (COALESCE): creating a room is its first activity, so a freshly created unplayed room
    /// sorts by its `createdAt`, right where a room played at that instant would sit, not below
    /// every played room. Ties on the coalesced key fall back to `createdAt`, then `gameId`, so
    /// the order is total and stable. The server already sends the page in this order; sorting
    /// again keeps the list correct across merged pages and never fights the server since the
    /// rule is identical. Timestamps are ISO 8601 UTC with the same server format, so a
    /// lexicographic compare is chronological (no date parsing in the view layer). Pure and
    /// non-mutating.
    public static func orderedByActivity(_ rooms: [RoomCardModel]) -> [RoomCardModel] {
        rooms.sorted { a, b in
            // COALESCE(lastActivityAt, createdAt): a never-played room keys on its creation time.
            let keyA = a.lastActivityAt ?? a.createdAt
            let keyB = b.lastActivityAt ?? b.createdAt
            if keyA != keyB { return keyA > keyB }  // more recently touched first
            if a.createdAt != b.createdAt { return a.createdAt > b.createdAt }
            return a.gameId > b.gameId
        }
    }

    /// Split rooms into the three shelves the Rooms screen renders (the web's grammar,
    /// Home.tsx GamesList): live rooms lead, then solved rooms, then host-ended rooms, each
    /// gathered trailing. A room is classified by its mutually exclusive terminal timestamps
    /// (§12): completed into `solved`, abandoned into `ended`, neither into `live`. The
    /// partition PRESERVES the input order within each group and never re-sorts, so the
    /// caller's activity order carries through and appended pages stay stable (§12 pagination:
    /// pages are createdAt-bounded and appended, never globally re-sorted, so a terminal room
    /// from page 2 lands after page 1's terminal rooms). When a group is empty the screen draws
    /// no trailing header for it. Pure and non-mutating.
    public static func shelved(
        _ rooms: [RoomCardModel]
    ) -> (live: [RoomCardModel], solved: [RoomCardModel], ended: [RoomCardModel]) {
        var live: [RoomCardModel] = []
        var solved: [RoomCardModel] = []
        var ended: [RoomCardModel] = []
        for room in rooms {
            if room.isSolved {
                solved.append(room)
            } else if room.isAbandoned {
                ended.append(room)
            } else {
                live.append(room)
            }
        }
        return (live, solved, ended)
    }
}

/// The member-dot arithmetic, pure so it pins headlessly: at most `cap` dots, the
/// rest a +N (the count-badge vocabulary the board already speaks, root DESIGN.md
/// §10).
public enum RoomCardDots {
    public static let cap = 4

    public static func counts(memberCount: Int, cap: Int = cap) -> (dots: Int, overflow: Int) {
        let members = max(memberCount, 0)
        if members <= cap { return (members, 0) }
        return (cap, members - cap)
    }
}

/// The card itself. Tap handling belongs to the list.
public struct RoomCard: View {
    private let model: RoomCardModel
    private let ground: GridGround

    /// How much the silhouette dims for a terminal room, solved or ended: a quiet
    /// muted-silhouette echo of the web's `Silhouette muted` (Home.tsx), the smallest honest
    /// signal that a room is done, so the trailing "Solved" and "Ended" sections read finished
    /// without a loud badge. Only the fingerprint dims; the headline and people stay full ink.
    /// A first pass for the owner's device eye, tuned by one constant.
    public static let solvedFingerprintOpacity: Double = 0.45

    public init(model: RoomCardModel, ground: GridGround) {
        self.model = model
        self.ground = ground
    }

    public var body: some View {
        HStack(spacing: 14) {
            PuzzleSilhouetteView(
                rows: model.rows, cols: model.cols, mask: model.mask, ground: ground)
                .frame(width: 52, height: 52)
                .opacity(model.isTerminal ? Self.solvedFingerprintOpacity : 1)

            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: model.headline)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .lineLimit(1)
                if let subline = model.subline {
                    Text(verbatim: subline)
                        .font(.system(size: 13))
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                        .lineLimit(1)
                }
                MemberDotsRow(
                    memberCount: model.memberCount, createdBy: model.createdBy, ground: ground)
                    .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(rgb: ground.tokens.cell))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Color(rgb: ground.tokens.gridLine), lineWidth: 1))
        )
    }
}

/// A featured room card (EXPERIENCE.md §3 Rooms): the same paper card grammar as
/// `RoomCard`, stood up vertically so the silhouette leads as a large face, the way the
/// web home leads its live rooms with a real grid (Home.tsx). The screen renders the few
/// most-recently-active live rooms this way (a 2x2 wall, RoomsScreen), the rest and the
/// solved rooms as the compact `RoomCard`. Featured rooms are live by construction (the
/// screen never features a solved room), so no muted-silhouette branch here. Paper, not
/// glass (DESIGN.md §1: a scrolling list is content); people are the only color.
public struct FeaturedRoomCard: View {
    private let model: RoomCardModel
    private let ground: GridGround

    public init(model: RoomCardModel, ground: GridGround) {
        self.model = model
        self.ground = ground
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PuzzleSilhouetteView(
                rows: model.rows, cols: model.cols, mask: model.mask, ground: ground)
                // A square face fits the common 15x15 exactly and centers an oblong grid
                // (the silhouette's layout keeps true aspect, so a 21x21 or a mini stays
                // honest inside the square). It fills the card's width, the featured card's
                // whole point: the puzzle read large.
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: model.headline)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .lineLimit(1)
                MemberDotsRow(
                    memberCount: model.memberCount, createdBy: model.createdBy, ground: ground)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(rgb: ground.tokens.cell))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Color(rgb: ground.tokens.gridLine), lineWidth: 1))
        )
    }
}

/// Member dots, shared by the compact and featured cards. The list row names one member
/// (the creator), so one dot carries that person's roster color and the rest stay quiet;
/// painting invented colors on unknown members would be dressing (people are the only
/// color, and only real people earn it). The +N overflow speaks the count-badge
/// vocabulary the board already speaks (root DESIGN.md §10).
public struct MemberDotsRow: View {
    private let memberCount: Int
    private let createdBy: String
    private let ground: GridGround

    public init(memberCount: Int, createdBy: String, ground: GridGround) {
        self.memberCount = memberCount
        self.createdBy = createdBy
        self.ground = ground
    }

    public var body: some View {
        let (count, overflow) = RoomCardDots.counts(memberCount: memberCount)
        return HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { index in
                Circle()
                    .fill(
                        index == 0
                            ? Color(rgb: ground.rosterColor(IdentityRoster.color(for: createdBy)))
                            : Color(rgb: ground.tokens.number).opacity(0.45)
                    )
                    .frame(width: 8, height: 8)
            }
            if overflow > 0 {
                Text(verbatim: "+\(overflow)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            }
        }
    }
}
