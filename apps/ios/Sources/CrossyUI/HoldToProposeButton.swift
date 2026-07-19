// Hold-to-propose (apps/ios Wave 15.5 UX): in a multiplayer room the Check control becomes
// press-and-hold (~600 ms) with a fill that grows under the finger; releasing early cancels,
// so a check is never proposed by a stray tap. The completed hold is the proposal. Solo rooms
// keep the plain confirm dialog (the caller decides which control to mount), since there is no
// room to interpose on an auto-pass.
//
// Accessibility: the timed hold is not reachable by VoiceOver, so an accessibility activation
// path fires the proposal directly (the `.accessibilityAction`), and the label says what the
// control does. Reduce Motion keeps the fill as a stepped state rather than a continuous sweep.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct HoldToProposeButton: View {
    private let title: String
    private let ground: GridGround
    private let reduceMotion: Bool
    private let enabled: Bool
    private let onPropose: () -> Void
    /// Fired as the fill begins, for the call haptic/ring pulse (the first of the five beats).
    private let onHoldBegan: () -> Void
    private let onHoldCancelled: () -> Void

    @State private var fill: CGFloat = 0
    @State private var pressing = false
    /// The Reduce Motion stepper: while pressing, a task advances the fill in quarters
    /// (U3's stepped state; the old binary fill read armed at touch-down, then did nothing).
    @State private var stepTask: Task<Void, Never>?

    /// The hold that counts as a proposal (~600 ms).
    public static let holdDuration: Double = 0.6

    /// The Reduce Motion fill at `elapsed` seconds into the hold: quarters, starting at
    /// 0.25 on touch-down and advancing every holdDuration/4 (150 ms), reaching full one
    /// step before the commit so the state is legible without a sweep. Pure, pinned in
    /// HoldToProposeSteppedFillTests.
    public static func steppedFill(elapsed: Double) -> Double {
        let quarter = holdDuration / 4
        return min(1, 0.25 * ((elapsed / quarter).rounded(.down) + 1))
    }

    public init(
        title: String,
        ground: GridGround,
        reduceMotion: Bool,
        enabled: Bool = true,
        onPropose: @escaping () -> Void,
        onHoldBegan: @escaping () -> Void = {},
        onHoldCancelled: @escaping () -> Void = {}
    ) {
        self.title = title
        self.ground = ground
        self.reduceMotion = reduceMotion
        self.enabled = enabled
        self.onPropose = onPropose
        self.onHoldBegan = onHoldBegan
        self.onHoldCancelled = onHoldCancelled
    }

    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }
    private var ink: Color { Color(rgb: ground.tokens.ink) }

    public var body: some View {
        ZStack(alignment: .leading) {
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(gold.opacity(0.28))
                    // With motion the fill sweeps under the finger; under Reduce Motion
                    // `fill` is set by the quarter stepper (no sweep, honest progress).
                    .frame(width: geo.size.width * fill)
            }
            Text(title)
                .font(.body.weight(.semibold))
                .foregroundStyle(enabled ? ink : ink.opacity(0.35))
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(ink.opacity(0.08)))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(gold.opacity(pressing ? 0.9 : 0.35), lineWidth: 1.5))
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .opacity(enabled ? 1 : 0.6)
        .onLongPressGesture(
            minimumDuration: Self.holdDuration, maximumDistance: 40,
            perform: {
                guard enabled else { return }
                onPropose()
                resetFill()
            },
            onPressingChanged: { isPressing in
                guard enabled else { return }
                pressing = isPressing
                if isPressing {
                    onHoldBegan()
                    if reduceMotion {
                        // The stepped fill (U3): quarters advancing every 150 ms, no sweep.
                        fill = CGFloat(Self.steppedFill(elapsed: 0))
                        stepTask?.cancel()
                        stepTask = Task { @MainActor in
                            let quarter = Self.holdDuration / 4
                            for step in 1...3 {
                                try? await Task.sleep(for: .seconds(quarter))
                                guard !Task.isCancelled, pressing else { return }
                                fill = CGFloat(
                                    Self.steppedFill(elapsed: Double(step) * quarter))
                            }
                        }
                    } else {
                        withAnimation(.linear(duration: Self.holdDuration)) {
                            fill = 1
                        }
                    }
                } else {
                    // Released before the threshold: cancel and drain the fill back.
                    if fill < 1 { onHoldCancelled() }
                    resetFill()
                }
            }
        )
        .accessibilityElement()
        .accessibilityLabel("Propose a check")
        .accessibilityHint("Opens a vote for the room to check the puzzle")
        .accessibilityAddTraits(.isButton)
        // VoiceOver cannot perform a timed hold; activation proposes directly.
        .accessibilityAction {
            guard enabled else { return }
            onPropose()
        }
    }

    private func resetFill() {
        stepTask?.cancel()
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { fill = 0 }
        pressing = false
    }
}
