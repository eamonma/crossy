// The avatar image cache: one url-keyed, in-memory store that fetches a participant's
// avatar once and hands the decoded image to every surface that shows that person
// (apps/ios/DESIGN.md §3: the people are the color; PROTOCOL.md §4: the avatarUrl is
// opaque and nullable, and a null, loading, or failed url is the colored initial, the
// floor). This file owns only "url -> image"; the puck composition and the live bridge
// that reads this cache live in RosterPuck.swift.
//
// Why a cache and not AsyncImage: the pill cluster re-renders every second (the room
// bar's 1 Hz TimelineView drives the clock), and AsyncImage restarts its fetch on each
// identity churn, so it would re-hit the network every tick and flash the initial back
// in between. A url-keyed cache fetches once and returns the same decoded image to every
// later render, so the image is stable and the initial shows only until the first load
// lands. URLSession resolves http(s) and data: urls alike, so a bundled data-url fixture
// proves the path with no network (DemoRoom).

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
