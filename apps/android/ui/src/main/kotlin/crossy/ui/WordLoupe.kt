// The completed Analysis board's directional loupe: one piece of clear glass above paper (twin of
// apps/ios/Sources/CrossyUI/WordLoupe.swift). The board is never sampled, redrawn, or filtered by
// this layer. The glass spans the active word with a small unclamped overhang, while the
// selected-cell etching is a separate board-space rect; changing axis can therefore morph the capsule
// without stretching the focus square.
//
// Two halves, the file set's pure-model + thin-composable idiom (GridCamera / GridFlash): the geometry
// is a plain value type that projects a word's cells through the camera exactly as the Swift
// WordLoupeLayout does, so WordLoupeTests pin it with no Compose; the draw layer is a hit-inert Compose
// overlay that rides the grid's live camera (ReactionStickerLayer's transform), mounted below the
// sticker layer. It never intercepts input (no pointerInput, iOS allowsHitTesting(false)); it animates
// on selection change with the chrome spring and snaps under Reduce Motion.

package crossy.ui

import androidx.compose.animation.core.AnimationVector4D
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.TwoWayConverter
import androidx.compose.animation.core.animateValueAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import crossy.design.Motion
import kotlin.math.max
import kotlin.math.min

/** A viewport (or board) rectangle by origin and size, the LoupeLayout's currency (twin of the Swift
 *  CGRect this file leans on). Kept Compose-free so the geometry model unit-tests headlessly, the
 *  GridCamera discipline; the draw layer converts to px and Compose types at the edge. */
data class LoupeRect(val x: Float, val y: Float, val width: Float, val height: Float) {
    val right: Float get() = x + width
    val bottom: Float get() = y + height

    /** The smallest rect covering both: the word's bounds accumulate by union, the Swift wordBounds walk. */
    fun union(other: LoupeRect): LoupeRect {
        val minX = min(x, other.x)
        val minY = min(y, other.y)
        val maxX = max(right, other.right)
        val maxY = max(bottom, other.bottom)
        return LoupeRect(minX, minY, maxX - minX, maxY - minY)
    }

    /** Inset each edge by (dx, dy); a negative inset expands (the overhang, iOS insetBy(dx:-o)). */
    fun insetBy(dx: Float, dy: Float): LoupeRect =
        LoupeRect(x + dx, y + dy, width - 2f * dx, height - 2f * dy)

    /** Scale every component (dp -> px at the draw edge). */
    fun scaled(factor: Float): LoupeRect =
        LoupeRect(x * factor, y * factor, width * factor, height * factor)
}

/** Board module units into the viewport dp the Canvas and its overlays share: the same projection
 *  CrossyGrid's draw pass applies (origin + unit * scale), so the glass sits exactly where its cells
 *  render. Twin of the Swift GridCamera.project. */
fun GridCamera.project(rect: LoupeRect): LoupeRect =
    LoupeRect(
        x = offsetX + rect.x * scale,
        y = offsetY + rect.y * scale,
        width = rect.width * scale,
        height = rect.height * scale,
    )

/** The cell's board-space rect (col*unit, row*unit, unit, unit): the Swift GridModule.cellRect,
 *  kept here since :ui's GridModule holds only draw constants. */
private fun cellRect(cell: Int, cols: Int): LoupeRect =
    LoupeRect((cell % cols) * GridModule.UNIT, (cell / cols) * GridModule.UNIT, GridModule.UNIT, GridModule.UNIT)

/**
 * The projected geometry for the word glass and its independent focus square (twin of the Swift
 * WordLoupeLayout). `lens` spans the active word with the overhang; `focus` is the one selected cell.
 * A block or out-of-range selection yields no word, so [of] returns null (nil geometry, no loupe).
 */
data class WordLoupeLayout(val lens: LoupeRect, val focus: LoupeRect) {
    /** Project both rects through a camera (the draw layer projects the animated board-space rects
     *  each frame, so a camera pan tracks instantly while a selection change springs). */
    fun projected(camera: GridCamera): WordLoupeLayout =
        WordLoupeLayout(camera.project(lens), camera.project(focus))

