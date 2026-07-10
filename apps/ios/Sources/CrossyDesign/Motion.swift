// Motion grammar (apps/ios/DESIGN.md §7): standing chrome uses small springs with no
// overshoot; overshoot is reserved for people and celebration. Every animation has a
// reduced-motion equivalent that crossfades instead of moving; that rule is enforced
// where animations are built (CrossyUI), these are the tuning constants. Durations
// are seconds. Values are a starting set for the device tuning pass (DESIGN.md §10).

import Foundation

/// A cubic-bezier control point in the unit square, Foundation-only stand-in for the
/// curve types CrossyUI will feed these into.
public struct CurvePoint: Hashable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public enum Motion {
    /// The conflict flash (PROTOCOL.md §8, apps/ios/DESIGN.md §7): roughly 300 ms in
    /// the winner's color when a visible value changes under you. The loudest thing
    /// in the room; a tuned curve, never a linear fade.
    public enum Flash {
        /// Total envelope, roughly 300 ms per PROTOCOL.md §8.
        public static let duration: TimeInterval = 0.300

        /// Sharp attack: snap to full tint fast enough to read as an event.
        public static let attackDuration: TimeInterval = 0.050

        /// Long decay: the remainder of the envelope, easing back to ink.
        public static let decayDuration: TimeInterval = 0.250

        /// Decay easing, cubic-bezier control points (ease-out with a long tail).
        public static let decayControlPoint1 = CurvePoint(x: 0.16, y: 1.0)
        public static let decayControlPoint2 = CurvePoint(x: 0.30, y: 1.0)
    }

    /// Spring grammar (apps/ios/DESIGN.md §7). Response/dampingFraction in the
    /// SwiftUI `Spring` sense; construction happens in CrossyUI.
    public enum Springs {
        /// Standing chrome: small springs, no overshoot. Damping fraction 1 is the
        /// no-overshoot guarantee (critically damped); keep it >= 1.
        public static let chromeResponse: TimeInterval = 0.30
        public static let chromeDampingFraction: Double = 1.0

        /// People and celebration (a puck arriving, the mosaic): the only springs
        /// allowed to overshoot.
        public static let celebrationResponse: TimeInterval = 0.45
        public static let celebrationDampingFraction: Double = 0.78
    }
}
