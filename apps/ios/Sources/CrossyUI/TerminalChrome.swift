// The terminal surfaces (roadmap I2d): the stats card and the kicked exit.
// The card is a custom overlay panel in the room's own hierarchy, the ChromeGlass
// grammar (never a system sheet, DESIGN.md §4); it presents as the mosaic settles
// (EXPERIENCE.md Completed: the mosaic, the frozen time, then the stats) and
// dismisses back to the frozen room. The kicked exit is the room's terminal
// screen: paper, the one honest sentence, and a way back (ID-5; EXPERIENCE.md
// Kicked). Copy lives in RoomTerminal so the words are pinned headlessly.

import CrossyDesign
import SwiftUI

/// The stats card (EXPERIENCE.md Completed: solve time, entries, solvers). The
/// frozen time is the headline (ID-2: the timer becomes the headline only at
/// completion); chrome stays achromatic (DESIGN.md §3), so the card carries no
/// color, only weight.
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct StatsCardPanel: View {
    let ground: GridGround
    let content: StatsCardContent

    var body: some View {
        VStack(spacing: 6) {
            // An uppercase label takes a touch of tracking (DESIGN.md §6).
            Text(verbatim: RoomTerminal.completedNotice.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Color(rgb: ground.tokens.number))
            Text(verbatim: content.time)
                .font(.system(size: 40, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Color(rgb: ground.tokens.ink))
            if let detail = content.detail {
                Text(verbatim: detail)
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            }
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 22)
        .frame(maxWidth: .infinity)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.panelCornerRadius))
        .contentShape(RoundedRectangle(
            cornerRadius: ChromeLayout.panelCornerRadius, style: .continuous))
        .onTapGesture {}  // a tap inside the card never falls through to the catcher
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLine))
    }

    private var accessibilityLine: String {
        var line = "\(RoomTerminal.completedNotice) in \(content.time)"
        if let detail = content.detail {
            line += ", \(detail.replacingOccurrences(of: " · ", with: ", "))"
        }
        return line
    }
}

/// The kicked exit: the room's terminal screen. One honest sentence, plainly
/// worded (ID-5), and one affordance out so it is never a dead end; the seat is
/// gone and the code is dead for this account (denylist), so nothing else here
/// pretends otherwise.
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct KickedExit: View {
    let ground: GridGround
    let onExit: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Text(verbatim: RoomTerminal.kickedNotice)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .multilineTextAlignment(.center)
            Button(action: onExit) {
                Text(verbatim: RoomTerminal.kickedExitWord)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .padding(.horizontal, 28)
                    .frame(height: 46)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .modifier(ChromeGlassSurface(cornerRadius: 23))
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
    }
}
