// The per-device typing preferences, persisted in UserDefaults (personal-settings
// slice 1). Client-local and off the wire entirely: these knobs shape only where this
// device's cursor lands after a keystroke, so they never touch the shared board (INV-6
// is unaffected; nothing here is a game mutation). The first local-prefs surface in the
// iOS app, so it sets the convention: an @Observable store over the standard defaults,
// injected once at the app root and read live, so a change in Settings reaches an open
// room without a restart (the store's `prefs` closure is re-read on every keystroke).
//
// The defaults reproduce the pre-slice behavior exactly (skip filled cells, wrap to the
// word's first blank), so a person who never opens Settings sees no change and the
// navigation vectors stay green. AD-2 holds: the store maps to BoardNavigation's plain
// prefs, never to a CrossyEngine type.

import CrossyStore
import Foundation
import Observation

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class NavigationSettingsStore {
    /// The defaults keys. Namespaced so a future prefs surface never collides.
    private enum Key {
        static let skipFilledInWord = "nav.skipFilledInWord"
        static let endOfWordIsNextClue = "nav.endOfWordIsNextClue"
        static let swipeSensitivity = "input.swipeSensitivity"
    }

    @ObservationIgnored private let defaults: UserDefaults

    /// On (the NYT default, and the pre-slice iOS behavior): typing advances past
    /// already-filled cells to the next blank inside the word. Off: advance to the
    /// immediately next cell of the word regardless of fill.
    public var skipFilledInWord: Bool {
        didSet { defaults.set(skipFilledInWord, forKey: Key.skipFilledInWord) }
    }

    /// True selects "move to the next clue" the moment the word fills; false (the
    /// pre-slice default) keeps the wrap-to-first-blank behavior. Stored as the boolean
    /// the picker toggles, mapped to `EndOfWord` at the boundary.
    public var endOfWordIsNextClue: Bool {
        didSet { defaults.set(endOfWordIsNextClue, forKey: Key.endOfWordIsNextClue) }
    }

    /// How readily a swipe on the grid turns the page (root DESIGN.md §5): Relaxed
    /// accepts shorter, looser swipes, Precise waits for a deliberate one. Standard is
    /// the pre-preference behavior. Stored as the raw case string, mapped to the pure
    /// SwipeTuning at the board's boundary (`swipeTuning`).
    public var swipeSensitivity: SwipeSensitivity {
        didSet { defaults.set(swipeSensitivity.rawValue, forKey: Key.swipeSensitivity) }
    }

    /// Reads any persisted values, else the pre-slice defaults. `UserDefaults.bool`
    /// returns false for an absent key, so an unset device reads `skipFilledInWord`
    /// false by mistake; the presence check restores the true default explicitly.
    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.skipFilledInWord =
            defaults.object(forKey: Key.skipFilledInWord) as? Bool ?? true
        self.endOfWordIsNextClue = defaults.bool(forKey: Key.endOfWordIsNextClue)
        // Absent (an unset device) or an unrecognized string both resolve to the
        // standard preset, the pre-preference behavior; only a stored, recognized
        // case moves off it.
        self.swipeSensitivity =
            (defaults.string(forKey: Key.swipeSensitivity)).flatMap(SwipeSensitivity.init)
            ?? .standard
    }

    /// The store's prefs re-expressed for the navigation layer (BoardNavigation owns the
    /// plain type; AD-2 keeps the engine's out of these upper layers).
    public var navigationPrefs: BoardNavigation.NavigationPrefs {
        BoardNavigation.NavigationPrefs(
            skipFilledInWord: skipFilledInWord,
            endOfWord: endOfWordIsNextClue ? .nextClue : .firstBlank)
    }

    /// The stored preference resolved to the board's swipe thresholds, the one bridge
    /// SolveScreen reads into CrossyGridView (the navigationPrefs pattern for the grid's
    /// gesture layer).
    public var swipeTuning: SwipeTuning { swipeSensitivity.tuning }
}
