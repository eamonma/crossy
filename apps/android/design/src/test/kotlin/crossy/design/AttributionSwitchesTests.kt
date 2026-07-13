package crossy.design

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Mirrors apps/ios/Tests/CrossyDesignTests/AttributionSwitchesTests.swift. ID-1 (adopted
// 2026-07-10): attribution at rest is ink; color in motion and the completion mosaic stay
// for now behind single constants, cheap to mute pending the owner's on-device look. These
// tests pin the current position: flipping a switch is a deliberate, reviewed diff here, not
// a silent regression.
class AttributionSwitchesTests {
    @Test
    fun colorInMotionIsOn_pendingOnDeviceLook_ID1() {
        assertTrue(AttributionSwitches.colorInMotionEnabled)
    }

    @Test
    fun completionMosaicIsOn_pendingOnDeviceLook_ID1() {
        assertTrue(AttributionSwitches.completionMosaicEnabled)
    }

    @Test
    fun completionConfettiIsOn_pendingOnDeviceLook_ID1() {
        assertTrue(AttributionSwitches.completionConfettiEnabled)
    }
}
