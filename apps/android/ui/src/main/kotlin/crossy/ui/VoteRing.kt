// The vote ring (PROTOCOL.md §10, D32; Wave 15.6 UX): a luminous rounded-rect halo just outside the
// grid bounds, warm gold (the analysis/share-card gold, ID-8, never an identity roster color), that
// drains continuously with the remaining time. It is the ONLY clock, so no digits ever accompany it.
// It ignites with a pulse on open, flashes and dissolves inward on a pass, and fades quietly on a
// fail or cancel. Under reduced motion it neither sweeps nor pulses: it steps its opacity instead
// (the §7 reduced-motion form). All timing decisions come from CheckVoteBenchModel; this file only
// paints. The fraction and phase are the model's; the color is the ground's.

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The draining halo. `fraction` is the remaining share (1 at open, 0 at expiry) from
 * [CheckVoteBenchModel.ringFraction]; `ignite` is the open pulse 0..1 (a brief swell then settle);
 * `dissolve` is the pass flash-dissolve 0..1 (the ring collapses inward and brightens then fades);
 * `alpha` is the overall opacity the caller fades on a quiet fail/cancel. Under `reduceMotion` the
 * caller passes the stepped fraction and holds `ignite`/`dissolve` at their endpoints, so the ring
 * only steps opacity. The ring is decorative: it is hidden from accessibility (the announcements
 * carry the state).
 */
@Composable
fun VoteRing(
    fraction: Float,
    ground: GridGround,
    modifier: Modifier = Modifier,
    ignite: Float = 1f,
    dissolve: Float = 0f,
    alpha: Float = 1f,
    reduceMotion: Boolean = false,
    inset: Dp = (-4).dp,
    strokeWidth: Dp = 3.dp,
    corner: Dp = 10.dp,
) {
    val gold = AnalysisPalette.gold(ground).toColor()
    // The ring is decorative: a Canvas holds no text node, so TalkBack never announces it; the open
    // and resolution announcements carry the state instead (Bench semantics).
    Canvas(modifier = modifier) {
        val insetPx = inset.toPx()
        val stroke = strokeWidth.toPx() * (0.6f + 0.4f * ignite) // the open pulse swells the line
        val cornerPx = corner.toPx()
        val left = insetPx
        val top = insetPx
        val right = size.width - insetPx
        val bottom = size.height - insetPx
        if (right <= left || bottom <= top) return@Canvas

        // The full rounded-rect perimeter as a path; the drain shows this share of it, dissolving
        // inward toward the top on a pass (the segment shrinks from both ends).
        val path = Path().apply {
            addRoundRect(
                androidx.compose.ui.geometry.RoundRect(
                    left = left, top = top, right = right, bottom = bottom,
                    radiusX = cornerPx, radiusY = cornerPx,
                ),
            )
        }
        val measure = PathMeasure().apply { setPath(path, false) }
        val length = measure.length
        if (length <= 0f) return@Canvas

        val remaining = fraction.coerceIn(0f, 1f)
        val shown = if (reduceMotion) 1f else remaining // stepped mode paints the whole ring at stepped alpha
        // A pass collapses the shown arc inward; the alpha brightens then fades with the same phase.
        val collapse = (1f - dissolve).coerceIn(0f, 1f)
        val arc = (shown * collapse).coerceIn(0f, 1f)
        val ringAlpha = (alpha * (if (reduceMotion) remaining else 1f) * (0.55f + 0.45f * ignite))
            .coerceIn(0f, 1f) * (0.4f + 0.6f * (1f - dissolve) + dissolve)

        if (arc <= 0f) return@Canvas
        val segment = Path()
        if (arc >= 1f) {
            measure.getSegment(0f, length, segment, true)
        } else {
            // Center the drained arc at the top of the ring so it recedes symmetrically.
            val half = length * arc / 2f
            val mid = 0f
            measure.getSegment(mid, mid + half, segment, true)
            measure.getSegment(length - half, length, segment, true)
        }
        drawPath(
            path = segment,
            color = gold.copy(alpha = ringAlpha.coerceIn(0f, 1f)),
            style = Stroke(width = stroke),
        )
        // A faint glow underlay so the halo reads as luminous, not a hairline (skipped under reduced
        // motion, where the stepped ring stays flat).
        if (!reduceMotion && dissolve < 1f) {
            drawPath(
                path = segment,
                color = gold.copy(alpha = (ringAlpha * 0.35f).coerceIn(0f, 1f)),
                style = Stroke(width = stroke * 2.2f),
            )
        }
    }
}
