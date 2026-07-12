// The local cursor's owner (roadmap I2b): one observable that CrossyGridView
// consumes as render input and the deck and grid gestures drive. The store
// deliberately holds no local selection (it mirrors the server actor; selection
// never crosses the wire), so it lives here, and every transition delegates to
// InputActions, whose navigation flows through the store ring into the engine's
// vectored rules. Board facts arrive through injected closures (the INV-10 rendered
// composite and the terminal freeze), so tests drive the model without a store;
// the GameStore binding is the one convenience initializer.

import CrossyStore
import Observation

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class SelectionModel {
    /// The cursor: a cell and a solving axis, always on a playable cell.
    public private(set) var selection: GridSelection

    /// The inline rebus entry in flight; nil when rebus mode is off
    /// (EXPERIENCE.md baseline rebus: multi-glyph entry committed as one value).
    public private(set) var rebusBuffer: String?

    /// The wire value charset cap (PROTOCOL.md §3): 1 to 10 glyphs.
    public static let rebusGlyphCap = 10

    private var puzzle: GridPuzzle
    @ObservationIgnored private let isFilled: (Int) -> Bool
    @ObservationIgnored private let isFrozen: () -> Bool
    @ObservationIgnored private let sendPlace: (Int, String) -> Void
    @ObservationIgnored private let sendClear: (Int) -> Void

    public init(
        puzzle: GridPuzzle,
        isFilled: @escaping (Int) -> Bool,
        isFrozen: @escaping () -> Bool,
        sendPlace: @escaping (Int, String) -> Void,
        sendClear: @escaping (Int) -> Void
    ) {
        self.puzzle = puzzle
        self.isFilled = isFilled
        self.isFrozen = isFrozen
        self.sendPlace = sendPlace
        self.sendClear = sendClear
        self.selection = InputActions.initialSelection(puzzle)
    }

    /// The store binding: fills read the INV-10 rendered composite (sequenced state
    /// painted with the overlay), the freeze reads the terminal status, and
    /// mutations go through the store's command path.
    public convenience init(store: GameStore, puzzle: GridPuzzle) {
        self.init(
            puzzle: puzzle,
            isFilled: { store.renderValue($0) != nil },
            isFrozen: { store.status != .ongoing },
            sendPlace: { store.placeLetter(cell: $0, value: $1) },
            sendClear: { store.clearCell(cell: $0) })
    }

    public var isRebusActive: Bool { rebusBuffer != nil }

    /// The room's REST geometry replacing the construction stand-in (the one-host
    /// arrival, DESIGN.md §4): the live room builds this model ONCE over a 1x1
    /// placeholder so the view's `@State` pin holds a single instance for the
    /// room's whole life, then re-targets it here when the real grid arrives. The
    /// cursor restarts at the new puzzle's initial cell (a stand-in cursor means
    /// nothing on the real grid) and an open rebus entry is discarded like every
    /// other move-away (impossible pre-board, but the rule is total).
    public func retarget(puzzle: GridPuzzle) {
        self.puzzle = puzzle
        rebusBuffer = nil
        selection = InputActions.initialSelection(puzzle)
    }

    // MARK: - Intents

    /// A deck key. In rebus mode, letters grow the buffer, backspace edits it (and
    /// exits when it is already empty), and the rebus key commits the whole value as
    /// one command. Outside it, letters and backspace follow the vectored rules and
    /// the rebus key opens the buffer.
    public func press(_ key: DeckKey) {
        if rebusBuffer != nil {
            pressInRebusMode(key)
            return
        }
        switch key {
        case .letter(let character):
            apply(InputActions.letter(env(), character))
        case .backspace:
            apply(InputActions.backspace(env()))
        case .rebus:
            rebusBuffer = ""
        }
    }

    /// A grid tap through I2a's closure: move the cursor, or toggle direction on
    /// the selected cell; blocks are ignored. Moving away discards an open rebus
    /// entry.
    public func tap(cell: Int) {
        guard let next = InputActions.tap(env(), cell: cell) else { return }
        rebusBuffer = nil
        selection = next
    }

    /// A clue-browser jump (the web's clueClick, via ClueBrowserList.jumpTarget):
    /// land on the given cell with the given axis, unconditionally. Blocks and
    /// out-of-range cells are refused (a malformed clue must not strand the
    /// cursor); an open rebus entry is discarded like every other move-away.
    public func jump(to target: GridSelection) {
        guard target.cell >= 0, target.cell < puzzle.cellCount,
            !puzzle.blocks.contains(target.cell)
        else { return }
        rebusBuffer = nil
        selection = target
    }

    /// A grid swipe: along the solving direction is next/previous word, across it
    /// toggles (root DESIGN.md §5). Discards an open rebus entry.
    public func swipe(_ intent: SwipeIntent) {
        rebusBuffer = nil
        switch intent {
        case .nextWord:
            apply(InputActions.nextWord(env()))
        case .previousWord:
            apply(InputActions.previousWord(env()))
        case .toggleDirection:
            apply(InputActions.toggleDirection(env()))
        }
    }

    // MARK: - Rebus mode

    private func pressInRebusMode(_ key: DeckKey) {
        switch key {
        case .letter(let character):
            guard let buffer = rebusBuffer, buffer.count < Self.rebusGlyphCap,
                let glyph = InputActions.deckValue(String(character))
            else { return }
            rebusBuffer = buffer + glyph
        case .backspace:
            guard let buffer = rebusBuffer, !buffer.isEmpty else {
                rebusBuffer = nil  // backspace on an empty buffer leaves rebus mode
                return
            }
            rebusBuffer = String(buffer.dropLast())
        case .rebus:
            let value = rebusBuffer ?? ""
            rebusBuffer = nil
            guard !value.isEmpty else { return }  // an empty commit just closes
            apply(InputActions.rebus(env(), value))
        }
    }

    // MARK: - Plumbing

    private func env() -> InputEnv {
        InputEnv(
            puzzle: puzzle,
            filled: Set((0..<puzzle.cellCount).filter(isFilled)),
            selection: selection,
            frozen: isFrozen())
    }

    private func apply(_ effect: InputEffect) {
        for mutation in effect.mutations {
            switch mutation {
            case .place(let cell, let value):
                sendPlace(cell, value)
            case .clear(let cell):
                sendClear(cell)
            }
        }
        selection = effect.selection
    }
}
