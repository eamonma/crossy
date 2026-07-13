// Mirrors apps/ios/Sources/CrossyDesign/Motion.swift. Motion grammar (apps/ios/DESIGN.md
// §7): standing chrome uses small springs with no overshoot; overshoot is reserved for
// people and celebration. Every animation has a reduced-motion equivalent that crossfades
// instead of moving; that rule is enforced where animations are built (:ui), these are the
// tuning constants. iOS carries durations in seconds; Android animates in milliseconds, so
// the twins are integer millisecond durations (0.300 s becomes 300). Values are a starting
// set for the device tuning pass (DESIGN.md §10).
package crossy.design

/// A cubic-bezier control point in the unit square, a plain-value stand-in for the
/// `CubicBezierEasing` :ui will feed these into.
data class CurvePoint(val x: Double, val y: Double)

object Motion {
    /// The conflict flash (PROTOCOL.md §8, apps/ios/DESIGN.md §7): roughly 300 ms in the
    /// winner's color when a visible value changes under you. The loudest thing in the
    /// room; a tuned curve, never a linear fade.
    object Flash {
        /// Total envelope, roughly 300 ms per PROTOCOL.md §8.
        const val durationMs: Int = 300

        /// Sharp attack: snap to full tint fast enough to read as an event.
        const val attackDurationMs: Int = 50

        /// Long decay: the remainder of the envelope, easing back to ink.
        const val decayDurationMs: Int = 250

        /// Decay easing, cubic-bezier control points (ease-out with a long tail).
        val decayControlPoint1 = CurvePoint(x = 0.16, y = 1.0)
        val decayControlPoint2 = CurvePoint(x = 0.30, y = 1.0)
    }

    /// Spring grammar (apps/ios/DESIGN.md §7). Response is the SwiftUI `Spring` response, a
    /// duration-like parameter carried here in milliseconds; damping fraction is the ζ
    /// ratio. :ui maps response to Compose `stiffness` and damping fraction to
    /// `dampingRatio`.
    object Springs {
        /// Standing chrome: small springs, no overshoot. Damping fraction 1 is the
        /// no-overshoot guarantee (critically damped); keep it >= 1.
        const val chromeResponseMs: Int = 300
        const val chromeDampingFraction: Double = 1.0

        /// People and celebration (a puck arriving, the mosaic): the only springs allowed
        /// to overshoot.
        const val celebrationResponseMs: Int = 450
        const val celebrationDampingFraction: Double = 0.78

        /// The key deck press pop (apps/ios/DESIGN.md §7, ID-4). Deliberately tighter than
        /// `chromeResponseMs` so the pop reads at sixty presses a minute; the value is the
        /// SP-i2 rig's, the geometry the owner confirmed on hardware. Damping stays at the
        /// chrome no-overshoot guarantee. Tuning candidate per the SP-i2 report.
        const val keyPressResponseMs: Int = 140
    }
}
