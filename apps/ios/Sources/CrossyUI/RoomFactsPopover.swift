// The mid-solve facts card as a system popover (owner ruling 2026-07-10). A tap
// on the time pill mid-solve raises this instead of the custom morph: MorphLab
// variant C proved a `.popover` with `.presentationCompactAdaptation(.popover)`
// flows out of a glass control the same way Mail's menu does, and hosts
// arbitrary content. The trap was whether the Menu-in-container break on 26.1
// (RosterMenu) also hits popovers; it does not (MorphLab variant D on the Air
// sim: a popover from a pill inside a GlassEffectContainer presents cleanly and
// leaves the cluster whole), so the time pill stays inside the cluster's
// container and the popover attaches to it.
//
// Content, the approved design: facts first (the room's name in natural casing,
// the puzzle's facts as the quiet detail line, the live clock as the ticking
// headline), a divider, then operations. Operations are ONLY what the API
// already supports (PROTOCOL.md §12): copy the invite code (a member holds it,
// `GET /games/{id}`), and for the host, end the game (`POST /games/{id}/abandon`,
// a `FORBIDDEN` for a non-host), which takes a confirm step. Kick is not here:
// it lives on the roster menu. A non-host with no code in hand sees facts alone,
// which the ruling accepts.
//
// The COMPLETION path does not change: at completion the tap still summons the
// clock-rider morph stats card (ID-2), so the pill routes here only while the
// room runs.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RoomFactsPopover: View {
    let ground: GridGround
    let content: RoomFactsContent
    let operations: FactsOperations
    /// The headline clock's inputs, the bar clock's own arithmetic (ID-2): mid
    /// solve it ticks against `now`; a terminal room never reaches this surface.
    let firstFillAt: String?
    let completedAt: String?
    /// Copy the invite code to the pasteboard (the composition root owns the
    /// platform clipboard, so CrossyUI stays free of UIKit; the row only reports
    /// the intent).
    let onCopyInviteCode: () -> Void
    /// End the game (host abandon). Confirmed here first, then reported.
    let onEndGame: () -> Void

    @State private var confirmingEnd = false

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var quiet: Color { Color(rgb: ground.tokens.number) }

    var body: some View {
        // The 1 Hz timeline keeps the headline honest: the room's clock never
        // stops for a card (the time pill is the room's facts).
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            card(now: timeline.date)
        }
        .presentationCompactAdaptation(.popover)
    }

    private func card(now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            facts(now: now)
            if operations.hasAny {
                Divider()
                    .padding(.horizontal, 16)
                operationRows
            }
        }
        .padding(.vertical, 12)
        .frame(width: 260)
        .confirmationDialog(
            "End this game for everyone?",
            isPresented: $confirmingEnd,
            titleVisibility: .visible
        ) {
            // The one destructive confirm (EXPERIENCE.md: abandon, one confirm,
            // plainly worded). The system dialog owns the red; the popover body
            // stays achromatic (DESIGN.md §3).
            Button("End game", role: .destructive, action: onEndGame)
            Button("Keep playing", role: .cancel) {}
        } message: {
            Text(verbatim: "This ends the game for everyone in the room.")
        }
    }

    // MARK: Facts (name, the quiet detail, the live clock headline)

    private func facts(now: Date) -> some View {
        let time = RoomFactsClock.headline(
            solveTimeSeconds: nil, firstFillAt: firstFillAt,
            completedAt: completedAt, now: now)
        return VStack(alignment: .leading, spacing: 4) {
            // Natural casing (owner ruling 2026-07-10: the uppercased register
            // read wrong on device).
            Text(verbatim: content.label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(quiet)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(verbatim: time)
                .font(.system(size: 34, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(ink)
            if let detail = content.detail {
                Text(verbatim: detail)
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(quiet)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, operations.hasAny ? 12 : 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: factsAccessibilityLine(time: time)))
    }

    // MARK: Operations (only what the API already supports, §12)

    @ViewBuilder
    private var operationRows: some View {
        VStack(spacing: 0) {
            if operations.inviteCode != nil {
                operationRow(
                    "Copy invite code", systemImage: "doc.on.doc",
                    role: nil, action: onCopyInviteCode)
            }
            if operations.canEndGame {
                operationRow(
                    "End game", systemImage: "xmark.circle",
                    role: .destructive, action: { confirmingEnd = true })
            }
        }
        .padding(.top, 8)
    }

    private func operationRow(
        _ title: String, systemImage: String, role: ButtonRole?,
        action: @escaping () -> Void
    ) -> some View {
        // Achromatic like all chrome (DESIGN.md §3): the destructive row reads
        // in ink too, and the red lives in the system confirm dialog. Symbols
        // template to the row's tint.
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
            .contentShape(Rectangle())
            .padding(.horizontal, 16)
            .frame(height: 40)
        }
        .buttonStyle(.plain)
    }

    private func factsAccessibilityLine(time: String) -> String {
        var line = "\(content.label), \(time)"
        if let detail = content.detail {
            line += ", \(detail.replacingOccurrences(of: " · ", with: ", "))"
        }
        return line
    }
}
