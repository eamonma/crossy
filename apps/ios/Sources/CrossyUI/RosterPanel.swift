// The roster panel (EXPERIENCE.md roster sheet, I2c slice): the room bar's
// players pill inflates into a small floating panel, whole (owner ruling
// 2026-07-10: the pill is the morph's rest surface, so no glass ever grows out
// of standing glass), the same single-surface morph grammar as the melt (SP-i1:
// one persistent surface interpolating frame and radius; the glassEffectID
// two-view swap snaps and is not built on). Tap-driven, so the discipline is
// trivial: the one animation runs on the tap, none mid-flight.
//
// Content rides the morph (owner device finding 2026-07-10: the first build
// inflated hollow glass and left the bar's cluster rendering beneath the panel's
// rows, the same people twice). The pucks are the continuity carriers: the
// players pill hands off the moment the panel exists, and each clustered puck
// travels from its reported bar frame into its row slot as one object, growing
// from cluster to row diameter on the way. Names, state words, and any overflow rows
// fade in late (GlassMorphContent), the panel's new content rather than its
// riders.
//
// Contents this wave: people with color, name, role, and presence; a spectating
// self gets the one affordance, Join in (ID-5), stubbed to a closure until I3
// wires the seat change. Host powers (kick, abandon) are I3's, with their
// endpoints.

import CrossyDesign
import SwiftUI

/// The riders' pure geometry, pinned in tests so the view carries no arithmetic
/// of its own (the GlassMorph pattern). Row metrics live here because the rider
/// at progress 1 must land exactly where the row lays its puck slot.
enum RosterRideLayout {
    static let rowHeight: CGFloat = 44
    static let topPadding: CGFloat = 10
    static let leadingPadding: CGFloat = 16
    static let clusterPuckDiameter: CGFloat = 24
    static let rowPuckDiameter: CGFloat = 26

    /// A rider's landing point in panel-local coordinates: row `index`'s puck
    /// slot center.
    static func openCenter(rowIndex: Int) -> CGPoint {
        CGPoint(
            x: leadingPadding + rowPuckDiameter / 2,
            y: topPadding + rowHeight * CGFloat(rowIndex) + rowHeight / 2)
    }

    /// The puck grows from cluster size to row size as it travels.
    static func diameter(at progress: CGFloat) -> CGFloat {
        GlassMorph.lerp(clusterPuckDiameter, rowPuckDiameter, progress)
    }

