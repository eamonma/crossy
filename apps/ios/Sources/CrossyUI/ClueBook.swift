// The render-shaped clues: the ClueBook is to clue text what GridPuzzle is to
// geometry, mapped from the solution-stripped ClientPuzzle by the composition root
// (AD-2: CrossyUI never imports CrossyProtocol; INV-6 holds structurally because no
// solution-shaped field exists to map). The derivations below are the clue bar's and
// clue browser's whole vocabulary, pure so tests pin them: the clue under the
// cursor (the web's clueOn), the jump rule (the web's clueClick: the clue's first
// cell, unconditionally, its axis set; interaction semantics never fork), and the
// browser's rows (both directions sectioned, current word pinned at the top,
// filled words quietly de-emphasized, EXPERIENCE.md clue browser).

/// One styled span of a clue's prose, the UI-ring twin of the wire `ClueRun` (the
/// composition root maps CrossyProtocol's runs into these, AD-2: CrossyUI never imports
/// CrossyProtocol). Text plus the styles that wrap it; `ClueTextRuns.attributed` turns a
/// list of these into an `AttributedString` for any surface's font.
public struct ClueTextRun: Sendable, Equatable {
    public let text: String
    public let styles: [ClueTextStyle]

    public init(text: String, styles: [ClueTextStyle] = []) {
        self.text = text
        self.styles = styles
    }
}

/// A clue-prose style. The wire's four strings ("i","b","sub","sup") map here at the
/// composition root; an unknown wire string is dropped (forward compatibility), so this
/// closed set is exactly what the mapper can render.
public enum ClueTextStyle: Sendable, Equatable {
    case italic
    case bold
    case subscript_
    case superscript_

    /// One wire style string to its case, or nil for an unknown string (forward
    /// compatibility: a newer server's style is dropped, never a decode failure). The
    /// composition root maps the wire `ClueRun`'s `s` through this, keeping CrossyUI free
    /// of CrossyProtocol (AD-2) while pinning the drop rule in the tested view ring.
    public init?(wire: String) {
        switch wire {
        case "i": self = .italic
        case "b": self = .bold
        case "sub": self = .subscript_
        case "sup": self = .superscript_
        default: return nil
        }
    }
}

extension ClueTextRun {
    /// A run from a wire run's parts: its text and its raw style strings, unknown strings
    /// dropped (`ClueTextStyle.init(wire:)`). The composition root calls this per run so
    /// the CrossyProtocol-to-CrossyUI translation carries no CrossyProtocol type into this
    /// ring (AD-2), and the unknown-style drop is a pure, tested view-ring function.
    public init(text: String, wireStyles: [String]) {
        self.init(text: text, styles: wireStyles.compactMap(ClueTextStyle.init(wire:)))
    }
}

/// One clue as the room renders it. No answer field on either side of the split.
public struct ClueEntry: Sendable, Equatable, Identifiable {
    public let number: Int
    public let text: String
    /// The word's cells in reading order; the jump target is the first.
    public let cells: [Int]
    public let isAcross: Bool
    /// The styled spelling of `text`, or nil for a plain clue (absent runs, or a puzzle
    /// stored before the clue-formatting wave). When present the runs' text concatenates
    /// to `text` (the server's guarantee), so `text` is always the exact fallback and the
    /// value accessibility, cross-references, and any plain render keep reading.
    public let runs: [ClueTextRun]?

    public init(
        number: Int, text: String, cells: [Int], isAcross: Bool, runs: [ClueTextRun]? = nil
    ) {
        self.number = number
        self.text = text
        self.cells = cells
        self.isAcross = isAcross
        self.runs = runs
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

    /// The entry ids the `current` clue cross-references ("With 2-Down", "17, 20, and
    /// 49 across"), filtered to entries that actually exist in this book and with the
    /// current clue itself excluded (mirror of the web's LiveApp memo, ~L915). The
    /// parser reads intent only; here we keep just the references that land on a real
    /// row, so a self-reference or a reference to a clue this grid lacks never lights
    /// anything. Empty for a nil current or a clue that names no entry.
    public func referencedIds(for current: ClueEntry?) -> Set<String> {
        guard let current else { return [] }
        let existing = Set(across.map(\.id)).union(down.map(\.id))
        var ids: Set<String> = []
        for ref in parseClueRefs(current.text) {
            let id = "\(ref.number)\(ref.isAcross ? "A" : "D")"
            if id != current.id, existing.contains(id) { ids.insert(id) }
        }
        return ids
    }

    /// The union of the referenced entries' cells, for the board's faint tint. Every
    /// cell of every clue the `current` clue references, relative to that selection.
    public func referencedCells(for current: ClueEntry?) -> Set<Int> {
        cells(of: referencedIds(for: current))
    }

    /// The union of cells for a set of entry ids (ClueBook.referencedIds output). Lets
    /// a call site parse once and feed both the browser rows and the board tint from
    /// one id set, so the two can never disagree.
    public func cells(of ids: Set<String>) -> Set<Int> {
        guard !ids.isEmpty else { return [] }
        var cells: Set<Int> = []
        for entry in across + down where ids.contains(entry.id) {
            cells.formUnion(entry.cells)
        }
        return cells
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
        /// The current clue's text names this one ("With 27-Down", "See 42-Across"):
        /// a faint highlight relative to the selection. Never both current and
        /// referenced; current wins.
        public let isReferenced: Bool

        public var id: String { clue.id }

        public init(
            clue: ClueEntry, isCurrent: Bool, isCrossing: Bool, isDimmed: Bool,
            isReferenced: Bool = false
        ) {
            self.clue = clue
            self.isCurrent = isCurrent
            self.isCrossing = isCrossing
            self.isDimmed = isDimmed
            self.isReferenced = isReferenced
        }
    }

    /// A word is filled when every cell of it renders non-null.
    public static func isFilled(_ clue: ClueEntry, filled: Set<Int>) -> Bool {
        !clue.cells.isEmpty && clue.cells.allSatisfy(filled.contains)
    }

    /// One direction's rows against the selection, the rendered fill set, and the ids
    /// the current clue cross-references (ClueBook.referencedIds). A row is never both
    /// current and referenced; current wins.
    public static func rows(
        _ clues: [ClueEntry], selection: GridSelection?, filled: Set<Int>,
        referenced: Set<String> = []
    ) -> [Row] {
        clues.map { clue in
            let onWord = selection.map { clue.cells.contains($0.cell) } ?? false
            let isCurrent = onWord && selection?.isAcross == clue.isAcross
            let isCrossing = onWord && !isCurrent
            let dimmed = !isCurrent && !isCrossing && isFilled(clue, filled: filled)
            let isReferenced = !isCurrent && referenced.contains(clue.id)
            return Row(
                clue: clue, isCurrent: isCurrent, isCrossing: isCrossing, isDimmed: dimmed,
                isReferenced: isReferenced)
        }
    }

    /// The jump for a tapped row (the web's clueClick, verbatim): the clue's first
    /// cell, unconditionally, its axis set. No first-empty scan; that is Tab's rule,
    /// not the pointer's.
    public static func jumpTarget(_ clue: ClueEntry) -> GridSelection {
        GridSelection(cell: clue.cells.first ?? 0, isAcross: clue.isAcross)
    }
}
