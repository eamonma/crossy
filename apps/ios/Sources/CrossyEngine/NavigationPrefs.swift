// The per-device navigation preferences the typing advance reads as data (INV-9: the
// engine takes no ambient config; a preference arrives in the call, never from a global).
// These are the NYT-style knobs personal-settings slice 1 exposes; the persistence and
// the settings UI live in the app layers, and only the resolved value reaches here.
//
// The defaults reproduce the iOS app's behavior before this slice exactly, so a person
// who never opens Settings sees zero change and the navigation vectors stay green: skip
// filled cells inside the word, and at the word's end wrap to its first blank (DESIGN §5,
// vectors/v1/navigation/typing-advance.json). The four-argument `typingAdvance` overload
// is the default-prefs call the vectors pin; the five-argument overload takes an explicit
// preference and is what the input layer drives from the person's chosen settings.

/// What to do on reaching the end of a word while typing (personal-settings slice 1).
public enum EndOfWordBehavior: Sendable, Equatable {
    /// The iOS default before this slice: wrap back to the word's first blank when the
    /// word is incomplete, else stay on the word's last cell. Preserves the vectored rule
    /// (full-word-asymmetry.json: typing the last cell of a full word stays on it).
    case firstBlank
    /// Advance to the next clue in the Tab traversal order the moment the word fills,
    /// never wrapping back within the word (the NYT "next clue" style).
    case nextClue
}

/// The navigation preferences a person can set per device. `skipFilledInWord` on (the
/// NYT default) advances over already-filled cells to the next blank inside the word;
/// off advances to the immediately next cell regardless of fill.
public struct NavigationPrefs: Sendable, Equatable {
    public let skipFilledInWord: Bool
    public let endOfWord: EndOfWordBehavior

    public init(skipFilledInWord: Bool, endOfWord: EndOfWordBehavior) {
        self.skipFilledInWord = skipFilledInWord
        self.endOfWord = endOfWord
    }

    /// The pre-slice iOS behavior, and the value the four-argument `typingAdvance` uses:
    /// skip filled cells, and wrap to the word's first blank at its end.
    public static let `default` = NavigationPrefs(
        skipFilledInWord: true, endOfWord: .firstBlank)
}
