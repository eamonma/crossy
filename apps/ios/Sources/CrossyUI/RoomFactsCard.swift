// The room-facts card (owner ruling 2026-07-10: the time pill is the room's
// facts). One surface, two moments: mid-solve a tap on the time pill inflates it
// into the card of the crossword's facts (the room's name, the puzzle's title
// and byline, the live clock as the headline); at completion the same surface is
// the stats card (ID-2: the timer becomes the headline only at completion, so
// the headline comes FROM the timer, frozen). The card is a morph, not a
// presentation (DESIGN.md §4 morph grammar; a tap-opened morph may animate on
// the chrome spring, and nothing here ever writes a drag-scrubbed morph's
// progress, SP-i1). The time rides the surface from the pill's clock to the
// headline slot (§4: content rides the morph); label and detail fade in late as
// the card's new content. Dismissal pours the time back into the bar; the pill,
// frozen or ticking, summons the card again. Copy derivations are pure and
// pinned (the StatsCardContent pattern this generalizes).

import CrossyDesign
import SwiftUI

/// The facts morph's pure geometry, pinned in tests: the card's rows are
/// fixed-height slots so the rider's landing point is arithmetic, not font
/// metrics, and the rider at progress 1 sits exactly in the headline slot.
enum FactsRideLayout {
    static let panelMaxWidth: CGFloat = 340
    static let verticalPadding: CGFloat = 22
    static let labelHeight: CGFloat = 14
    static let rowGap: CGFloat = 6
    static let timeHeight: CGFloat = 48
    static let detailHeight: CGFloat = 16
    /// The clock's size in the time pill and the headline's size in the card.
    static let restFontSize: CGFloat = 13
    static let openFontSize: CGFloat = 40
    /// The rows' inset from the open card's edge. Row text takes this CONSTANT
    /// width (a rigid frame against morph.open, never the interpolating
    /// surface), so truncation is computed once and a mid-morph width never
    /// re-truncates a line to an ellipsis (owner device finding 2026-07-10).
    static let contentInset: CGFloat = 20

    static func panelHeight(hasDetail: Bool) -> CGFloat {
        verticalPadding * 2 + labelHeight + rowGap + timeHeight
            + (hasDetail ? rowGap + detailHeight : 0)
    }

    static func contentWidth(openWidth: CGFloat) -> CGFloat {
        max(0, openWidth - contentInset * 2)
    }

    /// The headline slot's center in panel-local coordinates.
    static func timeCenterY() -> CGFloat {
        verticalPadding + labelHeight + rowGap + timeHeight / 2
    }

    static func fontSize(at progress: CGFloat) -> CGFloat {
        GlassMorph.lerp(restFontSize, openFontSize, progress)
    }

    /// The rider's center at a progress, in the CURRENT frame's local space: a
    /// straight room-space line from `restCenter` (the pill clock's own
    /// reported center; the weather sits beside the clock, so the pill's
    /// middle is not the clock's) to the headline slot, re-expressed against
    /// the interpolating surface.
    static func timeCenter(
        morph: GlassMorph, restCenter: CGPoint, progress: CGFloat
    ) -> CGPoint {
        let openRoom = CGPoint(
            x: morph.open.midX, y: morph.open.minY + timeCenterY())
        let frame = morph.frame(at: progress)
        return CGPoint(
            x: GlassMorph.lerp(restCenter.x, openRoom.x, progress) - frame.minX,
            y: GlassMorph.lerp(restCenter.y, openRoom.y, progress) - frame.minY)
    }
}

/// The card's headline clock, one pure rule (pinned): the server's stat leads
/// when it exists (stats arrive only with `gameCompleted`, PROTOCOL.md §6);
/// otherwise the ambient clock's value, which ticks against `now` while the
/// room runs and freezes at the terminal instant (ID-2), exactly the bar
/// clock's own arithmetic.
public enum RoomFactsClock {
    public static func headline(
        solveTimeSeconds: Int?, firstFillAt: String?, completedAt: String?, now: Date
    ) -> String {
        if let solveTimeSeconds {
            return AmbientClock.display(seconds: solveTimeSeconds)
        }
        return AmbientClock.display(
            firstFillAt: firstFillAt, completedAt: completedAt, now: now)
    }
}

