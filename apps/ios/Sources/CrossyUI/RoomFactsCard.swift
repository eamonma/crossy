// The room-facts card (owner ruling 2026-07-10: the time pill is the room's
// facts; redesigned 2026-07-11). One surface, ONE mechanism, two moments: a tap
// on the time pill inflates it into the card, mid-solve or terminal. Mid-solve
// the card carries the room's name, the live clock as the headline, the
// puzzle's facts, and (for the host) the end-game under a hairline, one
// confirm. Copying the invite code moved to the share menu (owner ruling
// 2026-07-11: the share surface owns invite copying). At completion the same surface is
// the stats card (ID-2: the timer becomes the headline only at completion, so
// the headline comes FROM the timer, frozen) and carries no operations: the
// terminal card is the record, not a control surface. The system popover the
// mid-solve path briefly rode retired with the redesign: its callout arrow
// pointed at the pill instead of BEING the pill, breaking the morph grammar's
// one promise (a panel is the pill reshaped, DESIGN.md §4).
//
// The card is a morph, not a presentation (DESIGN.md §4; a tap-opened morph
// animates on the chrome spring's walk, and nothing here ever writes a
// drag-scrubbed morph's progress, SP-i1). The clock-rider retired with the
// redesign too (owner dislike 2026-07-11: glyphs flying and rescaling from the
// pill to the headline read as theater): the pill hands off whole, the surface
// grows clean, and the card's content fades in late as one block, the
// browser-list rule (GlassMorphContent.listOpacity), out early on the pour
// back. Dismissal shrinks the surface back into the pill, which stands again,
// sealed or ticking. Copy derivations are pure and pinned.

import CrossyDesign
import SwiftUI

/// The facts card's pure geometry, pinned in tests: fixed-height slots so the
/// morph's open frame is arithmetic, never font metrics. Row text takes the
/// open card's CONSTANT content width (a rigid frame against morph.open, never
/// the interpolating surface), so truncation is computed once and a mid-morph
/// width never re-truncates a line to an ellipsis (owner device finding
/// 2026-07-10).
enum FactsCardLayout {
    static let panelMaxWidth: CGFloat = 340
    static let verticalPadding: CGFloat = 20
    static let labelHeight: CGFloat = 16
    static let rowGap: CGFloat = 6
    /// The headline: the timer as the card's largest fact (ID-2), in the
    /// register the retired popover proved on device.
    static let headlineFontSize: CGFloat = 34
    static let timeHeight: CGFloat = 40
    static let detailHeight: CGFloat = 16
    /// The rows' inset from the open card's edge.
    static let contentInset: CGFloat = 20
    /// The operations block (§12, mid-solve only): air, a one-point hairline,
    /// air, then fixed-height rows.
    static let operationsAirAbove: CGFloat = 12
    static let dividerHeight: CGFloat = 1
    static let operationsAirBelow: CGFloat = 4
    static let operationRowHeight: CGFloat = 40

    static func panelHeight(hasDetail: Bool, operationRows: Int) -> CGFloat {
        verticalPadding * 2 + labelHeight + rowGap + timeHeight
            + (hasDetail ? rowGap + detailHeight : 0)
            + (operationRows > 0
                ? operationsAirAbove + dividerHeight + operationsAirBelow
                    + operationRowHeight * CGFloat(operationRows)
                : 0)
    }

    static func contentWidth(openWidth: CGFloat) -> CGFloat {
        max(0, openWidth - contentInset * 2)
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

/// The facts card's operations, derived once so the view renders no policy
/// (the RoomFactsContent pattern). Copy invite code retired with the share
/// morph card (owner ruling 2026-07-11: the share surface owns invite copying
/// now, its Section header carries the code and Copy link the URL). So the
/// only operation left is the host's end-game (`POST /games/{id}/abandon`,
/// host only, a `FORBIDDEN` for a non-host, PROTOCOL.md §12), a destructive
/// action that takes a confirm step in the view. A non-host mid-solve sees no
/// operations, and the card shows facts alone, which is fine.
public struct FactsOperations: Equatable, Sendable {
    /// The host's destructive end-game, offered only to the host (the server
    /// refuses a non-host abandon anyway; the client simply does not show it).
    public let canEndGame: Bool

    public init(canEndGame: Bool) {
        self.canEndGame = canEndGame
    }

    /// The operations for the local participant. `isHost` gates the destructive
    /// end-game. A terminal room offers no operations: the terminal card is
    /// the record (ending an already-ended game is a no-op, INV-4), so the
    /// caller passes `.none` there instead of deriving.
    public static func make(isHost: Bool) -> FactsOperations {
        FactsOperations(canEndGame: isHost)
    }

    /// The empty set, the terminal card's operations.
    public static let none = FactsOperations(canEndGame: false)

    /// How many operation rows render, the panel-height arithmetic's input.
    public var rowCount: Int {
        canEndGame ? 1 : 0
    }

    /// Whether the card renders a hairline and any operation rows at all.
    public var hasAny: Bool { rowCount > 0 }
}

/// The card as one morphing glass surface: the pill reshaped, never a balloon
/// beside it (DESIGN.md §4, the Mail-button rule). Chrome stays achromatic
/// (§3), so the card carries no color, only weight. The 1 Hz timeline keeps a
/// mid-solve headline honest (the room's clock never stops for a card); a
/// terminal room's inputs freeze the same arithmetic, so the timeline ticks a
/// constant. All content fades on the browser-list rule against the walked
/// progress; nothing here animates implicitly.
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct RoomFactsPanel: View {
    let ground: GridGround
    let morph: GlassMorph
    let content: RoomFactsContent
    /// Already gated by the caller: mid-solve the host's end-game, `.none`
    /// for a terminal room (the record, not a control surface).
    let operations: FactsOperations
    let solveTimeSeconds: Int?
    let firstFillAt: String?
    let completedAt: String?
    let chrome: RoomChromeModel
    /// End the game (host abandon). Confirmed here first, then reported.
    let onEndGame: () -> Void

    @State private var confirmingEnd = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var quiet: Color { Color(rgb: ground.tokens.number) }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            card(now: timeline.date)
        }
    }

