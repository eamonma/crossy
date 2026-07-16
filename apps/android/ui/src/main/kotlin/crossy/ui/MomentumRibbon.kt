// The room's solving tempo, drawn native (twin of apps/ios MomentumRibbon.swift; a port of the web
// momentum sparkline over analysisReadout.ts): a gold area under a gold curve, a quiet baseline, and,
// when the room stalled and broke through, a shaded pause span closing on a "picked up" marker (engine
// `momentum` and `turningPoint`). Gold is the one warm note the completion panel earns; everywhere else
// chrome emphasis is achromatic (DESIGN.md §3, AnalysisPalette).
//
// One Canvas draw pass over the 40 peak-normalized samples the wire ships: the ribbon is a pure
// function of its inputs, so nothing here holds a clock or animates (reduce-motion is satisfied by
// construction, the way the iOS ribbon draws static). The curve is a Catmull-Rom spline converted to
// cubic beziers, the ratified mock's shape. The geometry math lives in MomentumRibbonGeometry, in the
// ribbon's own reference-point space (340x104), so the Canvas is one uniform scale over pure values and
// the tests pin the mapping headlessly.
//
// Degenerate by construction: an all-zero series (a single-instant solve, or a seeded fixture) draws
// only the baseline and a flat quiet gold line, never a NaN path and never a break marker
// (RoomMomentum.hasSignal gates the shape).

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import kotlin.math.roundToInt

/** A point in the ribbon's reference-point space (twin of the iOS Canvas point space): x runs left to
 *  right over the solve, y top-down (a taller sample sits nearer padTop). */
data class RibbonPoint(val x: Float, val y: Float)

/** One cubic segment of the tempo curve: the two control points and the endpoint (the start is the
 *  previous endpoint). The Catmull-Rom-to-bezier conversion, kept as data so the spline math pins in a
 *  headless test. */
data class RibbonBezier(val c1: RibbonPoint, val c2: RibbonPoint, val end: RibbonPoint)

/** The ribbon's geometry, all in the reference box (referenceWidth x referenceHeight, mirroring the web
 *  BOX and the iOS Layout). The Canvas draws in this space and applies one uniform scale to the device,
 *  so the shape is exact iOS parity at the fixed aspect. Pure, so the mapping and the spline pin in
 *  MomentumRibbonGeometryTests without a view. */
object MomentumRibbonGeometry {
    const val referenceWidth: Float = 340f
    const val referenceHeight: Float = 104f
    const val aspect: Float = referenceWidth / referenceHeight
    const val padX: Float = 4f
    const val padTop: Float = 16f
    const val padBottom: Float = 22f

    const val curveWidth: Float = 1.9f
    const val baselineWidth: Float = 1f
    const val breakDashWidth: Float = 1f
    const val breakDotRadius: Float = 3.4f
    const val breakHaloRadius: Float = 6.5f
    const val labelFontSize: Float = 9f

    const val areaTopAlpha: Float = 0.42f
    const val areaBottomAlpha: Float = 0.04f
    const val breakLineAlpha: Float = 0.7f
    const val breakHaloAlpha: Float = 0.3f
    const val flatLineAlpha: Float = 0.5f

    /** The dashed break line's pattern (web strokeDasharray "2 3"), in reference points. */
    val breakDash: FloatArray get() = floatArrayOf(2f, 3f)

    const val labelEdgeGuard: Float = 60f
    const val labelNudge: Float = 7f
    const val labelGap: Float = 3f

    /** The baseline's y (intensity 0), where the ticks and the break dot sit (web ribbonBaselineY). */
    val baselineY: Float get() = referenceHeight - padBottom

    /** Map a normalized value in [0, 1] to a y: 1 draws at the crest (near padTop), 0 on the baseline. */
    fun yForValue(value: Double): Float {
        val clamped = value.coerceIn(0.0, 1.0)
        val span = referenceHeight - padTop - padBottom
        return padTop + ((1.0 - clamped) * span).toFloat()
    }

    /** Map a fractional sample index in [0, count-1] to an x across the padded width (web scaleX). */
    fun xForSampleIndex(index: Float, count: Int): Float {
        val frac = if (count <= 1) 0f else index / (count - 1)
        return padX + frac * (referenceWidth - 2 * padX)
    }