/// The card's words, derived once as plain strings so the card renders no
/// arithmetic (the StatsCardContent pattern; that name retired when the card
/// stopped being stats-only). Mid-solve the label is the room's name and the
/// detail the puzzle's facts (title, byline, date: render params until the wire
/// carries them); at completion the label is the lexicon's completion word and
/// the detail whatever stats exist (EXPERIENCE.md Completed: solve time,
/// entries, solvers), vanishing rather than showing zeros.
public struct RoomFactsContent: Equatable, Sendable {
    public let label: String
    public let detail: String?

    public init(label: String, detail: String?) {
        self.label = label
        self.detail = detail
    }

    public static func make(
        roomName: String,
        puzzleTitle: String?,
        puzzleAuthor: String?,
        puzzleDate: String?,
        completed: Bool,
        totalEvents: Int?,
        participantCount: Int?
    ) -> RoomFactsContent {
        if completed {
            var parts: [String] = []
            if let totalEvents {
                parts.append(totalEvents == 1 ? "1 entry" : "\(totalEvents) entries")
            }
            if let participantCount {
                parts.append(
                    participantCount == 1 ? "1 solver" : "\(participantCount) solvers")
            }
            return RoomFactsContent(
                label: RoomTerminal.completedNotice,
                detail: parts.isEmpty ? nil : parts.joined(separator: " · "))
        }
        let facts = [puzzleTitle, puzzleAuthor, puzzleDate]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return RoomFactsContent(
            label: roomName,
            detail: facts.isEmpty ? nil : facts.joined(separator: " · "))
    }
}

/// The mid-solve facts popover's operations, derived once so the view renders no
/// policy (the RoomFactsContent pattern). Operations are ONLY what the API
/// already supports (PROTOCOL.md §12): a member may copy the room's invite code
/// (`GET /games/{id}` returns `inviteCode` to any member); the host may end the
/// game (`POST /games/{id}/abandon`, host only, a `FORBIDDEN` for a non-host).
/// Kick is not here: it lives on the roster menu, per the owner ruling. A
/// destructive operation (end game) renders only for the host and takes a
/// confirm step in the view. When nothing is available (a non-host with no
/// invite code in hand), the operations are empty and the popover shows facts
/// alone, which is fine.
public struct FactsOperations: Equatable, Sendable {
    /// The invite code to copy, nil when the client does not hold it (the row
    /// is then absent). The room view carries it (PROTOCOL.md §12), so a live
    /// room always has it; the demo has one too.
    public let inviteCode: String?
    /// The shareable invite URL (ShareInvite.url, the same link the QR code
    /// encodes), nil exactly when `inviteCode` is nil. Carried alongside the
    /// bare code because the system share sheet wants a URL, not a code.
    public let shareURL: URL?
    /// The host's destructive end-game, offered only to the host (the server
    /// refuses a non-host abandon anyway; the client simply does not show it).
    public let canEndGame: Bool

    public init(inviteCode: String?, shareURL: URL?, canEndGame: Bool) {
        self.inviteCode = inviteCode
        self.shareURL = shareURL
        self.canEndGame = canEndGame
    }

    /// The operations for the local participant. `isHost` gates the destructive
    /// end-game; a blank or absent code drops the copy and share rows. A
    /// terminal room offers no operations: the popover is the mid-solve
    /// surface only (the stats card owns completion), and ending an
    /// already-ended game is a no-op (INV-4), so the whole popover path is
    /// gated on `ongoing` upstream. `gameId`/`roomName` default to nil so
    /// existing callers keep compiling unchanged; without a `gameId` there is
    /// no URL to share and `shareURL` is nil (the row simply does not render).
    public static func make(
        inviteCode: String?, isHost: Bool, gameId: String? = nil, roomName: String? = nil
    ) -> FactsOperations {
        let trimmed = inviteCode?.trimmingCharacters(in: .whitespaces)
        let code = (trimmed?.isEmpty == false) ? trimmed : nil
        let shareURL = gameId.flatMap { ShareInvite.url(gameId: $0, code: code, name: roomName) }
        return FactsOperations(inviteCode: code, shareURL: shareURL, canEndGame: isHost)
    }

