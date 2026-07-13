// ASCII-only casing (INV-1), the Kotlin twin of packages/engine/src/casing.ts and
// apps/ios/Sources/CrossyEngine/Casing.swift. Shared by the reducer's value normalization
// and the comparator. Locale-aware casing is forbidden: Kotlin's String.uppercase() is
// Unicode and locale aware, so it would map Turkish dotless i differently than the other
// ports and diverge the engines. Folding by UTF-16 code unit cannot: a-z are single units
// that never occur inside a surrogate pair, so folding by unit equals folding by code point
// for exactly the ASCII lowercase range and touches nothing else. The reducer and comparator
// Turkish pins exist to catch any regression to locale casing.

package crossy.engine

/** Map a-z to A-Z by code unit; leave every other unit unchanged, matching the TS charCodeAt loop. */
fun asciiUpper(value: String): String {
    val out = StringBuilder(value.length)
    for (ch in value) {
        val code = ch.code
        // 0x61..0x7a is a-z; subtract 0x20 to reach A-Z. Everything else, including any
        // non-ASCII code unit, is copied verbatim.
        out.append(if (code in 0x61..0x7a) (code - 0x20).toChar() else ch)
    }
    return out.toString()
}
