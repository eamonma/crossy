// The personal reaction set spec (PROTOCOL.md §9, §12; DESIGN.md D25): the Kotlin twin of iOS
// CrossyProtocol/ReactionSetSpec.swift and the API's authoritative validate path
// (apps/api/src/identity/reaction-set.ts). A reaction set is the five emoji a client's send surface
// offers; `PATCH /me` writes it, null resets to the defaults, and the API is the single writer of
// the column (INV-7). This mirror exists so the Settings editor can gate input at the edge and name
// the same rule the server would; the server's named 422s (REACTION_SET_*) stay the authority the UI
// surfaces when the two ever disagree.
//
// Deliberately dependency-free (only kotlin stdlib), so the whole spec is provable on the JVM and on
// Android ART identically, with NO android.icu / ICU4J and NO java.util.regex Unicode-property
// reliance (those vary by platform Unicode version and are absent on some runtimes). The set is
// byte-exact, never normalized: distinctness compares the exact grapheme strings, so two entries
// that render alike but differ in code points (a variation selector, a skin-tone modifier) are
// distinct (§12).
//
// THE EMOJI HEURISTIC VS THE SERVER'S RGI RULE. The server matches `/^\p{RGI_Emoji}$/v`; there is no
// RGI_Emoji code-point property (that set is DATA, the curated RGI sequence list, not a scalar
// property), so `isReactionEmoji` approximates it from the scalar properties UTS #51 builds the RGI
// set from: Emoji, Emoji_Presentation, and Emoji_Modifier_Base. Those three properties are baked
// below as code-point range tables (derived mechanically from the JDK 21 Unicode data, the twin of
// Swift's Unicode.Scalar.Properties), so this file needs no runtime Unicode facility. What it checks,
// per grapheme, matches ReactionSetSpec.swift exactly:
//
//   accepted, matching the server:
//     - a single emoji-presentation scalar (🔥, 😭, and lone components like 🏽)
//     - an emoji scalar completed by VS16 (♥️, ©️; bare ♥ and © are rejected on both sides)
//     - an RGI-shaped keycap (digit/#/* + VS16 + U+20E3; the VS16-less form fails on both sides)
//     - a modifier base wearing one skin tone (👍🏽)
//     - a two-regional-indicator flag (🇨🇦)
//     - a U+1F3F4 tag sequence ending in CANCEL TAG (🏴󠁳󠁣󠁴󠁿, Scotland)
//     - ZWJ chains of the above (❤️‍🔥, 👨‍👩‍👧‍👦), within the 32-byte bound
//
//   accepted here but 422 REACTION_SET_INVALID on the server (THE DIVERGENCE, all three shapes are
//   "well-formed but not on the RGI list"; the UI treats the server as final):
//     - non-RGI ZWJ chains (🐐‍🔥): any chain of valid elements passes here, only the curated RGI
//       list passes there
//     - non-RGI flag pairs (🇦🇦): any RI pair passes here, only real regions there
//     - non-RGI tag sequences on 🏴: any well-formed tag spelling passes here, only
//       England/Scotland/Wales there
//
//   rejected here, nothing the server accepts is rejected beyond these:
//     - letters, digits, punctuation, whitespace, and any multi-grapheme string
//     - text-presentation forms (♥, ☂︎ with VS15), out-of-order or dangling modifiers, a trailing
//       ZWJ, three-plus regional indicators, and anything over 32 UTF-8 bytes (the §9 shape bound;
//       the longest multi-person ZWJ sequences fall here on both sides)

package crossy.protocol

/**
 * The named domain rejections, whose wire strings are the stable §12 codes (the NAME_* style; twin
 * of `ReactionSetError` in ReactionSetSpec.swift and apps/api/src/identity/reaction-set.ts). All 422.
 * These mirror the three [APIErrorCode] entries `REACTION_SET_*`, so a locally-named violation reads
 * with the exact code the server would send.
 */
public enum class ReactionSetError(public val wire: String) {
    /** The set is not exactly five entries. */
    LENGTH("REACTION_SET_LENGTH"),

    /** An entry is not one emoji grapheme within 32 UTF-8 bytes. */
    INVALID("REACTION_SET_INVALID"),

    /** A repeated entry (distinctness compares the exact grapheme string). */
    DUPLICATE("REACTION_SET_DUPLICATE"),
}

public object ReactionSetSpec {
    /** Exactly five slots (PROTOCOL.md §9: the personal set is five emoji in slot order). */
    public const val SIZE: Int = 5

