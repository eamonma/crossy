// The roster panel (EXPERIENCE.md roster sheet, I2c slice): the room bar's puck
// cluster inflates into a small floating panel, the same single-surface morph
// grammar as the melt (SP-i1: one persistent surface interpolating frame and
// radius; the glassEffectID two-view swap snaps and is not built on). Tap-driven,
// so the discipline is trivial: the one animation runs on the tap, none mid-flight.
// Contents this wave: people with color, name, role, and presence; a spectating
// self gets the one affordance, Join in (ID-5), stubbed to a closure until I3
// wires the seat change. Host powers (kick, abandon) are I3's, with their
// endpoints.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RosterPanel: View {
    let ground: GridGround
    let morph: GlassMorph
    let members: [RosterMember]
    let selfUserId: String?
    let chrome: RoomChromeModel
    let onJoinIn: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let progress = chrome.rosterProgress
        let frame = morph.frame(at: progress)
        let radius = morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)

        rows
            .opacity(GlassMorphContent.listOpacity(at: progress))
            .allowsHitTesting(progress >= 1)
            .frame(width: frame.width, height: frame.height, alignment: .top)
            .clipShape(shape)
            .modifier(ChromeGlassSurface(cornerRadius: radius))
            .contentShape(shape)
            .onTapGesture {}  // a tap inside the panel never falls through to the catcher
            .position(x: frame.midX, y: frame.midY)
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(RosterList.ordered(members)) { member in
                memberRow(member)
            }
            if RosterList.selfIsSpectator(members, selfUserId: selfUserId) {
                joinIn
            }
        }
        .padding(.vertical, 10)
    }

    private func memberRow(_ member: RosterMember) -> some View {
        HStack(spacing: 10) {
            RosterPuckView(member: member, ground: ground, diameter: 26)
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
        .padding(.horizontal, 16)
        .frame(height: 44)
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
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}
