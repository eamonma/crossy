// The reaction fan (PROTOCOL.md §9; the web mobile wave's sibling): one glass button
// that opens the five-emoji send row. All grammar lives in ReactionFanModel (pure,
// exhaustively tested); this file only translates touches into its calls and renders
// the phase. HOLD-SLIDE-RELEASE rides one DragGesture(minimumDistance: 0) on the
// button — touch down opens, the finger's position maps through ReactionFanLayout
// (the same geometry the render uses, so hit test and pixels cannot drift), release
// fires or cancels — and the TAP fallback falls out of the same gesture (a release
// still on the button stands the fan open). The row's slots are real Buttons for the
// standing fan, so tap-tap keeps every accessibility trait. Glass wears the D06
// availability gate: iOS 26 glass, the one blur-material fallback below, floor 18.

import CrossyDesign
import SwiftUI

/// Where the fan button stands (owner review on the Mac picks; the clue-bar corner is
/// the default, the deck edge the lab-toggled alternate).
public enum ReactionFanPlacement: String, CaseIterable, Sendable {
    case clueBarCorner
    case deckEdge
}

@available(iOS 17.0, macOS 14.0, *)
@MainActor
public struct ReactionFan: View {
    @Binding private var fan: ReactionFanModel
    private let ground: GridGround
    private let onFire: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The button's edge; the row's geometry comes from ReactionFanLayout.
    static let buttonSize: CGFloat = 40
    /// Air between the button's top and the open row's bottom.
    static let rowGap: CGFloat = 8
    /// How far past the button a release still reads as "on the button".
    static let buttonSlack: CGFloat = 10

    public init(
        fan: Binding<ReactionFanModel>, ground: GridGround,
        onFire: @escaping (String) -> Void
    ) {
        self._fan = fan
        self.ground = ground
        self.onFire = onFire
    }

    public var body: some View {
        button
            .overlay(alignment: .bottomTrailing) {
                if fan.isOpen {
                    // Aligned bottomTrailing, the row's bottom sits at the button's
                    // bottom; shifting by gap + buttonSize parks it `rowGap` above
                    // the button's top, the exact frame the slot mapping assumes.
                    row
                        .offset(y: -(Self.rowGap + Self.buttonSize))
                        .transition(
                            reduceMotion
                                ? .opacity.animation(.easeOut(duration: 0.15))
                                : .scale(scale: 0.72, anchor: .bottomTrailing)
                                    .combined(with: .opacity))
                }
            }
            // The standing fan's idle life (~3 s): the timer sleeps against the
            // opening it saw; the model validates, so a stale timer is a no-op.
            .task(id: fan.openedAt) {
                guard fan.openedAt != nil else { return }
                try? await Task.sleep(for: .seconds(ReactionFanModel.tapOpenIdleSeconds))
                guard !Task.isCancelled else { return }
                withAnimation(fanAnimation) {
                    fan.idleExpired(at: Date().timeIntervalSinceReferenceDate)
                }
            }
    }

    private var rowWidth: CGFloat { CGFloat(ReactionFanLayout.width(count: fan.emojis.count)) }
    private var rowHeight: CGFloat { CGFloat(ReactionFanLayout.height) }
    private var fanAnimation: Animation? { reduceMotion ? nil : .crossyChrome }

    // MARK: - The button

    private var button: some View {
        Image(systemName: "face.smiling")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color(rgb: ground.tokens.ink))
            .frame(width: Self.buttonSize, height: Self.buttonSize)
            .contentShape(Circle().inset(by: -Self.buttonSlack))
            .modifier(FanButtonGlass(pressed: fan.phase == .heldOpen))
            .gesture(holdSlide)
            .accessibilityLabel(Text(verbatim: "React"))
            .accessibilityAddTraits(.isButton)
    }

    /// The one gesture: minimumDistance 0, so touch-down opens with no latency (the
    /// KeyDeck's press path). Locations are button-local; the row's frame in that
    /// space is arithmetic (trailing-aligned, a fixed gap above), so the slot under
    /// the finger comes straight from ReactionFanLayout.
    private var holdSlide: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if fan.phase != .heldOpen {
                    withAnimation(fanAnimation) { fan.holdBegan() }
                }
                let slot = slot(at: value.location)
                if slot != fan.highlighted {
                    fan.holdMoved(over: slot)
                }
            }
            .onEnded { value in
                let slot = slot(at: value.location)
                let onButton =
                    value.location.x >= -Self.buttonSlack
                    && value.location.x <= Self.buttonSize + Self.buttonSlack
                    && value.location.y >= -Self.buttonSlack
                    && value.location.y <= Self.buttonSize + Self.buttonSlack
                var effect = ReactionFanModel.Effect.none
                withAnimation(fanAnimation) {
                    effect = fan.holdEnded(
                        over: slot, onButton: onButton,
                        at: Date().timeIntervalSinceReferenceDate)
                }
                if case .fire(let emoji) = effect { onFire(emoji) }
            }
    }

    /// The row's slot under a button-local point, through the shared layout.
    private func slot(at location: CGPoint) -> Int? {
        let rowX = location.x - (Self.buttonSize - rowWidth)
        let rowY = location.y + rowHeight + Self.rowGap
        return ReactionFanLayout.slot(
            atX: Double(rowX), y: Double(rowY), count: fan.emojis.count)
    }

    // MARK: - The open row

    private var row: some View {
        HStack(spacing: CGFloat(ReactionFanLayout.slotSpacing)) {
            ForEach(Array(fan.emojis.enumerated()), id: \.offset) { index, emoji in
                slotView(index: index, emoji: emoji)
            }
        }
        .padding(CGFloat(ReactionFanLayout.capsulePadding))
        .modifier(FanRowGlass())
        .frame(width: rowWidth, height: rowHeight)
    }

    private func slotView(index: Int, emoji: String) -> some View {
        Button {
            var effect = ReactionFanModel.Effect.none
            withAnimation(fanAnimation) { effect = fan.tapEmoji(at: index) }
            if case .fire(let fired) = effect { onFire(fired) }
        } label: {
            Text(verbatim: emoji)
                .font(.system(size: 26))
                .frame(
                    width: CGFloat(ReactionFanLayout.slotSize),
                    height: CGFloat(ReactionFanLayout.slotSize))
                .background(
                    Circle()
                        .fill(Color(rgb: ground.tokens.ink))
                        .opacity(fan.highlighted == index ? 0.10 : 0))
                .scaleEffect(fan.highlighted == index && !reduceMotion ? 1.18 : 1)
                .animation(
                    reduceMotion ? nil : .snappy(duration: 0.18), value: fan.highlighted)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "React with \(emoji)"))
    }
}

// MARK: - The materials (D06: 26+ glass, one blur fallback below, floor 18)

/// The button: interactive regular glass (it is a control), the KeySurface gating
/// pattern below 26 with a quiet pressed tint standing in for the glass's own touch
/// response.
private struct FanButtonGlass: ViewModifier {
    let pressed: Bool

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.glassEffect(.regular.interactive(), in: .circle)
            } else {
                fallback(content)
            }
        #else
            fallback(content)
        #endif
    }

    private func fallback(_ content: Content) -> some View {
        content.background(
            Circle().fill(.regularMaterial)
                .overlay(Circle().fill(Color.primary.opacity(pressed ? 0.08 : 0))))
    }
}

/// The open row: standing regular glass in the capsule register.
private struct FanRowGlass: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.glassEffect(.regular, in: .capsule)
            } else {
                content.background(Capsule().fill(.regularMaterial))
            }
        #else
            content.background(Capsule().fill(.regularMaterial))
        #endif
    }
}