    /**
     * The §9 send-gate byte bound: one emoji is at most 32 UTF-8 bytes. The same shape bound the wire
     * codec enforces (Messages.kt / the reaction frame), reproduced because the /me set rule is a
     * distinct policy path (the codec enforces shape only, never emoji-ness).
     */
    public const val MAX_UTF8_BYTES: Int = 32

    /**
     * The default personal set, exactly these five graphemes in slot order (PROTOCOL.md §9; D25,
     * owner ruling 2026-07-14). A null `reactionSet` on `/me` means these; the Phase 7 fixed set
     * (🎉 🤔 👀 💀 🫡) is retired. Identical to [ReactionSetError]-free `ReactionPolicy.defaultSet`
     * in :ui, kept here too because the spec is the set's home (:ui depends on :protocol, not the
     * reverse).
     */
    public val defaultSet: List<String> = listOf("🔥", "🤔", "🐐", "💀", "😭")

    /**
     * True iff [candidate] is one sendable reaction emoji: at most 32 UTF-8 bytes and emoji-presented
     * per the header's heuristic (the §9 send-gate rule as closely as scalar properties can state it).
     * The byte bound runs first so a pathological long input never reaches grapheme analysis, the
     * server's own ordering. There is no separate "one grapheme" check: the element/flag/tag/ZWJ-chain
     * grammar below IS the one-grapheme rule (two bases with no joiner, or a base plus trailing junk,
     * never satisfy it), so the outcomes match Swift's `candidate.count == 1` gate exactly.
     */
    public fun isReactionEmoji(candidate: String): Boolean {
        if (candidate.encodeToByteArray().size > MAX_UTF8_BYTES) return false
        return isEmojiPresentation(candidate.codePointsList())
    }

    /**
     * Validate a whole `reactionSet` patch value, the server's checks in the server's order (length,
     * then per-entry shape, then distinctness), so the first named error a person sees locally is the
     * one the server would name. null input is valid (null resets to the defaults); null out means
     * the set passes. Twin of `ReactionSetSpec.validate` (Swift) and the API validate suite.
     */
    public fun validate(set: List<String>?): ReactionSetError? {
        if (set == null) return null
        if (set.size != SIZE) return ReactionSetError.LENGTH
        if (set.any { !isReactionEmoji(it) }) return ReactionSetError.INVALID
        if (set.toSet().size != set.size) return ReactionSetError.DUPLICATE
        return null
    }

    // MARK: - The heuristic's parts (internal for the spec tests)

    /** One grapheme cluster, judged emoji-presented per the header's contract (Swift's
     *  `isEmojiPresentation(Character)`). Operates on the whole code-point list because the grammar
     *  it enforces is itself the one-grapheme rule. */
    internal fun isEmojiPresentation(scalars: IntArray): Boolean {
        val first = scalars.firstOrNull() ?: return false

        // An emoji flag: exactly two regional indicators. (Three RIs are two graphemes and never one
        // emoji; an RI followed by anything else is malformed.)
        if (isRegionalIndicator(first)) {
            return scalars.size == 2 && isRegionalIndicator(scalars[1])
        }

        // A tag sequence (the subdivision flags): the U+1F3F4 base, then tag scalars ending in
        // CANCEL TAG. Tags are legal nowhere else.
        if (scalars.drop(1).any { isTag(it) }) {
            if (first != 0x1F3F4) return false
            val tags = scalars.drop(1)
            return tags.size >= 2 && tags.all { isTag(it) } && tags.last() == 0xE007F
        }

        // Everything else: split on ZWJ; every segment must stand as one emoji-presented element. A
        // trailing ZWJ leaves an empty final segment, which fails (matching the server: a dangling
        // joiner is not one emoji).
        var segment = ArrayList<Int>()
        for (scalar in scalars) {
            if (scalar == 0x200D) {
                if (!isEmojiElement(segment)) return false
                segment = ArrayList()
            } else {
                segment.add(scalar)
            }
        }
        return isEmojiElement(segment)
    }

