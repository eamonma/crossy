import XCTest

@testable import CrossyUI

// The clue reference parser: prose in, (number, isAcross) pairs out. These tests pin the
// grammar the owner asked for (single refs hyphenated or spaced, "See N-Down" prose, distributed
// lists sharing one trailing direction word, mixed axes in one clue, case-insensitivity) and the
// hard "never match" line: bare numbers, years, and "(17)" enumerations carry no direction word,
// so they yield nothing. Existence is not this module's job; the call site filters against the
// real clue list, so a parsed ref for a clue that does not exist is correct behavior here. The
// normative twin is apps/web/src/ui/clueRefs.test.ts; these 19 cases port it verbatim.

final class ClueRefsTests: XCTestCase {
    func test_readsAHyphenatedSingleRef() {
        XCTAssertEqual(parseClueRefs("42-Down"), [ClueRef(number: 42, isAcross: false)])
    }

    func test_readsASpacedSingleRef() {
        XCTAssertEqual(parseClueRefs("17 Across"), [ClueRef(number: 17, isAcross: true)])
    }

    func test_readsARefBuriedInProse_likeSee42Down() {
        XCTAssertEqual(parseClueRefs("See 42-Down"), [ClueRef(number: 42, isAcross: false)])
    }

    func test_isCaseInsensitiveOnTheDirectionWord() {
        XCTAssertEqual(
            parseClueRefs("42-DOWN and 8-across and 3 AcRoSs"),
            [
                ClueRef(number: 42, isAcross: false),
                ClueRef(number: 8, isAcross: true),
                ClueRef(number: 3, isAcross: true),
            ])
    }

    func test_distributesOneTrailingDirectionWordOverACommaAndList() {
        XCTAssertEqual(
            parseClueRefs("17, 20, 49, and 59 across"),
            [
                ClueRef(number: 17, isAcross: true),
                ClueRef(number: 20, isAcross: true),
                ClueRef(number: 49, isAcross: true),
                ClueRef(number: 59, isAcross: true),
            ])
    }

    func test_distributesOverAShortAndList() {
        XCTAssertEqual(
            parseClueRefs("5 and 12 down"),
            [
                ClueRef(number: 5, isAcross: false),
                ClueRef(number: 12, isAcross: false),
            ])
    }

    func test_distributesOverAnAmpersandList() {
        XCTAssertEqual(
            parseClueRefs("1, 5 & 9 Down"),
            [
                ClueRef(number: 1, isAcross: false),
                ClueRef(number: 5, isAcross: false),
                ClueRef(number: 9, isAcross: false),
            ])
    }

    func test_keepsMixedAxesInOneClueOnTheirOwnDirectionWords() {
        XCTAssertEqual(
            parseClueRefs("17-Across and 3-Down"),
            [
                ClueRef(number: 17, isAcross: true),
                ClueRef(number: 3, isAcross: false),
            ])
    }

    func test_keepsADistributedListAndALaterSingleRefApart() {
        XCTAssertEqual(
            parseClueRefs("17, 20, and 49 across, plus 3 down"),
            [
                ClueRef(number: 17, isAcross: true),
                ClueRef(number: 20, isAcross: true),
                ClueRef(number: 49, isAcross: true),
                ClueRef(number: 3, isAcross: false),
            ])
    }

    func test_readsRefsInOrder_duplicatesKeptForTheCallSiteToDedupe() {
        XCTAssertEqual(
            parseClueRefs("8-Down, see also 8-Down"),
            [
                ClueRef(number: 8, isAcross: false),
                ClueRef(number: 8, isAcross: false),
            ])
    }

    func test_readsAThreeDigitClueNumber() {
        XCTAssertEqual(parseClueRefs("With 100-Across"), [ClueRef(number: 100, isAcross: true)])
    }

    // The "never match" line the owner drew.
    func test_doesNotMatchABareNumberWithNoDirectionWord() {
        XCTAssertEqual(parseClueRefs("Just the number 5 alone"), [])
    }

    func test_doesNotMatchAYear() {
        XCTAssertEqual(parseClueRefs("Event of 1999"), [])
        XCTAssertEqual(parseClueRefs("In 1066 across the channel"), [])
    }

    func test_doesNotReadAFourDigitNumbersTailAsAReference() {
        XCTAssertEqual(parseClueRefs("1000 down"), [])
        XCTAssertEqual(parseClueRefs("12345 across"), [])
    }

    func test_doesNotMatchAnEnumerationLike17() {
        XCTAssertEqual(parseClueRefs("Some answer (17)"), [])
    }

    func test_doesNotReadADirectionWordAloneAsAReference() {
        XCTAssertEqual(parseClueRefs("ACROSS the wide river"), [])
        XCTAssertEqual(parseClueRefs("A quiet rundown of the day"), [])
        XCTAssertEqual(parseClueRefs("Downtown at dusk"), [])
    }

    func test_doesNotMatchANumberGluedToADirectionWordWithNoSeparator() {
        XCTAssertEqual(parseClueRefs("12down"), [])
    }

    func test_returnsEmptyForEmptyOrAbsentText() {
        XCTAssertEqual(parseClueRefs(""), [])
        XCTAssertEqual(parseClueRefs(nil), [])
    }

    func test_returnsEmptyForProseWithNoReferenceAtAll() {
        XCTAssertEqual(parseClueRefs("Capital of France"), [])
    }
}
