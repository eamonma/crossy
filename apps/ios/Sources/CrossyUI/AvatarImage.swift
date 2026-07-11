// The avatar image, layered over the colored initial puck (apps/ios/DESIGN.md §3:
// the people are the color; PROTOCOL.md §4: the avatarUrl is opaque and nullable).
// The initial is always the floor: a null url, a url still loading, or a url that
// failed all render as the initial, and the fetched image returns the moment it
// arrives. So this file draws only the image layer; RosterPuckView owns the puck
// beneath it and the overlay simply sits on top when there is something to show.
//
// Why a small cache and not AsyncImage: the pill cluster re-renders every second
// (the room bar's 1 Hz TimelineView drives the clock), and AsyncImage restarts its
// fetch on each identity churn, so it would re-hit the network every tick and flash
// the initial back in between. A url-keyed in-memory cache fetches once and hands
// the same decoded image to every later render, so the image is stable and the
// initial shows only until the first load lands. URLSession resolves http(s) and
// data: urls alike, so a bundled data-url fixture proves the layering with no
// network (DemoRoom).

import CrossyDesign
import SwiftUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

/// One fetched-and-decoded avatar, platform-neutral for the SwiftUI `Image`.
#if canImport(UIKit)
    typealias PlatformImage = UIImage
#elseif canImport(AppKit)
    typealias PlatformImage = NSImage
#endif

/// A url-keyed avatar image cache (@MainActor, @Observable): a view asks for a url,
/// gets whatever is cached now (nil until the first load lands), and the load, once
/// it finishes, publishes the image so every observing puck re-renders with it. A
/// failed or non-image url caches a miss so it never retries in a loop; the initial
/// stays the render for it. One instance lives in the environment, shared by the
/// pill cluster and any other live avatar surface.
@available(iOS 17.0, macOS 14.0, *)
@Observable
@MainActor
final class AvatarImageCache {
    /// A resolved slot: an image, or a known miss (loaded but not an image, or
    /// failed). Absence from the dictionary means not-yet-requested.
    private enum Slot {
        case image(PlatformImage)
        case miss
    }

    private var slots: [String: Slot] = [:]
    /// In-flight urls, so a url that many pucks share is fetched once.
    private var inFlight: Set<String> = []

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// The cached image for a url, or nil while loading, on a miss, or before the
    /// first request. Reading during body registers @Observable tracking, so the
    /// puck re-renders when the load publishes.
    func image(for urlString: String) -> Image? {
        guard case .image(let platform) = slots[urlString] else { return nil }
        #if canImport(UIKit)
            return Image(uiImage: platform)
        #elseif canImport(AppKit)
            return Image(nsImage: platform)
        #endif
    }

    /// Begin a load if this url has no slot and none in flight. Idempotent: a
    /// resolved url or one already fetching is a no-op, so calling this from every
    /// render is safe.
    func load(_ urlString: String) {
        guard slots[urlString] == nil, !inFlight.contains(urlString) else { return }
        guard let url = URL(string: urlString) else {
            slots[urlString] = .miss
            return
        }
        inFlight.insert(urlString)
        Task { await fetch(urlString, url) }
    }

    private func fetch(_ key: String, _ url: URL) async {
        defer { inFlight.remove(key) }
        do {
            let (data, _) = try await session.data(from: url)
            if let platform = PlatformImage(data: data) {
                slots[key] = .image(platform)
            } else {
                // Loaded, but not a decodable image: a miss, so the initial stays.
                slots[key] = .miss
            }
        } catch {
            // A failed fetch is a miss, not a retry loop (PROTOCOL.md §4: a load
            // error falls back to the initial, first-class like null).
            slots[key] = .miss
        }
    }
}

/// The shared avatar cache in the environment (the ChromeClarifiedKey pattern, so no
/// call site changes to pass it). Defaulted nil so a preview or a lone puck renders
/// (it has no cache to draw from, so it shows the initial); the room injects the real
/// one.
@available(iOS 17.0, macOS 14.0, *)
private struct AvatarImageCacheKey: EnvironmentKey {
    static let defaultValue: AvatarImageCache? = nil
}

@available(iOS 17.0, macOS 14.0, *)
extension EnvironmentValues {
    var avatarImageCache: AvatarImageCache? {
        get { self[AvatarImageCacheKey.self] }
        set { self[AvatarImageCacheKey.self] = newValue }
    }
}

/// The image layer over the initial puck: nothing until the url's image resolves,
/// then the image scaled to fill and clipped to the circle. The ring stroke and the
/// away-dim opacity live on the puck beneath (RosterPuckView), so they apply to the
/// image too once it lands. A nil url, a loading url, and a failed url all draw
/// nothing here, leaving the initial as the render (PROTOCOL.md §4).
@available(iOS 17.0, macOS 14.0, *)
struct AvatarPuckOverlay: View {
    let avatarUrl: String?
    let diameter: CGFloat
    @Environment(\.avatarImageCache) private var cache

    var body: some View {
        Group {
            if let avatarUrl, let cache, let image = cache.image(for: avatarUrl) {
                image
                    .resizable()
                    .scaledToFill()
                    .frame(width: diameter, height: diameter)
                    .clipShape(Circle())
            }
        }
        .onAppear { requestLoad() }
        .onChange(of: avatarUrl) { _, _ in requestLoad() }
    }

    private func requestLoad() {
        guard let avatarUrl, let cache else { return }
        cache.load(avatarUrl)
    }
}
