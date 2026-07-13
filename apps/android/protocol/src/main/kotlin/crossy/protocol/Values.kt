// Cell value rules (PROTOCOL.md §3). Twin of packages/protocol/src/values.ts and
// apps/ios Values.swift. A value is a string matching `^[A-Z0-9]{1,10}$` after
// normalization, or null for an empty cell. Normalization is ASCII-only so the TypeScript,
// Swift, and Kotlin ports agree byte for byte (INV-1); locale-aware casing is forbidden
// because Turkish `i` uppercases to `İ` (U+0130) under a locale and would diverge the ports.
//
// Folding runs over the UTF-8 bytes by raw value: a-z (0x61..0x7a) map to A-Z, every other
// byte (including every byte of a multi-byte non-ASCII scalar) is copied verbatim. ASCII
// lowercase bytes never occur inside a multi-byte UTF-8 sequence, so byte folding equals
// code-point folding for exactly that range and touches nothing else. Kotlin's
// `String.uppercase()` (Unicode- and locale-aware) MUST NOT be used here.

package crossy.protocol

/** The charset for a filled value, checked after ASCII normalization (PROTOCOL.md §3, §11). */
public val VALUE_PATTERN: Regex = Regex("^[A-Z0-9]{1,10}$")

/**
 * Map `a`-`z` to `A`-`Z` and leave every other code point unchanged (INV-1). This is the
 * whole of normalization. Twin of `asciiUppercase`.
 */
public fun asciiUppercase(input: String): String {
    val bytes = input.encodeToByteArray()
    val folded = ByteArray(bytes.size) { i ->
        val b = bytes[i].toInt() and 0xFF
        if (b in 0x61..0x7A) (b - 0x20).toByte() else bytes[i]
    }
    return folded.decodeToString()
}

/** Normalize a raw wire value to its canonical form (PROTOCOL.md §3). Twin of `normalizeValue`. */
public fun normalizeValue(input: String): String = asciiUppercase(input)

/**
 * Whether a filled value is legal (PROTOCOL.md §11 INVALID_VALUE): it matches VALUE_PATTERN
 * after ASCII normalization. Twin of `isValidValue`. `İ` (U+0130) and `ı` (U+0131) are left
 * unchanged by the ASCII-only rule, so they fail the pattern identically on every port (INV-1).
 */
public fun isValidValue(raw: String): Boolean = VALUE_PATTERN.matches(normalizeValue(raw))
