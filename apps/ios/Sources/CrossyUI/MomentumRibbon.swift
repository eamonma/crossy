// The room's solving tempo, drawn native. A port of the web momentum sparkline
// (apps/web MomentumRibbon.tsx over analysisReadout.ts): a gold area under a gold
// curve, a quiet baseline, and, when the room stalled and broke through, a shaded
// pause span closing on a "picked up" marker (design/post-game/ANALYSIS.md, engine
// `momentum` and `turningPoint`). Gold is the one warm note the completion panel
// earns; everywhere else chrome emphasis is achromatic (apps/ios/DESIGN.md §3,
// AnalysisPalette).
//
// One Canvas draw pass over the 40 peak-normalized samples the wire ships, the
// same one-pass discipline the board draws under (CrossyGridView): the ribbon is a
// pure function of its inputs, so nothing here holds a clock or animates. The curve
// is a Catmull-Rom spline converted to cubic beziers, the ratified mock's shape.
//
// Degenerate by construction: an all-zero series (a single-instant solve, or a
// seeded fixture) draws only the baseline and a flat quiet gold line, never a NaN
// path and never a break marker (RoomMomentum.hasSignal gates the shape).

import CrossyDesign
import Foundation
import SwiftUI

/// The momentum ribbon for one analysis bundle. Draws the tempo curve and, when the
/// bundle carries a turning point, the stall wash and the "picked up" marker.
@available(iOS 17.0, macOS 14.0, *)
struct MomentumRibbon: View {
    let momentum: RoomMomentum
    let turningPoint: RoomTurningPoint?
    let ground: GridGround
    /// The sittings partition (D29), or nil (an older bundle, or a single sitting
    /// via `interiorBoundarySeconds` being empty): no seam ticks either way.
    var sittings: RoomSittings? = nil

    var body: some View {
        Canvas { context, size in
            Self.draw(
                momentum: momentum, turningPoint: turningPoint, sittings: sittings,
                ground: ground, context: &context, size: size)
        }
        // The web draws in a 340x104 viewBox scaled to full width; the same ratio
        // holds the shape here while the point-pad insets stay constant, so the
        // baseline hairline and the marker dot keep their weight at any width.
        .aspectRatio(Layout.aspect, contentMode: .fit)
        .accessibilityLabel(
            Text(
                verbatim: momentum.hasSignal
                    ? "The room's solving tempo over time, with the longest pause shaded and the point where solving picked back up marked"
                    : "The room's solving tempo, a quiet flat line for a short solve"))
    }
}

// MARK: - Layout

@available(iOS 17.0, macOS 14.0, *)
extension MomentumRibbon {
    /// The ribbon's box and insets, in points. Mirrors apps/web MomentumRibbon's
    /// BOX so the two surfaces read as one drawing (padX/padTop/padBottom kept as
    /// constant insets rather than scaled with the width, the way CrossyGridView
    /// draws its hairlines at a fixed device weight).
    private enum Layout {
        static let referenceWidth: CGFloat = 340
        static let referenceHeight: CGFloat = 104
        static let aspect: CGFloat = referenceWidth / referenceHeight
        static let padX: CGFloat = 4
        static let padTop: CGFloat = 16
        static let padBottom: CGFloat = 22

        static let curveWidth: CGFloat = 1.9
        static let baselineWidth: CGFloat = 1
        static let breakDashWidth: CGFloat = 1
        static let breakDotRadius: CGFloat = 3.4
        static let breakHaloRadius: CGFloat = 6.5
        static let labelFontSize: CGFloat = 9

        /// The area fill's vertical alpha ramp: near-opaque gold at the crest down to
        /// a whisper at the baseline (apps/web gold-8 stops, tuned for the native
        /// palette).
        static let areaTopAlpha: Double = 0.42
        static let areaBottomAlpha: Double = 0.04
        static let breakLineAlpha: Double = 0.7
        static let breakHaloAlpha: Double = 0.3
        static let stallWashAlpha: Double = 1
        static let flatLineAlpha: Double = 0.5

        /// The dashed break line's pattern (web strokeDasharray "2 3").
        static let breakDash: [CGFloat] = [2, 3]