    companion object {
        /** Enough air to read as an object hovering over the answer, without becoming a thick lens. */
        const val OVERHANG_CELLS: Float = 0.1f

        /** The board-space layout (word bounds + overhang for the lens, the one cell for the focus),
         *  before the camera. Null for a block or out-of-range cell (the word is empty). */
        fun boardSpace(geometry: GridGeometry, selection: GridSelection): WordLoupeLayout? {
            val cells = geometry.wordCells(selection.cell, selection.isAcross)
            if (cells.isEmpty()) return null
            var wordBounds = cellRect(selection.cell, geometry.cols)
            for (cell in cells) wordBounds = wordBounds.union(cellRect(cell, geometry.cols))
            val overhang = OVERHANG_CELLS * GridModule.UNIT
            return WordLoupeLayout(
                lens = wordBounds.insetBy(-overhang, -overhang),
                focus = cellRect(selection.cell, geometry.cols),
            )
        }

        /** The projected layout, the shape WordLoupeTests pin: board geometry through the camera. Null
         *  for a block or out-of-range cell (nil geometry). Twin of the Swift init?. */
        fun of(geometry: GridGeometry, selection: GridSelection, camera: GridCamera): WordLoupeLayout? =
            boardSpace(geometry, selection)?.projected(camera)
    }
}

/** The loupe's gate (twin of the Swift showsWordLoupe = analysisResting && mosaicSettled): the
 *  directional glass belongs only to the settled completed board. Android's completed room IS the
 *  resting analysis surface (the grid is the standing base; the clue browser's tab is a modal sheet,
 *  never a grid-fill state), so the analysisResting half collapses to `completed`. `mosaicSettled` is
 *  MosaicMoment.settled, true only once the wash stands, so the glass never shows over a blooming or
 *  pre-completion board. */
fun showsWordLoupe(roomStatus: RoomStatus, mosaicSettled: Boolean): Boolean =
    roomStatus == RoomStatus.COMPLETED && mosaicSettled

/** The chrome spring as a Compose stiffness: SwiftUI response maps to the natural frequency squared
 *  (omega = 2pi/response, stiffness = omega^2), damping fraction 1 is critically damped. The same
 *  no-overshoot chrome settle the camera follow hand-steps, here driving the glass to its new frame. */
private val CHROME_STIFFNESS: Float = run {
    val response = Motion.Springs.chromeResponseMs / 1000.0
    val omega = 2.0 * Math.PI / response
    (omega * omega).toFloat()
}

/** LoupeRect as a 4D animation vector, so the lens and focus spring their four components together. */
private val LoupeRectConverter: TwoWayConverter<LoupeRect, AnimationVector4D> =
    TwoWayConverter(
        convertToVector = { AnimationVector4D(it.x, it.y, it.width, it.height) },
        convertFromVector = { LoupeRect(it.v1, it.v2, it.v3, it.v4) },
    )

/**
 * The clear-glass overlay over the settled completed board, sized to the grid (give it the grid's own
 * `fillMaxWidth().aspectRatio(cols/rows)` so its cell math matches CrossyGrid's exactly). `camera` is
 * the grid's live transform (CrossyGrid.onCamera), null at rest where the fit-to-width camera stands
 * in, exactly as ReactionStickerLayer resolves it, so the glass rides the same pan and zoom the board
 * does. Draw-only: it carries no pointer input, so every touch still reaches the grid beneath it.
 *
 * The word bounds and focus square animate on a selection change with the chrome spring (snap under
 * Reduce Motion) in board space; the camera projection runs each frame after, so a camera pan tracks
 * the board instantly while only a cursor move or axis toggle springs. Twin of the Swift
 * WordLoupeOverlay.
 */
