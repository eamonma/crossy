import Foundation
import XCTest

import CrossyProtocol

// The elapsed-clock register schedule, pinned to vectors/live-activity/clock-schedule.json
// (PROTOCOL.md 12a). The register law (IslandPresentation.elapsedRegister) decides how the
// island renders a room's age; the server's push policy schedules the clock push against the
// same boundary so the ticking-to-H:MM flip is always given a render. This suite is the Swift
// conformance side: every vector case maps to the register (and coarse reading) it names, so
// the law cannot drift from the schedule the server upholds. The file is read directly via the
// #filePath mechanics, the same pattern as IslandContentStateTests (this family is not part of
// the closed v1 runner registry).

final class IslandClockScheduleTests: XCTestCase {
    /// One vector case: `{ name, ageSeconds, register, reading? }`. `reading` is present
    /// exactly when `register` is "coarse" and carries the exact static string.
    private struct Case: Decodable {
        let name: String
        let ageSeconds: Int
        let register: String
        let reading: String?
    }

    /// vectors/live-activity/clock-schedule.json, located from this file's compiled-in path:
    /// this file is at apps/ios/Tests/CrossyProtocolTests, so vectors/ is five components up
    /// beside apps/.
    private static let scheduleVectors: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyProtocolTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("vectors/live-activity/clock-schedule.json")

    private func loadCases() throws -> [Case] {
        let data = try Data(contentsOf: Self.scheduleVectors)
        let cases = try JSONDecoder().decode([Case].self, from: data)
        XCTAssertFalse(cases.isEmpty, "the clock-schedule vectors must not be empty")
        return cases
    }

    /// Every vector case maps to the register it names, coarse readings byte for byte
    /// (PROTOCOL.md 12a). A vector edit that moves a boundary or changes a reading fails here.
    func test_everyCaseMatchesTheRegisterLaw_12a() throws {
        for testCase in try loadCases() {
            let got = IslandPresentation.elapsedRegister(ageSeconds: testCase.ageSeconds)
            switch testCase.register {
            case "ticking":
                XCTAssertEqual(got, .ticking, testCase.name)
            case "coarse":
                let reading = try XCTUnwrap(
                    testCase.reading, "\(testCase.name): a coarse case must carry its reading")
                XCTAssertEqual(got, .coarse(reading), testCase.name)
            case "infinity":
                XCTAssertEqual(got, .infinity, testCase.name)
            default:
                XCTFail("\(testCase.name): unknown register \"\(testCase.register)\"")
            }
        }
    }

    /// The vectors' ticking/coarse straddle IS the boundary constant: the last ticking age is
    /// tickingBoundSeconds - 1 and the first coarse age is tickingBoundSeconds, so the constant
    /// the widget bounds its timer with (and the server twin schedules against) cannot drift
    /// from the pinned schedule (PROTOCOL.md 12a).
    func test_boundaryConstantMatchesTheVectorStraddle_12a() throws {
        let cases = try loadCases()
        let lastTicking = try XCTUnwrap(
            cases.filter { $0.register == "ticking" }.map(\.ageSeconds).max(),
            "the vectors must carry a ticking case")
        let firstCoarse = try XCTUnwrap(
            cases.filter { $0.register == "coarse" }.map(\.ageSeconds).min(),
            "the vectors must carry a coarse case")
        XCTAssertEqual(lastTicking, IslandPresentation.tickingBoundSeconds - 1)
        XCTAssertEqual(firstCoarse, IslandPresentation.tickingBoundSeconds)
        XCTAssertEqual(
            IslandPresentation.tickingRangeSeconds,
            IslandPresentation.tickingBoundSeconds - 1,
            "the timer range stays one second short of the boundary, the 59:59 reservation")
    }
}