        /// The sitting seam tick (D29): a short hairline notch crossing the
        /// baseline at each interior sitting boundary. Deliberately quieter than
        /// the turning-point marker (achromatic where the break is gold, a notch
        /// where the riser runs full height): the seam is axis furniture, not a
        /// moment. `number` at low alpha holds recessive on both grounds, where
        /// the gridLine token would vanish entirely at this length.
        static let seamTickWidth: CGFloat = 1
        static let seamTickRise: CGFloat = 5
        static let seamTickDrop: CGFloat = 4
        static let seamTickAlpha: Double = 0.55

        /// Right-align the label when the break sits within this of the right edge, so
        /// "picked up" never overflows past the box (web clampLabelX).
        static let labelEdgeGuard: CGFloat = 60
        static let labelNudge: CGFloat = 7
        static let labelGap: CGFloat = 3
    }
}

// MARK: - The draw pass

@available(iOS 17.0, macOS 14.0, *)
extension MomentumRibbon {
    /// Everything below draws from plain values, so the Canvas renderer closure needs
    /// no isolation (the same discipline as CrossyGridView.draw). Coordinates run in
    /// the Canvas's own point space: x left-to-right over the solve, y flipped so a
    /// taller sample draws higher (SwiftUI's origin is top-left).
    private static func draw(
        momentum: RoomMomentum, turningPoint: RoomTurningPoint?, sittings: RoomSittings?,
        ground: GridGround, context: inout GraphicsContext, size: CGSize
    ) {
        let gold = AnalysisPalette.gold(ground)
        let baselineY = self.baselineY(size)

        // The break only marks when there is a turning point AND the series has a
        // shape to mark on (web parity): a flat solve gets a quiet line, no dot.
        let marked = turningPoint != nil && momentum.hasSignal

        // The stall wash sits under the pause span, drawn first so the curve and the
        // marker read over it. Pause start = max(0, break - stall); both times map
        // through the same inverse bucketing (timeToSampleIndex) the server bucketed
        // by, so the span lands on the bins its samples were counted into.
        if marked, let turning = turningPoint {
            let count = momentum.samples.count
            let startX = x(
                forTime: max(0, turning.breakSeconds - turning.stallSeconds),
                duration: momentum.durationSeconds, count: count, size: size)
            let breakX = x(
                forTime: turning.breakSeconds,
                duration: momentum.durationSeconds, count: count, size: size)
            if breakX > startX {
                let wash = CGRect(
                    x: startX, y: Layout.padTop,
                    width: breakX - startX, height: baselineY - Layout.padTop)
                context.fill(
                    Path(wash),
                    with: .color(
                        Color(rgb: AnalysisPalette.stallWash(ground))
                            .opacity(Layout.stallWashAlpha)))
            }
        }

        // The baseline: the quiet rule the tempo rides on, in the ground's hairline
        // token (the lattice color the board draws its grid lines with, GroundTokens).
        var baseline = Path()
        baseline.move(to: CGPoint(x: Layout.padX, y: baselineY))
        baseline.addLine(to: CGPoint(x: size.width - Layout.padX, y: baselineY))
        context.stroke(
            baseline,
            with: .color(Color(rgb: ground.tokens.gridLine)),
            lineWidth: Layout.baselineWidth)

        // The sitting seams (D29): a quiet notch across the baseline at each interior
        // boundary, drawn with the axis so everything with a voice (the area, the
        // curve, the break marker) reads over it. No sittings or a single sitting
        // draws nothing, so an older bundle renders exactly as before.
        for tickX in seamTickXs(
            sittings: sittings, duration: momentum.durationSeconds,
            count: momentum.samples.count, size: size)
        {
            var tick = Path()
            tick.move(to: CGPoint(x: tickX, y: baselineY - Layout.seamTickRise))
            tick.addLine(to: CGPoint(x: tickX, y: baselineY + Layout.seamTickDrop))
            context.stroke(
                tick,
                with: .color(Color(rgb: ground.tokens.number).opacity(Layout.seamTickAlpha)),
                lineWidth: Layout.seamTickWidth)
        }

        guard momentum.hasSignal else {
            // Degenerate: no shape to draw. A flat, quiet gold line along the baseline
            // says "a short solve" without pretending to a curve (web hasSignal path).
            var flat = Path()
            flat.move(to: CGPoint(x: Layout.padX, y: baselineY))
            flat.addLine(to: CGPoint(x: size.width - Layout.padX, y: baselineY))
            context.stroke(
                flat,
                with: .color(Color(rgb: gold).opacity(Layout.flatLineAlpha)),
                style: StrokeStyle(lineWidth: Layout.curveWidth, lineCap: .round))
            return
        }

        let points = scaledPoints(samples: momentum.samples, size: size)
        guard points.count >= 2 else { return }
        let curve = curvePath(points)

        // The area under the curve, filled with a vertical gold gradient: dense at the
        // crest, a whisper at the baseline. Closed by dropping to the baseline at each
        // end (web ribbonAreaPath).
        var area = curve
        area.addLine(to: CGPoint(x: points[points.count - 1].x, y: baselineY))
        area.addLine(to: CGPoint(x: points[0].x, y: baselineY))
        area.closeSubpath()
        context.fill(
            area,
            with: .linearGradient(
                Gradient(colors: [
                    Color(rgb: gold).opacity(Layout.areaTopAlpha),
                    Color(rgb: gold).opacity(Layout.areaBottomAlpha),
                ]),
                startPoint: CGPoint(x: 0, y: Layout.padTop),
                endPoint: CGPoint(x: 0, y: baselineY)))

        // The curve itself, gold, round-capped and round-joined so the spline reads as
        // one continuous tempo, not a run of segments.
        context.stroke(
            curve,
            with: .color(Color(rgb: gold)),
            style: StrokeStyle(
                lineWidth: Layout.curveWidth, lineCap: .round, lineJoin: .round))

        // The break: the moment the room broke its longest pause. A dashed riser, a
        // gold dot with a soft halo on the baseline, and the label, once.
        if marked, let turning = turningPoint {
            let breakX = x(
                forTime: turning.breakSeconds,
                duration: momentum.durationSeconds,
                count: momentum.samples.count, size: size)
            drawBreak(breakX: breakX, baselineY: baselineY, gold: gold, size: size, &context)
        }
    }

