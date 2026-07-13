// The room-facts sheet (owner ruling 2026-07-10: the time pill is the room's
// facts; the tap-opened surface is a plain system sheet, 2026-07-12). A tap on
// the time pill mid-solve presents a small sheet, the ShareQRSheet register:
// the room's name, the live clock as the headline, the puzzle's facts, and (for
// the host) the end-game under a hairline, one confirm. The old inflate-from-the
// -pill morph (the PillInflation prototype: metaball / clean / overshoot) retired
// with this: the owner read it as ad-hoc goo, and a system sheet is the same
// verdict the players and share surfaces already earned (RosterMenu, ShareMenu).
//
// The sheet is a mid-solve surface only. At completion the pill seals and stands
// as the record (the frozen clock beside a check); the sheet does not auto-summon
// and a tap on a terminal pill does nothing (SolveScreen gates openFacts to
// ongoing). Post-game stats move to the clue-panel analysis surface, not here.
//
// The words and operations are pure (RoomFactsContent, FactsOperations); the
// clock ticks against `now` on the 1 Hz timeline, the bar clock's own arithmetic.

import CrossyDesign
import SwiftUI

/// The sheet's headline clock, one pure rule (pinned): the server's stat leads
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

/// The sheet's words, derived once as plain strings so the view renders no
/// arithmetic (the StatsCardContent pattern). Mid-solve the label is the room's
/// name and the detail the puzzle's facts (title, byline, date). The completed
/// branch stays for the pure derivation's tests; the live sheet never opens on a
/// completed room (the pill seals instead), so in practice only the mid-solve
/// words render.
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

/// The sheet's operations, derived once so the view renders no policy (the
/// RoomFactsContent pattern). The only operation is the host's end-game
/// (`POST /games/{id}/abandon`, host only, a `FORBIDDEN` for a non-host,
/// PROTOCOL.md §12), a destructive action that takes a confirm step in the view.
/// A non-host sees facts alone, which is fine.
public struct FactsOperations: Equatable, Sendable {
    /// The host's destructive end-game, offered only to the host (the server
    /// refuses a non-host abandon anyway; the client simply does not show it).
    public let canEndGame: Bool

    public init(canEndGame: Bool) {
        self.canEndGame = canEndGame
    }

    /// The operations for the local participant. `isHost` gates the destructive
    /// end-game.
    public static func make(isHost: Bool) -> FactsOperations {
        FactsOperations(canEndGame: isHost)
    }

    /// The empty set (a non-host, or any state that offers no operations).
    public static let none = FactsOperations(canEndGame: false)

    /// How many operation rows render, the sheet-height arithmetic's input.
    public var rowCount: Int {
        canEndGame ? 1 : 0
    }

    /// Whether the sheet renders a hairline and any operation rows at all.
    public var hasAny: Bool { rowCount > 0 }
}

/// The facts sheet's pure geometry, pinned in tests (the ShareQRSheetLayout
/// discipline): the detent height is slot arithmetic, never font metrics, so the
/// sheet sizes to exactly its content.
enum RoomFactsSheetLayout {
    static let verticalPadding: CGFloat = 32
    static let horizontalPadding: CGFloat = 24
    static let labelHeight: CGFloat = 18
    static let labelGap: CGFloat = 10
    /// The headline: the timer as the sheet's largest fact (ID-2).
    static let headlineFontSize: CGFloat = 52
    static let timeHeight: CGFloat = 60
    static let detailGap: CGFloat = 10
    static let detailHeight: CGFloat = 18
    /// The end-game block (host only): air, a hairline, air, one row.
    static let operationsAirAbove: CGFloat = 22
    static let dividerHeight: CGFloat = 1
    static let operationsAirBelow: CGFloat = 14
    static let operationRowHeight: CGFloat = 44

    static func height(hasDetail: Bool, operationRows: Int) -> CGFloat {
        verticalPadding * 2 + labelHeight + labelGap + timeHeight
            + (hasDetail ? detailGap + detailHeight : 0)
            + (operationRows > 0
                ? operationsAirAbove + dividerHeight + operationsAirBelow
                    + operationRowHeight * CGFloat(operationRows)
                : 0)
    }
}

