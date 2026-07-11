// The render-shaped clues: the ClueBook is to clue text what GridPuzzle is to
// geometry, mapped from the solution-stripped ClientPuzzle by the composition root
// (AD-2: CrossyUI never imports CrossyProtocol; INV-6 holds structurally because no
// solution-shaped field exists to map). The derivations below are the clue bar's and
// clue browser's whole vocabulary, pure so tests pin them: the clue under the
// cursor (the web's clueOn), the jump rule (the web's clueClick: the clue's first
// cell, unconditionally, its axis set; interaction semantics never fork), and the
// browser's rows (both directions sectioned, current word pinned at the top,
// filled words quietly de-emphasized, EXPERIENCE.md clue browser).

/// One clue as the room renders it. No answer field on either side of the split.
public struct ClueEntry: Sendable, Equatable, Identifiable {
    public let number: Int
    public let text: String
    /// The word's cells in reading order; the jump target is the first.
    public let cells: [Int]
    public let isAcross: Bool

    public init(number: Int, text: String, cells: [Int], isAcross: Bool) {
        self.number = number
        self.text = text
        self.cells = cells
        self.isAcross = isAcross
    }

    /// Stable identity across the two axes ("12A" / "12D").
    public var id: String { "\(number)\(isAcross ? "A" : "D")" }

    /// The uppercase direction label chip ("12A" in the gutter, DESIGN.md §6).
    public var tag: String { id }
}

/// Both directions' clues, in puzzle order.
public struct ClueBook: Sendable, Equatable {
    public let across: [ClueEntry]
    public let down: [ClueEntry]

    public init(across: [ClueEntry], down: [ClueEntry]) {
        self.across = across
        self.down = down
    }

    public static let empty = ClueBook(across: [], down: [])

    /// The clue containing `cell` on one axis (the web's clueOn), nil off-word.
    public func clue(at cell: Int, isAcross: Bool) -> ClueEntry? {
        (isAcross ? across : down).first { $0.cells.contains(cell) }
    }

    /// The clue the bar shows for a selection: the word under the cursor on the
    /// solving axis.
    public func current(for selection: GridSelection?) -> ClueEntry? {
        guard let selection else { return nil }
        return clue(at: selection.cell, isAcross: selection.isAcross)
    }
}

/// The browser's list, derived per render: sections, the pinned current word, and
/// the de-emphasis facts, all data so the view stays a pure function of it.
public enum ClueBrowserList {
    /// One row's render facts.
    public struct Row: Sendable, Equatable, Identifiable {
        public let clue: ClueEntry
        /// The word under the cursor on the solving axis: the pinned row's twin
        /// inside its section, emphasized, never de-emphasized.
        public let isCurrent: Bool
        /// The word through the cursor on the crossing axis, quietly marked (the
        /// web's crossing-row treatment).
        public let isCrossing: Bool
        /// Every cell renders non-null (INV-10 composite): quietly de-emphasized,
        /// unless it is the current or crossing word, which never dim.
        public let isDimmed: Bool

        public var id: String { clue.id }

        public init(clue: ClueEntry, isCurrent: Bool, isCrossing: Bool, isDimmed: Bool) {
            self.clue = clue
            self.isCurrent = isCurrent
            self.isCrossing = isCrossing
            self.isDimmed = isDimmed
        }
    }

    /// A word is filled when every cell of it renders non-null.
    public static func isFilled(_ clue: ClueEntry, filled: Set<Int>) -> Bool {
        !clue.cells.isEmpty && clue.cells.allSatisfy(filled.contains)
    }

    /// One direction's rows against the selection and the rendered fill set.
    public static func rows(
        _ clues: [ClueEntry], selection: GridSelection?, filled: Set<Int>
    ) -> [Row] {
        clues.map { clue in
            let onWord = selection.map { clue.cells.contains($0.cell) } ?? false
            let isCurrent = onWord && selection?.isAcross == clue.isAcross
            let isCrossing = onWord && !isCurrent
            let dimmed = !isCurrent && !isCrossing && isFilled(clue, filled: filled)
            return Row(clue: clue, isCurrent: isCurrent, isCrossing: isCrossing, isDimmed: dimmed)
        }
    }

    /// The jump for a tapped row (the web's clueClick, verbatim): the clue's first
    /// cell, unconditionally, its axis set. No first-empty scan; that is Tab's rule,
    /// not the pointer's.
    public static func jumpTarget(_ clue: ClueEntry) -> GridSelection {
        GridSelection(cell: clue.cells.first ?? 0, isAcross: clue.isAcross)
    }
}
