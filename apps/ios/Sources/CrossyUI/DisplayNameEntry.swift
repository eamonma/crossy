// The display-name field's honesty, mirroring InviteCodeEntry (the entry-sanitizer
// pattern). The one shared name spec lives in docs/design/name-onboarding.md §5 and is
// pinned by vectors/identity/display-name.json, which BOTH the server validator and this
// client sanitizer run, so the per-keystroke filter here can never drift from the submit
// path or the server. INV-1 (ASCII-only casing) does NOT apply: a name is user content
// shown back verbatim, never uppercased or folded (§5; DESIGN.md lines 115, 262 scope
// INV-1 to cell values). Provider names carry Unicode (a cedilla, Han), and we keep them.
//
// The block-list names only what breaks rendering or spoofs order; everything else, every
// letter/mark/number/symbol/emoji, is allowed. Length is measured in extended grapheme
// clusters (Swift's `String.count`, grapheme-based by default), so a family emoji or a
// flag counts as one and a name is never cut mid-glyph. The client cap is a courtesy: the
// server's grapheme count is authoritative (R7), so a client that counts fewer simply
// sees a server NAME_TOO_LONG, an acceptable degradation.

import Foundation

public enum DisplayNameEntry {
    /// The max grapheme-cluster length, mirroring the server bound (§5). A courtesy cap:
    /// the server count is authoritative (R7).
    public static let maxGraphemes = 40

    /// Per-keystroke edge sanitize: strip disallowed scalars and cap at `maxGraphemes`.
    /// It does NOT trim or collapse internal whitespace, because the field must let a
    /// person type spaces between words and a leading space while they are mid-word; the
    /// server and `canonicalize` do the trim/collapse on submit. NFC is likewise a submit
    /// concern, not a per-keystroke one (composing marks must survive an in-progress
    /// keystroke). So this only removes what no valid name may ever contain and holds the
    /// length. Iterating by `Character` means a ZWJ inside a valid emoji cluster is part
    /// of a multi-scalar grapheme and is kept; a LONE zero-width is its own single-scalar
    /// grapheme and is dropped (the "no lone zero-width outside an emoji cluster" rule).
    public static func sanitize(_ raw: String) -> String {
        var kept: [Character] = []
        for character in raw {
            if isDisallowedGrapheme(character) { continue }
            kept.append(character)
            if kept.count == maxGraphemes { break }
        }
        return String(kept)
    }

    /// Full canonicalize for submit, in the server's order (§5): Unicode NFC, then trim
    /// leading/trailing whitespace, then collapse every internal whitespace run to a
    /// single ASCII space. A name is a label, not a layout.
    ///
    /// The trim and collapse operate on NON-CONTROL whitespace ONLY (regular spaces and
    /// friends), NOT on the control characters tab/newline: those are in the C0 reject set
    /// (a name is one line), so they must survive canonicalization into the value where
    /// `isComplete`'s block-list rejects them, rather than being silently collapsed to a
    /// space and passing. The disallowed-scalar filter is not applied here (canonicalize
    /// matches the server's canonicalize, which validates disallowed scalars separately);
    /// `isComplete` runs the validity check on this value.
    public static func canonicalize(_ raw: String) -> String {
        let normalized = raw.precomposedStringWithCanonicalMapping
        // Trim only collapsible (non-control) whitespace from the ends; a leading tab or
        // newline is not trimmed away, it is kept so validation rejects it.
        let scalars = Array(normalized.unicodeScalars)
        var start = scalars.startIndex
        var end = scalars.endIndex
        while start < end, isCollapsibleWhitespace(scalars[start]) { start += 1 }
        while end > start, isCollapsibleWhitespace(scalars[end - 1]) { end -= 1 }
        let trimmed = String(String.UnicodeScalarView(scalars[start..<end]))
        // Collapse internal runs of collapsible whitespace to one ASCII space. A run of
        // control whitespace is NOT a separator here (control chars are kept for the
        // block-list to reject), so tab/newline survive into the value.
        let pieces = trimmed.split(whereSeparator: isCollapsibleWhitespace)
        return pieces.joined(separator: " ")
    }

    /// Whitespace the canonicalizer trims and collapses: the Unicode White_Space set
    /// MINUS the control characters (C0/C1), which are rejected rather than collapsed
    /// (§5, "a name is one line"). So a regular space, non-breaking space, or ideographic
    /// space collapses; a tab or newline is left in place to be rejected.
    private static func isCollapsibleWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        guard scalar.properties.isWhitespace else { return false }
        let value = scalar.value
        // Exclude C0 controls (includes tab U+0009 and newline U+000A..000D) and C1.
        if value <= 0x001F || (0x007F...0x009F).contains(value) { return false }
        return true
    }

    /// `split(whereSeparator:)` hands over a `Character`; a collapsible-whitespace
    /// character is a single-scalar grapheme whose scalar is collapsible.
    private static func isCollapsibleWhitespace(_ character: Character) -> Bool {
        let scalars = character.unicodeScalars
        guard scalars.count == 1, let scalar = scalars.first else { return false }
        return isCollapsibleWhitespace(scalar)
    }

    /// A name ready to submit (§5 validation on the canonical value): the canonicalized
    /// value is 1...maxGraphemes graphemes and contains no disallowed scalar. Empty after
    /// canonicalization (whitespace-only or all-stripped) is not complete (the server
    /// answers NAME_REQUIRED).
    public static func isComplete(_ raw: String) -> Bool {
        let canonical = canonicalize(raw)
        let count = canonical.count
        guard count >= 1, count <= maxGraphemes else { return false }
        return !canonical.contains(where: isDisallowedGrapheme)
    }

    // MARK: - The block-list (§5)

    /// A grapheme is disallowed when it is a single Unicode scalar in the reject set: a
    /// control char, a lone zero-width/invisible formatter, or a bidi override. A
    /// multi-scalar grapheme (an emoji ZWJ sequence, a combining-mark cluster) is never
    /// disallowed by this check: the zero-width joiner inside a valid emoji cluster is not
    /// "lone", so it passes, exactly as the grapheme segmenter keeps such sequences intact.
    private static func isDisallowedGrapheme(_ character: Character) -> Bool {
        let scalars = character.unicodeScalars
        guard scalars.count == 1, let scalar = scalars.first else { return false }
        return isDisallowedScalar(scalar)
    }

    /// The reject set from §5, as a scalar predicate:
    /// - C0 controls U+0000..U+001F and DEL/C1 controls U+007F..U+009F (includes newline
    ///   and tab; a name is one line).
    /// - Lone zero-width / invisible formatters: ZWSP/ZWNJ/ZWJ U+200B..U+200D, word joiner
    ///   U+2060, BOM U+FEFF.
    /// - Bidi overrides: U+202A..U+202E and U+2066..U+2069 (they spoof visible order).
    /// Plain RTL script (Arabic, Hebrew) is not here; the OS renders it natively.
    private static func isDisallowedScalar(_ scalar: Unicode.Scalar) -> Bool {
        let value = scalar.value
        switch value {
        case 0x0000...0x001F, 0x007F...0x009F:  // C0, DEL + C1 controls
            return true
        case 0x200B...0x200D, 0x2060, 0xFEFF:  // ZWSP/ZWNJ/ZWJ, word joiner, BOM
            return true
        case 0x202A...0x202E, 0x2066...0x2069:  // bidi overrides/isolates
            return true
        default:
            return false
        }
    }
}
