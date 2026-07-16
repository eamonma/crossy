// Pan and zoom over the module-unit board (twin of apps/ios GridCamera.swift; apps/ios/DESIGN.md §2:
// grids up to the 25x25 ingestion cap render legibly, and past comfortable glyph size the grid pans
// and zooms). The camera is two numbers, points-per-unit (`scale`) and a board origin (`offset`), so
// every rule here is a pure function the tests can pin: the zoom-out clamp holds the glyph-legibility
// floor (TypeScale), the zoom-in clamp a comfortable ceiling, and offsets clamp so the board never
// flies offscreen. Kept a pure value type (no Compose), like ReactionFanModel, so the whole camera
// grammar is JVM-testable; the Canvas surface (CrossyGrid.kt) converts these dp-space points to px.
//
// The coordinate unit is dp (the Android twin of iOS points), so `legibilityFloorScale` is a plain
// constant pinned exactly as iOS pins it: viewport, offset, and scale are all in dp; the view scales
// by display density on the way to the Canvas. iOS carries CGFloat (Double); the twin carries Float,
// the currency Compose draws in.

package crossy.ui

import crossy.design.TypeScale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Standing chrome's cover over the full-bleed board, in viewport dp (twin of the iOS GridOcclusion):
 * the STANDING inset (room bar above, clue bar below) feeds the clamp so a fitting board centers
 * between the bars and a panned board pins its edges; the KEEP-CLEAR inset (the live, possibly
 * wrapped bar) feeds only the follow. Android's grid lays out in its own row rather than full-bleed,
 * so the room passes `NONE`; the parameter is the seam a full-bleed board would grow through.
 */
data class GridOcclusion(val top: Float = 0f, val bottom: Float = 0f) {
    /** The unobstructed height of a viewport under this occlusion, floored at zero so degenerate
     *  chrome can never invert the window. */
    fun windowHeight(viewportHeight: Float): Float = max(viewportHeight - top - bottom, 0f)

    companion object {
        val NONE = GridOcclusion()
    }
}

/** The rows and columns intersecting the viewport (half-open ranges, `end` exclusive): the draw pass
 *  touches only these, so a zoomed 25x25 costs what is on screen, not 625 cells. */
data class VisibleCells(val rowStart: Int, val rowEnd: Int, val colStart: Int, val colEnd: Int)

/**
 * @param scale viewport dp per module unit.
 * @param offsetX the board origin's (cell 0's top-left) x in viewport dp.
 * @param offsetY the board origin's y in viewport dp.
 */
data class GridCamera(val scale: Float, val offsetX: Float, val offsetY: Float) {

    // MARK: Clamping

    /** Scale into bounds; each axis then centers when the board is smaller than the unobstructed
     *  window and otherwise pins so no gap opens between board edge and window edge. The occlusion
     *  here is the STANDING inset, constant under clue growth, so the clamp never moves the board when
     *  the bar breathes (twin of GridCamera.clamped). */
    fun clamped(
        viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
        occlusion: GridOcclusion = GridOcclusion.NONE,
    ): GridCamera {
        val bounded = min(
            max(scale, minScale(viewportWidth, viewportHeight, rows, cols, occlusion)),
            maxScale,
        )
        val contentW = boardWidth(cols) * bounded
        val contentH = boardHeight(rows) * bounded
        return GridCamera(
            scale = bounded,
            offsetX = clampedAxis(offsetX, contentW, viewportWidth),
            offsetY = clampedAxis(offsetY, contentH, viewportHeight, occlusion.top, occlusion.bottom),
        )
    }

    // MARK: Gestures

    /** Pinch about a fixed anchor (the board point under the fingers stays under them), then clamp;
     *  `pinched` generalizes this to a centroid that also drifts (twin of GridCamera.zoomed). */
    fun zoomed(
        magnification: Float, anchorX: Float, anchorY: Float,
        viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
        occlusion: GridOcclusion = GridOcclusion.NONE,
    ): GridCamera = pinched(
        magnification, anchorX, anchorY, anchorX, anchorY,
        viewportWidth, viewportHeight, rows, cols, occlusion,
    )

