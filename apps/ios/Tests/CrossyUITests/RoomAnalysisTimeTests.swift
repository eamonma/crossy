import XCTest

@testable import CrossyUI

// The Analysis header's Time label (design/post-game/ANALYSIS.md): the momentum span
// renders through the one CrossyUI moment formatter, and it must match the web's
// formatMSS (apps/web/src/ui/analysisReadout.ts) digit for digit so the same room reads
// identically on both platforms. The pre-fix twin never rolled minutes into hours, so a
// 3700-second solve read "61:40" on iOS while the web read "1:01:40"; these pin the roll.
// Twin of analysisReadout.test.ts's formatMSS suite.

final class RoomAnalysisTimeTests: XCTestCase {
    private func label(_ seconds: Double) -> String {
        RoomAnalysis(
            owners: [:],
            momentum: RoomMomentum(durationSeconds: seconds, samples: []),
            turningPoint: nil,
            titles: []
        ).durationLabel
    }

    func test_wholeMinutesAndSeconds_zeroPaddedSecondsField() {
        XCTAssertEqual(label(372), "6:12")
        XCTAssertEqual(label(9), "0:09")
        XCTAssertEqual(label(0), "0:00")
    }

    func test_floorsFractionalSeconds_neverADecimal() {
        XCTAssertEqual(label(125.9), "2:05")
    }

    func test_underAnHourStaysMSS_uncappedMinutesUpToThe5959Boundary() {
        // The last M:SS reading before the hour rolls: 59:59 keeps the flat shape.
        XCTAssertEqual(label(3599), "59:59")
    }

    func test_theHourBoundaryRolls_1_00_00() {
        // Exactly 3600s is the first H:MM:SS reading, minutes and seconds zero-padded.
        XCTAssertEqual(label(3600), "1:00:00")
    }

    func test_pastAnHourCarriesTheHour_theBugWas3700Read6140() {
        // The fix: a 3700-second solve rolls minutes into hours (1:01:40), matching the
        // web; the pre-fix formatter left it "61:40".
        XCTAssertEqual(label(3700), "1:01:40")
        XCTAssertEqual(label(3661), "1:01:01")
    }

    func test_negativeOrNonFiniteReadsZero_neverNaN() {
        XCTAssertEqual(label(-5), "0:00")
        XCTAssertEqual(label(.nan), "0:00")
        XCTAssertEqual(label(.infinity), "0:00")
    }
}
