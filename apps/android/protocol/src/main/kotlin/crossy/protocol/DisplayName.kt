// Display name spec (PROTOCOL.md §12, docs/design/name-onboarding). The authoritative
// canonicalize + validate path the identity `/me` write runs, plus an edge `sanitize` that mirrors
// the per-keystroke client filter. Kotlin twin of apps/api/src/identity/display-name.ts (behavior)
// and packages/protocol/src/display-name.ts (constants). All three are pinned by
// vectors/identity/display-name.json (DisplayNameVectorTests), the same JSON the API validator, the
// web sanitizer, and the iOS sanitizer run, so none of the four can drift.
//
// A display name is user content shown back verbatim. It is NEVER uppercased or folded (INV-1
// ASCII-only casing is cell-values only; the vector proves "ada" stays "ada" and "ADA" stays "ADA")
// and carries no solution content (INV-6 untouched). The block-list names only what breaks
// rendering or spoofs visible order; everything else (every letter, mark, number, symbol, emoji) is
// allowed, so this is a block-list, not an allow-list.

package crossy.protocol

import java.text.BreakIterator
import java.text.Normalizer
import java.util.Locale

public object DisplayName {
    /** Max length in extended grapheme clusters (user-perceived characters), not code points or
     *  UTF-16 units. Mirrors MAX_DISPLAY_NAME_GRAPHEMES (packages/protocol). The minimum is 1: the
     *  empty name is forbidden, which is the point of onboarding. */
    public const val MAX_GRAPHEMES: Int = 40

    /** The named domain rejections `validate` returns, matching APIErrorCode and PROTOCOL.md §12. */
    public enum class Error { NAME_REQUIRED, NAME_TOO_LONG, NAME_INVALID }

    /** A validate outcome: the accepted canonical value, or the first named rejection. */
    public sealed interface Result {
        public data class Ok(val value: String) : Result
        public data class Err(val code: Error) : Result
    }

    // Scalars disallowed anywhere, no matter their context (ALWAYS_DISALLOWED_SCALAR_RANGES,
    // packages/protocol): the C0/DEL/C1 control ranges and the bidi overrides. These always break
    // rendering or spoof visible order. Plain RTL script (Arabic, Hebrew) is not an override.
    private fun isAlwaysDisallowedScalar(cp: Int): Boolean =
        cp in 0x0000..0x001F || // C0 controls (newline, tab, ...)
            cp in 0x007F..0x009F || // DEL and C1 controls
            cp in 0x202A..0x202E || // LRE, RLE, PDF, LRO, RLO
            cp in 0x2066..0x2069 // LRI, RLI, FSI, PDI

    // Zero-width / invisible formatters (ZERO_WIDTH_SCALAR_RANGES, packages/protocol), disallowed
    // only when LONE (their own grapheme cluster), NOT when they sit inside a valid emoji cluster as
    // glue: the segmenter keeps a family emoji intact, so its internal ZWJ never trips the check.
    private fun isZeroWidthScalar(cp: Int): Boolean =
        cp in 0x200B..0x200D || // ZWSP, ZWNJ, ZWJ
            cp == 0x2060 || // word joiner
            cp == 0xFEFF // byte-order mark

    // The layout whitespace canonicalize trims and collapses: the Unicode White_Space scalars that
    // are NOT controls (COLLAPSIBLE_WHITESPACE, packages/protocol). The control whitespace (tab,
    // newline) is excluded, so it survives canonicalization and validate rejects it as a control (a
    // name is one line). The trailing anchor is \z (absolute end), not $, so a trailing space before
    // a final line terminator is not trimmed, matching the TS regex's end-of-string `$` under /u.
    private const val COLLAPSIBLE =
        "\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000"
    private val TRIM_RE = Regex("^[$COLLAPSIBLE]+|[$COLLAPSIBLE]+\\z")
    private val COLLAPSE_RE = Regex("[$COLLAPSIBLE]+")

