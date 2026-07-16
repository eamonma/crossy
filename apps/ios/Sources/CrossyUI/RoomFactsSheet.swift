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
    /// The room's check record while it runs ("Checked once" / "Checked N times",
    /// PROTOCOL.md §10, D27; design R10): a quiet, neutral line among the facts —
    /// no attribution, matching the wire event's missing `by`. Nil until the first
    /// accepted check. Mid-solve only: after completion the count freezes into
    /// `stats.checkCount`, whose display home is a future analysis-surface row.
    public let checkedLine: String?

    public init(label: String, detail: String?, checkedLine: String? = nil) {
        self.label = label
        self.detail = detail
        self.checkedLine = checkedLine
    }

    public static func make(
        roomName: String,
        puzzleTitle: String?,
        puzzleAuthor: String?,
        puzzleDate: String?,
        completed: Bool,
        totalEvents: Int?,
        participantCount: Int?,
        checkCount: Int = 0
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
            detail: facts.isEmpty ? nil : facts.joined(separator: " · "),
            checkedLine: Self.checkedLine(count: checkCount))
    }

    /// The R10 wording, natural casing, no zeros: nil before the first check.
    static func checkedLine(count: Int) -> String? {
        switch count {
        case ..<1: return nil
        case 1: return "Checked once"
        default: return "Checked \(count) times"
        }
    }
}

/// The sheet's operations, derived once so the view renders no policy (the
/// RoomFactsContent pattern). Two rows can stand: the room check (any host or
/// solver, PROTOCOL.md §5, §10; D27) above the host's end-game (`POST
/// /games/{id}/abandon`, host only, PROTOCOL.md §12). Both take a confirm step
/// in the view; a participant offered neither sees facts alone, which is fine.
public struct FactsOperations: Equatable, Sendable {
    /// The check row's render facts (design R7): present means the row stands;
    /// enabled only when the grid is full, with the quiet remaining-cells hint
    /// teaching the gate below full.
    public struct Check: Equatable, Sendable {
        /// Playable cells still empty in SEQUENCED state (R9: overlays excluded,
        /// the server's own filledCount gate mirrored).
        public let emptyCells: Int

        public init(emptyCells: Int) {
            self.emptyCells = max(0, emptyCells)
        }

        /// The grid-full gate (PROTOCOL.md §5: checkPuzzle requires a full grid).
        public var isEnabled: Bool { emptyCells == 0 }

        /// The quiet trailing hint while the grid is short; nil at full. Inside
        /// the row's standard height, no extra slot (R7).
        public var hint: String? {
            switch emptyCells {
            case 0: return nil
            case 1: return "1 empty"
            default: return "\(emptyCells) empty"
            }
        }
    }

    /// The check row, hosts and solvers only, and only where the transport
    /// carries `checkPuzzle` (R8: the demo's loopback drops it, so the demo
    /// never grows the row). Nil renders nothing.
    public let check: Check?
    /// The host's destructive end-game, offered only to the host (the server
    /// refuses a non-host abandon anyway; the client simply does not show it).
    public let canEndGame: Bool

    public init(check: Check? = nil, canEndGame: Bool) {
        self.check = check
        self.canEndGame = canEndGame
    }

    /// The operations for the local participant. `isHost` gates the destructive
    /// end-game; the check row needs a live check-capable transport (R8), a
    /// playing seat (spectators never see it, PROTOCOL.md §5's host|solver), and
    /// carries the sequenced empty-cell count for its own enable gate (R9).
    public static func make(
        isHost: Bool, isSpectator: Bool, supportsCheck: Bool, emptyCells: Int
    ) -> FactsOperations {
        FactsOperations(
            check: supportsCheck && !isSpectator ? Check(emptyCells: emptyCells) : nil,
            canEndGame: isHost)
    }

    /// The empty set (a spectator non-host, or any state that offers no operations).
    public static let none = FactsOperations(check: nil, canEndGame: false)

