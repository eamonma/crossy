// Pure reference parser: given a clue's prose, find the entries it points at, like
// "See 42-Down" or "17, 20, 49, and 59 across". Parse only. It never checks whether a
// referenced entry exists; the call site filters against the puzzle's real clue list, so
// this stays a string-to-pairs function with no puzzle knowledge and no IO.
//
// The hard part is the distributed list: one trailing direction word governs every number
// before it ("5 and 12 down" is 5-Down and 12-Down). We scan for maximal runs of
// number-then-connector that close on a direction word, then read every number out of the
// run and pair each with that word. A direction word ends its run, so "17-Across and 3-Down"
// splits into two runs and yields one entry per axis.
//
// The starred-clue convention is the second kind of reference (D26). A theme clue opens with a
// literal `*` and a revealer names the whole set collectively ("...the starred clues"), so the
// pair at the bottom is a predicate on the clue and a predicate on the prose, not a parse: a
// starred ref carries no number and no direction to read out. ClueBook.referencedIds resolves
// both kinds into one id set, so they union and paint the same tier.
//
// The normative twin is apps/web/src/ui/clueRefs.ts and apps/web/src/ui/clueRefs.test.ts: 19
// cases for the parser, plus the starred-clue grammar. Same pattern strings, ported to
// NSRegularExpression: the ICU engine backs the `(?<![0-9])` lookbehinds, where Swift-native
// Regex literals carry them only from a floor newer than we deploy to. The starred patterns
// need no lookbehind, so they port straight across.

import Foundation

/// A (number, isAcross) pair a clue's text references. The web's ClueRef carries a
/// `Direction` string; here the axis is a Bool to match ClueEntry and GridSelection.
public struct ClueRef: Equatable, Sendable {
    public let number: Int
    public let isAcross: Bool

    public init(number: Int, isAcross: Bool) {
        self.number = number
        self.isAcross = isAcross
    }
}

// One run: some numbers joined by list connectors (comma, "and", "&", hyphen, whitespace, in
// any run), closed by a direction word. The connector before the direction word is a hyphen or
// spaces ("17-Across", "17 Across"); requiring [\s-]+ there keeps "12down" glued prose out. The
// trailing \b stops "Downtown" or "Rundown" from reading as a direction. Case-insensitive per
// the direction-word requirement.
//
// [0-9]{1,3} caps a number at three digits (clue numbers never run longer), and the (?<![0-9])
// guard forbids a preceding digit, so a four-digit year ("in 1999") can never donate its last
// three digits to a run. Together they reject years and enumerations that carry no direction.
private let runPattern =
    "(?<![0-9])([0-9]{1,3}(?:(?:\\s*(?:,|&|-|and|\\s)\\s*)+(?<![0-9])[0-9]{1,3})*)[\\s-]+(across|down)\\b"

// The numbers inside a run, read left to right. Same three-digit cap and leading-digit guard
// as the run pattern so the two never disagree on what counts as one number.
private let numberPattern = "(?<![0-9])[0-9]{1,3}"

// Compiled once; the patterns are literals, so the force-unwrap is a construction-time
// invariant, not a runtime possibility. `.caseInsensitive` mirrors the web's `i` flag.
private let runRegex = try! NSRegularExpression(
    pattern: runPattern, options: [.caseInsensitive])
private let numberRegex = try! NSRegularExpression(pattern: numberPattern)

/// The (number, isAcross) pairs a clue's text references, in reading order, duplicates kept.
/// Returns [] when the text is empty or names no entry. A bare number, a year, or an
/// enumeration like "(17)" carries no direction word, so none of them produce a pair.
public func parseClueRefs(_ text: String?) -> [ClueRef] {
    guard let text, !text.isEmpty else { return [] }

    var refs: [ClueRef] = []
    let full = NSRange(text.startIndex..<text.endIndex, in: text)
    for run in runRegex.matches(in: text, range: full) {
        // Both groups are required by the run pattern, so a match always carries them; the
        // guards only satisfy the range-to-substring conversion.
        guard let numbersRange = Range(run.range(at: 1), in: text),
            let dirRange = Range(run.range(at: 2), in: text)
        else { continue }
        let numbers = String(text[numbersRange])
        let isAcross = text[dirRange].lowercased() == "across"
        let numbersNS = NSRange(numbers.startIndex..<numbers.endIndex, in: numbers)
        for num in numberRegex.matches(in: numbers, range: numbersNS) {
            guard let r = Range(num.range, in: numbers), let n = Int(numbers[r]) else { continue }
            refs.append(ClueRef(number: n, isAcross: isAcross))
        }
    }
    return refs
}

// A revealer naming the starred set. The noun is required: "starred" alone is ordinary prose
// ("Starred in a movie"), and only the adjacent noun separates the convention from the verb. The
// asymmetry is why this is biased hard toward precision: a missed revealer degrades to no
// highlight, while a false one paints roughly a quarter of the grid. [\s-]+ is the same connector
// idiom the run pattern uses, so a hyphenated "starred-clue" reads like "17-Across" does.
// Case-insensitive: the revealer opens a sentence as often as not.
private let starredPattern =
    "\\b(?:starred|asterisked)[\\s-]+(?:clues?|answers?|entries|entry|squares?)\\b"

// The convention's mark: a literal `*` opening the clue, leading whitespace tolerated. PROTOCOL
// section 12 law 11 carries the star through ingestion verbatim, so plain `text` is the whole
// story here. Read `text`, never `runs`: the runs concatenate to `text` (law 1), so a star split
// into its own styled run still shows up at the front of `text`.
private let starredMarkPattern = "^\\s*\\*"

// Compiled once, like the run patterns above. `.caseInsensitive` on the revealer only; the mark
// is punctuation, so case does not arise.
private let starredRegex = try! NSRegularExpression(
    pattern: starredPattern, options: [.caseInsensitive])
private let starredMarkRegex = try! NSRegularExpression(pattern: starredMarkPattern)

// Whether a pattern hits anywhere in a string. NSRegularExpression works in NSRange, so the
// conversion is the whole body.
private func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
    regex.firstMatch(in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)) != nil
}

/// Whether a clue wears the starred-clue convention, meaning its prose opens with a literal `*`.
/// The web's twin also answers false for a clue carrying no text at all; `ClueEntry.text` is a
/// non-optional String here, so that case has no Swift analogue and an empty string simply fails
/// to match.
public func isStarredClue(_ clue: ClueEntry) -> Bool {
    matches(starredMarkRegex, clue.text)
}

/// Whether a clue's text is a revealer, meaning it names the starred clues collectively. The link
/// is one-way by ruling (D26): this answers "does this prose name the starred set?", and a starred
/// clue's own prose names nothing, so a starred clue is never a revealer by virtue of its star.
/// Returns false for empty or absent text.
public func referencesStarredClues(_ text: String?) -> Bool {
    guard let text else { return false }
    return matches(starredRegex, text)
}