/// The facts sheet: a short system sheet in the ShareQRSheet register (a fixed
/// detent, the drag indicator, the room's canvas to the safe area). Chrome stays
/// achromatic (§3): the sheet carries no color, only weight, and the one
/// destructive action shows its red in the system confirm dialog, never the body.
/// The 1 Hz timeline keeps the headline honest while the room runs.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RoomFactsSheet: View {
    let ground: GridGround
    let content: RoomFactsContent
    /// Already gated by the caller: the host's end-game mid-solve, `.none`
    /// otherwise.
    let operations: FactsOperations
    let solveTimeSeconds: Int?
    let firstFillAt: String?
    let completedAt: String?
    /// End the game (host abandon). Confirmed here first, then reported.
    let onEndGame: () -> Void

    @State private var confirmingEnd = false

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var quiet: Color { Color(rgb: ground.tokens.number) }

    var body: some View {
        sheetBody
            #if os(iOS)
                .presentationDetents([
                    .height(
                        RoomFactsSheetLayout.height(
                            hasDetail: content.detail != nil,
                            operationRows: operations.rowCount))
                ])
                .presentationDragIndicator(.visible)
            #endif
    }

    private var sheetBody: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            factsBody(now: timeline.date)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        .confirmationDialog(
            "End this game for everyone?",
            isPresented: $confirmingEnd,
            titleVisibility: .visible
        ) {
            // The one destructive confirm (EXPERIENCE.md: abandon, one confirm,
            // plainly worded). The system dialog owns the red; the sheet body
            // stays achromatic (DESIGN.md §3).
            Button("End game", role: .destructive, action: onEndGame)
            Button("Keep playing", role: .cancel) {}
        } message: {
            Text(verbatim: "This ends the game for everyone in the room.")
        }
    }

    private func factsBody(now: Date) -> some View {
        let time = RoomFactsClock.headline(
            solveTimeSeconds: solveTimeSeconds,
            firstFillAt: firstFillAt, completedAt: completedAt, now: now)
        return VStack(alignment: .leading, spacing: 0) {
            facts(time: time)
            if operations.hasAny {
                operationBlock()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, RoomFactsSheetLayout.verticalPadding)
        .padding(.horizontal, RoomFactsSheetLayout.horizontalPadding)
    }

    // MARK: Facts (the label, the headline time, the quiet detail)

    private func facts(time: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Natural casing: the uppercased small-caps register read wrong on
            // device (owner ruling 2026-07-10).
            Text(verbatim: content.label)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(quiet)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(height: RoomFactsSheetLayout.labelHeight, alignment: .leading)
            Color.clear.frame(height: RoomFactsSheetLayout.labelGap)
            Text(verbatim: time)
                .font(.system(
                    size: RoomFactsSheetLayout.headlineFontSize, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(ink)
                .frame(height: RoomFactsSheetLayout.timeHeight, alignment: .leading)
            if let detail = content.detail {
                Color.clear.frame(height: RoomFactsSheetLayout.detailGap)
                Text(verbatim: detail)
                    .font(.system(size: 15, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(quiet)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(
                        height: RoomFactsSheetLayout.detailHeight, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLine(time: time)))
    }

    // MARK: Operations (only what the API already supports, §12)

    private func operationBlock() -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: RoomFactsSheetLayout.operationsAirAbove)
            // A deterministic one-point hairline, not a system Divider: the
            // sheet's detent height is pinned arithmetic (RoomFactsSheetLayout),
            // and a hairline's scale-dependent height would unpin it.
            Rectangle()
                .fill(quiet.opacity(0.28))
                .frame(maxWidth: .infinity)
                .frame(height: RoomFactsSheetLayout.dividerHeight)
            Color.clear.frame(height: RoomFactsSheetLayout.operationsAirBelow)
            if operations.canEndGame {
                operationRow(
                    "End game", systemImage: "xmark.circle",
                    action: { confirmingEnd = true })
            }
        }
    }

    private func operationRow(
        _ title: String, systemImage: String, action: @escaping () -> Void
    ) -> some View {
        // Achromatic like all chrome (DESIGN.md §3): the destructive row reads in
        // ink too, and the red lives in the system confirm dialog.
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 16))
                    .frame(width: 24)
                Text(verbatim: title)
                    .font(.system(size: 16, weight: .medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity)
            .frame(height: RoomFactsSheetLayout.operationRowHeight)
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