    /** Pinch, the Photos/Maps rule (twin of GridCamera.pinched): the board point under the pinch's
     *  START centroid stays pinned under the LIVE centroid as scale changes, so a centroid that
     *  drifts mid-pinch pans the board with it. The scale clamps FIRST, so the pin solves at the scale
     *  that will render: pinch past the ceiling (or floor) with a still centroid and the camera is a
     *  fixed point (scale saturates, offset holds); only real centroid drift pans. */
    fun pinched(
        magnification: Float, startCentroidX: Float, startCentroidY: Float,
        centroidX: Float, centroidY: Float,
        viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
        occlusion: GridOcclusion = GridOcclusion.NONE,
    ): GridCamera {
        if (magnification <= 0f || scale <= 0f) return this
        // Clamp the scale before placing the pin: the anchor law must hold at the scale that renders,
        // not at the raw target the clamp would then pull back.
        val target = min(
            max(scale * magnification, minScale(viewportWidth, viewportHeight, rows, cols, occlusion)),
            maxScale,
        )
        // The board point under the start centroid, in module units.
        val boardPointX = (startCentroidX - offsetX) / scale
        val boardPointY = (startCentroidY - offsetY) / scale
        // Put that board point back under the live centroid at the clamped scale, then bounds-clamp
        // only (the scale already sits inside its range, so this never breaks the pin).
        return GridCamera(
            scale = target,
            offsetX = centroidX - boardPointX * target,
            offsetY = centroidY - boardPointY * target,
        ).clamped(viewportWidth, viewportHeight, rows, cols, occlusion)
    }

    /** Drag: translate and clamp. Inert when the board already fits (clamping re-centers), so pan only
     *  bites when zoomed past fit (twin of GridCamera.panned). */
    fun panned(
        translationX: Float, translationY: Float,
        viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
        occlusion: GridOcclusion = GridOcclusion.NONE,
    ): GridCamera = GridCamera(scale, offsetX + translationX, offsetY + translationY)
        .clamped(viewportWidth, viewportHeight, rows, cols, occlusion)

    // MARK: Hit testing

    /** The cell under a viewport point, through this camera's transform; null outside the board. Pure
     *  point-to-cell: blocks are the caller's rule, not geometry's (twin of GridCamera.cell). */
    fun cell(pointX: Float, pointY: Float, rows: Int, cols: Int): Int? {
        if (scale <= 0f) return null
        val col = floor((pointX - offsetX) / scale / GridModule.UNIT).toInt()
        val row = floor((pointY - offsetY) / scale / GridModule.UNIT).toInt()
        if (row < 0 || row >= rows || col < 0 || col >= cols) return null
        return row * cols + col
    }

    // MARK: Follow

    /** The minimal pan that brings `cell` into the unobstructed window with `margin` breathing room
     *  (I2c camera follow); null when no pan is needed or possible. Scale never changes: follow is a
     *  pan, not a zoom (twin of GridCamera.following(cell:)). */
    fun following(
        cell: Int, viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
        margin: Float = FOLLOW_MARGIN, occlusion: GridOcclusion = GridOcclusion.NONE,
        keepClear: GridOcclusion? = null,
    ): GridCamera? {
        if (cell < 0 || cell >= rows * cols) return null
        val minX = (cell % cols) * GridModule.UNIT
        val minY = (cell / cols) * GridModule.UNIT
        return followed(
            spanMinX = minX, spanMaxX = minX + GridModule.UNIT,
            spanMinY = minY, spanMaxY = minY + GridModule.UNIT,
            cellMinX = minX, cellMaxX = minX + GridModule.UNIT,
            cellMinY = minY, cellMaxY = minY + GridModule.UNIT,
            viewportWidth, viewportHeight, rows, cols, margin, occlusion, keepClear,
        )
    }

