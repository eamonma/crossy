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
// The normative twin is apps/web/src/ui/clueRefs.ts and its 19 test cases in
// apps/web/src/ui/clueRefs.test.ts. Same pattern strings, ported to NSRegularExpression:
// the ICU engine backs the `(?<![0-9])` lookbehinds, where Swift-native Regex literals
// carry them only from a floor newer than we deploy to.

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
