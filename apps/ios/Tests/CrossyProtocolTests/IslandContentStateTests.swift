import Foundation
import XCTest

import CrossyProtocol

// The Live Activity content-state twin, pinned to vectors/live-activity/content-state.json
// (PROTOCOL.md §12a). The session emitter encodes this payload, the iOS widget decodes it;
// these vectors are the byte-for-byte shape both sides agree on. This suite is the Swift
// decode side: every fixture decodes to IslandContentState, its meaning round-trips, and a
// payload the server grew (an unknown key) still decodes (tolerant decode, §12a/§14).
//
// The vectors live in vectors/live-activity, a top-level family beside vectors/v1. It is
// NOT registered in the closed v1 runner registry (VectorFamily): that registry throws on
// any directory under v1/ it does not know, and this payload is a push-channel wire
// contract with its own consumers, not a v1 engine or client-store behavior. This suite
// reads the file directly, reusing only the #filePath path mechanics.

final class IslandContentStateTests: XCTestCase {
    /// One vector case: `{ name, contentState }`, the vectors/live-activity shape.
    private struct Case: Decodable {
        let name: String
        let contentState: IslandContentState
    }

    /// vectors/live-activity/content-state.json, located from this file's compiled-in path
    /// (the VectorRunnerTests/RepoLayout pattern): this file is at
    /// apps/ios/Tests/CrossyProtocolTests, so vectors/ is five components up beside apps/.
    private static let contentStateVectors: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyProtocolTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("vectors/live-activity/content-state.json")

    private func loadCases() throws -> [Case] {
        let data = try Data(contentsOf: Self.contentStateVectors)
        let cases = try JSONDecoder().decode([Case].self, from: data)
        XCTAssertFalse(cases.isEmpty, "the content-state vectors must not be empty")
        return cases
    }

    /// Every fixture decodes to the twin, and re-encoding then re-decoding is lossless: the
    /// meaning survives the round trip (INV-1: initials and colors are carried verbatim, no
    /// locale-aware transform on the way through).
    func test_everyVectorDecodesAndRoundTripsItsMeaning_INV1() throws {
        for testCase in try loadCases() {
            let state = testCase.contentState
            let reencoded = try JSONEncoder().encode(state)
            let redecoded = try JSONDecoder().decode(IslandContentState.self, from: reencoded)
            XCTAssertEqual(
                state, redecoded, "\(testCase.name): re-decoding the re-encoded state must be lossless")
        }
    }

    /// The named vectors carry the values PROTOCOL.md §12a describes: the mixed room's
    /// away puck, the at-cap four, the completed stamp, the abandoned null, the minimal
    /// single puck. Pin the load-bearing facts so a vector edit that changes meaning fails.
    func test_vectorMeaningsMatchTheContract() throws {
        let byName = Dictionary(uniqueKeysWithValues: try loadCases().map { ($0.name, $0.contentState) })

        let mixed = try XCTUnwrap(byName["ongoing room, mixed connected and disconnected pucks"])
        XCTAssertEqual(mixed.status, .ongoing)
        XCTAssertNil(mixed.completedAt)
        XCTAssertEqual(mixed.filled, 34)
        XCTAssertEqual(mixed.total, 78)
        XCTAssertEqual(mixed.pucks.map(\.connected), [true, false, true])
        XCTAssertEqual(mixed.pucks.first?.initial, "E")

        let atCap = try XCTUnwrap(byName["at-cap cluster of four pucks in presence order"])
        XCTAssertEqual(atCap.pucks.count, 4, "the cluster caps at four (PROTOCOL.md §12a)")

        let completed = try XCTUnwrap(byName["completed room stamps completedAt with the final fill"])
        XCTAssertEqual(completed.status, .completed)
        XCTAssertEqual(completed.completedAt, "2026-07-11T19:40:03Z")
        XCTAssertEqual(completed.filled, completed.total, "a completed room is full")

        let abandoned = try XCTUnwrap(byName["abandoned room freezes a partial fill, no completedAt"])
        XCTAssertEqual(abandoned.status, .abandoned)
        XCTAssertNil(abandoned.completedAt, "an abandoned game never completed (PROTOCOL.md §12a)")

        let minimal = try XCTUnwrap(byName["minimal single-puck room on a small grid"])
        XCTAssertEqual(minimal.pucks.count, 1)
    }