    /// The break marker: dashed riser, filled dot, halo ring, and the "picked up"
    /// label clamped inside the box (web break group + clampLabelX).
    private static func drawBreak(
        breakX: CGFloat, baselineY: CGFloat, gold: CrossyDesign.RGBColor, size: CGSize,
        _ context: inout GraphicsContext
    ) {
        var riser = Path()
        riser.move(to: CGPoint(x: breakX, y: Layout.padTop))
        riser.addLine(to: CGPoint(x: breakX, y: baselineY))
        context.stroke(
            riser,
            with: .color(Color(rgb: gold).opacity(Layout.breakLineAlpha)),
            style: StrokeStyle(lineWidth: Layout.breakDashWidth, dash: Layout.breakDash))

        let dot = CGRect(
            x: breakX - Layout.breakDotRadius, y: baselineY - Layout.breakDotRadius,
            width: Layout.breakDotRadius * 2, height: Layout.breakDotRadius * 2)
        context.fill(Path(ellipseIn: dot), with: .color(Color(rgb: gold)))

        let halo = CGRect(
            x: breakX - Layout.breakHaloRadius, y: baselineY - Layout.breakHaloRadius,
            width: Layout.breakHaloRadius * 2, height: Layout.breakHaloRadius * 2)
        context.stroke(
            Path(ellipseIn: halo),
            with: .color(Color(rgb: gold).opacity(Layout.breakHaloAlpha)),
            lineWidth: Layout.breakDashWidth)

        // Keep the label inside the box: right-align and nudge left when the break sits
        // near the trailing edge, otherwise left-align and nudge right (web clampLabelX
        // and its textAnchor swap).
        let nearRightEdge = breakX > size.width - Layout.labelEdgeGuard
        let labelX = nearRightEdge ? breakX - Layout.labelGap : breakX + Layout.labelNudge
        context.draw(
            Text(verbatim: "picked up")
                .font(.system(size: Layout.labelFontSize, weight: .semibold))
                .foregroundStyle(Color(rgb: gold)),
            at: CGPoint(x: labelX, y: Layout.padTop),
            anchor: nearRightEdge ? .trailing : .leading)
    }

    // MARK: Geometry

    /// The baseline's y (intensity 0), where the time ticks and the break dot sit
    /// (web ribbonBaselineY: the bottom inset from the box's height).
    private static func baselineY(_ size: CGSize) -> CGFloat {
        size.height - Layout.padBottom
    }

