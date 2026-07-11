// The roster puck, the one participant mark the whole app shares: a colored circle in
// the person's roster color, their initial in the paper's cell tone, and, when it has
// resolved, their avatar image clipped to the circle over the top (PROTOCOL.md §4). The
// initial is always the floor: a null url, a url still loading, and a url that failed
// all render as the initial, and the image returns the moment it arrives.
//
// Two types, split along the seam that matters. RosterPuckBody is pure composition: it
// takes the avatar as resolved data (an Image, or nil) and knows nothing about fetching,
// caching, or the environment, so it renders the same in a live view and inside an
// ImageRenderer snapshot. RosterPuckView is the live bridge: it reads the shared cache
// from the environment, kicks the load, and hands RosterPuckBody whatever image the
// cache holds now. Surfaces that cannot carry a live view (the roster menu's rasterized
// rows) skip the bridge and render RosterPuckBody directly with an image they resolved
// themselves (RosterPuckArt).

import CrossyDesign
import SwiftUI

// MARK: - The puck, pure

/// The puck as pixels: circle, initial, optional avatar, ring, and the away dim. Pure
/// composition, no IO and no environment, so it renders identically live or snapshotted.
/// The avatar is resolved data handed in; nil is the initial, the first-class fallback a
/// null, loading, or failed url gets everywhere (PROTOCOL.md §4). The ring and the dim
/// wrap the whole stack, so they apply to the image the same as the initial. Away members
/// sit back; presence is honest, not decorative.
@available(iOS 17.0, macOS 14.0, *)
struct RosterPuckBody: View {
    let member: RosterMember
    let ground: GridGround
    let diameter: CGFloat
    /// The resolved avatar image, or nil for the colored initial. A live surface passes
    /// the cache's current image; the menu snapshot passes what is cached at render time.
    let avatar: Image?

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(rgb: ground.rosterColor(member.identity)))
            Text(verbatim: member.initial)
                .font(.system(size: diameter * 0.42, weight: .bold))
                .foregroundStyle(Color(rgb: ground.tokens.cell))
            if let avatar {
                avatar
                    .resizable()
                    .scaledToFill()
                    .frame(width: diameter, height: diameter)
                    .clipShape(Circle())
            }
        }
        .frame(width: diameter, height: diameter)
        .overlay(
            Circle().stroke(Color(rgb: ground.tokens.cell), lineWidth: 1.5)
        )
        .opacity(member.connected ? 1 : 0.35)
        .accessibilityHidden(true)
    }
}

// MARK: - The puck, live

/// The puck bound to the shared avatar cache: it reads the member's resolved image from
/// the environment cache (nil until the first load lands) and kicks the load when it
/// appears or the url changes. Reading `image(for:)` in body registers observation, so
/// the puck re-renders the instant the image arrives; the load trigger sits on the always
/// present RosterPuckBody, so it fires reliably (an empty conditional would never appear).
/// A surface with no cache in its environment (a lone preview) simply shows the initial.
@available(iOS 17.0, macOS 14.0, *)
struct RosterPuckView: View {
    let member: RosterMember
    let ground: GridGround
    let diameter: CGFloat
    @Environment(\.avatarImageCache) private var cache

    var body: some View {
        RosterPuckBody(
            member: member, ground: ground, diameter: diameter, avatar: resolvedAvatar
        )
        .task(id: member.avatarUrl) { loadAvatar() }
    }

    /// The cache's image for this member's url, or nil (no url, loading, miss, or no
    /// cache). Read in body so the puck re-renders when the load publishes.
    private var resolvedAvatar: Image? {
        guard let url = member.avatarUrl, let cache else { return nil }
        return cache.image(for: url)
    }

    /// Begin the fetch for this member's url; idempotent, so appearing and every url
    /// change is safe to call. A resolved or in-flight url is a no-op in the cache.
    private func loadAvatar() {
        guard let url = member.avatarUrl, let cache else { return }
        cache.load(url)
    }
}