    /** One ZWJ-free element: an emoji base scalar, optionally completed by exactly one of VS16 (with
     *  an optional combining keycap after it, the RGI keycap shape) or a skin tone on a modifier
     *  base. The element must end up emoji-PRESENTED: a base whose default is text (♥, ©, a bare
     *  digit) passes only with its VS16. Twin of Swift's `isEmojiElement`. */
    internal fun isEmojiElement(scalars: List<Int>): Boolean {
        val base = scalars.firstOrNull() ?: return false
        if (!isEmoji(base)) return false
        var presented = isEmojiPresentationScalar(base)
        var index = 1

        if (index < scalars.size) {
            val next = scalars[index]
            if (next == 0xFE0F) {
                presented = true
                index++
                // The keycap rides only a VS16-presented base: digit + VS16 + U+20E3 (the RGI shape;
                // the VS16-less keycap fails on both sides).
                if (index < scalars.size && scalars[index] == 0x20E3) {
                    index++
                }
            } else if (next in 0x1F3FB..0x1F3FF && isEmojiModifierBase(base)) {
                presented = true
                index++
            }
        }
        return presented && index == scalars.size
    }

    private fun isRegionalIndicator(scalar: Int): Boolean = scalar in 0x1F1E6..0x1F1FF

    private fun isTag(scalar: Int): Boolean = scalar in 0xE0020..0xE007F

    // MARK: - Scalar properties (the UTS #51 sets Swift reads from Unicode.Scalar.Properties)

    /** The `Emoji` property (twin of `scalar.properties.isEmoji`). */
    internal fun isEmoji(scalar: Int): Boolean = inRanges(scalar, EMOJI_RANGES)

    /** The `Emoji_Presentation` property (twin of `scalar.properties.isEmojiPresentation`). */
    internal fun isEmojiPresentationScalar(scalar: Int): Boolean =
        inRanges(scalar, EMOJI_PRESENTATION_RANGES)

    /** The `Emoji_Modifier_Base` property (twin of `scalar.properties.isEmojiModifierBase`). */
    internal fun isEmojiModifierBase(scalar: Int): Boolean =
        inRanges(scalar, EMOJI_MODIFIER_BASE_RANGES)

