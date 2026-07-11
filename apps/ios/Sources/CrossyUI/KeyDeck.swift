// The key deck (ID-4, hardware-confirmed): clear interactive glass pucks in a
// GlassEffectContainer at the tight spacing SP-i1 verified (wider spacing metaball-
// fuses adjacent keys into wavy rows). Geometry, motion, and haptics are the SP-i2
// rig's, the deck the owner ruled on; DeckLayout owns the numbers. Below iOS 26 the
// glass APIs do not exist, so every key renders the DESIGN.md §4 fallback: the same
// geometry on the system's regular blur material, one fallback for all chrome. The
// deck always sits over solid canvas, never over the grid (ID-4); that stacking is
// the solve screen's job.
//
// Latency: a press mutates state synchronously at touch-down (DragGesture minimum
// distance 0, first onChanged), the SP-i2 rig's exact path, so press-to-glyph stays
// in the rig's measured class (8 to 11 ms software share to the next frame).

import CrossyDesign
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

@MainActor
public struct KeyDeck: View {
    private let ground: GridGround
    private let isRebusActive: Bool
    private let onPress: (DeckKey) -> Void

    public init(
        ground: GridGround, isRebusActive: Bool = false,
        onPress: @escaping (DeckKey) -> Void
    ) {
        self.ground = ground
        self.isRebusActive = isRebusActive
        self.onPress = onPress
    }

    public var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            #if os(iOS)
                if #available(iOS 26.0, *) {
                    GlassEffectContainer(spacing: DeckLayout.keySpacing) {
                        rows(width: width)
                    }
                } else {
                    rows(width: width)
                }
            #else
                rows(width: width)
            #endif
        }
        .frame(height: DeckLayout.deckHeight)
        .onAppear { KeyHaptics.shared.prepare() }
    }

    private func rows(width: CGFloat) -> some View {
        VStack(spacing: DeckLayout.rowSpacing) {
            ForEach(0..<DeckLayout.letterRows.count, id: \.self) { row in
                HStack(spacing: DeckLayout.keySpacing) {
                    ForEach(DeckLayout.keys(row: row), id: \.self) { key in
                        DeckKeyView(
                            key: key, ground: ground, isRebusActive: isRebusActive,
                            width: keyWidth(key, deckWidth: width),
                            onPress: onPress)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func keyWidth(_ key: DeckKey, deckWidth: CGFloat) -> CGFloat {
        switch key {
        case .letter: return DeckLayout.keyWidth(deckWidth: deckWidth)
        case .backspace, .rebus: return DeckLayout.specialKeyWidth(deckWidth: deckWidth)
        }
    }
}

// MARK: - One key

@MainActor
private struct DeckKeyView: View {
    let key: DeckKey
    let ground: GridGround
    let isRebusActive: Bool
    let width: CGFloat
    let onPress: (DeckKey) -> Void

    @State private var pressed = false

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: DeckLayout.keyCornerRadius, style: .continuous)
    }

    var body: some View {
        label
            .frame(width: width, height: DeckLayout.keyHeight)
            .contentShape(shape)
            .modifier(KeySurface(ground: ground, pressed: pressed))
            .scaleEffect(pressed ? 0.93 : 1)
            // No-overshoot press pop per the motion grammar (DESIGN.md §7); the
            // response is the SP-i2 constant so sixty presses a minute read.
            .animation(
                .spring(
                    response: Motion.Springs.keyPressResponse,
                    dampingFraction: Motion.Springs.chromeDampingFraction),
                value: pressed
            )
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        if !pressed {
                            pressed = true
                            KeyHaptics.shared.tick()
                            onPress(key)
                        }
                    }
                    .onEnded { _ in pressed = false }
            )
            .accessibilityLabel(Text(verbatim: accessibilityName))
            .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder
    private var label: some View {
        switch key {
        case .letter(let character):
            Text(String(character))
                .font(.system(size: 21, weight: Font.Weight(cssAxis: ground.glyphWeight)))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
        case .backspace:
            Image(systemName: "delete.left")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
        case .rebus:
            if isRebusActive {
                Image(systemName: "checkmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
            } else {
                // An uppercase label takes a touch of tracking (DESIGN.md §6).
                Text(verbatim: "REBUS")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
            }
        }
    }

    private var accessibilityName: String {
        switch key {
        case .letter(let character): return String(character)
        case .backspace: return "Delete"
        case .rebus: return isRebusActive ? "Commit rebus" : "Rebus"
        }
    }
}

// MARK: - The material

/// Clear interactive glass on iOS 26+; below, the DESIGN.md §4 fallback: the same
/// shape on the system's regular blur material, with a quiet pressed tint standing
/// in for the glass's own touch response. One fallback, both grounds, no second
/// design system.
private struct KeySurface: ViewModifier {
    let ground: GridGround
    let pressed: Bool

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: DeckLayout.keyCornerRadius, style: .continuous)
    }

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.glassEffect(.clear.interactive(), in: shape)
            } else {
                fallback(content)
            }
        #else
            fallback(content)
        #endif
    }

    private func fallback(_ content: Content) -> some View {
        content.background(
            shape.fill(.regularMaterial)
                .overlay(
                    shape.fill(
                        Color(rgb: ground.tokens.ink).opacity(pressed ? 0.08 : 0)))
        )
    }
}

// MARK: - Haptics

/// The press tick (DESIGN.md §7: specular pop plus haptic tick per press), fired at
/// touch-down alongside the visual press, the SP-i2 rig's order. Kept prepared so
/// sixty presses a minute never miss. Haptics are CrossyUI's business per the AD-2
/// module table; the macOS test build compiles the no-op.
@MainActor
final class KeyHaptics {
    static let shared = KeyHaptics()

    #if canImport(UIKit)
        private let generator = UIImpactFeedbackGenerator(style: .light)

        func prepare() { generator.prepare() }

        func tick() {
            generator.impactOccurred()
            generator.prepare()
        }
    #else
        func prepare() {}
        func tick() {}
    #endif
}
