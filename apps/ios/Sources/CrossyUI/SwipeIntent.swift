// Swipe-intent mapping (root DESIGN.md §5): on touch, a swipe along the solving
// direction is Tab (forward with the reading order, backward against it), and a
// swipe across it toggles the direction. The classifier is pure geometry over a
// finished drag; whether a drag was a swipe at all is the grid view's call (a drag
// that panned the camera is a pan, never a swipe), so the two gestures cannot
// double-fire.
//
// Twin of SwipeClassifier.kt (apps/android). The geometry and the three tuning
// presets are the same law on both platforms, so a swipe reads identically on iOS
// and Android; the preset values below and the Android ones must stay in lockstep
// (a change here is a change there, reviewed together).

import CoreGraphics

public enum SwipeIntent: Equatable, Sendable {
    case nextWord
    case previousWord
    case toggleDirection
}

/// How readily a drag reads as a swipe: the travel floor and the dominance ratio,
/// the two thresholds the classifier tests. A person picks one of the three presets
/// in Settings (SwipeSensitivity); the pure classifier takes the resolved values as
/// data, never the enum, so the geometry stays free of the preference plumbing.
public struct SwipeTuning: Equatable, Sendable {
    /// A drag must travel at least this far on its dominant axis to read as a swipe
    /// rather than a stray touch; the standard value is one cell module in points at
    /// typical zoom.
    public var minimumTravel: CGFloat

    /// The dominant axis must beat the other by this factor, or the gesture is too
    /// diagonal to carry one honest intent.
    public var dominanceRatio: CGFloat

    public init(minimumTravel: CGFloat, dominanceRatio: CGFloat) {
        self.minimumTravel = minimumTravel
        self.dominanceRatio = dominanceRatio
    }

    /// Accepts shorter, looser swipes: the page turns on a light gesture.
    public static let relaxed = SwipeTuning(minimumTravel: 16, dominanceRatio: 1.5)

    /// The default, unchanged from the pre-sensitivity behavior: one cell module of
    /// travel, twice-dominant. `classify` at this preset is bit-identical to the
    /// original single-threshold classifier, so the swipe vectors stay green.
    public static let standard = SwipeTuning(minimumTravel: 24, dominanceRatio: 2)

    /// Waits for a deliberate, straight, longer swipe: fewer accidental turns.
    public static let precise = SwipeTuning(minimumTravel: 32, dominanceRatio: 2.5)
}

/// The per-device swipe-sensitivity preference (NavigationSettingsStore persists the
/// raw string). Pure and Foundation-free beyond the synthesized RawRepresentable, so
/// it lives beside the geometry it selects; the store resolves an absent or
/// unrecognized value to `.standard`. Twin of SwipeClassifier.kt's Sensitivity.
public enum SwipeSensitivity: String, Equatable, Sendable, CaseIterable {
    case relaxed
    case standard
    case precise

    /// The thresholds this preference resolves to; the one bridge from the stored
    /// preference into the pure classifier.
    public var tuning: SwipeTuning {
        switch self {
        case .relaxed: return .relaxed
        case .standard: return .standard
        case .precise: return .precise
        }
    }
}

public enum SwipeClassifier {
    /// The standard preset's travel floor, kept as a name the pinned tests read. The
    /// preset is the single source of truth; this forwards to it.
    public static let minimumTravel: CGFloat = SwipeTuning.standard.minimumTravel

    /// The standard preset's dominance ratio, likewise forwarded.
    public static let dominanceRatio: CGFloat = SwipeTuning.standard.dominanceRatio

    /// Classify a finished drag against the current solving axis under `tuning`; nil
    /// when the gesture is too short or too diagonal to mean anything. The default
    /// preset reproduces the original thresholds exactly.
    public static func classify(
        translation: CGSize, isAcross: Bool, tuning: SwipeTuning = .standard
    ) -> SwipeIntent? {
        let dx = translation.width
        let dy = translation.height
        let horizontal =
            abs(dx) >= abs(dy) * tuning.dominanceRatio && abs(dx) >= tuning.minimumTravel
        let vertical =
            abs(dy) >= abs(dx) * tuning.dominanceRatio && abs(dy) >= tuning.minimumTravel

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

    /// Flick assist: classify the actual end translation first, and only if that
    /// means nothing fall back to the drag's predicted end translation (UIKit's
    /// lift-off velocity projection). This rescues a fast, short flick, the
    /// sluggish-swipes complaint on iOS: the finger travels little but lifts off
    /// fast, so the actual translation sits under the travel floor while the
    /// projection clears it.
    ///
    /// The predicted vector is capped first: scale it uniformly so its Euclidean
    /// length never exceeds twice the actual translation's length. Uniform scaling
    /// preserves direction and the dominance ratio, so the cap changes only whether
    /// the flick clears the travel floor, never which intent it carries. The 2x
    /// ceiling is what stops a 6pt twitch with a high lift-off velocity from firing
    /// a page turn nobody meant: past the cap the projection cannot buy more than
    /// double the real travel. Twin of SwipeClassifier.kt's classify with a
    /// predicted translation.
    public static func classify(
        translation: CGSize, predicted: CGSize, isAcross: Bool,
        tuning: SwipeTuning = .standard
    ) -> SwipeIntent? {
        if let intent = classify(translation: translation, isAcross: isAcross, tuning: tuning) {
            return intent
        }
        let capped = SwipeClassifier.capped(predicted, toLength: 2 * length(of: translation))
        return classify(translation: capped, isAcross: isAcross, tuning: tuning)
    }

    /// The Euclidean length of a translation, in points.
    private static func length(of v: CGSize) -> CGFloat {
        (v.width * v.width + v.height * v.height).squareRoot()
    }

    /// `v` scaled uniformly so its length does not exceed `maxLength`; returned
    /// unchanged when it is already within the cap (a predicted shorter than the
    /// actual keeps its own length). A zero cap collapses the vector to zero, so a
    /// twitch with no real travel can never be rescued.
    private static func capped(_ v: CGSize, toLength maxLength: CGFloat) -> CGSize {
        let length = length(of: v)
        guard length > maxLength else { return v }
        guard length > 0 else { return .zero }
        let scale = maxLength / length
        return CGSize(width: v.width * scale, height: v.height * scale)
    }
}
