import XCTest

import CrossyProtocol

// The stats side of sittings (PROTOCOL.md §4; DESIGN.md D29): `activeSolveSeconds`
// and `sittingCount` are additive, frozen pre-D29 rows lack them forever (never
// backfilled), and the headline Time everywhere stats render is active time with
// the wall-clock fallback (owner ruling). The fixtures pin the wire shapes
// (WireSnapshotTests: gameCompleted carries the fields, sync-completed predates
// them); these pin the decode tolerance and the one preference rule.

final class StatsSittingsTests: XCTestCase {
    // §4, D29: a frozen pre-D29 stats row (no activeSolveSeconds, no sittingCount)
    // decodes fine — additive fields, absence tolerated, never a decode failure.
    func test_statsWithoutSittingsFieldsDecodesWithNils_D29() throws {
        let frozen = Data(
            #"""
            {
              "solveTimeSeconds": 96067,
              "totalEvents": 899,
              "participantCount": 4,
              "checkCount": 2
            }
            """#.utf8)
        let stats = try JSONDecoder().decode(Stats.self, from: frozen)
        XCTAssertNil(stats.activeSolveSeconds)
        XCTAssertNil(stats.sittingCount)
        XCTAssertEqual(stats.solveTimeSeconds, 96067)
    }

    func test_statsWithSittingsFieldsDecodesBoth_D29() throws {
        let current = Data(
            #"""
            {
              "solveTimeSeconds": 96067,
              "activeSolveSeconds": 1453,
              "sittingCount": 2,
              "totalEvents": 899,
              "participantCount": 4,
              "checkCount": 2
            }
            """#.utf8)
        let stats = try JSONDecoder().decode(Stats.self, from: current)
        XCTAssertEqual(stats.activeSolveSeconds, 1453)
        XCTAssertEqual(stats.sittingCount, 2)
        XCTAssertEqual(
            stats.solveTimeSeconds, 96067,
            "solveTimeSeconds keeps its wall-clock semantics unchanged, forever (§4)")
    }

    // Owner ruling, D29: active time is THE headline Time stat wherever stats
    // render — a two-evening Sunday reads 24:13, not the 26:41:07 nobody
    // experienced.
    func test_headlinePrefersActiveOverWall_D29() {
        let stats = Stats(
            solveTimeSeconds: 96067, totalEvents: 899, participantCount: 4,
            activeSolveSeconds: 1453, sittingCount: 2)
        XCTAssertEqual(stats.headlineSolveSeconds, 1453)
    }

    // §4, D29: stats frozen before the fields shipped fall back to the wall-clock
    // number they always showed; a client never invents an active time.
    func test_headlineFallsBackToWallClockWhenActiveAbsent_D29() {
        let frozen = Stats(solveTimeSeconds: 2272, totalEvents: 899, participantCount: 4)
        XCTAssertEqual(frozen.headlineSolveSeconds, 2272)
    }

    // Expand/contract honesty (§4: never backfilled): a pre-D29 row re-encodes
    // WITHOUT the keys — absent stays absent, unlike checkCount whose 0 is a
    // real count.
    func test_absentSittingsFieldsStayAbsentOnReencode_D29() throws {
        let frozen = Stats(solveTimeSeconds: 2272, totalEvents: 899, participantCount: 4)
        let reencoded = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(frozen))
                as? [String: Any])
        XCTAssertNil(reencoded["activeSolveSeconds"])
        XCTAssertNil(reencoded["sittingCount"])
    }
}
