// The post-game analysis surface's content (owner ruling 2026-07-13, the approved
// mock): the same readout the web panel carries, re-set native on the bone/void
// ground. It rides inside the completed clue chrome's Analysis tab (ClueChrome),
// so this view is content only, no scroll of its own and no chrome: the "Solved
// together" eyebrow, the Time/Solvers/Squares trio, the roster legend, the
// momentum ribbon, and the title cards (design/post-game/TITLES.md; the person
// moment cards, First square and Last square, retired in their favor).
//
// Everything here is first-correct truth from GET /analysis (RoomAnalysis): the
// legend and the titles read the bundle's userIds, colored through the same
// roster seam the avatars and the mosaic use (GridPresence.rosterColor). No solve
// value is in reach (INV-6): the bundle carries userIds, cells, and numbers only.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
struct AnalysisPanel: View {
    let phase: AnalysisModel.Phase
    /// The room's people, for the legend and the moments' names and colors.
    let members: [RosterMember]
    let selfUserId: String?
    let ground: GridGround
    /// The isolated solver on the settled wash (the legend chips' selected
    /// state), or nil at the full multi-color record.
    let isolatedSolverId: String?
    /// Isolate a solver from their legend chip: same-tap clears, another
    /// switches (CompletionModel.toggleIsolation). Nil while isolation is
    /// unavailable — the bloom still playing — where the chips stay the plain
    /// labels they always were.
    let onIsolateSolver: ((String) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch phase {
            case .idle, .loading:
                placeholder("Loading\u{2026}")
            case .absent:
                placeholder("Analysis isn\u{2019}t available for this game.")
            case let .ready(analysis):
                content(analysis)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 22)
    }

    // MARK: States

