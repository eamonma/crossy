import XCTest

import CrossyProtocol

// INV-1: casing and comparison are ASCII-only so the TypeScript and Swift ports cannot
// diverge. Twin of packages/protocol/src/inv1-values.test.ts, case for case; the
// Turkish dotted/dotless i is the canonical trap PROTOCOL.md §3 and §13 call out.

final class INV1ValuesTests: XCTestCase {
    func test_asciiUppercaseMapsOnlyAToZ_INV1() throws {
        XCTAssertEqual(asciiUppercase("abc"), "ABC")
        XCTAssertEqual(asciiUppercase("aB9z"), "AB9Z")
        XCTAssertEqual(asciiUppercase("ABC123"), "ABC123")
        // Non-ASCII letters are untouched: no locale uppercasing.
        XCTAssertEqual(asciiUppercase("café"), "CAFé")
        XCTAssertEqual(asciiUppercase("naïve"), "NAïVE")
    }

    func test_normalizeValueIsNeverLocaleAware_INV1() throws {
        // A locale-aware uppercasing of Turkish "i" would yield "İ" (U+0130);
        // ASCII-only must not.
        XCTAssertEqual(normalizeValue("istanbul"), "ISTANBUL")
        XCTAssertFalse(normalizeValue("istanbul").contains("İ"))
    }

    func test_dottedAndDotlessIAreLeftUnchanged_INV1() throws {
        XCTAssertEqual(asciiUppercase("İ"), "İ")
        XCTAssertEqual(asciiUppercase("ı"), "ı")
    }

    func test_acceptsNormalizedLettersDigitsAndRebusUpTo10() throws {
        // PROTOCOL.md §3: ^[A-Z0-9]{1,10}$ after normalization.
        for value in ["A", "a", "Z", "5", "AB", "abc", "A1B2", "ABCDEFGHIJ"] {
            XCTAssertTrue(isValidValue(value), "\(value) must be valid")
        }
    }

    func test_rejectsEmptyOverlengthAndNonASCIIUppercasable() throws {
        for value in ["", "ABCDEFGHIJK", "A B", "A-B", "café"] {
            XCTAssertFalse(isValidValue(value), "\(value) must be invalid")
        }
    }

    func test_rejectsU0130AndU0131Identically_INV1() throws {
        // ASCII-only leaves them outside the charset, identically on both ports.
        XCTAssertFalse(isValidValue("İ"))
        XCTAssertFalse(isValidValue("ı"))
    }
}
