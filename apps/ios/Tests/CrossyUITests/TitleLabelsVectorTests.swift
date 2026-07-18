import Foundation
import XCTest

@testable import CrossyUI

// Pins the Titles display LABELS to the cross-client contract (design/post-game/TITLES.md;
// PROTOCOL.md §12; vectors/analysis/title-labels.json), the DisplayNameEntryTests / IdentityRoster
// pattern for a vector-bound CrossyUI test. The labels were client-owned prose until the
// server-rendered share card had to render them (native apps consume the server card PNG, not a
// client render; design/post-game/SHARE.md), so they are shared normative ground now: if
// TitleLadder's labels ever drift from the web/Android/server copies, this fails against the frozen
// vector. LABELS ONLY: the evidence/detail line under a label ("Overwrote 7 correct squares")
// interpolates the solve's stats and stays client-owned, so it is not pinned here. INV-1: labels are
// display strings shown verbatim, never folded or compared.

final class TitleLabelsVectorTests: XCTestCase {
    private struct Vector: Decodable {
        let labels: [Label]
        struct Label: Decodable {
            let key: String
            let label: String
        }
    }

    /// vectors/analysis/title-labels.json, from this file's compiled-in path (the
    /// DisplayNameEntryTests / RepoLayout pattern): up five from the test file to the repo root,
    /// then into vectors/analysis.
    private static let vectorURL: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyUITests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("vectors/analysis/title-labels.json")

    private func loadVector() throws -> Vector {
        let data = try Data(contentsOf: Self.vectorURL)
        return try JSONDecoder().decode(Vector.self, from: data)
    }

    func test_theVectorFileIsPresentAndNonEmpty() throws {
        let vector = try loadVector()
        XCTAssertFalse(
            vector.labels.isEmpty, "vectors/analysis/title-labels.json must exist with labels")
    }

    // Every pinned key resolves to its exact label, byte for byte, through the same card(for:) the
    // panel and the share card use. A drift on either side fails one of the twin sweeps.
    func test_labelsMatchTheSharedVector_byteForByte() throws {
        for entry in try loadVector().labels {
            let card = TitleLadder.card(for: RoomTitle(userId: "u1", key: entry.key, evidence: 7))
            XCTAssertNotNil(card, "\(entry.key) is a pinned key and must resolve to a card")
            XCTAssertEqual(card?.label, entry.label, "label for \(entry.key)")
        }
    }

    // The ladder covers exactly the pinned keys, in the vector's rank order (the vector lists the
    // TITLE_LADDER order for coverage). No key drops out and none is added without the vector moving.
    func test_ladderCoversExactlyTheVectorKeys_inOrder() throws {
        XCTAssertEqual(TitleLadder.keys, try loadVector().labels.map(\.key))
    }
}
