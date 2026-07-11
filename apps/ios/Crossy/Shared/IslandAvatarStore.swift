//
//  IslandAvatarStore.swift
//  Crossy (Shared)
//
//  The shared App Group container for island avatar pucks (owner ask 2026-07-11: profile
//  pics in the island). Widget views render synchronously from the payload with no network
//  and no async loading, and APNs carries no image bytes, so the app writes downscaled
//  avatar PNGs to a shared container at activity-request time and the widget reads them by
//  the opaque `userId` the wire carries per puck. The image is always layered over the
//  colored initial, and the initial is the floor (mirroring the in-app AvatarPuckOverlay
//  law): a nil key, a missing file, or an unreachable container all render the colored
//  initial, byte-identical to today.
//
//  This file lives in the Shared/ synchronized folder, so it compiles into BOTH the app
//  target (which writes, ImageWriting) and the widget extension (which reads, ImageReading).
//  It links only what both targets have: Foundation, UIKit, and the CrossyProtocol product
//  (for IslandAvatarKey, the pure filename/downscale/prune law both share). It never imports
//  CrossyUI or CrossyStore: the widget links neither.
//
//  Nil-tolerant by construction: the App Group entitlement lands AFTER this code (it is
//  orchestrator-held). Until then `containerURL(forSecurityApplicationGroupIdentifier:)`
//  returns nil, and every write and read is a clean no-op, so the island degrades to
//  initials exactly like before this track. Once the entitlement ships, the same code
//  writes and reads real images with no change here.
//

import CrossyProtocol
import Foundation
import UIKit

/// The shared-container avatar store. One value type over the App Group's `containerURL`,
/// nil when no entitlement (so every operation is a no-op). Split into a writer used only by
/// the app and a reader used by the widget, both over the same directory and the same
/// IslandAvatarKey filename law, so the two ports cannot key the same person differently.
struct IslandAvatarStore {
    /// The container directory the avatars live in, or nil when the App Group is unreachable
    /// (no entitlement yet, or a misconfigured identifier). Nil means every read and write is
    /// a clean no-op and the island stays initials.
    let directory: URL?

    /// Open the store for the shared App Group. Resolves the container URL once; nil-tolerant,
    /// so a build without the entitlement simply gets a nil directory and no-ops.
    init(appGroupIdentifier: String = IslandAvatarKey.appGroupIdentifier) {
        directory = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier)
    }

    /// The on-disk URL for one member's avatar, or nil when there is no container.
    func fileURL(for userId: String) -> URL? {
        directory?.appendingPathComponent(IslandAvatarKey.fileName(for: userId))
    }

    // MARK: - Reading (widget + app)

    /// The avatar image for one userId, or nil when there is no key, no container, no file,
    /// or the bytes do not decode. Nil is the initial, the floor. Cheap and synchronous, as a
    /// widget render demands: a decode off disk, no network and no async.
    func image(for userId: String?) -> UIImage? {
        guard let userId, let url = fileURL(for: userId) else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }

    // MARK: - Writing (app only, at activity-request time)

    /// Write one already-resolved avatar image for a userId: downscale to the square target
    /// (IslandAvatarKey.targetPixelSize), encode PNG, and write atomically (overwrite). A nil
    /// container is a clean no-op. Best-effort: a write failure leaves the puck as initials,
    /// never a thrown error into the request path.
    func write(image: UIImage, for userId: String) {
        guard let url = fileURL(for: userId) else { return }
        guard let data = Self.downscaledPNGData(from: image) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// Prune the store to the current cluster: delete the store's own `avatar-*.png` files
    /// whose member is no longer present. Bounded housekeeping (IslandAvatarKey.staleFileNames
    /// only ever returns files this store owns), never a sweep of unknown files, and a clean
    /// no-op when there is no container. Best-effort: a failed unlink is dropped.
    func prune(keeping currentUserIds: [String]) {
        guard let directory else { return }
        let existing =
            (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in IslandAvatarKey.staleFileNames(
            existingFileNames: existing, currentUserIds: currentUserIds)
        {
            try? FileManager.default.removeItem(
                at: directory.appendingPathComponent(name))
        }
    }

    // MARK: - Downscale

    /// Downscale an image to the square target and encode PNG. A source at or below the
    /// target is drawn at its own size (never upscaled); a larger source is drawn scaled to
    /// fill the target square and center-cropped, so a non-square avatar keys the same circle
    /// the puck clips it to. Returns nil only if PNG encoding fails.
    static func downscaledPNGData(from image: UIImage) -> Data? {
        let target = CGFloat(IslandAvatarKey.targetPixelSize)
        let source = image.size
        // Point size at scale 1: the format renders 1 px per point, so the pixel count is the
        // point count. Cap each side at the target; a smaller image keeps its own size.
        let longest = max(source.width, source.height)
        let side = min(target, longest > 0 ? longest : target)

        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = 1
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: side, height: side), format: format)
        let scaled = renderer.image { _ in
            // Aspect-fill into the square, center-cropped: scale by the SHORTER side so the
            // square is fully covered, then center the overflow. This matches the puck's
            // scaledToFill + clipShape(Circle) so the disk image and the live puck agree.
            let coverScale = source.width > 0 && source.height > 0
                ? max(side / source.width, side / source.height) : 1
            let drawSize = CGSize(
                width: source.width * coverScale, height: source.height * coverScale)
            let origin = CGPoint(
                x: (side - drawSize.width) / 2, y: (side - drawSize.height) / 2)
            image.draw(in: CGRect(origin: origin, size: drawSize))
        }
        return scaled.pngData()
    }
}