@Composable
fun WordLoupeLayer(
    geometry: GridGeometry,
    selection: GridSelection,
    ground: GridGround,
    modifier: Modifier = Modifier,
    camera: GridCamera? = null,
    reduceMotion: Boolean = rememberReduceMotion(),
) {
    // Glass, not text: the loupe is seen, not spoken (iOS accessibilityHidden), so it never reaches the
    // reader. The grid keeps its own live cursor semantics.
    BoxWithConstraints(modifier.clearAndSetSemantics {}) {
        val density = LocalDensity.current
        val d = density.density
        // A block (or out-of-range) selection has no word, so nothing to draw (nil geometry, no loupe).
        val board = WordLoupeLayout.boardSpace(geometry, selection) ?: return@BoxWithConstraints

        val spec: FiniteAnimationSpec<LoupeRect> =
            if (reduceMotion) snap() else spring(dampingRatio = 1f, stiffness = CHROME_STIFFNESS)
        val threshold = LoupeRect(0.5f, 0.5f, 0.5f, 0.5f)
        val lensBoard by animateValueAsState(board.lens, LoupeRectConverter, spec, threshold, label = "loupeLens")
        val focusBoard by animateValueAsState(board.focus, LoupeRectConverter, spec, threshold, label = "loupeFocus")

        // The rest camera is the same fit-to-width one CrossyGrid opens with when its own camera is null
        // (occlusion NONE, the room's board layout), so the glass and the draw pass never disagree on
        // where a cell sits; a reported camera is already clamped by the grid.
        val cam = camera ?: GridCamera.initial(maxWidth.value, maxHeight.value, geometry.rows, geometry.cols)
        val lensPx = cam.project(lensBoard).scaled(d)
        val focusPx = cam.project(focusBoard).scaled(d)
        val viewportPx = Size(with(density) { maxWidth.toPx() }, with(density) { maxHeight.toPx() })
        val ink = ground.tokens.ink.toColor()

        Canvas(Modifier.matchParentSize()) {
            drawWordLoupe(lensPx, focusPx, ink, viewportPx)
        }
    }
}

/**
 * Thin liquid surface with no backdrop sampling (twin of the Swift WordLoupeSurface + WordLoupeFocus):
 * a fixed light above the board at (0.24w, 0.08h) travels over the material as the capsule moves, three
 * concentric rims and three soft shadows preserve the paper, and the selected cell is etched
 * independently so an axis flip morphs the glass without swelling the square.
 */
private fun DrawScope.drawWordLoupe(lens: LoupeRect, focus: LoupeRect, ink: Color, viewport: Size) {
    // The fixed light as a unit point within the lens, clamped to the same window iOS clamps to, so the
    // specular rides the glass instead of sitting at a painted point inside the capsule.
    val lightX = viewport.width * 0.24f
    val lightY = viewport.height * 0.08f
    val hx = if (lens.width > 0f) ((lightX - lens.x) / lens.width).coerceIn(-0.25f, 1.25f) else 0.5f
    val hy = if (lens.height > 0f) ((lightY - lens.y) / lens.height).coerceIn(-0.4f, 1.4f) else 0.5f
    val start = Offset(lens.x + hx * lens.width, lens.y + hy * lens.height)
    val end = Offset(lens.x + (1f - hx) * lens.width, lens.y + (1f - hy) * lens.height)

    // Three shadows behind the whole surface (ink at falling opacity, growing blur and drop).
    drawLoupeShadow(lens, ink.copy(alpha = 0.14f), 3.dp.toPx(), 2.dp.toPx())
    drawLoupeShadow(lens, ink.copy(alpha = 0.16f), 12.dp.toPx(), 6.dp.toPx())
    drawLoupeShadow(lens, ink.copy(alpha = 0.08f), 24.dp.toPx(), 14.dp.toPx())

    // The capsule fill: a faint white gradient toward the light, fading to clear (the paper shows through).
    drawCapsule(
        lens,
        brush = Brush.linearGradient(
            colors = listOf(Color.White.copy(alpha = 0.09f), Color.White.copy(alpha = 0.025f), Color.Transparent),
            start = start, end = end,
        ),
    )
    // Rim 1: the sub-pixel ink edge. Rims 2 and 3: the specular field, bright at the light, ink at the far side.
    drawCapsule(lens.insetBy(0.75.dp.toPx(), 0.75.dp.toPx()), color = ink.copy(alpha = 0.42f), stroke = 1.5.dp.toPx())
    drawCapsule(
        lens.insetBy(1.25.dp.toPx(), 1.25.dp.toPx()),
        brush = Brush.linearGradient(
            colors = listOf(
                Color.White.copy(alpha = 0.98f), Color.White.copy(alpha = 0.36f),
                ink.copy(alpha = 0.48f), Color.White.copy(alpha = 0.82f),
            ),
            start = start, end = end,
        ),
        stroke = 1.dp.toPx(),
    )
    drawCapsule(
        lens.insetBy(2.25.dp.toPx(), 2.25.dp.toPx()),
        brush = Brush.linearGradient(
            colors = listOf(Color.White.copy(alpha = 0.58f), Color.Transparent, ink.copy(alpha = 0.12f)),
            start = start, end = end,
        ),
        stroke = 0.5.dp.toPx(),
    )

    // The focus square, etched independently of the morphing glass: a soft shadow, an ink rim, a bright inner rim.
    drawFocusShadow(focus, ink.copy(alpha = 0.12f), 3.dp.toPx())
    drawRect(
        color = ink.copy(alpha = 0.62f),
        topLeft = Offset(focus.x + 0.5.dp.toPx(), focus.y + 0.5.dp.toPx()),
        size = Size(focus.width - 1.dp.toPx(), focus.height - 1.dp.toPx()),
        style = Stroke(1.dp.toPx()),
    )
    drawRect(
        color = Color.White.copy(alpha = 0.82f),
        topLeft = Offset(focus.x + 1.5.dp.toPx(), focus.y + 1.5.dp.toPx()),
        size = Size(focus.width - 3.dp.toPx(), focus.height - 3.dp.toPx()),
        style = Stroke(1.dp.toPx()),
    )
}

