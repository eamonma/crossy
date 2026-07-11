// The avatar-puck disk keying, pure (owner ask 2026-07-11: profile pics in the island).
// Widget views render synchronously from the payload with no network and no async load, and
// APNs carries no image bytes, so the app writes downscaled avatar PNGs to a shared App
// Group container at activity-request time and the wire carries only an opaque `userId` per
// puck. This file owns the three pure decisions that keying makes, kept here (Foundation
// only, no UIKit, no IO) so the widget and the app share one filename law and so the math is
// pinned headlessly in CrossyProtocolTests: the container's image I/O lives in the app and
// widget targets (Shared/IslandAvatarStore), built on this.
//
// The image is always over the colored initial, and the initial is the floor (mirroring the
// in-app AvatarPuckOverlay law): a nil key, a missing file, or an unreachable container all
// render the colored initial puck, byte-identical to before this track.

import Foundation

/// The pure avatar-puck keying: the on-disk filename per userId, the downscale target, and
/// the prune set. No IO, no image type, no App Group access; those live in the store built
/// on this (Shared/IslandAvatarStore), which both the app and the widget compile.
public enum IslandAvatarKey {
    /// The one App Group the app and the widget share. The container is nil-tolerant at the
    /// store: no entitlement yet means every write and read is a clean no-op and the island
    /// stays initials, so this identifier can ship before the entitlement lands.
    public static let appGroupIdentifier = "group.com.eamonma.Crossy"

    /// The downscale target, square, in pixels. Pucks render at most at the expanded
    /// island's 44 pt diameter; at 2x that is 88 px, so an 88x88 image reads crisp at every
    /// presentation and stays tiny on disk (four of these is a handful of KB). A larger
    /// source is downscaled to this; a smaller one is not upscaled.
    public static let targetPixelSize = 88

    /// The on-disk filename for one member's avatar: `avatar-<userId>.png`. The userId is
    /// opaque and already server-issued, but it becomes a path component here, so any byte
    /// that is not filename-safe is percent-escaped (a `/` in a userId would otherwise
    /// escape the container directory). ASCII-only, no locale-aware transform (INV-1): the
    /// same userId keys the same file on every device.
    public static func fileName(for userId: String) -> String {
        "avatar-\(escape(userId)).png"
    }

    /// The prune set: of the files currently in the container, which to delete because their
    /// member is no longer in the cluster. Bounded housekeeping, never a sweep of unknown
    /// files: only files this store owns (the `avatar-*.png` shape) are candidates, and only
    /// those whose userId is absent from the current cluster are returned. A file the store
    /// does not recognize is left untouched.
    ///
    /// - Parameters:
    ///   - existingFileNames: the file names currently in the container directory.
    ///   - currentUserIds: the userIds in the cluster the app just wrote for.
    /// - Returns: the file names to delete (the store's own files whose member left).
    public static func staleFileNames(
        existingFileNames: [String], currentUserIds: [String]
    ) -> [String] {
        let keep = Set(currentUserIds.map { fileName(for: $0) })
        return existingFileNames.filter { isOwnedFileName($0) && !keep.contains($0) }
    }

    /// Whether a file name is one this store owns (`avatar-<...>.png`), so pruning never
    /// touches a file another writer put in the container.
    public static func isOwnedFileName(_ name: String) -> Bool {
        name.hasPrefix("avatar-") && name.hasSuffix(".png")
    }

    /// Percent-escape the userId for use as a path component. The allowed set is the
    /// unreserved URL characters plus a few filename-safe extras, so a `/`, a space, or any
    /// control byte becomes `%XX` and the file stays a single flat name in the container.
    private static func escape(_ userId: String) -> String {
        userId.addingPercentEncoding(withAllowedCharacters: Self.filenameSafe) ?? userId
    }

    /// Filename-safe characters: alphanumerics and the unreserved marks that are also valid
    /// in a POSIX file name. Notably excludes `/` and `%` themselves so they escape.
    private static let filenameSafe: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-._~")
        return set
    }()
}