    /** The minimal pan that brings the whole current WORD into the window when it fits, and otherwise
     *  follows the cursor cell alone (owner 2026-07-12: advancing a clue should frame the word you are
     *  about to solve). `word` order does not matter, only its lowest and highest cell, since a word
     *  is a straight line. Whether to frame is decided per axis by whether the word fits, so typing
     *  across a framed word holds the camera still (no per-keystroke flip); reduces to the cell follow
     *  on the cross axis and for an empty word (twin of GridCamera.following(word:cursor:)). */
    fun following(
        word: Iterable<Int>, cursor: Int, viewportWidth: Float, viewportHeight: Float,
        rows: Int, cols: Int, margin: Float = FOLLOW_MARGIN,
        occlusion: GridOcclusion = GridOcclusion.NONE, keepClear: GridOcclusion? = null,
    ): GridCamera? {
        if (cursor < 0 || cursor >= rows * cols) return null
        val count = rows * cols
        // A word is a contiguous run, so its bounding rect spans its lowest and highest cell index; an
        // empty word (a block or an out-of-range pick) collapses the span onto the cursor.
        var lo = cursor
        var hi = cursor
        for (c in word) if (c in 0 until count) {
            lo = min(lo, c)
            hi = max(hi, c)
        }
        val loMinX = (lo % cols) * GridModule.UNIT
        val loMinY = (lo / cols) * GridModule.UNIT
        val hiMinX = (hi % cols) * GridModule.UNIT
        val hiMinY = (hi / cols) * GridModule.UNIT
        val curMinX = (cursor % cols) * GridModule.UNIT
        val curMinY = (cursor / cols) * GridModule.UNIT
        return followed(
            spanMinX = min(loMinX, hiMinX), spanMaxX = max(loMinX, hiMinX) + GridModule.UNIT,
            spanMinY = min(loMinY, hiMinY), spanMaxY = max(loMinY, hiMinY) + GridModule.UNIT,
            cellMinX = curMinX, cellMaxX = curMinX + GridModule.UNIT,
            cellMinY = curMinY, cellMaxY = curMinY + GridModule.UNIT,
            viewportWidth, viewportHeight, rows, cols, margin, occlusion, keepClear,
        )
    }

    /** Shared follow solver: pan so the span (a whole word) enters the window with `margin`, falling
     *  back per axis to the cursor cell when the word is too wide. `keepClear` is the live cover the
     *  cursor must escape (the larger cover per edge); the final clamp rides the standing `occlusion`,
     *  so clue growth can only rescue the cursor, never shove a pinned board (twin of GridCamera
     *  .followed). Returns null when the target equals `this`. */
    private fun followed(
        spanMinX: Float, spanMaxX: Float, spanMinY: Float, spanMaxY: Float,
        cellMinX: Float, cellMaxX: Float, cellMinY: Float, cellMaxY: Float,
        viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
        margin: Float, occlusion: GridOcclusion, keepClear: GridOcclusion?,
    ): GridCamera? {
        val live = keepClear ?: occlusion
        val clearTop = max(live.top, occlusion.top)
        val clearBottom = max(live.bottom, occlusion.bottom)
        val target = GridCamera(
            scale = scale,
            offsetX = followedAxis(
                offsetX, spanMinX * scale, spanMaxX * scale, cellMinX * scale, cellMaxX * scale,
                viewportWidth, margin,
            ),
            offsetY = followedAxis(
                offsetY, spanMinY * scale, spanMaxY * scale, cellMinY * scale, cellMaxY * scale,
                viewportHeight, margin, clearTop, clearBottom,
            ),
        ).clamped(viewportWidth, viewportHeight, rows, cols, occlusion)
        return if (target == this) null else target
    }

    /** Straight-line interpolation toward another camera, fraction clamped: the follow animator's step
     *  function (Canvas transforms cannot ride a Compose animation, so the glide is computed; twin of
     *  GridCamera.interpolated). */
    fun interpolated(to: GridCamera, fraction: Float): GridCamera {
        val t = min(max(fraction, 0f), 1f)
        return GridCamera(
            scale = scale + (to.scale - scale) * t,
            offsetX = offsetX + (to.offsetX - offsetX) * t,
            offsetY = offsetY + (to.offsetY - offsetY) * t,
        )
    }

    // MARK: Culling

    /** The rows and columns intersecting the viewport (twin of GridCamera.visibleCells). */
    fun visibleCells(viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int): VisibleCells {
        if (scale <= 0f) return VisibleCells(0, 0, 0, 0)
        val unit = GridModule.UNIT * scale
        val firstCol = max(0, floor(-offsetX / unit).toInt())
        val firstRow = max(0, floor(-offsetY / unit).toInt())
        val lastCol = min(cols, ceilDiv(viewportWidth - offsetX, unit))
        val lastRow = min(rows, ceilDiv(viewportHeight - offsetY, unit))
        return VisibleCells(firstRow, max(firstRow, lastRow), firstCol, max(firstCol, lastCol))
    }