    /** Binary search over a flat sorted [lo0, hi0, lo1, hi1, ...] range table (inclusive bounds). */
    private fun inRanges(scalar: Int, ranges: IntArray): Boolean {
        var lo = 0
        var hi = ranges.size / 2 - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val start = ranges[mid * 2]
            val end = ranges[mid * 2 + 1]
            when {
                scalar < start -> hi = mid - 1
                scalar > end -> lo = mid + 1
                else -> return true
            }
        }
        return false
    }

    /** Decode a String to its Unicode code points (surrogate pairs folded), stdlib-only so the spec
     *  stays JVM/ART-portable. */
    private fun String.codePointsList(): IntArray {
        val out = ArrayList<Int>(length)
        var i = 0
        while (i < length) {
            val cp = codePointAt(i)
            out.add(cp)
            i += Character.charCount(cp)
        }
        return out.toIntArray()
    }

    // MARK: - The baked UTS #51 property tables (JDK 21 Unicode data; \p{IsEmoji},
    // \p{IsEmoji_Presentation}, \p{IsEmoji_Modifier_Base}). Flat sorted inclusive [start, end] pairs.

    // Emoji: 151 ranges, 1424 code points
    private val EMOJI_RANGES: IntArray = intArrayOf(
        0x23, 0x23, 0x2A, 0x2A, 0x30, 0x39, 0xA9, 0xA9, 0xAE, 0xAE, 0x203C, 0x203C, 0x2049, 0x2049,
        0x2122, 0x2122, 0x2139, 0x2139, 0x2194, 0x2199, 0x21A9, 0x21AA, 0x231A, 0x231B, 0x2328, 0x2328,
        0x23CF, 0x23CF, 0x23E9, 0x23F3, 0x23F8, 0x23FA, 0x24C2, 0x24C2, 0x25AA, 0x25AB, 0x25B6, 0x25B6,
        0x25C0, 0x25C0, 0x25FB, 0x25FE, 0x2600, 0x2604, 0x260E, 0x260E, 0x2611, 0x2611, 0x2614, 0x2615,
        0x2618, 0x2618, 0x261D, 0x261D, 0x2620, 0x2620, 0x2622, 0x2623, 0x2626, 0x2626, 0x262A, 0x262A,
        0x262E, 0x262F, 0x2638, 0x263A, 0x2640, 0x2640, 0x2642, 0x2642, 0x2648, 0x2653, 0x265F, 0x2660,
        0x2663, 0x2663, 0x2665, 0x2666, 0x2668, 0x2668, 0x267B, 0x267B, 0x267E, 0x267F, 0x2692, 0x2697,
        0x2699, 0x2699, 0x269B, 0x269C, 0x26A0, 0x26A1, 0x26A7, 0x26A7, 0x26AA, 0x26AB, 0x26B0, 0x26B1,
        0x26BD, 0x26BE, 0x26C4, 0x26C5, 0x26C8, 0x26C8, 0x26CE, 0x26CF, 0x26D1, 0x26D1, 0x26D3, 0x26D4,
        0x26E9, 0x26EA, 0x26F0, 0x26F5, 0x26F7, 0x26FA, 0x26FD, 0x26FD, 0x2702, 0x2702, 0x2705, 0x2705,
        0x2708, 0x270D, 0x270F, 0x270F, 0x2712, 0x2712, 0x2714, 0x2714, 0x2716, 0x2716, 0x271D, 0x271D,
        0x2721, 0x2721, 0x2728, 0x2728, 0x2733, 0x2734, 0x2744, 0x2744, 0x2747, 0x2747, 0x274C, 0x274C,
        0x274E, 0x274E, 0x2753, 0x2755, 0x2757, 0x2757, 0x2763, 0x2764, 0x2795, 0x2797, 0x27A1, 0x27A1,
        0x27B0, 0x27B0, 0x27BF, 0x27BF, 0x2934, 0x2935, 0x2B05, 0x2B07, 0x2B1B, 0x2B1C, 0x2B50, 0x2B50,
        0x2B55, 0x2B55, 0x3030, 0x3030, 0x303D, 0x303D, 0x3297, 0x3297, 0x3299, 0x3299, 0x1F004, 0x1F004,
        0x1F0CF, 0x1F0CF, 0x1F170, 0x1F171, 0x1F17E, 0x1F17F, 0x1F18E, 0x1F18E, 0x1F191, 0x1F19A,
        0x1F1E6, 0x1F1FF, 0x1F201, 0x1F202, 0x1F21A, 0x1F21A, 0x1F22F, 0x1F22F, 0x1F232, 0x1F23A,
        0x1F250, 0x1F251, 0x1F300, 0x1F321, 0x1F324, 0x1F393, 0x1F396, 0x1F397, 0x1F399, 0x1F39B,
        0x1F39E, 0x1F3F0, 0x1F3F3, 0x1F3F5, 0x1F3F7, 0x1F4FD, 0x1F4FF, 0x1F53D, 0x1F549, 0x1F54E,
        0x1F550, 0x1F567, 0x1F56F, 0x1F570, 0x1F573, 0x1F57A, 0x1F587, 0x1F587, 0x1F58A, 0x1F58D,
        0x1F590, 0x1F590, 0x1F595, 0x1F596, 0x1F5A4, 0x1F5A5, 0x1F5A8, 0x1F5A8, 0x1F5B1, 0x1F5B2,
        0x1F5BC, 0x1F5BC, 0x1F5C2, 0x1F5C4, 0x1F5D1, 0x1F5D3, 0x1F5DC, 0x1F5DE, 0x1F5E1, 0x1F5E1,
        0x1F5E3, 0x1F5E3, 0x1F5E8, 0x1F5E8, 0x1F5EF, 0x1F5EF, 0x1F5F3, 0x1F5F3, 0x1F5FA, 0x1F64F,
        0x1F680, 0x1F6C5, 0x1F6CB, 0x1F6D2, 0x1F6D5, 0x1F6D7, 0x1F6DC, 0x1F6E5, 0x1F6E9, 0x1F6E9,
        0x1F6EB, 0x1F6EC, 0x1F6F0, 0x1F6F0, 0x1F6F3, 0x1F6FC, 0x1F7E0, 0x1F7EB, 0x1F7F0, 0x1F7F0,
        0x1F90C, 0x1F93A, 0x1F93C, 0x1F945, 0x1F947, 0x1F9FF, 0x1FA70, 0x1FA7C, 0x1FA80, 0x1FA88,
        0x1FA90, 0x1FABD, 0x1FABF, 0x1FAC5, 0x1FACE, 0x1FADB, 0x1FAE0, 0x1FAE8, 0x1FAF0, 0x1FAF8,
    )

    // Emoji_Presentation: 81 ranges, 1205 code points
    private val EMOJI_PRESENTATION_RANGES: IntArray = intArrayOf(
        0x231A, 0x231B, 0x23E9, 0x23EC, 0x23F0, 0x23F0, 0x23F3, 0x23F3, 0x25FD, 0x25FE, 0x2614, 0x2615,
        0x2648, 0x2653, 0x267F, 0x267F, 0x2693, 0x2693, 0x26A1, 0x26A1, 0x26AA, 0x26AB, 0x26BD, 0x26BE,
        0x26C4, 0x26C5, 0x26CE, 0x26CE, 0x26D4, 0x26D4, 0x26EA, 0x26EA, 0x26F2, 0x26F3, 0x26F5, 0x26F5,
        0x26FA, 0x26FA, 0x26FD, 0x26FD, 0x2705, 0x2705, 0x270A, 0x270B, 0x2728, 0x2728, 0x274C, 0x274C,
        0x274E, 0x274E, 0x2753, 0x2755, 0x2757, 0x2757, 0x2795, 0x2797, 0x27B0, 0x27B0, 0x27BF, 0x27BF,
        0x2B1B, 0x2B1C, 0x2B50, 0x2B50, 0x2B55, 0x2B55, 0x1F004, 0x1F004, 0x1F0CF, 0x1F0CF, 0x1F18E, 0x1F18E,
        0x1F191, 0x1F19A, 0x1F1E6, 0x1F1FF, 0x1F201, 0x1F201, 0x1F21A, 0x1F21A, 0x1F22F, 0x1F22F,
        0x1F232, 0x1F236, 0x1F238, 0x1F23A, 0x1F250, 0x1F251, 0x1F300, 0x1F320, 0x1F32D, 0x1F335,
        0x1F337, 0x1F37C, 0x1F37E, 0x1F393, 0x1F3A0, 0x1F3CA, 0x1F3CF, 0x1F3D3, 0x1F3E0, 0x1F3F0,
        0x1F3F4, 0x1F3F4, 0x1F3F8, 0x1F43E, 0x1F440, 0x1F440, 0x1F442, 0x1F4FC, 0x1F4FF, 0x1F53D,
        0x1F54B, 0x1F54E, 0x1F550, 0x1F567, 0x1F57A, 0x1F57A, 0x1F595, 0x1F596, 0x1F5A4, 0x1F5A4,
        0x1F5FB, 0x1F64F, 0x1F680, 0x1F6C5, 0x1F6CC, 0x1F6CC, 0x1F6D0, 0x1F6D2, 0x1F6D5, 0x1F6D7,
        0x1F6DC, 0x1F6DF, 0x1F6EB, 0x1F6EC, 0x1F6F4, 0x1F6FC, 0x1F7E0, 0x1F7EB, 0x1F7F0, 0x1F7F0,
        0x1F90C, 0x1F93A, 0x1F93C, 0x1F945, 0x1F947, 0x1F9FF, 0x1FA70, 0x1FA7C, 0x1FA80, 0x1FA88,
        0x1FA90, 0x1FABD, 0x1FABF, 0x1FAC5, 0x1FACE, 0x1FADB, 0x1FAE0, 0x1FAE8, 0x1FAF0, 0x1FAF8,
    )

    // Emoji_Modifier_Base: 40 ranges, 134 code points
    private val EMOJI_MODIFIER_BASE_RANGES: IntArray = intArrayOf(
        0x261D, 0x261D, 0x26F9, 0x26F9, 0x270A, 0x270D, 0x1F385, 0x1F385, 0x1F3C2, 0x1F3C4, 0x1F3C7, 0x1F3C7,
        0x1F3CA, 0x1F3CC, 0x1F442, 0x1F443, 0x1F446, 0x1F450, 0x1F466, 0x1F478, 0x1F47C, 0x1F47C,
        0x1F481, 0x1F483, 0x1F485, 0x1F487, 0x1F48F, 0x1F48F, 0x1F491, 0x1F491, 0x1F4AA, 0x1F4AA,
        0x1F574, 0x1F575, 0x1F57A, 0x1F57A, 0x1F590, 0x1F590, 0x1F595, 0x1F596, 0x1F645, 0x1F647,
        0x1F64B, 0x1F64F, 0x1F6A3, 0x1F6A3, 0x1F6B4, 0x1F6B6, 0x1F6C0, 0x1F6C0, 0x1F6CC, 0x1F6CC,
        0x1F90C, 0x1F90C, 0x1F90F, 0x1F90F, 0x1F918, 0x1F91F, 0x1F926, 0x1F926, 0x1F930, 0x1F939,
        0x1F93C, 0x1F93E, 0x1F977, 0x1F977, 0x1F9B5, 0x1F9B6, 0x1F9B8, 0x1F9B9, 0x1F9BB, 0x1F9BB,
        0x1F9CD, 0x1F9CF, 0x1F9D1, 0x1F9DD, 0x1FAC3, 0x1FAC5, 0x1FAF0, 0x1FAF8,
    )
}
