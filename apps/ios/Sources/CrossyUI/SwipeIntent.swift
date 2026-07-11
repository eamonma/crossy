// Swipe-intent mapping (root DESIGN.md §5): on touch, a swipe along the solving
// direction is Tab (forward with the reading order, backward against it), and a
// swipe across it toggles the direction. The classifier is pure geometry over a
// finished drag; whether a drag was a swipe at all is the grid view's call (a drag
// that panned the camera is a pan, never a swipe), so the two gestures cannot
// double-fire.

import CoreGraphics

public enum SwipeIntent: Equatable, Sendable {
    case nextWord
    case previousWord
    case toggleDirection
}

public enum SwipeClassifier {
    /// A drag must travel at least this far on its dominant axis to read as a
    /// swipe rather than a stray touch; one cell module in points at typical zoom.
    public static let minimumTravel: CGFloat = 24

    /// The dominant axis must beat the other by this factor, or the gesture is too
    /// diagonal to carry one honest intent.
    public static let dominanceRatio: CGFloat = 2

    /// Classify a finished drag against the current solving axis; nil when the
    /// gesture is too short or too diagonal to mean anything.
    public static func classify(translation: CGSize, isAcross: Bool) -> SwipeIntent? {
        let dx = translation.width
        let dy = translation.height
        let horizontal = abs(dx) >= abs(dy) * dominanceRatio && abs(dx) >= minimumTravel
        let vertical = abs(dy) >= abs(dx) * dominanceRatio && abs(dy) >= minimumTravel

        if horizontal {
            if isAcross { return dx > 0 ? .nextWord : .previousWord }
            return .toggleDirection
        }
        if vertical {
            if isAcross { return .toggleDirection }
            return dy > 0 ? .nextWord : .previousWord
        }
        return nil
    }
}