    /// Map a sample's normalized value in [0, 1] to a y: 1 draws at the crest (near
    /// padTop), 0 on the baseline (web scaleY, y flipped).
    private static func y(forValue value: Double, size: CGSize) -> CGFloat {
        let clamped = min(1, max(0, value))
        let span = size.height - Layout.padTop - Layout.padBottom
        return Layout.padTop + (1 - CGFloat(clamped)) * span
    }

    /// Map a fractional sample index in [0, count-1] to an x, across the padded width
    /// (web scaleX).
    private static func x(forSampleIndex index: CGFloat, count: Int, size: CGSize) -> CGFloat {
        let frac = count <= 1 ? 0 : index / CGFloat(count - 1)
        return Layout.padX + frac * (size.width - 2 * Layout.padX)
    }

    /// Map a relative time (seconds from the solve's start) to an x, by binning it to
    /// the nearest sample index and placing that bin. Bucketing matches the server's
    /// discrete granularity (design/post-game/ANALYSIS.md), so the marker lands on the
    /// bin its samples were counted into. A zero (or non-positive) duration puts it at
    /// index 0, never a divide-by-zero.
    private static func x(
        forTime time: Double, duration: Double, count: Int, size: CGSize
    ) -> CGFloat {
        let raw = duration > 0
            ? Int((time / duration * Double(count - 1)).rounded())
            : 0
        let index = min(max(0, raw), count - 1)
        return x(forSampleIndex: CGFloat(index), count: count, size: size)
    }

    /// The seam ticks' x positions (D29): each interior sitting boundary
    /// (`spans[k].endSeconds`, k < count-1, the active axis) through the SAME
    /// inverse bucketing the break marker maps by, so a seam lands on the bin its
    /// sittings butt against. Boundaries at the axis edges draw nothing — a
    /// zero-width span clamps to an edge by contract (PROTOCOL.md §12), and an
    /// edge tick would read as a border, not a seam — and two boundaries bucketed
    /// into one bin collapse to one tick. Internal (not private) so the tick
    /// positions pin headlessly.
    static func seamTickXs(
        sittings: RoomSittings?, duration: Double, count: Int, size: CGSize
    ) -> [CGFloat] {
        guard let sittings, duration > 0, count >= 3 else { return [] }
        var indices: [Int] = []
        for boundary in sittings.interiorBoundarySeconds {
            guard boundary > 0, boundary < duration else { continue }
            let index = Int((boundary / duration * Double(count - 1)).rounded())
            guard (1...(count - 2)).contains(index) else { continue }
            if indices.last != index { indices.append(index) }
        }
        return indices.map { x(forSampleIndex: CGFloat($0), count: count, size: size) }
    }

    /// The samples as scaled points in the Canvas's space: x over the span, y the
    /// (already peak-normalized) value flipped. Matches web ribbonPoints then scaleX/
    /// scaleY, folded into one pass.
    private static func scaledPoints(samples: [Double], size: CGSize) -> [CGPoint] {
        let count = samples.count
        guard count > 0 else { return [] }
        if count == 1 {
            // One bin spans the full width, flat at its value (web n == 1 case).
            let y = self.y(forValue: samples[0], size: size)
            return [
                CGPoint(x: x(forSampleIndex: 0, count: 2, size: size), y: y),
                CGPoint(x: x(forSampleIndex: 1, count: 2, size: size), y: y),
            ]
        }
        return samples.enumerated().map { index, value in
            CGPoint(
                x: x(forSampleIndex: CGFloat(index), count: count, size: size),
                y: y(forValue: value, size: size))
        }
    }

    /// A smooth path through the points: a Catmull-Rom spline converted to cubic bezier
    /// segments (web ribbonLinePath), stroked as the tempo curve. For each segment
    /// Pi -> Pi+1 the control points are C1 = Pi + (Pi+1 - Pi-1)/6 and
    /// C2 = Pi+1 - (Pi+2 - Pi)/6, with the endpoint neighbors clamped (Pi stands in for
    /// Pi-1 at the start, Pi+1 for Pi+2 at the end), so the curve never overshoots past
    /// the first or last sample.
    private static func curvePath(_ points: [CGPoint]) -> Path {
        var path = Path()
        guard points.count >= 2 else { return path }
        path.move(to: points[0])
        for i in 0..<(points.count - 1) {
            let p0 = points[i == 0 ? 0 : i - 1]
            let p1 = points[i]
            let p2 = points[i + 1]
            let p3 = points[i + 2 >= points.count ? points.count - 1 : i + 2]
            let c1 = CGPoint(
                x: p1.x + (p2.x - p0.x) / 6,
                y: p1.y + (p2.y - p0.y) / 6)
            let c2 = CGPoint(
                x: p2.x - (p3.x - p1.x) / 6,
                y: p2.y - (p3.y - p1.y) / 6)
            path.addCurve(to: p2, control1: c1, control2: c2)
        }
        return path
    }
}