    /** Map a relative time (seconds from the solve's start) to an x by binning it to the nearest sample
     *  index, matching the server's discrete bucketing (design/post-game/ANALYSIS.md), so the marker
     *  lands on the bin its samples were counted into. A non-positive duration puts it at index 0,
     *  never a divide-by-zero. */
    fun xForTime(time: Double, duration: Double, count: Int): Float {
        val raw = if (duration > 0) (time / duration * (count - 1)).roundToInt() else 0
        val index = raw.coerceIn(0, count - 1)
        return xForSampleIndex(index.toFloat(), count)
    }

    /** The samples as points: x over the span, y the (already peak-normalized) value flipped. A single
     *  bin spans the full width flat at its value (web n == 1 case). */
    fun scaledPoints(samples: List<Double>): List<RibbonPoint> {
        val count = samples.size
        if (count == 0) return emptyList()
        if (count == 1) {
            val y = yForValue(samples[0])
            return listOf(RibbonPoint(xForSampleIndex(0f, 2), y), RibbonPoint(xForSampleIndex(1f, 2), y))
        }
        return samples.mapIndexed { index, value ->
            RibbonPoint(xForSampleIndex(index.toFloat(), count), yForValue(value))
        }
    }

    /** A smooth path through the points: a Catmull-Rom spline converted to cubic bezier segments (web
     *  ribbonLinePath). For each segment Pi -> Pi+1 the controls are C1 = Pi + (Pi+1 - Pi-1)/6 and
     *  C2 = Pi+1 - (Pi+2 - Pi)/6, with the endpoint neighbors clamped, so the curve never overshoots
     *  past the first or last sample. */
    fun curveSegments(points: List<RibbonPoint>): List<RibbonBezier> {
        if (points.size < 2) return emptyList()
        val out = ArrayList<RibbonBezier>(points.size - 1)
        for (i in 0 until points.size - 1) {
            val p0 = points[if (i == 0) 0 else i - 1]
            val p1 = points[i]
            val p2 = points[i + 1]
            val p3 = points[if (i + 2 >= points.size) points.size - 1 else i + 2]
            val c1 = RibbonPoint(p1.x + (p2.x - p0.x) / 6f, p1.y + (p2.y - p0.y) / 6f)
            val c2 = RibbonPoint(p2.x - (p3.x - p1.x) / 6f, p2.y - (p3.y - p1.y) / 6f)
            out.add(RibbonBezier(c1, c2, p2))
        }
        return out
    }

    /** Whether the break marks: a turning point AND a series with a shape to mark on (web parity). A
     *  flat solve gets a quiet line, no dot. */
    fun marks(momentum: RoomMomentum, turningPoint: RoomTurningPoint?): Boolean =
        turningPoint != null && momentum.hasSignal
}

/** The momentum ribbon for one analysis bundle. Draws the tempo curve and, when the bundle carries a
 *  turning point, the stall wash and the "picked up" marker. Static by construction, so reduce-motion
 *  needs no branch (nothing animates). */
