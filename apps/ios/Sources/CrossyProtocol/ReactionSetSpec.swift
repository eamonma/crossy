// The personal reaction set spec (PROTOCOL.md §9, §12; DESIGN.md D25): the Swift twin
// of the API's authoritative validate path (apps/api/src/identity/reaction-set.ts). A
// reaction set is the five emoji a client's send surface offers; `PATCH /me` writes it,
// null resets to the defaults, and the API is the single writer of the column (INV-7).
// This mirror exists so the Settings editor can gate input at the edge and name the
// same rule the server would; the server's named 422s remain the authority the UI
// surfaces when the two ever disagree.
//
// Deliberately Foundation-free (Unicode.Scalar.Properties is stdlib), so the whole
// spec is provable on any Swift toolchain, Linux included. The set is byte-exact,
// never normalized: distinctness compares the exact grapheme strings, so two entries
// that render alike but differ in code points (a variation selector, a skin-tone
// modifier) are distinct (§12).
//
// THE EMOJI HEURISTIC VS THE SERVER'S RGI RULE. The server matches
// `/^\p{RGI_Emoji}$/v`; Swift has no RGI_Emoji property (that set is data, the RGI
// sequence list, not a scalar property), so `isReactionEmoji` approximates it from the
// scalar properties UTS #51 builds the set from. What it checks, per grapheme:
//
//   accepted, matching the server:
//     - a single emoji-presentation scalar (🔥, 😭, and lone components like 🏽,
//       which Emoji_Presentation puts inside Basic_Emoji on the server too)
//     - an emoji scalar completed by VS16 (♥️, ©️; bare ♥ and © are rejected on
//       both sides)
//     - an RGI-shaped keycap (digit/#/* + VS16 + U+20E3; the VS16-less form fails
//       on both sides)
//     - a modifier base wearing one skin tone (👍🏽)
//     - a two-regional-indicator flag (🇨🇦)
//     - a U+1F3F4 tag sequence ending in CANCEL TAG (🏴󠁧󠁢󠁳󠁣󠁴󠁿)
//     - ZWJ chains of the above (❤️‍🔥, 👨‍👩‍👧‍👦), within the 32-byte bound
//
//   accepted here but 422 REACTION_SET_INVALID on the server (the divergence, all
//   "well-formed but not on the RGI list" shapes; the UI treats the server as final):
//     - non-RGI ZWJ chains (🐐‍🔥): any chain of valid elements passes here, only
//       the curated RGI list passes there
//     - non-RGI flag pairs (🇦🇦): any RI pair passes here, only real regions there
//     - non-RGI tag sequences on 🏴: any well-formed tag spelling passes here, only
//       England/Scotland/Wales there
//
//   rejected here, nothing the server accepts is rejected beyond these:
//     - letters, digits, punctuation, whitespace, and any multi-grapheme string
//     - text-presentation forms (♥, ☂︎ with VS15), out-of-order or dangling
//       modifiers, a trailing ZWJ, three-plus regional indicators (two graphemes
//       anyway), and anything over 32 UTF-8 bytes (the §9 shape bound; the longest
//       multi-person ZWJ sequences fall here on both sides)

/// The named domain rejections, raw values the stable §12 wire codes (the NAME_* style;
/// twin of `ReactionSetError` in apps/api/src/identity/reaction-set.ts). All 422.
public enum ReactionSetError: String, Sendable, Equatable, CaseIterable {
    /// The set is not exactly five entries.
    case length = "REACTION_SET_LENGTH"
    /// An entry is not one emoji grapheme within 32 UTF-8 bytes.
    case invalid = "REACTION_SET_INVALID"
    /// A repeated entry (distinctness compares the exact grapheme string).
    case duplicate = "REACTION_SET_DUPLICATE"
}

public enum ReactionSetSpec {
    /// Exactly five slots (PROTOCOL.md §9: the personal set is five emoji in slot order).
    public static let size = 5

    /// The §9 send-gate byte bound: one emoji is at most 32 UTF-8 bytes. The same shape
    /// bound the wire codec enforces (Messages.swift), reproduced because the /me set
    /// rule is a distinct policy path (the codec enforces shape only, never emoji-ness).
    public static let maxUTF8Bytes = 32

