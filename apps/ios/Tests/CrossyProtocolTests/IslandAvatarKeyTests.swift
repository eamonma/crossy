import Foundation
import XCTest

import CrossyProtocol

// The avatar-puck disk keying, pinned headlessly (owner ask 2026-07-11: profile pics in the
// island). The app writes downscaled avatar PNGs to a shared App Group container keyed by
// userId and the widget reads them; the filename law, the downscale target, and the prune set
// are pure decisions both sides share (IslandAvatarKey), so they pin here with no UIKit, no
// IO, and no App Group. The container's image I/O lives in the app and widget targets
// (Shared/IslandAvatarStore), built on this.

final class IslandAvatarKeyTests: XCTestCase {
    // MARK: - Filename keying (INV-1: ASCII-only, no locale-aware transform)

    /// The filename is `avatar-<userId>.png`: the puck's disk key. Stable per userId, so the
    /// writer and the reader address the same file on every device.
    func test_fileNameIsAvatarUserIdPng_INV1() {
        XCTAssertEqual(IslandAvatarKey.fileName(for: "u-42"), "avatar-u-42.png")
        XCTAssertEqual(IslandAvatarKey.fileName(for: "abc"), "avatar-abc.png")
    }

    /// A userId with a path separator or space is percent-escaped, so it can never escape the
    /// container directory or split into a nested path: it stays one flat file name.
    func test_fileNameEscapesUnsafePathBytes() {
        let name = IslandAvatarKey.fileName(for: "a/b c")
        XCTAssertTrue(name.hasPrefix("avatar-"))
        XCTAssertTrue(name.hasSuffix(".png"))
        XCTAssertFalse(name.contains("/"), "a slash in the userId must not become a path separator")
        XCTAssertFalse(name.contains(" "), "a space must be escaped, not a raw file-name byte")
    }

    /// A file this store owns is `avatar-<...>.png`; anything else is not, so pruning never
    /// touches a file another writer put in the container.
    func test_ownedFileNameRecognition() {
        XCTAssertTrue(IslandAvatarKey.isOwnedFileName("avatar-u1.png"))
        XCTAssertFalse(IslandAvatarKey.isOwnedFileName("avatar-u1.jpg"))
        XCTAssertFalse(IslandAvatarKey.isOwnedFileName("note.png"))
        XCTAssertFalse(IslandAvatarKey.isOwnedFileName("someone-else.dat"))
    }

    // MARK: - Downscale target

    /// The downscale target is 88 px square: the expanded island puck is 44 pt, so 2x reads
    /// crisp at every presentation while staying tiny on disk.
    func test_targetPixelSizeIs88() {
        XCTAssertEqual(IslandAvatarKey.targetPixelSize, 88)
    }

    // MARK: - The prune set (bounded housekeeping, never a sweep of unknown files)

    /// A file whose member is no longer in the cluster is stale; a member still present keeps
    /// their file. The set returns exactly the files to delete.
    func test_staleFileNamesDropsDepartedMembersKeepsPresent() {
        let existing = [
            "avatar-alice.png", "avatar-bob.png", "avatar-carol.png",
        ]
        let stale = IslandAvatarKey.staleFileNames(
            existingFileNames: existing, currentUserIds: ["alice", "carol"])
        XCTAssertEqual(Set(stale), ["avatar-bob.png"], "only bob left the cluster")
    }

    /// Pruning never touches a file the store does not own, even when its member is absent from
    /// the cluster: a stray file another writer left is out of scope.
    func test_staleFileNamesLeavesUnownedFilesAlone() {
        let existing = ["avatar-bob.png", "readme.txt", "cache.bin"]
        let stale = IslandAvatarKey.staleFileNames(
            existingFileNames: existing, currentUserIds: [])
        XCTAssertEqual(Set(stale), ["avatar-bob.png"], "only the store's own file is a candidate")
    }

    /// The escaped file name is what the prune compares, so a member with an unsafe userId is
    /// kept correctly (their file matches, so it is not pruned while they are present).
    func test_staleFileNamesMatchesEscapedNames() {
        let present = IslandAvatarKey.fileName(for: "a/b")
        let departed = IslandAvatarKey.fileName(for: "c d")
        let stale = IslandAvatarKey.staleFileNames(
            existingFileNames: [present, departed], currentUserIds: ["a/b"])
        XCTAssertEqual(stale, [departed], "the present member's escaped file is kept")
    }

    /// Nothing to prune when every existing file belongs to a current member: an empty set.
    func test_staleFileNamesEmptyWhenAllPresent() {
        let existing = ["avatar-x.png", "avatar-y.png"]
        let stale = IslandAvatarKey.staleFileNames(
            existingFileNames: existing, currentUserIds: ["x", "y"])
        XCTAssertTrue(stale.isEmpty)
    }
}