@Composable
fun MomentumRibbon(
    momentum: RoomMomentum,
    turningPoint: RoomTurningPoint?,
    ground: GridGround,
    modifier: Modifier = Modifier,
) {
    val measurer = rememberTextMeasurer()
    val label = if (momentum.hasSignal) {
        "Solving tempo over time, longest pause shaded, and where solving picked back up marked"
    } else {
        "Solving tempo, a quiet flat line for a short solve"
    }
    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(MomentumRibbonGeometry.aspect)
            .semantics { contentDescription = label },
    ) {
        drawRibbon(momentum, turningPoint, ground, measurer)
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawRibbon(
    momentum: RoomMomentum,
    turningPoint: RoomTurningPoint?,
    ground: GridGround,
    measurer: TextMeasurer,
) {
    val g = MomentumRibbonGeometry
    val scale = size.width / g.referenceWidth
    fun p(pt: RibbonPoint) = Offset(pt.x * scale, pt.y * scale)
    fun sx(v: Float) = v * scale

    val gold = AnalysisPalette.gold(ground).toColor()
    val baselineY = sx(g.baselineY)
    val marked = MomentumRibbonGeometry.marks(momentum, turningPoint)

    // The stall wash under the pause span, drawn first so the curve and the marker read over it. Both
    // times map through the same inverse bucketing the server bucketed by (xForTime).
    if (marked && turningPoint != null) {
        val count = momentum.samples.size
        val startX = sx(
            g.xForTime((turningPoint.breakSeconds - turningPoint.stallSeconds).coerceAtLeast(0.0), momentum.durationSeconds, count),
        )
        val breakX = sx(g.xForTime(turningPoint.breakSeconds, momentum.durationSeconds, count))
        if (breakX > startX) {
            drawRect(
                color = AnalysisPalette.stallWash(ground).toColor(),
                topLeft = Offset(startX, sx(g.padTop)),
                size = Size(breakX - startX, baselineY - sx(g.padTop)),
            )
        }
    }

    // The baseline: the quiet rule the tempo rides on, in the ground's hairline token.
    drawLine(
        color = ground.tokens.gridLine.toColor(),
        start = Offset(sx(g.padX), baselineY),
        end = Offset(size.width - sx(g.padX), baselineY),
        strokeWidth = sx(g.baselineWidth),
    )

    if (!momentum.hasSignal) {
        // Degenerate: a flat, quiet gold line along the baseline says "a short solve".
        drawLine(
            color = gold.copy(alpha = g.flatLineAlpha),
            start = Offset(sx(g.padX), baselineY),
            end = Offset(size.width - sx(g.padX), baselineY),
            strokeWidth = sx(g.curveWidth),
            cap = androidx.compose.ui.graphics.StrokeCap.Round,
        )
        return
    }

    val points = g.scaledPoints(momentum.samples)
    if (points.size < 2) return
    val segments = g.curveSegments(points)

    val curve = Path().apply {
        moveTo(p(points[0]).x, p(points[0]).y)
        for (seg in segments) {
            cubicTo(p(seg.c1).x, p(seg.c1).y, p(seg.c2).x, p(seg.c2).y, p(seg.end).x, p(seg.end).y)
        }
    }

    // The area under the curve, a vertical gold gradient: dense at the crest, a whisper at the baseline.
    val area = Path().apply {
        addPath(curve)
        lineTo(p(points.last()).x, baselineY)
        lineTo(p(points.first()).x, baselineY)
        close()
    }
    drawPath(
        area,
        brush = Brush.verticalGradient(
            colors = listOf(gold.copy(alpha = g.areaTopAlpha), gold.copy(alpha = g.areaBottomAlpha)),
            startY = sx(g.padTop),
            endY = baselineY,
        ),
    )

    // The curve itself, gold, round-capped and round-joined so the spline reads as one continuous tempo.
    drawPath(
        curve,
        color = gold,
        style = Stroke(
            width = sx(g.curveWidth),
            cap = androidx.compose.ui.graphics.StrokeCap.Round,
            join = androidx.compose.ui.graphics.StrokeJoin.Round,
        ),
    )

    // The break: a dashed riser, a gold dot with a soft halo on the baseline, and the label, once.
    if (marked && turningPoint != null) {
        val breakXRef = g.xForTime(turningPoint.breakSeconds, momentum.durationSeconds, momentum.samples.size)
        drawBreak(breakXRef, baselineY, gold, scale, measurer, ground)
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawBreak(
    breakXRef: Float,
    baselineY: Float,
    gold: androidx.compose.ui.graphics.Color,
    scale: Float,
    measurer: TextMeasurer,
    ground: GridGround,
) {
    val g = MomentumRibbonGeometry
    fun sx(v: Float) = v * scale
    val breakX = sx(breakXRef)

    // The dashed riser from padTop to the baseline.
    drawLine(
        color = gold.copy(alpha = g.breakLineAlpha),
        start = Offset(breakX, sx(g.padTop)),
        end = Offset(breakX, baselineY),
        strokeWidth = sx(g.breakDashWidth),
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(sx(g.breakDash[0]), sx(g.breakDash[1]))),
    )

    // The filled dot and its soft halo, on the baseline.
    drawCircle(color = gold, radius = sx(g.breakDotRadius), center = Offset(breakX, baselineY))
    drawCircle(
        color = gold.copy(alpha = g.breakHaloAlpha),
        radius = sx(g.breakHaloRadius),
        center = Offset(breakX, baselineY),
        style = Stroke(width = sx(g.breakDashWidth)),
    )

    // Keep the label inside the box: right-align and nudge left near the trailing edge, else left-align
    // and nudge right (web clampLabelX and its textAnchor swap).
    val nearRightEdge = breakXRef > g.referenceWidth - g.labelEdgeGuard
    val labelX = if (nearRightEdge) sx(breakXRef - g.labelGap) else sx(breakXRef + g.labelNudge)
    val layout = measurer.measure(
        text = "picked up",
        style = TextStyle(fontSize = sx(g.labelFontSize).toSp(), fontWeight = FontWeight.SemiBold, color = gold),
    )
    val topLeftX = if (nearRightEdge) labelX - layout.size.width else labelX
    val topLeftY = sx(g.padTop) - layout.size.height / 2f
    drawText(layout, topLeft = Offset(topLeftX, topLeftY))
}