    companion object {
        /** The zoom-out floor: the scale where an entry glyph (24 module units) hits the TypeScale
         *  legibility floor in dp. Never zoom out past where glyphs blur into noise; the number's
         *  justification lives on the TypeScale constant. iOS pins the same ratio in points. */
        val legibilityFloorScale: Float =
            (TypeScale.gridGlyphLegibilityFloorSp / GridModule.GLYPH_FONT_SIZE).toFloat()

        /** The zoom-in ceiling as a cell edge in dp: 72 is two 36-dp tap targets of magnification,
         *  enough to read a squeezed rebus string, past which panning cost outweighs any gain. */
        const val MAX_CELL_POINTS: Float = 72f

        val maxScale: Float = MAX_CELL_POINTS / GridModule.UNIT

        /** Breathing room around a followed cell, in viewport dp: enough that a landed cursor never
         *  kisses the viewport edge, small enough that the pan stays minimal. */
        const val FOLLOW_MARGIN: Float = 24f

        fun boardWidth(cols: Int): Float = cols * GridModule.UNIT
        fun boardHeight(rows: Int): Float = rows * GridModule.UNIT

        /** The scale at which the whole board fits the viewport's unobstructed window. */
        fun fitScale(
            viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
            occlusion: GridOcclusion = GridOcclusion.NONE,
        ): Float {
            val bw = boardWidth(cols)
            val bh = boardHeight(rows)
            if (bw <= 0f || bh <= 0f) return legibilityFloorScale
            return min(viewportWidth / bw, occlusion.windowHeight(viewportHeight) / bh)
        }

        /** The zoom-out clamp: whole-board fit when that respects the legibility floor, else the floor
         *  itself (a 25x25 on a narrow phone pans instead of blurring). Never above the ceiling, which
         *  keeps the range non-empty for tiny boards whose fit exceeds it. */
        fun minScale(
            viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
            occlusion: GridOcclusion = GridOcclusion.NONE,
        ): Float = min(
            maxScale,
            max(fitScale(viewportWidth, viewportHeight, rows, cols, occlusion), legibilityFloorScale),
        )

        /** The opening camera: as much board as the clamps allow, centered in the window. */
        fun initial(
            viewportWidth: Float, viewportHeight: Float, rows: Int, cols: Int,
            occlusion: GridOcclusion = GridOcclusion.NONE,
        ): GridCamera = GridCamera(
            scale = minScale(viewportWidth, viewportHeight, rows, cols, occlusion),
            offsetX = 0f, offsetY = 0f,
        ).clamped(viewportWidth, viewportHeight, rows, cols, occlusion)

        private fun clampedAxis(
            offset: Float, content: Float, viewport: Float, insetMin: Float = 0f, insetMax: Float = 0f,
        ): Float {
            val window = max(viewport - insetMin - insetMax, 0f)
            if (content <= window) return insetMin + (window - content) / 2f
            return min(insetMin, max(insetMin + window - content, offset))
        }

        /** One axis of the minimal pan: shift only as far as the near edge demands to reveal the
         *  target, the whole word when it fits the window and the cursor cell when it does not. All
         *  bounds are in scaled content dp; the margin collapses when the target is too wide to honor
         *  it. Choosing per-axis on FIT (word length and zoom), never on cursor position, is what
         *  keeps typing smooth (twin of GridCamera.followedAxis). */
        private fun followedAxis(
            offset: Float, spanMin: Float, spanMax: Float, cellMin: Float, cellMax: Float,
            viewport: Float, margin: Float, insetMin: Float = 0f, insetMax: Float = 0f,
        ): Float {
            val window = max(viewport - insetMin - insetMax, 0f)
            val fitsWord = (spanMax - spanMin) <= window
            val targetMin = if (fitsWord) spanMin else cellMin
            val targetMax = if (fitsWord) spanMax else cellMax
            val inset = min(margin, max(0f, (window - (targetMax - targetMin)) / 2f))
            val visibleMin = targetMin + offset
            val visibleMax = targetMax + offset
            if (visibleMin < insetMin + inset) return insetMin + inset - targetMin
            if (visibleMax > viewport - insetMax - inset) return viewport - insetMax - inset - targetMax
            return offset
        }

        /** `ceil(value / unit)` in ints, matching iOS's `(value / unit).rounded(.up)` for the culling
         *  window's far edge; never negative (a far edge behind the origin culls to nothing). */
        private fun ceilDiv(value: Float, unit: Float): Int {
            if (unit <= 0f) return 0
            return kotlin.math.ceil(value / unit).toInt()
        }
    }
}
