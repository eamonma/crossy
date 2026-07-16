// The completion confetti's render pass (owner ask 2026-07-11), the Compose twin of apps/ios
// Sources/CrossyUI/ConfettiOverlay.swift. One Canvas over the room, driven per frame by withFrameNanos
// against the celebration's instant; every trajectory is ConfettiEnvelope's pure math, so this view
// owns no physics, just paint. It mounts only while the room holds a non-null start instant (the room
// nils it when the drift ends, and never sets it under Reduce Motion, so this layer simply unmounts),
// overlays the whole room rather than the grid (§1: people between), and never takes a touch.
//
// The per-frame clock is sampled inside withFrameNanos, the GridFlash / ReactionStickerLayer pattern,
// so the drift rides the compositor's cadence without re-rendering anything but the Canvas. A dropped
// frame costs smoothness, never trajectory (the poses are analytic over elapsed time).

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.rotateRad
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.clearAndSetSemantics

/**
 * Draw the confetti drift. `field` is the seeded flecks and their palette (built once per
 * celebration); `startedAt` is the celebration trigger on the monotonic seconds clock (reactionNow).
 * The layer is hit-inert by construction (a Canvas with no pointerInput), so every touch still reaches
 * the room beneath it. Give it a modifier that fills the room; unit poses map onto that box.
 */
@Composable
fun ConfettiOverlay(
    field: ConfettiField,
    startedAt: Double,
    modifier: Modifier = Modifier,
) {
    if (field.isEmpty) return

    // The per-frame sample of the shared monotonic clock (the same origin `startedAt` was stamped
    // from). Reading it inside withFrameNanos ties the sample to the compositor's frame cadence
    // without re-rendering anything but this Canvas. The loop runs for the drift's life; the room
    // unmounts the whole overlay when it nils the start instant.
    var now by remember(startedAt) { mutableDoubleStateOf(reactionNow()) }
    LaunchedEffect(startedAt) {
        while (true) {
            withFrameNanos { now = reactionNow() }
            if (now - startedAt > ConfettiEnvelope.DURATION_SECONDS) break
        }
    }

    // Decorative: the drift is seen, not spoken (iOS ConfettiOverlay accessibilityHidden).
    Canvas(modifier = modifier.clearAndSetSemantics {}) {
        val elapsed = now - startedAt
        if (elapsed < 0.0 || elapsed > ConfettiEnvelope.DURATION_SECONDS) return@Canvas
        val width = size.width
        val height = size.height
        for (fleck in field.flecks) {
            val pose = ConfettiEnvelope.pose(fleck, elapsed) ?: continue
            val sizePx = (fleck.size * density).toFloat()
            val color = field.colors[fleck.colorIndex].toColor().copy(alpha = pose.alpha.toFloat())
            // One fleck: translate to its unit position, spin about that point, then fill a thin
            // rectangle centered there (the iOS rect: full width, 0.6 tall, offset up by 0.3).
            translate(
                left = (pose.unitX * width).toFloat(),
                top = (pose.unitY * height).toFloat(),
            ) {
                rotateRad(radians = pose.rotation.toFloat(), pivot = Offset.Zero) {
                    drawRect(
                        color = color,
                        topLeft = Offset(-sizePx / 2f, -sizePx * 0.3f),
                        size = Size(sizePx, sizePx * 0.6f),
                    )
                }
            }
        }
    }
}
