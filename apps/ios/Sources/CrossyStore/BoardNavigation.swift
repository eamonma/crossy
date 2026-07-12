// Cursor navigation on the store ring. ARCHITECTURE.md §3 has the store calling the
// engine synchronously for navigation, and AD-2 keeps CrossyEngine out of CrossyUI's
// imports, so this facade is the declared surface the input layer (roadmap I2b)
// drives navigation through. Type mapping only: every rule lives in CrossyEngine
// where the navigation vectors pin it (PROTOCOL.md §13, DESIGN.md §5), and nothing
// here restates one. The web twin of the caller is apps/web/src/input/actions.ts,
// which imports the engine directly; the extra hop here is the AD-2 layering cost.

import CrossyEngine

public enum BoardNavigation {
    /// Grid geometry in plain values, the engine's `Grid` re-expressed so callers
    /// above the store never name an engine type.
    public struct Geometry: Sendable, Equatable {
        public let cols: Int
        public let rows: Int
        public let blocks: Set<Int>

        public init(cols: Int, rows: Int, blocks: Set<Int>) {
            self.cols = cols
            self.rows = rows
            self.blocks = blocks
        }

        var grid: Grid { Grid(cols: cols, rows: rows, blocks: blocks) }
    }

    /// The end-of-word behavior in plain values, the engine's `EndOfWordBehavior`
    /// re-expressed so the input layer (roadmap I2b) never names an engine type (AD-2).
    public enum EndOfWord: Sendable, Equatable {
        case firstBlank
        case nextClue

        var engine: EndOfWordBehavior {
            switch self {
            case .firstBlank: return .firstBlank
            case .nextClue: return .nextClue
            }
        }
    }

    /// The navigation preferences re-expressed for callers above the store, the engine's
    /// `NavigationPrefs` in plain values (the `Geometry` pattern). `.default` reproduces
    /// the pre-slice iOS behavior exactly, so an unset device sees zero change.
    public struct NavigationPrefs: Sendable, Equatable {
        public let skipFilledInWord: Bool
        public let endOfWord: EndOfWord

        public init(skipFilledInWord: Bool, endOfWord: EndOfWord) {
            self.skipFilledInWord = skipFilledInWord
            self.endOfWord = endOfWord
        }

        public static let `default` = NavigationPrefs(
            skipFilledInWord: true, endOfWord: .firstBlank)

        var engine: CrossyEngine.NavigationPrefs {
            CrossyEngine.NavigationPrefs(
                skipFilledInWord: skipFilledInWord, endOfWord: endOfWord.engine)
        }
    }

    private static func direction(_ isAcross: Bool) -> Direction {
        isAcross ? .across : .down
    }

    private static func toward(_ forward: Bool) -> Toward {
        forward ? .forward : .backward
    }

    /// The initial cursor position: first playable cell (DESIGN.md §5), computed as
    /// the engine's out-of-range clamp exactly as the web's `initialSelection` does,
    /// so the rule is never restated.
    public static func initialCell(_ geometry: Geometry) -> Int {
        CrossyEngine.getNextCell(geometry.grid, .across, -1, .forward)
    }

    /// Single-cell advance with block-skip (the seed's getNextCell; the
    /// single-cell-advance vectors).
    public static func step(
        _ geometry: Geometry, isAcross: Bool, from: Int, forward: Bool,
        canEscapeWord: Bool = true
    ) -> Int {
        CrossyEngine.getNextCell(
            geometry.grid, direction(isAcross), from, toward(forward),
            canEscapeWord: canEscapeWord)
    }

    /// The cursor move after a letter lands at `from`, with `filled` the board after
    /// that keystroke (the typing-advance and full-word-asymmetry vectors). Default
    /// prefs; keeps the solving axis.
    public static func typingAdvance(
        _ geometry: Geometry, isAcross: Bool, from: Int, filled: Set<Int>
    ) -> Int {
        CrossyEngine.typingAdvance(geometry.grid, direction(isAcross), from, filled)
    }

    /// The pref-aware typing advance (personal-settings slice 1): the person's chosen
    /// skip-filled and end-of-word behavior arrives as `prefs` data. `.nextClue` may
    /// cross the across/down axis, so this returns the landing axis alongside the cell.
    public static func typingAdvance(
        _ geometry: Geometry, isAcross: Bool, from: Int, filled: Set<Int>,
        prefs: NavigationPrefs
    ) -> (cell: Int, isAcross: Bool) {
        let target = CrossyEngine.typingAdvance(
            geometry.grid, direction(isAcross), from, filled, prefs.engine)
        return (target.cell, target.direction == .across)
    }

    /// The cursor move on Backspace (the backspace-step-back vectors).
    public static func backspaceTarget(
        _ geometry: Geometry, isAcross: Bool, from: Int, filled: Set<Int>
    ) -> Int {
        CrossyEngine.backspaceTarget(geometry.grid, direction(isAcross), from, filled)
    }

    /// Tab and Shift+Tab over the circular clue cycle, axis crossing included
    /// (PR #30 semantics; the next-word / previous-word / full-word-asymmetry
    /// vectors).
    public static func tabTarget(
        _ geometry: Geometry, isAcross: Bool, from: Int, forward: Bool,
        filled: Set<Int>
    ) -> (cell: Int, isAcross: Bool) {
        let target = CrossyEngine.tabTarget(
            geometry.grid, direction(isAcross), from, toward(forward), filled)
        return (target.cell, target.direction == .across)
    }
}
