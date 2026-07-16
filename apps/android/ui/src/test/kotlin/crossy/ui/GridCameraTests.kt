// The camera: zoom clamped between the glyph-legibility floor (TypeScale) and a comfortable ceiling,
// offsets clamped so the board never flies offscreen, hit testing as a pure point-to-cell function
// across any transform, and camera follow that pans the minimal distance to frame a jumped-to word.
// Twin of apps/ios/Tests/CrossyUITests/GridCameraTests.swift and CameraFollowTests.swift; the numeric
// pins carry over unit-for-unit (dp for iOS points), the 25x25 ingestion cap sizing the whole file
// (apps/ios/DESIGN.md §2). These defend the interaction contract, not a numbered invariant.
package crossy.ui

import crossy.design.TypeScale
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GridCameraTests {
    // An iPhone-ish grid viewport (GridCameraTests.swift `viewport`).
    private val vw = 393f
    private val vh = 560f
    private val rows = 25
    private val cols = 25
    private val margin = GridCamera.FOLLOW_MARGIN

    private fun clamped(scale: Float, x: Float, y: Float, r: Int = rows, c: Int = cols, occ: GridOcclusion = GridOcclusion.NONE) =
        GridCamera(scale, x, y).clamped(vw, vh, r, c, occ)

    /** The board point under a viewport point through a camera, in module units (the swift helper). */
    private fun boardX(cam: GridCamera, px: Float) = (px - cam.offsetX) / cam.scale
    private fun boardY(cam: GridCamera, py: Float) = (py - cam.offsetY) / cam.scale

    // MARK: Scale bounds (GridCameraTests.swift test_legibilityFloor / test_minScale / test_clamped)

    @Test
    fun `legibility floor comes from TypeScale`() {
        val floor = GridCamera.legibilityFloorScale
        assertEquals(TypeScale.gridGlyphLegibilityFloorSp.toFloat(), floor * GridModule.GLYPH_FONT_SIZE, 0.0001f)
        assertEquals(15f, floor * GridModule.UNIT, 0.0001f)
    }

    @Test
    fun `maxScale is a two-tap-target cell edge`() {
        assertEquals(GridCamera.MAX_CELL_POINTS / GridModule.UNIT, GridCamera.maxScale, 0.0001f)
        assertEquals(2f, GridCamera.maxScale, 0.0001f)
    }

    @Test
    fun `minScale holds the floor when fit would blur a 25x25`() {
        val fit = GridCamera.fitScale(320f, 480f, 25, 25)
        assertTrue(fit < GridCamera.legibilityFloorScale)
        assertEquals(GridCamera.legibilityFloorScale, GridCamera.minScale(320f, 480f, 25, 25))
    }

    @Test
    fun `minScale is the fit when the board fits legibly (15x15)`() {
        val fit = GridCamera.fitScale(vw, vh, 15, 15)
        assertTrue(fit > GridCamera.legibilityFloorScale)
        assertEquals(fit, GridCamera.minScale(vw, vh, 15, 15))
    }

    @Test
    fun `minScale never exceeds maxScale on a tiny board`() {
        assertEquals(GridCamera.maxScale, GridCamera.minScale(vw, vh, 2, 2))
    }

    @Test
    fun `clamped bounds scale both ways`() {
        assertEquals(GridCamera.minScale(vw, vh, 25, 25), clamped(0.01f, 0f, 0f).scale)
        assertEquals(GridCamera.maxScale, clamped(50f, 0f, 0f).scale)
    }

    @Test
    fun `clamped centers a fitting axis and pins an overflowing one`() {
        // 12x12 at scale 1.2 is 518.4 dp square: wider than the viewport, shorter than it.
        val cam = clamped(1.2f, 999f, -999f, 12, 12)
        assertEquals(1.2f, cam.scale, 0.0001f)
        assertEquals(0f, cam.offsetX, 0.001f)
        assertEquals((560f - 518.4f) / 2f, cam.offsetY, 0.01f)
    }

    @Test
    fun `clamped never flies the board offscreen`() {
        val scale = GridCamera.maxScale
        val content = 25 * GridModule.UNIT * scale
        assertEquals(0f, clamped(scale, 400f, 700f).offsetX, 0.001f)
        assertEquals(0f, clamped(scale, 400f, 700f).offsetY, 0.001f)
        val back = clamped(scale, -99999f, -99999f)
        assertEquals(vw - content, back.offsetX, 0.01f)
        assertEquals(vh - content, back.offsetY, 0.01f)
    }

    @Test
    fun `initial opens at the clamp centered`() {
        val cam = GridCamera.initial(vw, vh, 15, 15)
        assertEquals(GridCamera.fitScale(vw, vh, 15, 15), cam.scale, 0.0001f)
        val content = 15 * GridModule.UNIT * cam.scale
        assertEquals((vw - content) / 2f, cam.offsetX, 0.001f)
    }

    // MARK: Pinch, the Photos/Maps anchor (GridCameraTests.swift test_zoomed / test_pinched_*)

    @Test
    fun `zoomed keeps the anchor point fixed`() {
        val start = clamped(1f, -200f, -300f)
        assertEquals(-200f, start.offsetX, 0.001f)
        assertEquals(-300f, start.offsetY, 0.001f)
        val ax = 200f
        val ay = 250f
        val beforeX = boardX(start, ax)
        val beforeY = boardY(start, ay)
        val z = start.zoomed(1.5f, ax, ay, vw, vh, 25, 25)
        assertEquals(1.5f, z.scale, 0.001f)
        assertEquals(beforeX, boardX(z, ax), 0.01f)
        assertEquals(beforeY, boardY(z, ay), 0.01f)
    }

    @Test
    fun `zoomed clamps at the legibility floor`() {
        val start = GridCamera.initial(vw, vh, 25, 25)
        val out = start.zoomed(0.01f, 100f, 100f, vw, vh, 25, 25)
        assertEquals(GridCamera.minScale(vw, vh, 25, 25), out.scale)
    }

    @Test
    fun `pinched without drift matches zoomed about the anchor`() {
        val start = clamped(1f, -200f, -300f)
        val viaZoom = start.zoomed(1.6f, 200f, 250f, vw, vh, 25, 25)
        val viaPinch = start.pinched(1.6f, 200f, 250f, 200f, 250f, vw, vh, 25, 25)
        assertEquals(viaZoom.scale, viaPinch.scale, 0.0001f)
        assertEquals(viaZoom.offsetX, viaPinch.offsetX, 0.0001f)
        assertEquals(viaZoom.offsetY, viaPinch.offsetY, 0.0001f)
    }

    @Test
    fun `pinched lands the start-centroid board point under the live centroid`() {
        // The core anchor law: a centroid that wanders mid-pinch pans the content with it.
        val start = clamped(1f, -220f, -260f)
        val anchoredX = boardX(start, 180f)
        val anchoredY = boardY(start, 240f)
        val p = start.pinched(1.4f, 180f, 240f, 240f, 210f, vw, vh, 25, 25)
        assertEquals(1.4f, p.scale, 0.0001f)
        assertEquals(anchoredX, boardX(p, 240f), 0.01f)
        assertEquals(anchoredY, boardY(p, 210f), 0.01f)
    }

    @Test
    fun `pinched pure centroid drift pans without scaling`() {
        val start = clamped(GridCamera.maxScale, -400f, -400f)
        val pinnedX = boardX(start, 260f)
        val p = start.pinched(1.0f, 260f, 340f, 200f, 300f, vw, vh, 25, 25)
        assertEquals(start.scale, p.scale, 0.0001f)
        assertEquals(pinnedX, boardX(p, 200f), 0.01f)
        // The offset moved by exactly the centroid's drift (-60, -40).
        assertEquals(start.offsetX - 60f, p.offsetX, 0.01f)
        assertEquals(start.offsetY - 40f, p.offsetY, 0.01f)
    }

    @Test
    fun `pinched at the ceiling with a still centroid is a fixed point`() {
        // The reported bug's twin: at max zoom, pinching harder with the fingers still changes
        // nothing (the pin solves at the rendered scale, not the raw target the clamp discards).
        val start = clamped(GridCamera.maxScale, -400f, -400f)
        for (mag in listOf(1.5f, 10f, 1000f)) {
            val sat = start.pinched(mag, 200f, 300f, 200f, 300f, vw, vh, 25, 25)
            assertEquals(GridCamera.maxScale, sat.scale)
            assertEquals(start.offsetX, sat.offsetX, 0.0001f)
            assertEquals(start.offsetY, sat.offsetY, 0.0001f)
        }
    }

    @Test
    fun `pinched at the floor with a still centroid is a fixed point`() {
        val start = GridCamera.initial(vw, vh, 25, 25)
        assertEquals(GridCamera.minScale(vw, vh, 25, 25), start.scale)
        for (mag in listOf(0.5f, 0.01f, 0.0001f)) {
            val sat = start.pinched(mag, 180f, 260f, 180f, 260f, vw, vh, 25, 25)
            assertEquals(start.scale, sat.scale)
            assertEquals(start.offsetX, sat.offsetX, 0.0001f)
            assertEquals(start.offsetY, sat.offsetY, 0.0001f)
        }
    }

    @Test
    fun `pinched saturated at the ceiling still pans by exactly the drift`() {
        val start = clamped(GridCamera.maxScale, -400f, -400f)
        val pinnedX = boardX(start, 260f)
        val sat = start.pinched(100f, 260f, 340f, 200f, 300f, vw, vh, 25, 25)
        assertEquals(GridCamera.maxScale, sat.scale)
        assertEquals(pinnedX, boardX(sat, 200f), 0.01f)
        assertEquals(start.offsetX - 60f, sat.offsetX, 0.01f)
        assertEquals(start.offsetY - 40f, sat.offsetY, 0.01f)
    }

    @Test
    fun `pinched non-positive magnification is inert`() {
        val start = clamped(1f, -100f, -120f)
        assertEquals(start, start.pinched(0f, 100f, 100f, 150f, 150f, vw, vh, 25, 25))
    }

    @Test
    fun `panned translates and clamps`() {
        val start = clamped(GridCamera.maxScale, 0f, 0f)
        val p = start.panned(-120f, -60f, vw, vh, 25, 25)
        assertEquals(-120f, p.offsetX, 0.001f)
        assertEquals(-60f, p.offsetY, 0.001f)
        val pinned = start.panned(500f, 500f, vw, vh, 25, 25)
        assertEquals(0f, pinned.offsetX, 0.001f)
        assertEquals(0f, pinned.offsetY, 0.001f)
    }

    // MARK: Hit testing (GridCameraTests.swift test_hitTest_*)

    @Test
    fun `hit test identity transform`() {
        val cam = GridCamera(1f, 0f, 0f)
        assertEquals(0, cam.cell(1f, 1f, 5, 5))
        assertEquals(1, cam.cell(37f, 1f, 5, 5))
        assertEquals(12, cam.cell(100f, 100f, 5, 5))
    }

    @Test
    fun `hit test across zoom and pan`() {
        val cam = GridCamera(2f, -72f, -36f)
        assertEquals(1, cam.cell(10f, 10f, 5, 5))
        assertEquals(13, cam.cell(150f, 150f, 5, 5))
    }

    @Test
    fun `hit test outside the board is null`() {
        val cam = GridCamera(1f, 0f, 0f)
        assertNull(cam.cell(-1f, 10f, 5, 5))
        assertNull(cam.cell(181f, 10f, 5, 5))
        assertNull(cam.cell(10f, 181f, 5, 5))
    }

    // MARK: Culling (GridCameraTests.swift test_visibleCells_*)

    @Test
    fun `visible cells cover the viewport and only that`() {
        val cam = GridCamera(GridCamera.legibilityFloorScale, -15f, -15f)
        val v = cam.visibleCells(150f, 90f, 25, 25)
        assertEquals(1, v.colStart)
        assertEquals(11, v.colEnd)
        assertEquals(1, v.rowStart)
        assertEquals(7, v.rowEnd)
    }

    @Test
    fun `visible cells clamp to the board`() {
        val v = GridCamera(1f, 0f, 0f).visibleCells(10000f, 10000f, 5, 5)
        assertEquals(0, v.rowStart)
        assertEquals(5, v.rowEnd)
        assertEquals(0, v.colStart)
        assertEquals(5, v.colEnd)
    }

    // MARK: Occlusion, the full-bleed ruling (GridCameraTests.swift test_occlusion_* / test_following_*)

    private val occ = GridOcclusion(top = 110f, bottom = 92f)

    @Test
    fun `occlusion window height floors at zero`() {
        assertEquals(560f - 110f - 92f, occ.windowHeight(vh))
        assertEquals(0f, GridOcclusion(400f, 400f).windowHeight(vh))
    }

    @Test
    fun `fitScale fits the window not the viewport, full bleed`() {
        // A 9x9 is 324 units square; height-limited fit uses the 358-dp window, not the 560 viewport.
        assertEquals((560f - 110f - 92f) / 324f, GridCamera.fitScale(500f, 560f, 9, 9, occ), 0.0001f)
        assertEquals(500f / 324f, GridCamera.fitScale(500f, 560f, 9, 9), 0.0001f)
    }

    @Test
    fun `clamped overflowing board pins to the window edges and bleeds past the screen`() {
        val scale = GridCamera.maxScale
        val content = 25 * GridModule.UNIT * scale
        val tooFar = GridCamera(scale, 0f, 700f).clamped(vw, vh, 25, 25, occ)
        assertEquals(110f, tooFar.offsetY, 0.001f)
        assertTrue(110f + content > vh)
        val tooBack = GridCamera(scale, 0f, -99999f).clamped(vw, vh, 25, 25, occ)
        assertEquals((vh - 92f) - content, tooBack.offsetY, 0.001f)
    }

    @Test
    fun `following pans a cell out from under the clue bar, full bleed`() {
        // Cell (14, 3): y 504..540, under the bottom cover (window bottom 468). Pan up the minimal
        // distance: cell bottom to the window bottom less the margin.
        val start = GridCamera(1f, 0f, 0f).clamped(vw, vh, 25, 25, occ)
        val target = start.following(14 * 25 + 3, vw, vh, 25, 25, occlusion = occ, keepClear = occ)
        assertNotNull(target)
        assertEquals(vh - 92f - margin - 540f, target!!.offsetY, 0.001f)
        assertEquals(0f, target.offsetX, 0.001f)
        assertEquals(1f, target.scale, 0.001f)
    }

    @Test
    fun `following inside the window needs no pan`() {
        val start = GridCamera(1f, 0f, 0f).clamped(vw, vh, 25, 25, occ)
        assertNull(start.following(7 * 25 + 3, vw, vh, 25, 25, occlusion = occ, keepClear = occ))
    }

    @Test
    fun `following a grown bar rescues the cell through keepClear`() {
        val start = GridCamera(1f, 0f, 0f).clamped(vw, vh, 25, 25, occ)
        val grown = GridOcclusion(top = 110f, bottom = 92f + 68f)
        val cell = 11 * 25 + 3
        assertNull(start.following(cell, vw, vh, 25, 25, occlusion = occ, keepClear = occ))
        val target = start.following(cell, vw, vh, 25, 25, occlusion = occ, keepClear = grown)
        assertNotNull(target)
        assertEquals(vh - (92f + 68f) - margin - 432f, target!!.offsetY, 0.001f)
    }

    @Test
    fun `following the grown bar never shoves a bottom-pinned board, full bleed`() {
        val scale = 1f
        val content = 25 * GridModule.UNIT * scale
        val pinned = GridCamera(scale, 0f, (vh - 92f) - content).clamped(vw, vh, 25, 25, occ)
        val grown = GridOcclusion(top = 110f, bottom = 92f + 68f)
        assertNull(pinned.following(24 * 25 + 3, vw, vh, 25, 25, occlusion = occ, keepClear = grown))
    }
}
