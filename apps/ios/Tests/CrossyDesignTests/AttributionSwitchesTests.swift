import XCTest

@testable import CrossyDesign

// ID-1 (adopted 2026-07-10): attribution at rest is ink; color in motion and the
// completion mosaic stay for now behind single constants, cheap to mute pending the
// owner's on-device look. These tests pin the current position: flipping a switch
// is a deliberate, reviewed diff here, not a silent regression.

final class AttributionSwitchesTests: XCTestCase {
    func test_colorInMotionIsOn_pendingOnDeviceLook_ID1() {
        XCTAssertTrue(AttributionSwitches.colorInMotionEnabled)
    }

    func test_completionMosaicIsOn_pendingOnDeviceLook_ID1() {
        XCTAssertTrue(AttributionSwitches.completionMosaicEnabled)
    }
}
