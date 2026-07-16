// Camera follow (I2c): a jump that lands the cursor off-screen pans the MINIMAL distance that shows
// the cell with breathing room, framing the whole WORD when it fits and tracking the cursor cell when
// the word is too wide; a visible cursor moves nothing. Twin of
// apps/ios/Tests/CrossyUITests/CameraFollowTests.swift; the target math is pure, the glide the view's
// hand-stepped interpolation. Defends the follow contract, not a numbered invariant.
package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class CameraFollowTests {
    private val vw = 393f
    private val vh = 560f
    private val rows = 25
    private val cols = 25
    private val margin = GridCamera.FOLLOW_MARGIN

    // Scale 1: a 25x25 board is 900x900, well past the viewport.
    private val camera = GridCamera(1f, 0f, 0f).clamped(393f, 560f, 25, 25)

    @Test
    fun `a visible cell needs no pan`() {
        assertNull(camera.following(2 * cols + 2, vw, vh, rows, cols))
    }

    @Test
    fun `offscreen right pans the minimal distance`() {
        val target = camera.following(12 * cols + 20, vw, vh, rows, cols)
        assertNotNull(target)
        assertEquals(vw - margin - 756f, target!!.offsetX, 0.001f)
        assertEquals(0f, target.offsetY, 0.001f)
        assertEquals(1f, target.scale, 0.001f)
    }

    @Test
    fun `offscreen below pans only the vertical axis`() {
        val target = camera.following(20 * cols + 3, vw, vh, rows, cols)
        assertNotNull(target)
        assertEquals(0f, target!!.offsetX, 0.001f)
        assertEquals(vh - margin - 756f, target.offsetY, 0.001f)
    }

    @Test
    fun `a corner cell stays inside the board clamp`() {
        val target = camera.following(rows * cols - 1, vw, vh, rows, cols)
        assertNotNull(target)
        assertEquals(vw - 900f, target!!.offsetX, 0.001f)
        assertEquals(vh - 900f, target.offsetY, 0.001f)
    }

    @Test
    fun `an edge cell under the pin needs no pan because the clamp holds it`() {
        assertNull(camera.following(0, vw, vh, rows, cols))
    }

    @Test
    fun `a fitting board never pans`() {
        val small = GridCamera.initial(vw, vh, 9, 9)
        for (cell in listOf(0, 40, 80)) assertNull(small.following(cell, vw, vh, 9, 9))
    }

    // MARK: Word follow (advancing a clue frames the whole word, owner 2026-07-12)

    @Test
    fun `a fully visible word needs no pan`() {
        assertNull(camera.following(setOf(127, 128, 129, 130), 127, vw, vh, rows, cols))
    }

    @Test
    fun `an across word offscreen right reveals the whole word, not just the cursor`() {
        val word = setOf(143, 144, 145, 146, 147)
        val target = camera.following(word, 143, vw, vh, rows, cols)
        assertNotNull(target)
        assertEquals(vw - margin - 828f, target!!.offsetX, 0.001f)
        assertEquals(0f, target.offsetY, 0.001f)
        // Contrast: the single-cell follow stops at the cursor's own right edge (684).
        val cellOnly = camera.following(143, vw, vh, rows, cols)
        assertEquals(vw - margin - 684f, cellOnly!!.offsetX, 0.001f)
    }

    @Test
    fun `a down word offscreen below pans only vertical to reveal the word`() {
        val word = setOf(453, 478, 503, 528, 553)
        val target = camera.following(word, 453, vw, vh, rows, cols)
        assertNotNull(target)
        assertEquals(0f, target!!.offsetX, 0.001f)
        assertEquals(vh - margin - 828f, target.offsetY, 0.001f)
    }

    @Test
    fun `a word wider than the window falls back to the smooth cursor follow`() {
        val zoomed = GridCamera(GridCamera.maxScale, 0f, 0f).clamped(vw, vh, rows, cols)
        val word = (0 until cols).toSet()
        for (cursor in listOf(0, 5, 10, 18, 24)) {
            assertEquals(
                zoomed.following(cursor, vw, vh, rows, cols),
                zoomed.following(word, cursor, vw, vh, rows, cols),
            )
        }
    }

    @Test
    fun `typing across a framed word holds the camera still`() {
        val word = setOf(143, 144, 145, 146, 147)
        val framed = camera.following(word, 143, vw, vh, rows, cols)!!
        for (cursor in word) assertNull(framed.following(word, cursor, vw, vh, rows, cols))
    }

    @Test
    fun `an empty word falls back to the cursor cell`() {
        assertEquals(
            camera.following(12 * cols + 20, vw, vh, rows, cols),
            camera.following(emptySet(), 12 * cols + 20, vw, vh, rows, cols),
        )
    }

    @Test
    fun `interpolated walks endpoint to endpoint clamped`() {
        val start = GridCamera(1f, 0f, 0f)
        val end = GridCamera(1f, -100f, 40f)
        assertEquals(start, start.interpolated(end, 0f))
        assertEquals(end, start.interpolated(end, 1f))
        val mid = start.interpolated(end, 0.5f)
        assertEquals(-50f, mid.offsetX, 0.001f)
        assertEquals(20f, mid.offsetY, 0.001f)
        assertEquals(end, start.interpolated(end, 2f))
    }
}