    /// How many operation rows render, the sheet-height arithmetic's input.
    public var rowCount: Int {
        (check != nil ? 1 : 0) + (canEndGame ? 1 : 0)
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
    /// The checked-count facts line (R10), its own slot (R7: the formula counts
    /// every conditional honestly or the sheet clips).
    static let checkedLineGap: CGFloat = 10
    static let checkedLineHeight: CGFloat = 18
    /// The operations block: air, a hairline, air, then the rows (check above
    /// end-game). The check row's remaining-cells hint renders INSIDE the standard
    /// row height at the trailing edge — no extra slot (R7).
    static let operationsAirAbove: CGFloat = 22
    static let dividerHeight: CGFloat = 1
    static let operationsAirBelow: CGFloat = 14
    static let operationRowHeight: CGFloat = 44

    static func height(
        hasDetail: Bool, hasCheckedLine: Bool, operationRows: Int
    ) -> CGFloat {
        verticalPadding * 2 + labelHeight + labelGap + timeHeight
            + (hasDetail ? detailGap + detailHeight : 0)
            + (hasCheckedLine ? checkedLineGap + checkedLineHeight : 0)
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
    /// Already gated by the caller: the check row and the host's end-game
    /// mid-solve, `.none` otherwise.
    let operations: FactsOperations
    let solveTimeSeconds: Int?
    let firstFillAt: String?
    let completedAt: String?
    /// Check the puzzle for the room (PROTOCOL.md §5, §10; D27). Confirmed here
    /// first, then reported; the caller re-derives the grid-full gate at the
    /// confirm tap (design R2) and owns the send.
    let onCheckPuzzle: () -> Void
    /// End the game (host abandon). Confirmed here first, then reported.
    let onEndGame: () -> Void

    @State private var confirmingCheck = false
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
                            hasCheckedLine: content.checkedLine != nil,
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
            if let checkedLine = content.checkedLine {
                // The check record (R10): quiet and neutral, no attribution
                // (the wire event carries no `by`, D27).
                Color.clear.frame(height: RoomFactsSheetLayout.checkedLineGap)
                Text(verbatim: checkedLine)
                    .font(.system(size: 15, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(quiet)
                    .lineLimit(1)
                    .frame(
                        height: RoomFactsSheetLayout.checkedLineHeight,
                        alignment: .leading)
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
            if let check = operations.check {
                checkRow(check)
            }
            if operations.canEndGame {
                operationRow(
                    "End game", systemImage: "xmark.circle",
                    action: { confirmingEnd = true })
            }
        }
    }

    /// The check row (PROTOCOL.md §5, §10; D27), above end-game: enabled only on
    /// a full grid, teaching the gate below full with the quiet remaining-cells
    /// hint at the trailing edge, inside the standard row height (R7). The
    /// confirm is the end-game register exactly but non-destructive (D27: the
    /// client interposes the one confirmation; the command is the confirmed
    /// intent) — plain tint, no red.
    private func checkRow(_ check: FactsOperations.Check) -> some View {
        Button(action: { confirmingCheck = true }) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 16))
                    .frame(width: 24)
                Text(verbatim: "Check puzzle")
                    .font(.system(size: 16, weight: .medium))
                Spacer(minLength: 0)
                if let hint = check.hint {
                    Text(verbatim: hint)
                        .font(.system(size: 13, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(quiet)
                }
            }
            .foregroundStyle(check.isEnabled ? ink : quiet)
            .frame(maxWidth: .infinity)
            .frame(height: RoomFactsSheetLayout.operationRowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!check.isEnabled)
        .confirmationDialog(
            "Check the puzzle for everyone?",
            isPresented: $confirmingCheck,
            titleVisibility: .visible
        ) {
            Button("Check puzzle", action: onCheckPuzzle)
            Button("Keep solving", role: .cancel) {}
        } message: {
            Text(verbatim: "Wrong letters get marked for the whole room.")
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
        if let checkedLine = content.checkedLine {
            line += ", \(checkedLine)"
        }
        return line
    }
}