    /// Tolerant decode (PROTOCOL.md §12a): the server grows the payload by expand/contract
    /// and the widget ships on the App Store's clock, so a payload with an unknown key MUST
    /// still decode against a widget that has never seen it, rather than failing.
    func test_unknownKeyStillDecodes_expandContract() throws {
        let grown = Data(
            #"""
            {
              "pucks": [
                { "initial": "E", "red": 214, "green": 178, "blue": 92, "connected": true }
              ],
              "filled": 40,
              "total": 78,
              "status": "ongoing",
              "completedAt": null,
              "presenceLine": "E, plus two more",
              "protocolMinor": 7
            }
            """#.utf8)
        let decoded = try JSONDecoder().decode(IslandContentState.self, from: grown)
        XCTAssertEqual(decoded.filled, 40)
        XCTAssertEqual(decoded.total, 78)
        XCTAssertEqual(decoded.status, .ongoing)
        XCTAssertEqual(decoded.pucks.count, 1, "the unknown keys were ignored, the known ones kept")
    }

    /// The empty pre-push state (IslandContentState()): no cluster, no progress, ongoing.
    /// The widget reads this as "no push yet" and renders the attributes fallback.
    func test_emptyStateIsValidAndPrePush() {
        let empty = IslandContentState()
        XCTAssertTrue(empty.pucks.isEmpty)
        XCTAssertEqual(empty.total, 0, "total 0 hides the meter and ring")
        XCTAssertEqual(empty.status, .ongoing)
        XCTAssertNil(empty.completedAt)
    }

    /// A missing field decodes to its floor rather than throwing (§12a): an older payload,
    /// or one written before a field existed, still yields a valid state.
    func test_missingFieldsDecodeToFloors_expandContract() throws {
        let sparse = Data(#"{ "filled": 5 }"#.utf8)
        let decoded = try JSONDecoder().decode(IslandContentState.self, from: sparse)
        XCTAssertEqual(decoded.filled, 5)
        XCTAssertEqual(decoded.total, 0)
        XCTAssertTrue(decoded.pucks.isEmpty)
        XCTAssertEqual(decoded.status, .ongoing, "an absent status is treated as still going")
    }

    /// An unrecognized status decodes to ongoing, never a throw: a lagging widget treats a
    /// status word it does not know as "still going" (§12a tolerance).
    func test_unknownStatusDecodesToOngoing() throws {
        let future = Data(#"{ "status": "paused", "total": 10 }"#.utf8)
        let decoded = try JSONDecoder().decode(IslandContentState.self, from: future)
        XCTAssertEqual(decoded.status, .ongoing)
    }

    // MARK: - The puck's avatar disk key (userId), absent-tolerant like avatarUrl (§4/§12a)

    /// A present userId decodes verbatim (opaque, the widget's disk key for the avatar puck).
    /// A local probe, not vendored from the backend agent's vectors: this pins the Swift twin
    /// of the wire's optional puck userId independently.
    func test_puckUserIdPresentDecodesOpaqueString() throws {
        let json = Data(
            #"{ "initial": "E", "red": 214, "green": 178, "blue": 92, "connected": true, "userId": "u-42" }"#
                .utf8)
        let puck = try JSONDecoder().decode(IslandPuck.self, from: json)
        XCTAssertEqual(puck.userId, "u-42")
    }

    /// An explicit null userId reads as nil: no avatar key, so the widget renders the initial.
    func test_puckUserIdNullReadsAsNil() throws {
        let json = Data(
            #"{ "initial": "E", "red": 214, "green": 178, "blue": 92, "connected": true, "userId": null }"#
                .utf8)
        let puck = try JSONDecoder().decode(IslandPuck.self, from: json)
        XCTAssertNil(puck.userId)
    }

    /// The load-bearing case: an ABSENT userId reads as nil, so a pre-userId server (or the
    /// backend agent's push/puck-user-id not yet merged) still decodes and the puck stays
    /// initials, the floor. This is the tolerance the parallel backend change lands against.
    func test_puckUserIdAbsentReadsAsNil_expandContract() throws {
        let json = Data(
            #"{ "initial": "E", "red": 214, "green": 178, "blue": 92, "connected": true }"#.utf8)
        let puck = try JSONDecoder().decode(IslandPuck.self, from: json)
        XCTAssertNil(puck.userId, "a pre-userId puck must still decode, staying initials")
    }

    /// An absent userId stays OFF the wire on re-encode (the omit-when-nil posture): a puck
    /// with no avatar key never becomes an explicit null, mirroring avatarUrl on the wire.
    func test_puckWithoutUserIdStaysAbsentOnReencode() throws {
        let puck = IslandPuck(initial: "E", red: 214, green: 178, blue: 92, connected: true)
        let reencoded = try JSONEncoder().encode(puck)
        let object = try JSONSerialization.jsonObject(with: reencoded) as? [String: Any]
        XCTAssertNotNil(object)
        XCTAssertFalse(
            object?.keys.contains("userId") ?? true,
            "an absent userId must stay off the wire, never become null")
    }

    /// A present userId survives the round trip and the state round-trips its meaning with it,
    /// so frame one (born live) and the pushed frame key the same avatar file.
    func test_puckUserIdSurvivesRoundTrip() throws {
        let state = IslandContentState(
            pucks: [IslandPuck(initial: "E", red: 214, green: 178, blue: 92, connected: true, userId: "u-7")],
            filled: 3, total: 9, status: .ongoing, completedAt: nil)
        let reencoded = try JSONEncoder().encode(state)
        let redecoded = try JSONDecoder().decode(IslandContentState.self, from: reencoded)
        XCTAssertEqual(redecoded, state)
        XCTAssertEqual(redecoded.pucks.first?.userId, "u-7")
    }

    /// INV-6: the payload carries counts only, never a letter placed on the board or a cell
    /// coordinate. The only letters it carries are puck INITIALS (a person's identity, not
    /// board content). Sweep every decoded field label and JSON key for a coordinate- or
    /// cell-named member.
    func test_payloadCarriesCountsNotCells_INV6() throws {
        for testCase in try loadCases() {
            let reencoded = try JSONEncoder().encode(testCase.contentState)
            let keys = allJSONKeys(in: try JSONSerialization.jsonObject(with: reencoded))
            for key in keys {
                let folded = String(
                    decoding: key.utf8.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 },
                    as: UTF8.self)
                XCTAssertFalse(
                    folded.contains("cell") || folded.contains("coord") || folded.contains("solution"),
                    "\(testCase.name): content-state key \"\(key)\" leaks toward the board (INV-6)")
            }
        }
    }
}