    /// The default personal set, exactly these five graphemes in slot order
    /// (PROTOCOL.md §9; D25, owner ruling 2026-07-14). A null `reactionSet` on `/me`
    /// means these; the Phase 7 fixed set (🎉 🤔 👀 💀 🫡) is retired.
    public static let defaultSet: [String] = ["🔥", "🤔", "🐐", "💀", "😭"]

    /// True iff `candidate` is one sendable reaction emoji: exactly one grapheme
    /// cluster, at most 32 UTF-8 bytes, and emoji-presented per the header's heuristic
    /// (the §9 send-gate rule as closely as scalar properties can state it). The byte
    /// bound runs first so a pathological long input never reaches grapheme analysis,
    /// the server's own ordering.
    public static func isReactionEmoji(_ candidate: String) -> Bool {
        guard candidate.utf8.count <= maxUTF8Bytes else { return false }
        guard candidate.count == 1, let character = candidate.first else { return false }
        return isEmojiPresentation(character)
    }

    /// Validate a whole `reactionSet` patch value, the server's checks in the server's
    /// order (length, then per-entry shape, then distinctness), so the first named error
    /// a person sees locally is the one the server would name. nil input is valid (null
    /// resets to the defaults); nil out means the set passes.
    public static func validate(_ set: [String]?) -> ReactionSetError? {
        guard let set else { return nil }
        guard set.count == size else { return .length }
        for entry in set where !isReactionEmoji(entry) {
            return .invalid
        }
        guard Set(set).count == set.count else { return .duplicate }
        return nil
    }

    // MARK: - The heuristic's parts (internal for the spec tests)

    /// One grapheme cluster, judged emoji-presented per the header's contract.
    static func isEmojiPresentation(_ character: Character) -> Bool {
        let scalars = Array(character.unicodeScalars)
        guard let first = scalars.first else { return false }

        // An emoji flag: exactly two regional indicators. (Three RIs are two graphemes
        // and never reach here; an RI followed by anything else is malformed.)
        if isRegionalIndicator(first) {
            return scalars.count == 2 && isRegionalIndicator(scalars[1])
        }

        // A tag sequence (the subdivision flags): the U+1F3F4 base, then tag scalars
        // ending in CANCEL TAG. Tags are legal nowhere else.
        if scalars.dropFirst().contains(where: isTag) {
            guard first.value == 0x1F3F4 else { return false }
            let tags = scalars.dropFirst()
            return tags.count >= 2 && tags.allSatisfy(isTag) && tags.last?.value == 0xE007F
        }

        // Everything else: split on ZWJ; every segment must stand as one
        // emoji-presented element. A trailing ZWJ leaves an empty final segment,
        // which fails (matching the server: a dangling joiner is not one emoji).
        var segment: [Unicode.Scalar] = []
        for scalar in scalars {
            if scalar.value == 0x200D {
                guard isEmojiElement(segment) else { return false }
                segment = []
            } else {
                segment.append(scalar)
            }
        }
        return isEmojiElement(segment)
    }

    /// One ZWJ-free element: an emoji base scalar, optionally completed by exactly one
    /// of VS16 (with an optional combining keycap after it, the RGI keycap shape) or a
    /// skin tone on a modifier base. The element must end up emoji-PRESENTED: a base
    /// whose default is text (♥, ©, a bare digit) passes only with its VS16.
    static func isEmojiElement(_ scalars: [Unicode.Scalar]) -> Bool {
        guard let base = scalars.first, base.properties.isEmoji else { return false }
        var presented = base.properties.isEmojiPresentation
        var rest = scalars.dropFirst()

        if let next = rest.first {
            if next.value == 0xFE0F {
                presented = true
                rest = rest.dropFirst()
                // The keycap rides only a VS16-presented base: digit + VS16 + U+20E3
                // (the RGI shape; the VS16-less keycap fails on both sides).
                if rest.first?.value == 0x20E3 {
                    rest = rest.dropFirst()
                }
            } else if (0x1F3FB...0x1F3FF).contains(next.value),
                base.properties.isEmojiModifierBase
            {
                presented = true
                rest = rest.dropFirst()
            }
        }
        return presented && rest.isEmpty
    }

    static func isRegionalIndicator(_ scalar: Unicode.Scalar) -> Bool {
        (0x1F1E6...0x1F1FF).contains(scalar.value)
    }

    static func isTag(_ scalar: Unicode.Scalar) -> Bool {
        (0xE0020...0xE007F).contains(scalar.value)
    }
}
