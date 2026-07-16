import CoreGraphics
import Foundation
import XCTest

@testable import CrossyUI

// Sittings on the iOS post-game surface (design/post-game/SITTINGS.md, D29; owner
// rulings): active time is THE headline Time, the sitting count is context, never a
// second stat ("24:13 · 2 sittings", only at two or more), and the momentum ribbon
// draws a quiet seam tick at each interior sitting boundary through the same
// time-to-x bucketing the break marker maps by. An older bundle (no sittings) and a
// single-sitting game read exactly as today.

final class SittingsSuffixTests: XCTestCase {
    private func analysis(
        durationSeconds: Double = 1453, sittings: RoomSittings?
    ) -> RoomAnalysis {
        RoomAnalysis(
            owners: [:],
            momentum: RoomMomentum(durationSeconds: durationSeconds, samples: []),
            turningPoint: nil,
            titles: [],
            sittings: sittings)
    }

    private func sittings(count: Int, endings: [Double]) -> RoomSittings {
        var spans: [RoomSittings.Span] = []
        var start = 0.0
        for end in endings {
            spans.append(RoomSittings.Span(startSeconds: start, endSeconds: end))
            start = end
        }
        return RoomSittings(count: count, spans: spans, wallSeconds: endings.last ?? 0)
    }

    // Owner ruling, D29: the suffix renders only at two or more sittings.
    func test_suffixRendersAtTwoOrMoreSittings_D29() {
        XCTAssertEqual(
            analysis(sittings: sittings(count: 2, endings: [300, 1453])).sittingCountSuffix,
            "2 sittings")
        XCTAssertEqual(
            analysis(sittings: sittings(count: 3, endings: [300, 900, 1453])).sittingCountSuffix,
            "3 sittings")
    }

    // A single-sitting game reads exactly as today: no suffix (D29).
    func test_noSuffixForASingleSitting_D29() {
        XCTAssertNil(
            analysis(sittings: sittings(count: 1, endings: [1453])).sittingCountSuffix)
    }

    // An older cached bundle omits sittings entirely; the surface degrades to
    // today's rendering (PROTOCOL.md §12 absence rule, D29).
    func test_noSuffixWhenSittingsAbsent_olderBundle_D29() {
        XCTAssertNil(analysis(sittings: nil).sittingCountSuffix)
    }

    // The headline keeps the one CrossyUI moment formatter (formatMSS, unified with
    // web in the hour-roll fix): sittings add context, never a formatting fork (D29).
    func test_headlineKeepsTheHourRollingFormatter_noFork_D29() {
        let bundle = analysis(
            durationSeconds: 3700, sittings: sittings(count: 2, endings: [1800, 3700]))
        XCTAssertEqual(bundle.durationLabel, "1:01:40")
        XCTAssertEqual(bundle.sittingCountSuffix, "2 sittings")
    }

    // The seam lookup: every span end but the last, on the active axis (D29).
    func test_interiorBoundariesAreEverySpanEndButTheLast_D29() {
        XCTAssertEqual(
            sittings(count: 3, endings: [300, 900, 1453]).interiorBoundarySeconds,
            [300, 900])
        XCTAssertEqual(sittings(count: 1, endings: [1453]).interiorBoundarySeconds, [])
    }
}

// The completed facts detail (RoomFactsContent): the sitting count joins the
// " · " facts grammar as context, only at two or more (owner ruling, D29). The
// headline preference itself (active over wall) is the stats twin's rule,
// pinned in CrossyProtocolTests/StatsSittingsTests.

final class SittingsFactsContentTests: XCTestCase {
    func test_completed_sittingCountJoinsTheFactsAtTwoOrMore_D29() {
        let content = RoomFactsContent.make(
            roomName: "trio", puzzleTitle: nil, puzzleAuthor: nil, puzzleDate: nil,
            completed: true, totalEvents: 143, participantCount: 3, sittingCount: 2)
        XCTAssertEqual(content.detail, "143 entries · 3 solvers · 2 sittings")
    }

    // One sitting reads exactly as today — no "1 sittings", no suffix at all (D29).
    func test_completed_singleSittingReadsAsToday_D29() {
        let content = RoomFactsContent.make(
            roomName: "trio", puzzleTitle: nil, puzzleAuthor: nil, puzzleDate: nil,
            completed: true, totalEvents: 143, participantCount: 3, sittingCount: 1)
        XCTAssertEqual(content.detail, "143 entries · 3 solvers")
    }

    // A frozen pre-D29 stats row carries no sittingCount; absence renders as today.
    func test_completed_absentSittingCountReadsAsToday_D29() {
        let content = RoomFactsContent.make(
            roomName: "trio", puzzleTitle: nil, puzzleAuthor: nil, puzzleDate: nil,
            completed: true, totalEvents: 143, participantCount: 3, sittingCount: nil)
        XCTAssertEqual(content.detail, "143 entries · 3 solvers")
    }

