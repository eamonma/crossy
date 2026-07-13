package crossy.design

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Mirrors apps/ios/Tests/CrossyDesignTests/GroundTests.swift. Pins the two ground token sets
// against the apps/ios/DESIGN.md §5 tables (ID-6: one app, two grounds, no third identity).
class GroundTests {
    @Test
    fun studioTokens_matchDesignTable_ID6() {
        assertEquals(0xF2F1EC, Ground.studio.canvas.rgb24)
        assertEquals(0xFFFFFF, Ground.studio.cell.rgb24)
        assertEquals(0x1D1B18, Ground.studio.ink.rgb24)
        assertEquals(0x1B1A17, Ground.studio.block.rgb24)
        assertEquals(0xD9D6CD, Ground.studio.gridLine.rgb24)
        assertEquals(0x8B877D, Ground.studio.number.rgb24)
    }

    @Test
    fun observatoryTokens_matchDesignTable_ID6() {
        assertEquals(0x121118, Ground.observatory.canvas.rgb24)
        assertEquals(0x201F27, Ground.observatory.cell.rgb24)
        assertEquals(0xEDEAE2, Ground.observatory.ink.rgb24)
        assertEquals(0x0A0910, Ground.observatory.block.rgb24)
        assertEquals(0x2C2B34, Ground.observatory.gridLine.rgb24)
        assertEquals(0x77747F, Ground.observatory.number.rgb24)
    }

    // DESIGN.md §5: Observatory recesses blocks darker than the canvas; Studio raises cells
    // lighter than the canvas. Pins the relationships the prose promises, not just the raw
    // values.
    @Test
    fun groundRelationships_ID6() {
        assertTrue(
            Ground.observatory.block.rgb24 < Ground.observatory.canvas.rgb24,
            "Observatory blocks must recess darker than the canvas",
        )
        assertTrue(
            Ground.studio.cell.rgb24 > Ground.studio.canvas.rgb24,
            "Studio cells sit lighter than the bone canvas",
        )
    }
}
