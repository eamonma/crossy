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
    public let memberCount: Int
    /// The creator's user id: the one member the list row names, so the one honest
    /// person-color the card can carry.
    public let createdBy: String
    /// When the room was created (ISO 8601), the fallback sort key for a room no one
    /// has played yet (§12). Kept off the card face; it feeds ordering only.
    public let createdAt: String
    /// When the room completed (ISO 8601), or nil while it is ongoing AND nil for an
    /// abandoned room, which never completed (§12, the completed read expand). The one
    /// lifecycle fact the home reads: a non-nil value gathers the room into the trailing
    /// "Solved" shelf. INV-6-safe (a bare timestamp, never a cell value). Kept off the
    /// card face; the section tells the story.
    public let completedAt: String?
    /// The room's last activity (ISO 8601), or nil when no one has played yet: the
    /// newest board event's time, `MAX(cell_events.at)` server-side (§12). It is the
    /// key the rooms list orders on, most recent first; a played room leads. INV-6-safe
    /// (a bare timestamp, never a cell value). Kept off the card face; it feeds ordering.
    public let lastActivityAt: String?

    public var id: String { gameId }

    /// True when the room has a completion time: the fact the trailing "Solved" shelf
    /// gathers on (§12). Null (ongoing, or an abandoned room) reads as not solved.
    public var isSolved: Bool { completedAt != nil }

    public init(
        gameId: String, name: String?, puzzleTitle: String?,
        rows: Int, cols: Int, memberCount: Int, createdBy: String,
        createdAt: String, completedAt: String?, lastActivityAt: String?
    ) {
        self.gameId = gameId
        self.name = name
        self.puzzleTitle = puzzleTitle
        self.rows = rows
        self.cols = cols
        self.memberCount = memberCount
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.lastActivityAt = lastActivityAt
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

    /// Order rooms most-recently-active first, matching the server's within-page order
    /// (PROTOCOL.md §12): a played room (non-nil `lastActivityAt`) outranks an unplayed
    /// one, ties and unplayed rooms fall back to `createdAt`, then `gameId`, so the order
    /// is total and stable. The server already sends the page in this order; sorting again
    /// keeps the list correct across merged pages and never fights the server since the
    /// rule is identical. Timestamps are ISO 8601 UTC with the same server format, so a
    /// lexicographic compare is chronological (no date parsing in the view layer). Pure and
    /// non-mutating.
    public static func orderedByActivity(_ rooms: [RoomCardModel]) -> [RoomCardModel] {
        rooms.sorted { a, b in
            switch (a.lastActivityAt, b.lastActivityAt) {
            case let (lhs?, rhs?):
                if lhs != rhs { return lhs > rhs }  // more recent first
            case (nil, _?):
                return false  // an unplayed room sorts after a played one
            case (_?, nil):
                return true  // a played room sorts before an unplayed one
            case (nil, nil):
                break  // both unplayed: fall through to createdAt
            }
            if a.createdAt != b.createdAt { return a.createdAt > b.createdAt }
            return a.gameId > b.gameId
        }
    }

    /// Split rooms into the two shelves the Rooms screen renders (the web's grammar,
    /// Home.tsx GamesList): live rooms lead, solved rooms gather trailing. The partition
    /// PRESERVES the input order within each group and never re-sorts, so the caller's
    /// activity order carries through and appended pages stay stable (§12 pagination:
    /// pages are createdAt-bounded and appended, never globally re-sorted, so a solved
    /// room from page 2 lands after page 1's solved rooms). When nothing is solved the
    /// `solved` group is empty and the screen draws no trailing header. Pure and
    /// non-mutating.
    public static func shelved(
        _ rooms: [RoomCardModel]
    ) -> (live: [RoomCardModel], solved: [RoomCardModel]) {
        var live: [RoomCardModel] = []
        var solved: [RoomCardModel] = []
        for room in rooms {
            if room.isSolved {
                solved.append(room)
            } else {
                live.append(room)
            }
        }
        return (live, solved)
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

    public init(model: RoomCardModel, ground: GridGround) {
        self.model = model
        self.ground = ground
    }

    public var body: some View {
        HStack(spacing: 14) {
            GeometryFingerprintView(rows: model.rows, cols: model.cols, ground: ground)
                .frame(width: 52, height: 52)

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
                dots
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

    /// Member dots. The list row names one member (the creator), so one dot carries
    /// that person's roster color and the rest stay quiet; painting invented colors
    /// on unknown members would be dressing (people are the only color, and only
    /// real people earn it).
    private var dots: some View {
        let (count, overflow) = RoomCardDots.counts(memberCount: model.memberCount)
        return HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { index in
                Circle()
                    .fill(
                        index == 0
                            ? Color(rgb: ground.rosterColor(IdentityRoster.color(for: model.createdBy)))
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
        .padding(.top, 2)
    }
}