// MARK: - Previews

@available(iOS 17.0, macOS 14.0, *)
private struct MomentumRibbonPreviewFixtures {
    /// A clear tempo with a stall the room broke through: a warm-up, a lull near the
    /// middle, then a burst that carries the finish. The turning point shades the lull
    /// and marks its break, so the "picked up" marker rides mid-ribbon.
    static func lively() -> (momentum: RoomMomentum, turning: RoomTurningPoint) {
        var samples = [Double](repeating: 0, count: 40)
        for i in 0..<40 {
            let t = Double(i) / 39
            // Two humps with a trough between them, peak-normalized to 1.
            let a = exp(-pow((t - 0.22) / 0.12, 2))
            let b = exp(-pow((t - 0.74) / 0.14, 2))
            samples[i] = min(1, max(0, 0.25 + 0.9 * a + 1.0 * b))
        }
        let peak = samples.max() ?? 1
        if peak > 0 { samples = samples.map { $0 / peak } }
        let momentum = RoomMomentum(durationSeconds: 512, samples: samples)
        // The lull sat around t = 0.5; the room broke it at ~340s (t = 0.66).
        let turning = RoomTurningPoint(stallSeconds: 82, breakSeconds: 338, burst: 9)
        return (momentum, turning)
    }

    /// A short solve with no shape: every bucket empty. The ribbon shows the quiet flat
    /// line and no marker (hasSignal is false).
    static func flat() -> RoomMomentum {
        RoomMomentum(durationSeconds: 6, samples: [Double](repeating: 0, count: 40))
    }

    /// The lively solve as a three-sitting room (D29): two interior seams, one in
    /// the first hump's tail and one in the trough, so the ticks read against both
    /// a filled area and open baseline.
    static func sittings() -> RoomSittings {
        RoomSittings(
            count: 3,
            spans: [
                RoomSittings.Span(startSeconds: 0, endSeconds: 160),
                RoomSittings.Span(startSeconds: 160, endSeconds: 260),
                RoomSittings.Span(startSeconds: 260, endSeconds: 512),
            ],
            wallSeconds: 29160)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct MomentumRibbonPreviewCard: View {
    let title: String
    let ground: GridGround
    let momentum: RoomMomentum
    let turningPoint: RoomTurningPoint?
    var sittings: RoomSittings? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.number))
            MomentumRibbon(
                momentum: momentum, turningPoint: turningPoint, ground: ground,
                sittings: sittings)
        }
        .padding(16)
        // Over the ground's own paper so the gold accent reads as it will in the panel.
        .background(Color(rgb: ground.tokens.canvas))
    }
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("Momentum ribbon") {
    let lively = MomentumRibbonPreviewFixtures.lively()
    let flat = MomentumRibbonPreviewFixtures.flat()
    return VStack(spacing: 20) {
        MomentumRibbonPreviewCard(
            title: "Studio, a stall broken", ground: .studio,
            momentum: lively.momentum, turningPoint: lively.turning)
        MomentumRibbonPreviewCard(
            title: "Observatory, a stall broken", ground: .observatory,
            momentum: lively.momentum, turningPoint: lively.turning)
        MomentumRibbonPreviewCard(
            title: "Studio, three sittings", ground: .studio,
            momentum: lively.momentum, turningPoint: lively.turning,
            sittings: MomentumRibbonPreviewFixtures.sittings())
        MomentumRibbonPreviewCard(
            title: "Observatory, three sittings", ground: .observatory,
            momentum: lively.momentum, turningPoint: lively.turning,
            sittings: MomentumRibbonPreviewFixtures.sittings())
        MomentumRibbonPreviewCard(
            title: "Studio, a short flat solve", ground: .studio,
            momentum: flat, turningPoint: nil)
        MomentumRibbonPreviewCard(
            title: "Observatory, a short flat solve", ground: .observatory,
            momentum: flat, turningPoint: nil)
    }
    .padding(24)
}
