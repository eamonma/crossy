import Foundation
import XCTest

import CrossyProtocol

// The born-live builder (PROTOCOL.md §12a), pinned headlessly the way the presentation
// math and the lifecycle policy are: the island no longer starts empty and waits ~20s for
// the first push, it is born carrying the room's real state, so this suite pins that the
// resolved cluster, the confirmed counts, the status, and the completion stamp map to the
// same IslandContentState shape the emitter pushes. Pure, store-free, no ActivityKit: the
// builder lives beside the payload it builds, so it pins anywhere.

final class IslandContentStateBuilderTests: XCTestCase {
    private func member(
        _ initial: String, _ rgb: (Int, Int, Int), connected: Bool
    ) -> IslandContentState.ClusterMember {
        IslandContentState.ClusterMember(
            initial: initial, red: rgb.0, green: rgb.1, blue: rgb.2, connected: connected)
    }

    /// Mixed presence maps each member's live `connected` flag through verbatim: the away
    /// register is a per-puck fact the born-live frame already carries, not something the
    /// first push introduces.
    func test_mixedPresenceMapsEachConnectedFlag() {
        let state = IslandContentState.bornLive(
            cluster: [
                member("E", (214, 178, 92), connected: true),
                member("A", (127, 119, 221), connected: false),
                member("M", (92, 184, 148), connected: true),
            ],
            filled: 34, total: 78, status: .ongoing, completedAt: nil)

        XCTAssertEqual(state.pucks.map(\.initial), ["E", "A", "M"])
        XCTAssertEqual(state.pucks.map(\.connected), [true, false, true])
    }

    /// The cluster arrives already in presence order and already capped (RosterList.cluster),
    /// so the builder maps it verbatim: an at-cap crew of four keeps its order and its colors,
    /// no re-ordering, no re-capping, no re-casing (INV-1).
    func test_atCapClusterMapsVerbatim() {
        let cluster = [
            member("H", (214, 178, 92), connected: true),
            member("B", (127, 119, 221), connected: true),
            member("R", (92, 184, 148), connected: false),
            member("J", (224, 122, 95), connected: true),
        ]
        let state = IslandContentState.bornLive(
            cluster: cluster, filled: 61, total: 78, status: .ongoing, completedAt: nil)

        XCTAssertEqual(state.pucks.count, 4)
        XCTAssertEqual(state.pucks.map(\.initial), ["H", "B", "R", "J"])
        XCTAssertEqual(
            state.pucks.map { [$0.red, $0.green, $0.blue] },
            [[214, 178, 92], [127, 119, 221], [92, 184, 148], [224, 122, 95]])
        XCTAssertEqual(state.pucks.map(\.connected), [true, true, false, true])
    }

    /// The counts map straight to the content-state's `filled`/`total`: the born-live frame
    /// reports the room's real progress, the same denominator (playable cells) the server's
    /// BoardFacts uses, so frame one and the first push agree.
    func test_countsMapToFilledAndTotal() {
        let state = IslandContentState.bornLive(
            cluster: [member("E", (214, 178, 92), connected: true)],
            filled: 12, total: 45, status: .ongoing, completedAt: nil)

        XCTAssertEqual(state.filled, 12)
        XCTAssertEqual(state.total, 45)
    }

    /// The policy only ever starts an ongoing room, so frame one is ongoing with no
    /// completion stamp: the builder carries that unchanged, and progress is real (total > 0).
    func test_ongoingStatusCarriesNoCompletion() {
        let state = IslandContentState.bornLive(
            cluster: [member("E", (214, 178, 92), connected: true)],
            filled: 34, total: 78, status: .ongoing, completedAt: nil)

        XCTAssertEqual(state.status, .ongoing)
        XCTAssertNil(state.completedAt)
        XCTAssertEqual(IslandPresentation.fraction(filled: state.filled, total: state.total), 34.0 / 78.0)
    }

    /// A completed status carries its stamp through, so a born-live frame for a just-completed
    /// room would read terminal rather than assuming ongoing (the builder never assumes; the
    /// controller maps the store's real status).
    func test_completedStatusCarriesItsStamp() {
        let stamp = "2026-07-11T12:00:00Z"
        let state = IslandContentState.bornLive(
            cluster: [member("E", (214, 178, 92), connected: true)],
            filled: 78, total: 78, status: .completed, completedAt: stamp)

        XCTAssertEqual(state.status, .completed)
        XCTAssertEqual(state.completedAt, stamp)
    }

    /// The empty-room edge: no cluster and zero counts yield exactly the empty pre-push state,
    /// so a start with no resolved members degrades to the attributes fallback (progress
    /// hidden) rather than a broken frame. This is the born-live floor, not the norm: the
    /// policy gates start on a first fill, so a real room carries at least one filled cell.
    func test_emptyRoomEdgeIsTheEmptyState() {
        let state = IslandContentState.bornLive(
            cluster: [], filled: 0, total: 0, status: .ongoing, completedAt: nil)

        XCTAssertEqual(state, IslandContentState())
        XCTAssertTrue(state.pucks.isEmpty)
        XCTAssertNil(IslandPresentation.fraction(filled: state.filled, total: state.total))
    }

    /// The born-live frame is the same shape the emitter pushes: it encodes, re-decodes, and
    /// round-trips its meaning, so frame one and push two cannot drift (§12a, D04 twin).
    func test_bornLiveRoundTripsAsTheWireShape() throws {
        let state = IslandContentState.bornLive(
            cluster: [
                member("E", (214, 178, 92), connected: true),
                member("A", (127, 119, 221), connected: false),
            ],
            filled: 34, total: 78, status: .ongoing, completedAt: nil)

        let reencoded = try JSONEncoder().encode(state)
        let redecoded = try JSONDecoder().decode(IslandContentState.self, from: reencoded)
        XCTAssertEqual(redecoded, state)
    }
}
