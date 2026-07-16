// The solve's haptic grammar (apps/ios/DESIGN.md §7, roadmap I2e): a light tick
// when the cursor crosses a block, a soft thud when a word completes, a double
// tick when a word you were mid-typing is finished by someone else, a distinct
// pattern for gameCompleted — and never a haptic for a teammate's routine
// letters (that would buzz constantly in a lively room). The deck's per-press
// tick lives with the deck (KeyHaptics); this file owns the board's moments.
//
// The grammar is a pure fold over observed (filled, selection) pairs, the
// CelebrationGate pattern: whose hand moved is derived, never plumbed. A delta
// on the cell the cursor stood on is the local hand (you type where you stand);
// any other single-cell delta is a teammate's. A bulk delta is a snapshot
// (welcome, resync) — history arriving, not a moment, so it is silent. The fold
// receives whole current states, so the two SwiftUI observers that feed it
// (selection, filled composite) can fire in any order or collapse into one;
// whichever arrives first carries the delta, the other observes nothing new.

import Foundation

/// One haptic moment, named by DESIGN.md §7's grammar. The player renders it;
/// the fold derives it; nothing else decides when the room buzzes.
public enum SolveHaptic: Equatable, Sendable {
    /// The cursor traveled to another word: a block crossed, a line changed, a
    /// swipe between words, the axis toggled (owner ruling 2026-07-10
    /// broadening §7's block-cross tick to every word-to-word travel).
    case travelTick
    /// A word completed under the local hand.
    case wordThud
    /// A word the cursor stands in was finished by someone else.
    case doubleTick
    /// The gameCompleted pattern (fired off the INV-3 gate, not this fold).
    case completion
    /// Your own reaction left (Wave 7.5): a light confirmation under the fan's fire.
    case reactionSent
    /// A teammate's sticker landed on or beside your active word (Wave 7.5; gated by
    /// ReactionProximity and the ReactionSettings toggle, never fired for a sticker
    /// across the board).
    case reactionLanded
}

/// Starting values for the I2e device tuning pass (DESIGN.md §7: tuned on
/// hardware). One block to edit; nothing else holds a magic number.
public enum SolveHapticTuning {
    public static let travelTickIntensity: Double = 0.6
    public static let wordThudIntensity: Double = 1.0
    public static let doubleTickIntensity: Double = 0.8
    /// The double tick's gap: wide enough to read as two, tight enough to be
    /// one gesture.
    public static let doubleTickGapMilliseconds: Int = 90
    /// The reaction pair (Wave 7.5): your send confirms lightly; a received sticker
    /// near your word taps softer still (it is a wave, not a knock).
    public static let reactionSentIntensity: Double = 0.7
    public static let reactionLandedIntensity: Double = 0.5
}

/// The exactly-when derivation. Feed every observed (filled, selection) pair;
/// at most one haptic comes back per observation. The first observation seeds
/// the fold and never buzzes (a welcome into a half-filled board is arrival,
/// not action).
public struct SolveHapticFold: Equatable, Sendable {
    private var filled: Set<Int>?
    private var restCell: Int?
    private var restIsAcross: Bool?

    public init() {}

