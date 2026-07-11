// The roster as a system presentation (owner ruling 2026-07-10, the morph lab's
// verdict on the Mail mechanism: "exactly what i want"). Mail's "..." button is
// a stock menu, and its goo is the presentation system's own: menus flow out of
// the glass controls that present them (WWDC25 session 323), the shader
// blending the departing pill into the arriving surface. Frame study of the
// owner's recording proved that blend unreachable by hand (soft mid-flight
// edges are two shapes' fields merging, not a tweened rect), so the players
// pill now IS a Menu label and the system owns the morph. The custom roster
// panel and its puck riders retired with this; the GlassMorph single-surface
// grammar remains the law for drag-scrubbed morphs (the melt, SP-i1) and the
// stats card.
//
// Menu rows carry rendered puck images: a non-template image passes through in
// full color (Messages' pin menus show contact photos), where a symbol would
// template to gray. Name is the title, the quiet state word the subtitle
// (ID-5 lexicon), and the spectator's one affordance, Join in, is a real menu
// action. Presence order is RosterList's, the same rule the pill cluster reads.
//
// Two caveats, both deliberate: a Menu inside a GlassEffectContainer breaks its
// morph on 26.1 (ecosystem finding), so this pill stands OUTSIDE the cluster's
// container; and the system glass button cannot read the clarity beat's
// environment flag, a gap that rides the clarity beat's own pending keep-or-cut
// ruling.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct RosterMenu: View {
    let ground: GridGround
    let members: [RosterMember]
    let selfUserId: String?
    let onJoinIn: () -> Void
    /// Kick a member (owner ruling 2026-07-10: the host can remove from the
    /// participants panel). The composition root wires this to the REST call
    /// (`DELETE /games/{id}/members/{userId}`); the fixture no-ops. Threaded
    /// here now; the host-gated submenu that calls it lands with the kick UI.
    let onKick: (String) -> Void

    var body: some View {
        if members.isEmpty {
            // The welcome has not landed: an empty cluster squishes the glass
            // capsule into a blob (owner device finding 2026-07-10). A hollow
            // puck holds the pill's register until the room arrives; it is not
            // a control yet, so touches pass through and VoiceOver skips it.
            placeholderPill
        } else {
            presentedPill
        }
    }

    private var presentedPill: some View {
        Group {
            #if os(iOS)
                if #available(iOS 26.0, *) {
                    // The verified recipe from the morph lab: a plain label in
                    // the system's glass button style; the menu morphs out of
                    // the control. The pill's own ChromeGlassSurface would
                    // stand glass the presentation does not know.
                    menu.buttonStyle(.glass)
                } else {
                    fallbackMenu
                }
            #else
                fallbackMenu
            #endif
        }
        .accessibilityLabel(Text(verbatim: "Roster, \(members.count) in the room"))
    }

    /// The loading register: one hollow puck in the same geometry the loaded
    /// pill starts with (self is always a member once the room lands), so the
    /// roster's arrival fills a circle that was already standing instead of
    /// materializing new chrome.
    private var placeholderPill: some View {
        Group {
            #if os(iOS)
                if #available(iOS 26.0, *) {
                    Button {} label: {
                        placeholderPuck
                            .frame(height: ChromeLayout.pillHeight - 14)
                    }
                    .buttonStyle(.glass)
                } else {
                    placeholderFallback
                }
            #else
                placeholderFallback
            #endif
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var placeholderFallback: some View {
        placeholderPuck
            .padding(.horizontal, 10)
            .frame(height: ChromeLayout.pillHeight)
            .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
    }

    /// A hollow circle at the away member's strength: someone will be here.
    private var placeholderPuck: some View {
        Circle()
            .stroke(Color(rgb: ground.tokens.number).opacity(0.35), lineWidth: 1.5)
            .frame(width: 24, height: 24)
    }

    /// Below 26 (and the macOS test build) the same Menu presents the system's
    /// plain menu from the pill's fallback material: one mechanism, the §4
    /// one-fallback rule. This branch draws its own capsule, so the label
    /// carries the pill's full geometry.
    private var fallbackMenu: some View {
        Menu {
            rows
        } label: {
            pillContent
                .padding(.horizontal, 10)
                .frame(height: ChromeLayout.pillHeight)
                .contentShape(Capsule())
                .modifier(
                    ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        }
        .buttonStyle(.plain)
    }

    /// The system glass button pads and shapes its own capsule, so it takes
    /// the bare cluster: a full pill frame on the label stacks the button's
    /// padding on ours and inflates the pill out of the bar's register (owner
    /// device finding 2026-07-10). Bare pucks alone land short (~38 pt), so
    /// the label carries just enough height that content plus the style's
    /// ~7 pt sides meets the register. Measured on the 26.5 sim; retune at
    /// I2e if an OS revision repads.
    private var menu: some View {
        Menu {
            rows
        } label: {
            pillContent
                .frame(height: ChromeLayout.pillHeight - 14)
        }
    }

    // MARK: The pill (the cluster at rest, unchanged vocabulary)

    private var pillContent: some View {
        let cluster = RosterList.cluster(members)
        return HStack(spacing: 4) {
            HStack(spacing: -7) {
                ForEach(cluster.pucks) { member in
                    RosterPuckView(member: member, ground: ground, diameter: 24)
                }
            }
            if cluster.overflow > 0 {
                Text(verbatim: "+\(cluster.overflow)")
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            }
        }
    }

    // MARK: The rows (people, then the spectator's one action)

    @ViewBuilder
    private var rows: some View {
        ForEach(RosterList.ordered(members)) { member in
            // A person is not an action; the row dismisses like Mail's do.
            Button {} label: {
                Label {
                    Text(verbatim: member.displayName)
                    if let word = RosterList.stateWord(member) {
                        Text(verbatim: word)
                    }
                } icon: {
                    RosterPuckArt.image(member: member, ground: ground)
                }
            }
        }
        if RosterList.selfIsSpectator(members, selfUserId: selfUserId) {
            Divider()
            Button(action: onJoinIn) {
                Label("Join in", systemImage: "person.badge.plus")
            }
        }
    }
}

// MARK: - Rendered pucks

/// Menu rows take an Image, not a live view, so each puck renders once per
/// (member, ground) through ImageRenderer at 3x and caches. The render bakes in
/// the away dim (RosterPuckView's own opacity); non-template, so color survives
/// the menu.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
enum RosterPuckArt {
    /// The row diameter the retired panel used; menu icons sit comfortably here.
    static let puckDiameter: CGFloat = 26

    private static var cache: [String: Image] = [:]

    static func image(member: RosterMember, ground: GridGround) -> Image {
        let ink = ground.tokens.ink
        let key = [
            member.userId, member.initial, member.wireColor,
            String(member.connected), "\(ink.red).\(ink.green).\(ink.blue)",
        ].joined(separator: "|")
        if let hit = cache[key] { return hit }

        let renderer = ImageRenderer(
            content: RosterPuckView(
                member: member, ground: ground, diameter: puckDiameter))
        renderer.scale = 3
        var rendered: Image?
        #if canImport(UIKit)
            rendered = renderer.uiImage.map { Image(uiImage: $0) }
        #elseif canImport(AppKit)
            rendered = renderer.nsImage.map { Image(nsImage: $0) }
        #endif
        guard let image = rendered else {
            return Image(systemName: "person.crop.circle.fill")
        }
        cache[key] = image
        return image
    }
}