/** A pill (corner radius = half the short side) filled by a brush or stroked in a color/brush. */
private fun DrawScope.drawCapsule(rect: LoupeRect, brush: Brush? = null, color: Color? = null, stroke: Float? = null) {
    val r = min(rect.width, rect.height) / 2f
    val topLeft = Offset(rect.x, rect.y)
    val size = Size(rect.width, rect.height)
    val corner = CornerRadius(r, r)
    val style = stroke?.let { Stroke(it) }
    when {
        brush != null && style != null -> drawRoundRect(brush, topLeft, size, corner, style = style)
        brush != null -> drawRoundRect(brush, topLeft, size, corner)
        color != null && style != null -> drawRoundRect(color, topLeft, size, corner, style = style)
        color != null -> drawRoundRect(color, topLeft, size, corner)
    }
}

/** A blurred capsule silhouette dropped by (0, dy): the Android twin of the SwiftUI .shadow, via a
 *  native BlurMaskFilter (Compose has no draw-scope soft shadow). */
private fun DrawScope.drawLoupeShadow(rect: LoupeRect, color: Color, blur: Float, dy: Float) {
    if (blur <= 0f) return
    val r = min(rect.width, rect.height) / 2f
    drawIntoNative(color, blur) { canvas, paint ->
        canvas.drawRoundRect(rect.x, rect.y + dy, rect.right, rect.bottom + dy, r, r, paint)
    }
}

/** The focus square's soft shadow (no drop, iOS x:0 y:0). */
private fun DrawScope.drawFocusShadow(rect: LoupeRect, color: Color, blur: Float) {
    if (blur <= 0f) return
    drawIntoNative(color, blur) { canvas, paint ->
        canvas.drawRect(rect.x, rect.y, rect.right, rect.bottom, paint)
    }
}

private inline fun DrawScope.drawIntoNative(
    color: Color,
    blur: Float,
    block: (android.graphics.Canvas, android.graphics.Paint) -> Unit,
) {
    val paint = android.graphics.Paint().apply {
        isAntiAlias = true
        this.color = color.toArgb()
        maskFilter = android.graphics.BlurMaskFilter(blur, android.graphics.BlurMaskFilter.Blur.NORMAL)
    }
    block(drawContext.canvas.nativeCanvas, paint)
}