    public mutating func observe(
        filled: Set<Int>, selection: GridSelection, puzzle: GridPuzzle
    ) -> SolveHaptic? {
        defer {
            self.filled = filled
            restCell = selection.cell
            restIsAcross = selection.isAcross
        }
        guard let before = self.filled, let rest = restCell, let restAcross = restIsAcross
        else { return nil }
        let delta = filled.subtracting(before)

        // Pure movement (a swipe, an advance, a backspace step, a toggle): the
        // tick when the travel lands in another word (owner ruling 2026-07-10:
        // line changes and swipes tick like block crossings; within-word steps
        // stay silent). Clears are movement too.
        if delta.isEmpty {
            guard selection.cell != rest || selection.isAcross != restAcross
            else { return nil }
            return Self.wordChanged(
                fromCell: rest, fromIsAcross: restAcross, to: selection,
                puzzle: puzzle)
                ? .travelTick : nil
        }

        // The live wire places one letter at a time; a bulk delta is a snapshot.
        guard delta.count == 1, let placed = delta.first else { return nil }

        if placed == rest {
            // The local hand. A completing letter thuds; the thud outranks the
            // advance's travel tick (one haptic per intent, the loudest fact).
            if Self.completesAWord(cell: placed, after: filled, puzzle: puzzle) {
                return .wordThud
            }
            return Self.wordChanged(
                fromCell: rest, fromIsAcross: restAcross, to: selection,
                puzzle: puzzle)
                ? .travelTick : nil
        }

        // Another hand. §7's double tick only when it finishes the word the
        // cursor stands in ("mid-typing" read as the standing word); a
        // teammate's routine letter is silent, always.
        let standing = puzzle.wordCells(through: rest, isAcross: restAcross)
        if standing.contains(placed), standing.isSubset(of: filled) {
            return .doubleTick
        }
        return nil
    }

    /// Whether the travel landed in another word: the standing word's cells
    /// before against after (a block crossing, a line change, an axis toggle,
    /// and any jump all change the word; a step within the word does not).
    static func wordChanged(
        fromCell: Int, fromIsAcross: Bool, to selection: GridSelection,
        puzzle: GridPuzzle
    ) -> Bool {
        puzzle.wordCells(through: fromCell, isAcross: fromIsAcross)
            != puzzle.wordCells(through: selection.cell, isAcross: selection.isAcross)
    }

    /// True when a word through the cell stands fully filled: the placed letter
    /// was the word's last empty cell on either axis.
    static func completesAWord(cell: Int, after: Set<Int>, puzzle: GridPuzzle) -> Bool {
        puzzle.wordCells(through: cell, isAcross: true).isSubset(of: after)
            || puzzle.wordCells(through: cell, isAcross: false).isSubset(of: after)
    }
}

#if canImport(UIKit)
    import UIKit
#endif

/// The player (the KeyHaptics pattern): CrossyUI's business per AD-2, prepared
/// so moments never miss, compiled to a no-op on the macOS test build. The
/// system's haptics setting silences the generators without our help. A
/// completing deck press fires the key tick and the thud together; they read
/// as one weighted press, judged in the I2e tuning pass.
@MainActor
public final class SolveHaptics {
    public static let shared = SolveHaptics()

    #if canImport(UIKit)
        private let tick = UIImpactFeedbackGenerator(style: .light)
        private let thud = UIImpactFeedbackGenerator(style: .soft)
        private let pattern = UINotificationFeedbackGenerator()

        public func prepare() {
            tick.prepare()
            thud.prepare()
            pattern.prepare()
        }

        public func play(_ haptic: SolveHaptic) {
            switch haptic {
            case .travelTick:
                tick.impactOccurred(intensity: SolveHapticTuning.travelTickIntensity)
                tick.prepare()
            case .wordThud:
                thud.impactOccurred(intensity: SolveHapticTuning.wordThudIntensity)
                thud.prepare()
            case .doubleTick:
                tick.impactOccurred(intensity: SolveHapticTuning.doubleTickIntensity)
                Task { @MainActor in
                    try? await Task.sleep(
                        for: .milliseconds(SolveHapticTuning.doubleTickGapMilliseconds))
                    self.tick.impactOccurred(
                        intensity: SolveHapticTuning.doubleTickIntensity)
                    self.tick.prepare()
                }
            case .completion:
                // §7's "distinct completion pattern": the system's success
                // two-beat, unmistakably not a tick or a thud.
                pattern.notificationOccurred(.success)
            case .reactionSent:
                tick.impactOccurred(intensity: SolveHapticTuning.reactionSentIntensity)
                tick.prepare()
            case .reactionLanded:
                thud.impactOccurred(intensity: SolveHapticTuning.reactionLandedIntensity)
                thud.prepare()
            }
        }
    #else
        public func prepare() {}
        public func play(_ haptic: SolveHaptic) {}
    #endif
}
