// The directional word loupe pinned against apps/ios/Tests/CrossyUITests/WordLoupeTests.swift so the
// twins cannot drift: the projected lens/focus geometry (word bounds + overhang, the one-cell focus),
// the axis morph that never resizes the focus square, the edge overflow past the grid, the block's nil
// geometry, and the settled-completed gate. Pure value math, no Compose, the GridCameraTests discipline.
package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class WordLoupeTests {
    // The Swift `camera` (scale 2, offset (10, 20)) and `open` 5x5 with no blocks, unit-for-unit.
    private val camera = GridCamera(scale = 2f, offsetX = 10f, offsetY = 20f)
    private val open = GridGeometry(
        rows = 5, cols = 5, blocks = emptySet(),
        circles = emptySet(), shadedCircles = emptySet(), numbers = emptyMap(),
    )

    // MARK: Geometry (WordLoupeTests.swift test_acrossLoupeOverhangsWordWhileFocusStaysOneCell)

    @Test
    fun `across loupe overhangs the word while the focus stays one cell`() {
        val layout = WordLoupeLayout.of(open, GridSelection(cell = 12, isAcross = true), camera)!!

        assertEquals(2.8f, layout.lens.x, 0.001f)
        assertEquals(156.8f, layout.lens.y, 0.001f)
        assertEquals(374.4f, layout.lens.width, 0.001f)
        assertEquals(86.4f, layout.lens.height, 0.001f)
        assertEquals(LoupeRect(154f, 164f, 72f, 72f), layout.focus)
    }

    // MARK: Axis morph (WordLoupeTests.swift test_axisMorphNeverResizesOrMovesFocusSquare)

    @Test
    fun `an axis morph never resizes or moves the focus square`() {
        val across = WordLoupeLayout.of(open, GridSelection(cell = 12, isAcross = true), camera)!!
        val down = WordLoupeLayout.of(open, GridSelection(cell = 12, isAcross = false), camera)!!

        assertEquals(across.focus, down.focus)
        assertTrue(across.lens.width > across.lens.height)
        assertTrue(down.lens.height > down.lens.width)
    }

    // MARK: Edge overflow (WordLoupeTests.swift test_edgeAnswerOverflowsPastGridBounds)

    @Test
    fun `an edge answer overflows past the grid bounds`() {
        val layout = WordLoupeLayout.of(
            open, GridSelection(cell = 0, isAcross = false), GridCamera(scale = 1f, offsetX = 0f, offsetY = 0f),
        )!!

        assertTrue(layout.lens.x < 0f)
        assertTrue(layout.lens.y < 0f)
    }

    // MARK: Block (WordLoupeTests.swift test_blockHasNoLoupe)

    @Test
    fun `a block cell has no loupe`() {
        val blocked = GridGeometry(
            rows = 3, cols = 3, blocks = setOf(4),
            circles = emptySet(), shadedCircles = emptySet(), numbers = emptyMap(),
        )
        assertNull(WordLoupeLayout.of(blocked, GridSelection(cell = 4, isAcross = true), camera))
    }

    // MARK: Gate (iOS SolveScreen showsWordLoupe = analysisResting && mosaicSettled)

    @Test
    fun `the loupe shows only on the settled completed board`() {
        assertTrue(showsWordLoupe(RoomStatus.COMPLETED, mosaicSettled = true))
        // A blooming (not yet settled) completed board keeps the plain frozen paper, no glass.
        assertFalse(showsWordLoupe(RoomStatus.COMPLETED, mosaicSettled = false))
        // Mid-solve and host-ended rooms never wear the glass, whatever the wash reads.
        assertFalse(showsWordLoupe(RoomStatus.ONGOING, mosaicSettled = true))
        assertFalse(showsWordLoupe(RoomStatus.ABANDONED, mosaicSettled = true))
    }
}
