// The reaction sticker layer as a Compose overlay ABOVE the board Canvas (the owner's entry-shake
// finding, 2026-07-14; twin of apps/ios ReactionStickerLayer and the web sticker layer). Each
// sticker is ONE Text of the native emoji glyph (owner ruling: platform font glyphs, no bundled
// images), and its entrance, coalesce replay, and exit are transforms of that rasterized layer via
// Modifier.graphicsLayer — the glyph is never re-rendered mid-flight. The transform values are
// sampled each frame from StickerEnvelope's closed forms, the SAME constants StickerEnvelopeTests
// pins, so the tested character and the shipped render share one source of truth (ANIMATE TRANSFORMS
// OF A RASTERIZED LAYER, NEVER RE-RENDER CONTENT PER FRAME).
//
// Placement is born-correct: each sticker's cell anchor and seeded tilt come from its own stable key
// alone, applied as un-animated layout, so a newcomer never drifts an incumbent. The layer never
// hit-tests (no pointerInput), so every touch still belongs to the grid beneath it.

package crossy.ui

import android.provider.Settings
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.IntOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.key
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.LaunchedEffect
import kotlin.math.roundToInt

/**
 * Draw every live sticker over the grid. `stickers` is the host's book (a pure `List` it mutates via
 * ReactionBook); `geometry` maps a cell index to its rect. The layer sizes to the grid: give it the
 * grid's own `fillMaxWidth().aspectRatio(cols/rows)` so its cell math matches CrossyGrid's exactly.
 *
 * `camera` is the grid's live transform (CrossyGrid.onCamera), threaded so the stickers ride the same
 * zoom and pan the board does (iOS passes its resolved GridCamera into the sticker layer). Null while
 * nothing has moved the board: at rest the layer keeps its own fit-to-width math, so nothing changes.
 * A non-null camera is already clamped by the grid, so its scale (dp per module unit) and offset (the
 * board origin in dp) place each sticker exactly where its cell renders, and the glyph grows with the
 * zoom just as the board's letters do.
 */
@Composable
fun ReactionStickerLayer(
    stickers: List<ReactionSticker>,
    geometry: GridGeometry,
    modifier: Modifier = Modifier,
    camera: GridCamera? = null,
    reduceMotion: Boolean = rememberReduceMotion(),
) {
    // Decorative: the ephemeral stickers are seen, not spoken (iOS ReactionStickerLayer
    // accessibilityHidden), so the emoji glyphs never reach the reader.
    BoxWithConstraints(modifier.clearAndSetSemantics {}) {
        val density = LocalDensity.current
        val cols = geometry.cols
        // At rest (no camera) the fit-to-width factor is the same one CrossyGrid derives when its own
        // camera is null: cell = width / cols, unit = cell / 36. With a camera the factor is the
        // camera's dp-per-unit scale converted to px, and the board origin shifts by the camera's dp
        // offset (both converted by display density). One `unitPx`/`originX`/`originY` covers both,
        // so the sticker anchor is `origin + moduleUnits * unitPx`, matching the grid's draw exactly.
        val d = density.density
        val restUnitPx = (with(density) { maxWidth.toPx() } / cols) / GridModule.UNIT
        val unitPx = if (camera != null) camera.scale * d else restUnitPx
        val originX = if (camera != null) camera.offsetX * d else 0f
        val originY = if (camera != null) camera.offsetY * d else 0f
        val fontSize = with(density) { (GridModule.STICKER_FONT_SIZE * unitPx).toSp() }

        for (sticker in stickers) {
            // A reaction anchored on a black square never renders (the web/iOS layer's rule).
            if (sticker.cell in geometry.blocks) continue
            val col = sticker.cell % cols
            val row = sticker.cell / cols
            val anchorX = originX + (col * GridModule.UNIT + sticker.offsetX.toFloat()) * unitPx
            val anchorY = originY + (row * GridModule.UNIT + sticker.offsetY.toFloat()) * unitPx
            key(sticker.id) {
                StickerGlyph(sticker, anchorX, anchorY, fontSize, reduceMotion)
            }
        }
    }
}

/**
 * One sticker: a single native-emoji Text whose scale, tremble rotation, and opacity are transforms
 * of its one rasterized layer, sampled each frame from StickerEnvelope's closed forms. The seeded
 * tilt is folded into the rotation the closed form returns (tremble composes OVER it). The glyph's
 * center sits at its cell anchor (in px, already through the camera); graphicsLayer recenters
 * (translate by -size/2) and transforms about that center, so nothing re-lays-out mid-flight.
 */
@Composable
private fun StickerGlyph(
    sticker: ReactionSticker,
    anchorX: Float,
    anchorY: Float,
    fontSize: androidx.compose.ui.unit.TextUnit,
    reduceMotion: Boolean,
) {
    // The per-frame sample of the shared monotonic clock (the same origin the book stamped bornAt
    // from). Reading it inside withFrameNanos ties the sample to the compositor's frame cadence
    // without re-rendering the glyph's content — only its transform changes.
    var now by remember(sticker.id) { mutableFloatStateOf(reactionNow().toFloat()) }
    LaunchedEffect(sticker.id) {
        while (true) {
            withFrameNanos { now = reactionNow().toFloat() }
        }
    }

    val t = now.toDouble()
    Text(
        text = sticker.emoji,
        style = TextStyle(fontFamily = FontFamily.Default),
        fontSize = fontSize,
        modifier = Modifier
            .offset { IntOffset(anchorX.roundToInt(), anchorY.roundToInt()) }
            .graphicsLayer {
                translationX = -size.width / 2f
                translationY = -size.height / 2f
                transformOrigin = TransformOrigin(0.5f, 0.5f)
                val s = StickerEnvelope.scale(sticker, t, reduceMotion).toFloat()
                scaleX = s
                scaleY = s
                rotationZ = StickerEnvelope.rotationDegrees(sticker, t, reduceMotion).toFloat()
                alpha = StickerEnvelope.opacity(sticker, t, reduceMotion).toFloat()
            },
    )
}

/** Whether the device has animations disabled (accessibility). Under Reduce Motion the sticker sits
 *  upright and fades only (owner spec), matching the web's prefers-reduced-motion fallback. Read
 *  from ANIMATOR_DURATION_SCALE == 0, Android's closest signal to prefers-reduced-motion. */
@Composable
fun rememberReduceMotion(): Boolean {
    val context = LocalContext.current
    return remember {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }
}