    private func placeholder(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            eyebrow("Solved together")
            Text(verbatim: text)
                .font(.system(size: 14))
                .foregroundStyle(Color(rgb: ground.tokens.number))
        }
    }

    @ViewBuilder
    private func content(_ analysis: RoomAnalysis) -> some View {
        eyebrow("Solved together")
            .padding(.bottom, 12)

        statTrio(analysis)

        let legend = legendRows(analysis)
        if !legend.isEmpty {
            // Tighter chip spacing once the rows wear the tappable capsule
            // (its own padding carries the air); the plain labels keep theirs.
            FlowLayout(spacing: onIsolateSolver == nil ? 14 : 8, lineSpacing: 8) {
                ForEach(legend) { row in
                    legendChip(row)
                }
            }
            .padding(.top, 14)
            Text(verbatim: legendCaption(legend))
                .font(.system(size: 11))
                .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.85))
                .padding(.top, 6)
        }

        // Momentum: the ribbon plus the one line that reads it.
        capsLabel("Momentum")
            .padding(.top, 20)
            .padding(.bottom, 8)
        MomentumRibbon(
            momentum: analysis.momentum,
            turningPoint: analysis.turningPoint,
            ground: ground)
        Text(verbatim: momentumCaption(analysis))
            .font(.system(size: 11))
            .lineSpacing(1.5)
            .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.85))
            .padding(.top, 8)

        // Titles: everyone's superlative (design/post-game/TITLES.md), one card per
        // titled solver, in the wire's ladder-rank order (reordering client-side would
        // fork the two platforms' surfaces). An unknown key renders nothing (PROTOCOL
        // §12: a client MUST ignore an unknown key; that is how the ladder grows), and
        // a solo solve (or an older API) ships no titles, so the section vanishes
        // entirely, never an empty-state box.
        let cards = analysis.titles.compactMap(TitleLadder.card(for:))
        if !cards.isEmpty {
            capsLabel("Titles")
                .padding(.top, 22)
                .padding(.bottom, 2)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(cards.enumerated()), id: \.element.userId) { index, card in
                    if index > 0 {
                        Rectangle()
                            .fill(Color(rgb: ground.tokens.number).opacity(0.18))
                            .frame(height: 1)
                    }
                    titleRow(card)
                }
            }
        }
    }

    // MARK: The legend

    /// One legend row. Once the wash settles the row is a button that isolates
    /// its solver on the board: a quiet capsule marks it tappable (the stat
    /// trio's hairline vocabulary), and the selected chip wears its solver's
    /// color — color stays with the person, chrome stays achromatic (DESIGN.md
    /// §3). While the bloom still plays (`onIsolateSolver` nil) the row is the
    /// plain label it always was.
    @ViewBuilder
    private func legendChip(_ row: LegendRow) -> some View {
        let isIsolated = row.id == isolatedSolverId
        let label = HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(Color(rgb: row.color))
                .frame(width: 10, height: 10)
            Text(verbatim: row.name)
                .font(
                    .system(
                        size: 12.5, weight: row.isSelf || isIsolated ? .semibold : .regular))
                .foregroundStyle(
                    Color(
                        rgb: row.isSelf || isIsolated
                            ? ground.tokens.ink : ground.tokens.number))
        }
        if let onIsolateSolver {
            Button {
                onIsolateSolver(row.id)
            } label: {
                label
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(
                        Capsule(style: .continuous)
                            .fill(Color(rgb: row.color).opacity(isIsolated ? 0.16 : 0)))
                    .overlay(
                        Capsule(style: .continuous)
                            .stroke(
                                isIsolated
                                    ? Color(rgb: row.color).opacity(0.55)
                                    : Color(rgb: ground.tokens.number).opacity(0.22),
                                lineWidth: 1))
                    .contentShape(Capsule(style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: row.name))
            .accessibilityHint(
                Text(
                    verbatim: isIsolated
                        ? "Shows everyone\u{2019}s squares again."
                        : row.isSelf
                            ? "Shows only your squares on the board."
                            : "Shows only their squares on the board."))
            .accessibilityAddTraits(isIsolated ? .isSelected : [])
        } else {
            label
        }
    }

    /// The legend's one caption: what the squares mean; then, once the chips
    /// can isolate, what a tap does; then who is isolated. The caption is the
    /// tappability affordance in words, matching the web legend's grammar.
    private func legendCaption(_ legend: [LegendRow]) -> String {
        guard onIsolateSolver != nil else {
            return "Each square shows who solved it first."
        }
        if let isolated = legend.first(where: { $0.id == isolatedSolverId }) {
            return isolated.isSelf
                ? "Showing only your squares. Tap again for everyone."
                : "Showing only \(isolated.name)\u{2019}s squares. Tap again for everyone."
        }
        return "Each square shows who solved it first. Tap a solver to see just theirs."
    }

    // MARK: The stat trio

    private func statTrio(_ analysis: RoomAnalysis) -> some View {
        let cells: [(label: String, value: String)] = [
            ("Time", analysis.durationLabel),
            ("Solvers", String(analysis.solverCount)),
            ("Squares", String(analysis.entryCount)),
        ]
        return HStack(spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
                if index > 0 {
                    Rectangle()
                        .fill(Color(rgb: ground.tokens.number).opacity(0.18))
                        .frame(width: 1)
                }
                VStack(spacing: 5) {
                    capsLabel(cell.label)
                    Text(verbatim: cell.value)
                        .font(.system(size: 21, weight: .regular, design: .monospaced))
                        .foregroundStyle(Color(rgb: ground.tokens.ink))
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color(rgb: ground.tokens.number).opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Titles

    /// One title card, the retired moment row's exact grammar plus the evidence line:
    /// the solver's dot, the title's caps label, the name, and the claim (nothing when
    /// the rung's number did not arrive; the card degrades to the label alone).
    private func titleRow(_ card: TitleCard) -> some View {
        HStack(spacing: 11) {
            Circle()
                .fill(Color(rgb: color(for: card.userId)))
                .frame(width: 11, height: 11)
            VStack(alignment: .leading, spacing: 2) {
                capsLabel(card.label)
                Text(verbatim: name(for: card.userId))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                if let detail = card.detail {
                    Text(verbatim: detail)
                        .font(.system(size: 12))
                        .lineSpacing(1.5)
                        .foregroundStyle(Color(rgb: ground.tokens.number).opacity(0.85))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 11)
    }

    // MARK: Labels

    private func eyebrow(_ text: String) -> some View {
        Text(verbatim: text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(Color(rgb: AnalysisPalette.goldText(ground)))
    }

    private func capsLabel(_ text: String) -> some View {
        Text(verbatim: text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(1.1)
            .foregroundStyle(Color(rgb: ground.tokens.number))
    }

    // MARK: Derivations

    private struct LegendRow: Identifiable {
        let id: String
        let name: String
        let color: CrossyDesign.RGBColor
        let isSelf: Bool
    }

    /// The solvers who own at least one square, self first and named "You" (the
    /// web's legendSolvers). A member who owns nothing is dropped; an owner who is
    /// no longer in the roster is not invented here (the titles still name them).
    private func legendRows(_ analysis: RoomAnalysis) -> [LegendRow] {
        let owners = Set(analysis.owners.values)
        var rows: [LegendRow] = []
        for member in members where owners.contains(member.userId) {
            let isSelf = member.userId == selfUserId
            let row = LegendRow(
                id: member.userId,
                name: isSelf ? "You" : member.displayName,
                color: color(for: member.userId, wireColor: member.wireColor),
                isSelf: isSelf)
            if isSelf {
                rows.insert(row, at: 0)
            } else {
                rows.append(row)
            }
        }
        return rows
    }

    /// The one line that reads the ribbon, matching the web copy. Falls back to the
    /// short-solve sentence when there is no pause to shade.
    private func momentumCaption(_ analysis: RoomAnalysis) -> String {
        guard analysis.momentum.hasSignal, analysis.turningPoint != nil else {
            return "Height tracks solving speed over the course of the solve."
        }
        return
            "Height tracks solving speed. The shaded span is the room\u{2019}s longest pause; the marker is where solving picked back up."
    }

    /// The roster color for a userId, through the same seam the avatars and mosaic
    /// use: the wire color when the member is known, the userId hash otherwise
    /// (GridPresence.rosterColor tolerates an empty wire and falls back), then
    /// paired for this ground.
    private func color(for userId: String, wireColor: String = "") -> CrossyDesign.RGBColor {
        let wire =
            wireColor.isEmpty
            ? (members.first { $0.userId == userId }?.wireColor ?? "") : wireColor
        return ground.rosterColor(GridPresence.rosterColor(wireColor: wire, userId: userId))
    }

    /// A solver's name for the title cards: "You", the roster display name, or a plain
    /// fallback for someone who has left (the wire never hands us a nameless live
    /// member, but a titled solver can outlive their roster row).
    private func name(for userId: String) -> String {
        if userId == selfUserId { return "You" }
        return members.first { $0.userId == userId }?.displayName ?? "A solver"
    }
}

/// A minimal flow layout (iOS 16+ Layout): lays chips left to right and wraps to a
/// new line when the next one would overflow the proposed width, the legend's
/// flex-wrap (the web panel). Small rosters, so a plain greedy pass is enough; no
/// caching earns its keep here.
@available(iOS 17.0, macOS 14.0, *)
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = rows(subviews: subviews, maxWidth: maxWidth)
        let height =
            rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: maxWidth.isFinite ? min(width, maxWidth) : width, height: height)
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        var y = bounds.minY
        for row in rows(subviews: subviews, maxWidth: bounds.width) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(subviews: Subviews, maxWidth: CGFloat) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let projected =
                current.items.isEmpty ? size.width : current.width + spacing + size.width
            if !current.items.isEmpty, projected > maxWidth {
                rows.append(current)
                current = Row(items: [index], width: size.width, height: size.height)
            } else {
                current.width = projected
                current.height = max(current.height, size.height)
                current.items.append(index)
            }
        }
        if !current.items.isEmpty { rows.append(current) }
        return rows
    }
}