    // Mid-solve the facts are the puzzle's, not the stats' (stats only exist at
    // completion, PROTOCOL.md §4): the count never leaks into the running sheet.
    func test_midSolve_sittingCountNeverRenders_D29() {
        let content = RoomFactsContent.make(
            roomName: "Tuesday evening", puzzleTitle: "Midsummer Crossings",
            puzzleAuthor: nil, puzzleDate: nil, completed: false,
            totalEvents: nil, participantCount: nil, sittingCount: 5)
        XCTAssertEqual(content.detail, "Midsummer Crossings")
    }
}

// The ribbon's seam ticks (D29): interior boundaries through the SAME inverse
// bucketing the break marker uses, so a seam lands on the bin its sittings butt
// against; edges draw nothing (a zero-width span clamps to an edge by contract,
// PROTOCOL.md §12). Pinned in the web ribbon's reference box (340x104), the same
// space MomentumRibbon scales from.

final class SittingsSeamTickTests: XCTestCase {
    private let box = CGSize(width: 340, height: 104)
    private let sampleCount = 40

    /// The ribbon's own scaleX arithmetic for a bin index in the reference box
    /// (padX 4): the expected side of the pin, computed independently.
    private func expectedX(forBin bin: Int) -> CGFloat {
        4 + CGFloat(bin) / CGFloat(sampleCount - 1) * (box.width - 8)
    }

    private func spans(_ endings: [Double]) -> RoomSittings {
        var result: [RoomSittings.Span] = []
        var start = 0.0
        for end in endings {
            result.append(RoomSittings.Span(startSeconds: start, endSeconds: end))
            start = end
        }
        return RoomSittings(count: endings.count, spans: result, wallSeconds: endings.last ?? 0)
    }

    // The pinned fixture (the REST snapshot's analysis-view sittings): duration 60,
    // spans [0,45][45,60]. The one interior boundary at 45s buckets to bin
    // round(45/60 * 39) = 29 and lands on that bin's x.
    func test_tickPositionsForThePinnedFixture_D29() {
        let ticks = MomentumRibbon.seamTickXs(
            sittings: spans([45, 60]), duration: 60, count: sampleCount, size: box)
        XCTAssertEqual(ticks.count, 1)
        XCTAssertEqual(ticks[0], expectedX(forBin: 29), accuracy: 0.0001)
    }

    // Three sittings, two seams, each on its own bin (D29: spans[k].endSeconds,
    // k < count-1).
    func test_threeSittingsDrawTwoTicks_D29() {
        let ticks = MomentumRibbon.seamTickXs(
            sittings: spans([160, 260, 512]), duration: 512, count: sampleCount, size: box)
        // round(160/512 * 39) = 12; round(260/512 * 39) = 20.
        XCTAssertEqual(ticks.count, 2)
        XCTAssertEqual(ticks[0], expectedX(forBin: 12), accuracy: 0.0001)
        XCTAssertEqual(ticks[1], expectedX(forBin: 20), accuracy: 0.0001)
    }

    // No sittings (an older bundle) or a single sitting: no ticks, the ribbon
    // renders exactly as before this wave (D29).
    func test_noTicksWhenSittingsAbsentOrSingle_D29() {
        XCTAssertEqual(
            MomentumRibbon.seamTickXs(
                sittings: nil, duration: 60, count: sampleCount, size: box),
            [])
        XCTAssertEqual(
            MomentumRibbon.seamTickXs(
                sittings: spans([60]), duration: 60, count: sampleCount, size: box),
            [])
    }

    // A zero-width span clamps its boundary to the axis edge (PROTOCOL.md §12,
    // the wrong-writes-only sitting), and a zero-width seam tick draws nothing.
    func test_edgeClampedBoundariesDrawNothing_D29() {
        // Boundary at the start edge (a first sitting with no trace entry) ...
        XCTAssertEqual(
            MomentumRibbon.seamTickXs(
                sittings: spans([0, 60]), duration: 60, count: sampleCount, size: box),
            [])
        // ... and at the end edge (a last sitting with no trace entry).
        let atEnd = RoomSittings(
            count: 2,
            spans: [
                RoomSittings.Span(startSeconds: 0, endSeconds: 60),
                RoomSittings.Span(startSeconds: 60, endSeconds: 60),
            ],
            wallSeconds: 60)
        XCTAssertEqual(
            MomentumRibbon.seamTickXs(
                sittings: atEnd, duration: 60, count: sampleCount, size: box),
            [])
    }

    // Two boundaries bucketed into one bin collapse to one tick, the marker's own
    // discrete granularity (design/post-game/ANALYSIS.md bucketing).
    func test_boundariesInOneBinCollapseToOneTick_D29() {
        let ticks = MomentumRibbon.seamTickXs(
            sittings: spans([1800, 1810, 3600]), duration: 3600, count: sampleCount, size: box)
        // round(1800/3600 * 39) = round(19.5) = 20; round(1810/3600 * 39) = 20 too.
        XCTAssertEqual(ticks.count, 1)
        XCTAssertEqual(ticks[0], expectedX(forBin: 20), accuracy: 0.0001)
    }

    // A degenerate duration draws no seam (the marker's own zero-duration guard).
    func test_zeroDurationDrawsNoTicks_D29() {
        XCTAssertEqual(
            MomentumRibbon.seamTickXs(
                sittings: spans([0, 0]), duration: 0, count: sampleCount, size: box),
            [])
    }
}
