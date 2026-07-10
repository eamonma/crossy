// The terminal surfaces (roadmap I2d): the stats card and the kicked exit.
// The card is a morph, not a presentation (owner ruling 2026-07-10, replacing the
// first build's transitioned overlay and its Stats button): ID-2 says the timer
// becomes the headline only at completion, so the headline comes FROM the timer.
// The time pill inflates into the card, the time itself riding the surface from
// pill size to headline size (DESIGN.md §4: content rides the morph; the whole
// pill hands off exactly as the players pill does); label and detail fade in
// late as the card's new content. Dismissal pours the time back into the bar, and
// tapping the frozen clock summons the card again. The kicked exit is the room's
// terminal screen: paper, the one honest sentence, and a way back (ID-5;
// EXPERIENCE.md Kicked). Copy lives in RoomTerminal so the words are pinned
// headlessly.

import CrossyDesign
import SwiftUI

/// The stats morph's pure geometry, pinned in tests (the RosterRideLayout
/// pattern): the card's rows are fixed-height slots so the rider's landing point
/// is arithmetic, not font metrics, and the rider at progress 1 sits exactly in
/// the headline slot.
enum StatsRideLayout {
    static let panelMaxWidth: CGFloat = 340
    static let verticalPadding: CGFloat = 22
    static let labelHeight: CGFloat = 14
    static let rowGap: CGFloat = 6
    static let timeHeight: CGFloat = 48
    static let detailHeight: CGFloat = 16
    /// The clock's size in the time pill and the headline's size in the card.
    static let restFontSize: CGFloat = 13
    static let openFontSize: CGFloat = 40

    static func panelHeight(hasDetail: Bool) -> CGFloat {
        verticalPadding * 2 + labelHeight + rowGap + timeHeight
            + (hasDetail ? rowGap + detailHeight : 0)
    }

    /// The headline slot's center in panel-local coordinates.
    static func timeCenterY() -> CGFloat {
        verticalPadding + labelHeight + rowGap + timeHeight / 2
    }

    static func fontSize(at progress: CGFloat) -> CGFloat {
        GlassMorph.lerp(restFontSize, openFontSize, progress)
    }

    /// The rider's center at a progress, in the CURRENT frame's local space: a
    /// straight room-space line from the clock's center (the morph's rest
    /// center, since the time pill IS the rest surface and centers its clock)
    /// to the headline slot, re-expressed against the interpolating surface.
    static func timeCenter(morph: GlassMorph, progress: CGFloat) -> CGPoint {
        let rest = CGPoint(x: morph.rest.midX, y: morph.rest.midY)
        let openRoom = CGPoint(
            x: morph.open.midX, y: morph.open.minY + timeCenterY())
        let frame = morph.frame(at: progress)
        return CGPoint(
            x: GlassMorph.lerp(rest.x, openRoom.x, progress) - frame.minX,
            y: GlassMorph.lerp(rest.y, openRoom.y, progress) - frame.minY)
    }
}

/// The stats card as one morphing glass surface (EXPERIENCE.md Completed: solve
/// time, entries, solvers). The frozen time is the rider and the headline (ID-2);
/// chrome stays achromatic (DESIGN.md §3), so the card carries no color, only
/// weight.
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct StatsMorphPanel: View {
    let ground: GridGround
    let morph: GlassMorph
    let content: StatsCardContent
    let chrome: RoomChromeModel

    var body: some View {
        let progress = chrome.statsProgress
        let frame = morph.frame(at: progress)
        let radius = morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)

        ZStack(alignment: .topLeading) {
            rows
                .opacity(GlassMorphContent.listOpacity(at: progress))
                .frame(width: frame.width, height: frame.height, alignment: .top)
            // The rider: the frozen time, one object from bar clock to headline.
            Text(verbatim: content.time)
                .font(.system(
                    size: StatsRideLayout.fontSize(at: progress), weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .position(StatsRideLayout.timeCenter(morph: morph, progress: progress))
                .allowsHitTesting(false)
        }
        .frame(width: frame.width, height: frame.height)
        .clipShape(shape)
        .modifier(ChromeGlassSurface(cornerRadius: radius))
        .contentShape(shape)
        // An inside tap stays the card's: only touches OUTSIDE a transient
        // dismiss it (DESIGN.md §4), the RosterPanel blocker rule.
        .onTapGesture {}
        .position(x: frame.midX, y: frame.midY)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLine))
    }

    /// The card's new content: fixed-height slots (the rider lands by arithmetic),
    /// the headline slot left clear for it. Both lines take .fixedSize() so a
    /// mid-morph width never truncates them to an ellipsis (owner device
    /// finding 2026-07-10, the stats pour-back): each keeps its intrinsic
    /// width and clips under the surface's clipShape while listOpacity fades it.
    private var rows: some View {
        VStack(spacing: StatsRideLayout.rowGap) {
            // An uppercase label takes a touch of tracking (DESIGN.md §6).
            Text(verbatim: RoomTerminal.completedNotice.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Color(rgb: ground.tokens.number))
                .fixedSize()
                .frame(height: StatsRideLayout.labelHeight)
            Color.clear
                .frame(height: StatsRideLayout.timeHeight)
            if let detail = content.detail {
                Text(verbatim: detail)
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .fixedSize()
                    .frame(height: StatsRideLayout.detailHeight)
            }
        }
        .padding(.vertical, StatsRideLayout.verticalPadding)
        .frame(maxWidth: .infinity)
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
