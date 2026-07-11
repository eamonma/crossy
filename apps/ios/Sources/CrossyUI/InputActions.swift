// The input map as pure transforms: environment plus intent in, next selection plus
// mutations out, the Swift twin of apps/web/src/input/actions.ts (Wave 2.1d). Every
// cursor move goes through BoardNavigation, the store ring's facade over
// CrossyEngine's navigation ops (AD-2 keeps the engine out of CrossyUI's imports),
// so the input layer cannot drift from the navigation vectors; the parity pins live
// in Tests/CrossyUITests. Mutations are intents for the store's command path
// (GameStore.placeLetter / clearCell); nothing here touches a store.

import CrossyStore

/// A board mutation the input layer wants sent through the store's command path.
public enum GridMutation: Equatable, Sendable {
    case place(cell: Int, value: String)
    case clear(cell: Int)
}

/// One intent's outcome: where the cursor goes and what (if anything) hits the wire.
public struct InputEffect: Equatable, Sendable {
    public let selection: GridSelection
    public let mutations: [GridMutation]

    public init(selection: GridSelection, mutations: [GridMutation] = []) {
        self.selection = selection
        self.mutations = mutations
    }
}

/// Everything an input transform reads: geometry, the INV-10 rendered fill set
/// (sequenced state painted with the overlay), the cursor, and the terminal freeze.
public struct InputEnv: Sendable {
    public let geometry: BoardNavigation.Geometry
    /// Cells currently rendering non-null (GameStore.renderValue, INV-10).
    public let filled: Set<Int>
    public let selection: GridSelection
    /// True after completed or abandoned: navigation stays live, mutation freezes
    /// locally and never reaches the wire (the web twin's frozen rule).
    public let frozen: Bool

    public init(
        puzzle: GridPuzzle, filled: Set<Int>, selection: GridSelection, frozen: Bool
    ) {
        self.geometry = BoardNavigation.Geometry(
            cols: puzzle.cols, rows: puzzle.rows, blocks: puzzle.blocks)
        self.filled = filled
        self.selection = selection
        self.frozen = frozen
    }
}

public enum InputActions {
    /// The initial position: first playable cell, direction across (DESIGN.md §5),
    /// via the engine's clamp exactly as the web's `initialSelection`.
    public static func initialSelection(_ puzzle: GridPuzzle) -> GridSelection {
        let geometry = BoardNavigation.Geometry(
            cols: puzzle.cols, rows: puzzle.rows, blocks: puzzle.blocks)
        return GridSelection(cell: BoardNavigation.initialCell(geometry), isAcross: true)
    }

    /// A letter key: place at the cursor and advance by the typing op, filled-skip
    /// inside the word against the board after this keystroke (typing-advance.json,
    /// full-word-asymmetry.json). Accepts ASCII A-Z (the deck's alphabet), folding
    /// lowercase; anything else is a no-op. Frozen refuses the mutation and holds.
    public static func letter(_ env: InputEnv, _ character: Character) -> InputEffect {
        guard let value = deckValue(String(character)) else { return refused(env) }
        return place(env, value)
    }

    /// A rebus commit: the whole multi-glyph value lands as one command through the
    /// same path as a letter, and the cursor advances by the same typing op
    /// (EXPERIENCE.md baseline rebus; charset and length per PROTOCOL.md §3).
    public static func rebus(_ env: InputEnv, _ value: String) -> InputEffect {
        guard let value = deckValue(value) else { return refused(env) }
        return place(env, value)
    }

    /// Backspace: a non-empty cursor clears in place and stays; an already-empty one
    /// steps back per the vectored rule and clears where it lands, skipping the wire
    /// no-op when the landing cell is already empty (backspace-step-back.json; the
    /// web twin's rule). Frozen refuses the mutation and holds.
    public static func backspace(_ env: InputEnv) -> InputEffect {
        if env.frozen { return refused(env) }
        let target = BoardNavigation.backspaceTarget(
            env.geometry, isAcross: env.selection.isAcross, from: env.selection.cell,
            filled: env.filled)
        return InputEffect(
            selection: GridSelection(cell: target, isAcross: env.selection.isAcross),
            mutations: env.filled.contains(target) ? [.clear(cell: target)] : [])
    }

    /// Next word: Tab over the circular clue cycle, full clues skipped, axis
    /// crossing included (PR #30; next-word.json). On touch this is the swipe along
    /// the solving direction (root DESIGN.md §5).
    public static func nextWord(_ env: InputEnv) -> InputEffect {
        tab(env, forward: true)
    }

    /// Previous word: Shift+Tab over the same cycle (previous-word.json); the swipe
    /// against the solving direction.
    public static func previousWord(_ env: InputEnv) -> InputEffect {
        tab(env, forward: false)
    }

    /// Toggle the solving axis in place: the swipe across the solving direction
    /// (root DESIGN.md §5). Pure selection change, never a mutation.
    public static func toggleDirection(_ env: InputEnv) -> InputEffect {
        InputEffect(
            selection: GridSelection(
                cell: env.selection.cell, isAcross: !env.selection.isAcross))
    }

    /// The pointer paths (web `cellClick`, v2 verbatim): a playable non-current cell
    /// moves the cursor and keeps direction; the current cell toggles direction; a
    /// block returns nil. Taps never mutate, so they stay live after a terminal
    /// state.
    public static func tap(_ env: InputEnv, cell: Int) -> GridSelection? {
        guard cell >= 0, cell < env.geometry.cols * env.geometry.rows,
            !env.geometry.blocks.contains(cell)
        else { return nil }
        if cell == env.selection.cell {
            return GridSelection(cell: cell, isAcross: !env.selection.isAcross)
        }
        return GridSelection(cell: cell, isAcross: env.selection.isAcross)
    }

    // MARK: - Shared paths

    private static func tab(_ env: InputEnv, forward: Bool) -> InputEffect {
        let target = BoardNavigation.tabTarget(
            env.geometry, isAcross: env.selection.isAcross, from: env.selection.cell,
            forward: forward, filled: env.filled)
        return InputEffect(
            selection: GridSelection(cell: target.cell, isAcross: target.isAcross))
    }

    private static func place(_ env: InputEnv, _ value: String) -> InputEffect {
        if env.frozen { return refused(env) }
        var filledAfter = env.filled
        filledAfter.insert(env.selection.cell)
        let next = BoardNavigation.typingAdvance(
            env.geometry, isAcross: env.selection.isAcross, from: env.selection.cell,
            filled: filledAfter)
        return InputEffect(
            selection: GridSelection(cell: next, isAcross: env.selection.isAcross),
            mutations: [.place(cell: env.selection.cell, value: value)])
    }

    /// A handled intent that does nothing: the frozen-mutation refusal.
    private static func refused(_ env: InputEnv) -> InputEffect {
        InputEffect(selection: env.selection)
    }

    /// Normalize a deck-entered value: ASCII-only uppercase fold (INV-1), then
    /// validate against the wire charset `A-Z0-9`, length 1 to 10 (PROTOCOL.md §3).
    /// The deck offers letters only; digits pass for parity with the value charset.
    static func deckValue(_ raw: String) -> String? {
        let bytes = raw.utf8.map { $0 >= 0x61 && $0 <= 0x7A ? $0 - 0x20 : $0 }
        guard bytes.count >= 1, bytes.count <= 10 else { return nil }
        for byte in bytes {
            let isUpper = byte >= 0x41 && byte <= 0x5A
            let isDigit = byte >= 0x30 && byte <= 0x39
            if !(isUpper || isDigit) { return nil }
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
