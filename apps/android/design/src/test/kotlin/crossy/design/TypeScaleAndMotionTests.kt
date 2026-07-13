package crossy.design

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Mirrors apps/ios/Tests/CrossyDesignTests/TypeScaleAndMotionTests.swift. Pins the type
// constants (apps/ios/DESIGN.md §6) and the motion grammar values (§7) so a tuning change is
// a reviewed diff, never a drive-by. iOS carries motion durations in seconds; the twins are
// milliseconds (0.300 s -> 300 ms), so the exact pins are the iOS values times 1000.
class TypeScaleTests {
    // DESIGN.md §6: weight 600 on the light ground, 500 on the dark (dark grounds fatten
    // type).
    @Test
    fun gridGlyphWeights_matchDesign6() {
        assertEquals(600, TypeScale.gridGlyphWeightLightGround)
        assertEquals(500, TypeScale.gridGlyphWeightDarkGround)
    }

    // DESIGN.md §6: the shared clock never jitters in width.
    @Test
    fun tabularNumeralsRequired_design6() {
        assertTrue(TypeScale.numericChromeRequiresTabularNumerals)
    }

    // DESIGN.md §6: the legibility floor is 10 (points on iOS, sp here).
    @Test
    fun legibilityFloor_matchesDesign6() {
        assertEquals(10.0, TypeScale.gridGlyphLegibilityFloorSp)
    }
}

class MotionTests {
    // PROTOCOL.md §8 / DESIGN.md §7: the flash is roughly 300 ms, sharp attack, long decay;
    // attack and decay partition the envelope.
    @Test
    fun flashEnvelope_protocol8() {
        assertEquals(300, Motion.Flash.durationMs)
        assertEquals(
            Motion.Flash.durationMs,
            Motion.Flash.attackDurationMs + Motion.Flash.decayDurationMs,
        )
        assertTrue(
            Motion.Flash.attackDurationMs < Motion.Flash.decayDurationMs,
            "sharp attack, long decay: the attack must be the short side",
        )
    }

    // The exact envelope split (0.050 s / 0.250 s on iOS).
    @Test
    fun flashEnvelopeSplit_matchesDesign7() {
        assertEquals(50, Motion.Flash.attackDurationMs)
        assertEquals(250, Motion.Flash.decayDurationMs)
    }

    // Bezier control points stay in the unit square so any curve consumer is safe.
    @Test
    fun flashDecayControlPoints_areUnitSquare() {
        for (point in listOf(Motion.Flash.decayControlPoint1, Motion.Flash.decayControlPoint2)) {
            assertTrue(point.x in 0.0..1.0)
            assertTrue(point.y in 0.0..1.0)
        }
    }

    // The exact decay curve (apps/ios/DESIGN.md §7).
    @Test
    fun flashDecayControlPoints_matchDesign7() {
        assertEquals(0.16, Motion.Flash.decayControlPoint1.x)
        assertEquals(1.0, Motion.Flash.decayControlPoint1.y)
        assertEquals(0.30, Motion.Flash.decayControlPoint2.x)
        assertEquals(1.0, Motion.Flash.decayControlPoint2.y)
    }

    // DESIGN.md §7: standing chrome uses small springs with no overshoot; damping fraction
    // >= 1 is the no-overshoot guarantee. Overshoot is reserved for people and celebration.
    @Test
    fun springGrammar_noChromeOvershoot_design7() {
        assertTrue(Motion.Springs.chromeDampingFraction >= 1.0)
        assertTrue(
            Motion.Springs.celebrationDampingFraction < 1.0,
            "celebration springs are the only ones allowed to overshoot",
        )
        assertTrue(Motion.Springs.chromeResponseMs > 0)
        assertTrue(Motion.Springs.celebrationResponseMs > 0)
    }

    // The exact spring tuning (iOS response 0.30 / 0.45 / 0.14 s, damping 1.0 / 0.78).
    @Test
    fun springConstants_matchDesign7() {
        assertEquals(300, Motion.Springs.chromeResponseMs)
        assertEquals(1.0, Motion.Springs.chromeDampingFraction)
        assertEquals(450, Motion.Springs.celebrationResponseMs)
        assertEquals(0.78, Motion.Springs.celebrationDampingFraction)
        assertEquals(140, Motion.Springs.keyPressResponseMs)
    }
}