    /// The rider's center at a progress, in the CURRENT frame's local space:
    /// a straight room-space line from the bar's cluster slot to the open row
    /// slot, re-expressed against the interpolating surface. Both endpoints sit
    /// inside their frames, so a lerped rider never escapes the lerped surface.
    static func center(
        rest: CGPoint, openLocal: CGPoint, morph: GlassMorph, progress: CGFloat
    ) -> CGPoint {
        let openRoom = CGPoint(
            x: morph.open.minX + openLocal.x, y: morph.open.minY + openLocal.y)
        let frame = morph.frame(at: progress)
        return CGPoint(
            x: GlassMorph.lerp(rest.x, openRoom.x, progress) - frame.minX,
            y: GlassMorph.lerp(rest.y, openRoom.y, progress) - frame.minY)
    }
}

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RosterPanel: View {
    let ground: GridGround
    let morph: GlassMorph
    let members: [RosterMember]
    /// Room-space centers of the bar's cluster pucks by userId, as layout
    /// reported them: where each rider launches from. A member absent here
    /// (overflow, or a mid-morph join) has no rider and keeps a row puck.
    let restCenters: [String: CGPoint]
    let selfUserId: String?
    let chrome: RoomChromeModel
    let onJoinIn: () -> Void

    var body: some View {
        let progress = chrome.rosterProgress
        let frame = morph.frame(at: progress)
        let radius = morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let ordered = RosterList.ordered(members)

        ZStack(alignment: .topLeading) {
            rows(ordered: ordered)
                .opacity(GlassMorphContent.listOpacity(at: progress))
                .allowsHitTesting(progress >= 1)
                .frame(width: frame.width, height: frame.height, alignment: .top)
            riders(ordered: ordered, progress: progress)
                .allowsHitTesting(false)
        }
        .frame(width: frame.width, height: frame.height)
        .clipShape(shape)
        .modifier(ChromeGlassSurface(cornerRadius: radius))
        .contentShape(shape)
        // An inside tap stays the panel's: only touches OUTSIDE a transient
        // dismiss it (DESIGN.md §4), so this blocker keeps a panel tap from
        // falling through to the room's dismiss-and-land layer.
        .onTapGesture {}
        .position(x: frame.midX, y: frame.midY)
    }

    // MARK: The riders (the pucks, one object end to end)

    @ViewBuilder
    private func riders(ordered: [RosterMember], progress: CGFloat) -> some View {
        ForEach(Array(ordered.enumerated()), id: \.element.id) { index, member in
            if let rest = restCenters[member.userId] {
                RosterPuckView(
                    member: member, ground: ground,
                    diameter: RosterRideLayout.diameter(at: progress)
                )
                .position(
                    RosterRideLayout.center(
                        rest: rest,
                        openLocal: RosterRideLayout.openCenter(rowIndex: index),
                        morph: morph, progress: progress))
            }
        }
    }

    // MARK: The rows

    private func rows(ordered: [RosterMember]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(ordered) { member in
                memberRow(member, ridden: restCenters[member.userId] != nil)
            }
            if RosterList.selfIsSpectator(members, selfUserId: selfUserId) {
                joinIn
            }
        }
        .padding(.vertical, RosterRideLayout.topPadding)
    }

    /// A ridden member's puck slot stays clear: the rider IS their puck, landing
    /// exactly here at progress 1. Overflow members keep an in-row puck that
    /// fades in with the row (they were a +N in the bar, not a puck).
    private func memberRow(_ member: RosterMember, ridden: Bool) -> some View {
        HStack(spacing: 10) {
            if ridden {
                Color.clear.frame(
                    width: RosterRideLayout.rowPuckDiameter,
                    height: RosterRideLayout.rowPuckDiameter)
            } else {
                RosterPuckView(
                    member: member, ground: ground,
                    diameter: RosterRideLayout.rowPuckDiameter)
            }
            Text(verbatim: member.displayName)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .lineLimit(1)
            Spacer(minLength: 8)
            if let state = stateWord(member) {
                Text(verbatim: state)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            }
        }
        .padding(.horizontal, RosterRideLayout.leadingPadding)
        .frame(height: RosterRideLayout.rowHeight)
        .opacity(member.connected ? 1 : 0.45)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLine(member)))
    }

    /// The quiet trailing word (ID-5 lexicon: plain, no metaphors): Away beats the
    /// role because presence is what the room asks first; Watching is the
    /// spectator word; Host names the seat; a connected solver needs no word.
    private func stateWord(_ member: RosterMember) -> String? {
        if !member.connected { return "Away" }
        if member.isSpectator { return "Watching" }
        if member.isHost { return "Host" }
        return nil
    }

    private func accessibilityLine(_ member: RosterMember) -> String {
        var line = member.displayName
        if member.userId == selfUserId { line += ", you" }
        if let word = stateWord(member) { line += ", \(word.lowercased())" }
        return line
    }

    /// The spectator's one action (EXPERIENCE.md): plain words, achromatic chrome
    /// (an ink wash, not a tint; DESIGN.md §3), the seat change itself is I3's.
    private var joinIn: some View {
        Button(action: onJoinIn) {
            Text(verbatim: "Join in")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(
                    Capsule().fill(Color(rgb: ground.tokens.ink).opacity(0.08))
                )
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, RosterRideLayout.leadingPadding)
        .padding(.top, 8)
    }
}