    /** Grapheme clusters of `s`, so length is measured in user-perceived characters. Java's grapheme
     *  BreakIterator keeps a ZWJ emoji sequence and a regional-indicator flag as one cluster each,
     *  the same extended-grapheme-cluster segmentation Intl.Segmenter (TS) and Swift's Character use,
     *  so a family emoji counts as one and a name is never cut mid-glyph. */
    private fun graphemes(s: String): List<String> {
        val iterator = BreakIterator.getCharacterInstance(Locale.ROOT)
        iterator.setText(s)
        val out = ArrayList<String>()
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            out.add(s.substring(start, end))
            start = end
            end = iterator.next()
        }
        return out
    }

    /** True if `cluster` (one grapheme) contains a disallowed scalar. A control or bidi override is
     *  disallowed anywhere. A zero-width formatter is disallowed only when the cluster is a LONE
     *  zero-width run (every scalar in it is zero-width): inside a valid emoji cluster the ZWJ is
     *  glue and the segmenter keeps the cluster intact, so a family emoji's ZWJ never trips it. */
    private fun clusterHasDisallowedScalar(cluster: String): Boolean {
        var allZeroWidth = true
        var hasZeroWidth = false
        var i = 0
        while (i < cluster.length) {
            val cp = cluster.codePointAt(i)
            if (isAlwaysDisallowedScalar(cp)) return true
            if (isZeroWidthScalar(cp)) hasZeroWidth = true else allZeroWidth = false
            i += Character.charCount(cp)
        }
        // A cluster made up entirely of zero-width formatters is a lone occurrence (a base-less run),
        // which is disallowed; a zero-width scalar acting as glue in a real cluster is allowed.
        return hasZeroWidth && allZeroWidth
    }

    /**
     * Canonicalize a raw name for storage (docs/design/name-onboarding §5), in order: Unicode NFC
     * (one visual name, one byte form), trim leading and trailing collapsible whitespace, then
     * collapse every internal collapsible-whitespace run to a single ASCII space. A name is a label,
     * not a layout. Casing is untouched (INV-1 does not apply to names). Control whitespace (tab,
     * newline) is NOT collapsible here: it survives so `validate` rejects it as a control.
     */
    public fun canonicalize(raw: String): String =
        Normalizer.normalize(raw, Normalizer.Form.NFC)
            .replace(TRIM_RE, "")
            .replace(COLLAPSE_RE, " ")

    /**
     * Validate a canonicalized name (docs/design/name-onboarding §5). Empty is NAME_REQUIRED; over
     * MAX_GRAPHEMES graphemes is NAME_TOO_LONG; a disallowed scalar (control, lone zero-width, bidi
     * override) outside a valid emoji cluster is NAME_INVALID. Everything else is allowed. Pass the
     * value through `canonicalize` first.
     */
    public fun validate(canonical: String): Result {
        if (canonical.isEmpty()) return Result.Err(Error.NAME_REQUIRED)
        val clusters = graphemes(canonical)
        if (clusters.size > MAX_GRAPHEMES) return Result.Err(Error.NAME_TOO_LONG)
        for (cluster in clusters) {
            if (clusterHasDisallowedScalar(cluster)) return Result.Err(Error.NAME_INVALID)
        }
        return Result.Ok(canonical)
    }

    /**
     * Edge sanitize for parity with the clients (docs/design/name-onboarding R6): strip every
     * disallowed scalar and cap at MAX_GRAPHEMES graphemes, but do NOT trim or collapse whitespace
     * and do NOT NFC-normalize. This is the per-keystroke shape the client field applies so it never
     * holds a value the server would reject for shape; the server still trims, collapses, and
     * normalizes on submit via `canonicalize`. Vector-pinned so the keystroke filter cannot drift.
     */
    public fun sanitize(raw: String): String {
        val kept = StringBuilder()
        var count = 0
        for (cluster in graphemes(raw)) {
            if (clusterHasDisallowedScalar(cluster)) continue
            if (count >= MAX_GRAPHEMES) break
            kept.append(cluster)
            count += 1
        }
        return kept.toString()
    }

    /** A raw name ready to submit: `canonicalize` then `validate` passes. The onboarding and editor
     *  submit gate; derived from the two vector-pinned functions, never a second naming policy. */
    public fun isComplete(raw: String): Boolean = validate(canonicalize(raw)) is Result.Ok
}
