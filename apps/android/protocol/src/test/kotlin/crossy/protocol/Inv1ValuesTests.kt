package crossy.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// INV-1: casing and comparison are ASCII-only so the TypeScript, Swift, and Kotlin ports cannot
// diverge. Twin of packages/protocol/src/inv1-values.test.ts and apps/ios INV1ValuesTests.swift,
// case for case; the Turkish dotted/dotless i is the canonical trap PROTOCOL.md §3 and §13 call out.

class Inv1ValuesTests {
    @Test
    fun asciiUppercaseMapsOnlyAToZ_INV1() {
        assertEquals("ABC", asciiUppercase("abc"))
        assertEquals("AB9Z", asciiUppercase("aB9z"))
        assertEquals("ABC123", asciiUppercase("ABC123"))
        // Non-ASCII letters are untouched: no locale uppercasing.
        assertEquals("CAFé", asciiUppercase("café"))
        assertEquals("NAïVE", asciiUppercase("naïve"))
    }

    @Test
    fun normalizeValueIsNeverLocaleAware_INV1() {
        // A locale-aware uppercasing of Turkish "i" would yield "İ" (U+0130); ASCII-only must not.
        assertEquals("ISTANBUL", normalizeValue("istanbul"))
        assertFalse(normalizeValue("istanbul").contains("İ"))
    }

    @Test
    fun dottedAndDotlessIAreLeftUnchanged_INV1() {
        assertEquals("İ", asciiUppercase("İ"))
        assertEquals("ı", asciiUppercase("ı"))
    }

    @Test
    fun acceptsNormalizedLettersDigitsAndRebusUpTo10() {
        // PROTOCOL.md §3: ^[A-Z0-9]{1,10}$ after normalization.
        for (value in listOf("A", "a", "Z", "5", "AB", "abc", "A1B2", "ABCDEFGHIJ")) {
            assertTrue(isValidValue(value), "$value must be valid")
        }
    }

    @Test
    fun rejectsEmptyOverlengthAndNonASCIIUppercasable() {
        for (value in listOf("", "ABCDEFGHIJK", "A B", "A-B", "café")) {
            assertFalse(isValidValue(value), "$value must be invalid")
        }
    }

    @Test
    fun rejectsU0130AndU0131Identically_INV1() {
        // ASCII-only leaves them outside the charset, identically on every port.
        assertFalse(isValidValue("İ"))
        assertFalse(isValidValue("ı"))
    }
}