    /// Whether the popover renders a divider and any operation rows at all.
    public var hasAny: Bool { inviteCode != nil || canEndGame }
}

/// The card as one morphing glass surface. The time is the rider and the
/// headline; chrome stays achromatic (DESIGN.md §3), so the card carries no
/// color, only weight. The 1 Hz timeline keeps a mid-solve headline honest
/// (the room's clock never stops for a card); a terminal room's inputs freeze
/// the same arithmetic, so the timeline ticks a constant.
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct RoomFactsPanel: View {
    let ground: GridGround
    let morph: GlassMorph
    /// The pill clock's reported center in room space: the rider's launch
    /// point (§4: content rides the morph, and hands off from the chrome it
    /// left).
    let restTimeCenter: CGPoint
    let content: RoomFactsContent
    let solveTimeSeconds: Int?
    let firstFillAt: String?
    let completedAt: String?
    let chrome: RoomChromeModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            card(now: timeline.date)
        }
    }

    private func card(now: Date) -> some View {
        let progress = chrome.factsProgress
        let frame = morph.frame(at: progress)
        let radius = morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let time = RoomFactsClock.headline(
            solveTimeSeconds: solveTimeSeconds,
            firstFillAt: firstFillAt, completedAt: completedAt, now: now)

        return ZStack(alignment: .topLeading) {
            rows
                .opacity(GlassMorphContent.listOpacity(at: progress))
                .frame(width: frame.width, height: frame.height, alignment: .top)
            // The rider: the time, one object from bar clock to headline.
            Text(verbatim: time)
                .font(.system(
                    size: FactsRideLayout.fontSize(at: progress), weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .position(
                    FactsRideLayout.timeCenter(
                        morph: morph, restCenter: restTimeCenter, progress: progress))
                .allowsHitTesting(false)
        }
        .frame(width: frame.width, height: frame.height)
        .clipShape(shape)
        .modifier(ChromeGlassSurface(cornerRadius: radius))
        .contentShape(shape)
        // An inside tap stays the card's: only touches OUTSIDE a transient
        // dismiss it (DESIGN.md §4), the panel's own inner blocker rule.
        .onTapGesture {}
        .position(x: frame.midX, y: frame.midY)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLine(time: time)))
    }

    /// The card's new content: fixed-height slots (the rider lands by
    /// arithmetic), the headline slot left clear for it. Each line takes the
    /// open card's CONSTANT content width with one-line truncation, so a
    /// mid-morph width never re-truncates it (owner device finding 2026-07-10,
    /// the stats pour-back); mid-flight the rigid rows clip under the
    /// surface's clipShape while listOpacity fades them.
    private var rows: some View {
        let width = FactsRideLayout.contentWidth(openWidth: morph.open.width)
        return VStack(spacing: FactsRideLayout.rowGap) {
            // Natural casing: the uppercased small-caps register read wrong
            // on device (owner ruling 2026-07-10).
            Text(verbatim: content.label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.number))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: width, height: FactsRideLayout.labelHeight)
            Color.clear
                .frame(height: FactsRideLayout.timeHeight)
            if let detail = content.detail {
                Text(verbatim: detail)
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(width: width, height: FactsRideLayout.detailHeight)
            }
        }
        .padding(.vertical, FactsRideLayout.verticalPadding)
        .frame(maxWidth: .infinity)
    }

    private func accessibilityLine(time: String) -> String {
        var line = "\(content.label), \(time)"
        if let detail = content.detail {
            line += ", \(detail.replacingOccurrences(of: " · ", with: ", "))"
        }
        return line
    }
}
