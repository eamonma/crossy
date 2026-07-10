// The solve surface, I2b shape: grid above, key deck below on solid canvas (the
// deck sits over canvas, never over the grid, ID-4), one SelectionModel wiring the
// two together. Ground follows system appearance through CrossyDesign tokens (ID-3:
// Studio light, Observatory dark; two renders of one drawing, never two code
// paths). The room's chrome (room bar, clue bar, browser) grows around this in I2c;
// composition roots hand in a store and a mapped puzzle and nothing else.

import CrossyDesign
import CrossyStore
import SwiftUI

@available(iOS 18.0, macOS 14.0, *)
@MainActor
public struct SolveScreen: View {
    private let store: GameStore
    private let puzzle: GridPuzzle
    @State private var model: SelectionModel
    @Environment(\.colorScheme) private var colorScheme

    /// `model` lets a composition root own the selection (the room will drive it
    /// from clue-bar taps in I2c); nil owns a store-bound one locally.
    public init(store: GameStore, puzzle: GridPuzzle, model: SelectionModel? = nil) {
        self.store = store
        self.puzzle = puzzle
        _model = State(initialValue: model ?? SelectionModel(store: store, puzzle: puzzle))
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        VStack(spacing: 0) {
            CrossyGridView(
                store: store, puzzle: puzzle, ground: ground,
                selection: model.selection,
                onSwipe: { model.swipe($0) },
                onPlaceCursor: { model.tap(cell: $0) })
            deckZone
        }
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
    }

    /// The deck over solid canvas (ID-4), the rebus inline field surfacing above it
    /// while an entry is open (EXPERIENCE.md baseline; the exhale bubble is I4).
    private var deckZone: some View {
        VStack(spacing: 10) {
            if let buffer = model.rebusBuffer {
                RebusField(buffer: buffer, ground: ground)
            }
            KeyDeck(ground: ground, isRebusActive: model.isRebusActive) { key in
                model.press(key)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(Color(rgb: ground.tokens.canvas))
        .animation(
            .spring(
                response: Motion.Springs.chromeResponse,
                dampingFraction: Motion.Springs.chromeDampingFraction),
            value: model.isRebusActive)
    }
}

// MARK: - The rebus inline field

/// The baseline rebus entry (EXPERIENCE.md §6: a plain inline field qualifies): the
/// buffer as it grows, committed as one value by the deck's rebus key. Clear glass,
/// the momentary register (DESIGN.md §4), with the §4 blur fallback below iOS 26.
/// Chrome stays achromatic (DESIGN.md §3), so the caret is ink.
@MainActor
struct RebusField: View {
    let buffer: String
    let ground: GridGround

    var body: some View {
        HStack(spacing: 3) {
            if buffer.isEmpty {
                Text(verbatim: "Rebus")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            } else {
                Text(verbatim: buffer)
                    .font(.system(size: 17, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
            }
            RoundedRectangle(cornerRadius: 1)
                .fill(Color(rgb: ground.tokens.ink))
                .frame(width: 2, height: 18)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .modifier(RebusSurface())
        .accessibilityLabel(
            Text(verbatim: buffer.isEmpty ? "Rebus entry" : "Rebus entry \(buffer)"))
    }
}

/// Clear glass on iOS 26+; the one blur-material fallback below (DESIGN.md §4).
private struct RebusSurface: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.glassEffect(.clear, in: .capsule)
            } else {
                content.background(Capsule().fill(.regularMaterial))
            }
        #else
            content.background(Capsule().fill(.regularMaterial))
        #endif
    }
}