    private func card(now: Date) -> some View {
        let time = RoomFactsClock.headline(
            solveTimeSeconds: solveTimeSeconds,
            firstFillAt: firstFillAt, completedAt: completedAt, now: now)
        return surface(time: time)
            .confirmationDialog(
                "End this game for everyone?",
                isPresented: $confirmingEnd,
                titleVisibility: .visible
            ) {
                // The one destructive confirm (EXPERIENCE.md: abandon, one
                // confirm, plainly worded). The system dialog owns the red;
                // the card body stays achromatic (DESIGN.md §3).
                Button("End game", role: .destructive, action: onEndGame)
                Button("Keep playing", role: .cancel) {}
            } message: {
                Text(verbatim: "This ends the game for everyone in the room.")
            }
    }

    /// The surface's character (PillInflation, the owner-gated prototype):
    /// the card's CONTENT and open geometry never change here, only how the
    /// glass travels. The default is the shipped law.
    @ViewBuilder
    private func surface(time: String) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *), PillInflation.character == .metaball {
                MetaballPanelSurface(
                    morph: morph, progress: chrome.factsProgress,
                    reduceMotion: reduceMotion
                ) {
                    rows(time: time)
                }
            } else {
                walkedSurface(time: time)
            }
        #else
            walkedSurface(time: time)
        #endif
    }

    private func walkedSurface(time: String) -> some View {
        let progress = chrome.factsProgress
        let overshoots = PillInflation.walksWithOvershoot
        let frame =
            overshoots ? morph.frameUnclamped(at: progress) : morph.frame(at: progress)
        let radius =
            overshoots
            ? morph.cornerRadiusUnclamped(at: progress) : morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)

        // The card's content, one block: rigid rows against the OPEN width
        // (truncation computed once), clipped under the surface mid-flight
        // while listOpacity fades them, in late and out early.
        return rows(time: time)
            .opacity(GlassMorphContent.listOpacity(at: progress))
            .frame(width: frame.width, height: frame.height, alignment: .topLeading)
            .clipShape(shape)
            .modifier(ChromeGlassSurface(cornerRadius: radius))
            .contentShape(shape)
            // An inside tap stays the card's: only touches OUTSIDE a transient
            // dismiss it (DESIGN.md §4), the panel's own inner blocker rule.
            .onTapGesture {}
            .position(x: frame.midX, y: frame.midY)
    }

    private func rows(time: String) -> some View {
        let width = FactsCardLayout.contentWidth(openWidth: morph.open.width)
        return VStack(alignment: .leading, spacing: 0) {
            facts(time: time, width: width)
            if operations.hasAny {
                operationBlock(width: width)
            }
        }
        .padding(.vertical, FactsCardLayout.verticalPadding)
        .padding(.horizontal, FactsCardLayout.contentInset)
    }

    // MARK: Facts (the label, the headline time, the quiet detail)

    private func facts(time: String, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Natural casing: the uppercased small-caps register read wrong
            // on device (owner ruling 2026-07-10).
            Text(verbatim: content.label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(quiet)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(
                    width: width, height: FactsCardLayout.labelHeight,
                    alignment: .leading)
            Color.clear.frame(height: FactsCardLayout.rowGap)
            Text(verbatim: time)
                .font(.system(
                    size: FactsCardLayout.headlineFontSize, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(ink)
                .frame(
                    width: width, height: FactsCardLayout.timeHeight,
                    alignment: .leading)
            if let detail = content.detail {
                Color.clear.frame(height: FactsCardLayout.rowGap)
                Text(verbatim: detail)
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(quiet)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(
                        width: width, height: FactsCardLayout.detailHeight,
                        alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLine(time: time)))
    }

    // MARK: Operations (only what the API already supports, §12)

    private func operationBlock(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: FactsCardLayout.operationsAirAbove)
            // A deterministic one-point hairline, not a system Divider: the
            // panel's open height is pinned arithmetic (FactsCardLayout), and
            // a hairline's scale-dependent height would unpin it.
            Rectangle()
                .fill(quiet.opacity(0.28))
                .frame(width: width, height: FactsCardLayout.dividerHeight)
            Color.clear.frame(height: FactsCardLayout.operationsAirBelow)
            if operations.canEndGame {
                operationRow(
                    "End game", systemImage: "xmark.circle",
                    width: width, action: { confirmingEnd = true })
            }
        }
    }

    private func operationRow(
        _ title: String, systemImage: String, width: CGFloat,
        action: @escaping () -> Void
    ) -> some View {
        // Achromatic like all chrome (DESIGN.md §3): the destructive row reads
        // in ink too, and the red lives in the system confirm dialog.
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 15))
                    .frame(width: 22)
                Text(verbatim: title)
                    .font(.system(size: 15, weight: .medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(ink)
            .frame(width: width, height: FactsCardLayout.operationRowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func accessibilityLine(time: String) -> String {
        var line = "\(content.label), \(time)"
        if let detail = content.detail {
            line += ", \(detail.replacingOccurrences(of: " · ", with: ", "))"
        }
        return line
    }
}
