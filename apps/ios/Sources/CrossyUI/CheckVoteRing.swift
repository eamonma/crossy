// The vote ring (apps/ios Wave 15.5 UX): a luminous rounded-rect halo just outside the grid,
// in the warm gold accent, draining continuously with the vote's remaining time. It is the
// only clock, so there are no countdown digits anywhere. It ignites on open with a pulse,
// flashes and dissolves inward on a pass, and fades on a fail or cancel. Under Reduce Motion
// it neither sweeps nor pulses: it steps its opacity as the time drains (honoring
// accessibilityReduceMotion, which the caller reads and passes in).
//
// The gold is the AnalysisPalette ramp (the app's one warm note), never an identity color, so
// the ring can never be mistaken for a voter. It is decorative and hidden from the
// accessibility tree; the Bench carries the labels and announcements a screen reader reads.

import CrossyDesign
import SwiftUI

/// The ring's life phase, driving ignition, drain, and dissolution independently of the drain
/// fraction. The caller advances it on the store's vote beats.
public enum CheckVoteRingPhase: Equatable, Sendable {
    /// Rising on vote open: a brief pulse, then it settles into the drain.
    case igniting
    /// Steady state: the stroke drains with `progress`.
    case draining
    /// The vote passed: a bright flash that dissolves inward.
    case passing
    /// The vote failed, lapsed, or cancelled: a gentle fade out.
    case fading
}

@available(iOS 17.0, macOS 14.0, *)
public struct CheckVoteRing: View {
    /// Remaining fraction, 1 at open draining to 0 at the timebox (the store clamps it).
    private let progress: Double
    private let phase: CheckVoteRingPhase
    private let ground: GridGround
    private let reduceMotion: Bool
    /// The halo's corner radius; the grid's own frame is a soft rounded rect at this radius.
    private let cornerRadius: CGFloat

    public init(
        progress: Double, phase: CheckVoteRingPhase, ground: GridGround, reduceMotion: Bool,
        cornerRadius: CGFloat = 22
    ) {
        self.progress = min(1, max(0, progress))
        self.phase = phase
        self.ground = ground
        self.reduceMotion = reduceMotion
        self.cornerRadius = cornerRadius
    }

    /// The warm gold, the solo-gold ramp hue (AnalysisPalette), never an identity color.
    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }

    /// The stroke opacity: full while igniting/draining, brighter on the pass flash, fading to
    /// nothing on a fail. Under Reduce Motion the drain itself is expressed as stepped opacity
    /// (five buckets), the only cue that time is running when no sweep may animate.
    private var strokeOpacity: Double {
        switch phase {
        case .passing: return 1
        case .fading: return 0
        case .igniting, .draining:
            guard reduceMotion else { return 0.9 }
            // Stepped: 1.0, 0.8, 0.6, 0.4, 0.2 as the fifths drain.
            let step = (ceil(progress * 5) / 5)
            return max(0.2, step) * 0.9
        }
    }

    public var body: some View {
        GeometryReader { geo in
            let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            ZStack {
                // The draining halo. When motion is allowed the trim sweeps from full to empty
                // with the remaining time; under Reduce Motion the full ring stands and only
                // its opacity steps (no trim sweep, no pulse).
                shape
                    .trim(from: 0, to: reduceMotion ? 1 : CGFloat(progress))
                    .stroke(
                        gold,
                        style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    .opacity(strokeOpacity)
                    .shadow(color: gold.opacity(reduceMotion ? 0 : 0.55), radius: 6)
                    // The trim starts at the top center and drains clockwise; a quarter-turn
                    // rotation puts the seam at 12 o'clock rather than 3 o'clock.
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: geo.size.width, height: geo.size.height)
            // The pass flash blooms outward then the whole ring dissolves inward.
            .scaleEffect(reduceMotion ? 1 : (phase == .passing ? 1.015 : phase == .igniting ? 1.01 : 1))
            .opacity(phase == .fading ? 0 : 1)
            .animation(
                reduceMotion ? nil : .easeOut(duration: phase == .passing ? 0.5 : 0.3), value: phase)
            .animation(reduceMotion ? .none : .linear(duration: 0.2), value: progress)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)  // decorative; the Bench carries the semantics
    }
}
