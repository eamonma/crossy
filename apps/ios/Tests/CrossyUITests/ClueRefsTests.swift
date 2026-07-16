import XCTest

@testable import CrossyUI

// The clue reference parser: prose in, (number, isAcross) pairs out. These tests pin the
// grammar the owner asked for (single refs hyphenated or spaced, "See N-Down" prose, distributed
// lists sharing one trailing direction word, mixed axes in one clue, case-insensitivity) and the
// hard "never match" line: bare numbers, years, and "(17)" enumerations carry no direction word,
// so they yield nothing. Existence is not this module's job; the call site filters against the
// real clue list, so a parsed ref for a clue that does not exist is correct behavior here. The
// normative twin is apps/web/src/ui/clueRefs.test.ts; these 19 cases port it verbatim.
//
// The starred-clue predicates (D26) are pinned the same way, in StarredClueTests below, and the
// same division of labor holds: they answer "is this clue starred?" and "does this prose name the
// starred set?" and nothing more. ClueBook.referencedIds is where both kinds of reference meet a
// real clue list, so the existence and self-exclusion guards are pinned in ClueBookTests.

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

// The reference puzzle, shared by the grammar cases below and the resolution cases in
// ClueBookTests: revealer 61-Across names the set, four theme entries wear the star, and 1-Down is
// ordinary. One fixture for both files, so the grammar and the resolution can never drift apart.
let refPuzzleRevealer =
    "Question during a brainstorming session ... or of the answers to the starred clues"
let refPuzzleAcross: [ClueEntry] = [
    ClueEntry(number: 18, text: "*Yes — three arduous ones", cells: [0, 1], isAcross: true),
    ClueEntry(number: 29, text: "*Yes — sometimes more than 1,000", cells: [2, 3], isAcross: true),
    ClueEntry(
        number: 37, text: "*Yes — exactly one, in common usage", cells: [4, 5], isAcross: true),
    ClueEntry(number: 50, text: "*No — but it does have three feet", cells: [6, 7], isAcross: true),
    ClueEntry(number: 61, text: refPuzzleRevealer, cells: [8, 9], isAcross: true),
]
let refPuzzleDown: [ClueEntry] = [
    ClueEntry(number: 1, text: "Capital of France", cells: [0, 2], isAcross: false)
]

// The starred-clue grammar (D26): what the prose means, independent of any puzzle. Resolution
// against a clue list is ClueBook.referencedIds' job and is pinned in ClueBookTests.
final class StarredClueTests: XCTestCase {
    func test_readsTheReferencePuzzlesRevealer() {
        XCTAssertTrue(referencesStarredClues(refPuzzleRevealer))
    }

    func test_marksTheReferencePuzzlesFourThemeEntriesAndNothingElse() {
        XCTAssertEqual(refPuzzleAcross.filter(isStarredClue).map(\.number), [18, 29, 37, 50])
        XCTAssertEqual(refPuzzleDown.filter(isStarredClue), [])
    }

    func test_doesNotReadStarredAsAVerb_starredInAMovieNamesNothing() {
        XCTAssertFalse(referencesStarredClues("Starred in a movie"))
        XCTAssertFalse(referencesStarredClues("She starred alongside him"))
    }

    func test_takesEveryNounTheConventionUses() {
        XCTAssertTrue(referencesStarredClues("starred answers"))
        XCTAssertTrue(referencesStarredClues("asterisked clues"))
        XCTAssertTrue(referencesStarredClues("the four starred entries"))
        XCTAssertTrue(referencesStarredClues("the starred entry"))
        XCTAssertTrue(referencesStarredClues("the starred squares"))
        XCTAssertTrue(referencesStarredClues("a starred-clue theme"))
    }

    func test_readsThePossessive_theStarredCluesAnswers() {
        XCTAssertTrue(referencesStarredClues("the starred clues' answers"))
    }

    func test_isCaseInsensitiveOnTheRevealerPhrase() {
        XCTAssertTrue(referencesStarredClues("... of the STARRED CLUES"))
    }

    // The one-way ruling (D26). A highlight answers "what does the active clue's own text name?",
    // and a starred clue's text names nothing, so a starred clue lights nothing. Reverse linking
    // would need a reverse index and a revealer concept; pinned here so any change is deliberate.
    func test_isOneWay_aStarredClueAsTheActiveClueNamesNothing() {
        for clue in refPuzzleAcross.filter(isStarredClue) {
            XCTAssertFalse(referencesStarredClues(clue.text))
        }
    }

    // PROTOCOL section 12 law 11: the leading `*` survives ingestion verbatim, and law 1 makes the
    // runs concatenate to `text`. So a star split into its own styled run is still the first
    // character of `text`, and reading `text` alone sees it.
    func test_seesTheStarThroughStyledProse_law11KeepsItVerbatimInText() {
        let styled = ClueEntry(
            number: 18, text: "*bold star", cells: [0], isAcross: true,
            runs: [ClueTextRun(text: "*"), ClueTextRun(text: "bold star", styles: [.bold])])
        XCTAssertTrue(isStarredClue(styled))
    }

    func test_toleratesLeadingWhitespaceBeforeTheStar() {
        XCTAssertTrue(
            isStarredClue(ClueEntry(number: 1, text: " *Themed", cells: [0], isAcross: true)))
    }

    // The web's twin also pins a clue with no text at all; ClueEntry.text is non-optional here, so
    // that case has no Swift analogue and the empty string carries it.
    func test_isNotStarredForAMidProseAsteriskOrEmptyText() {
        XCTAssertFalse(
            isStarredClue(ClueEntry(number: 1, text: "Not *this", cells: [0], isAcross: true)))
        XCTAssertFalse(isStarredClue(ClueEntry(number: 1, text: "", cells: [0], isAcross: true)))
    }

    func test_returnsFalseForEmptyOrAbsentRevealerText() {
        XCTAssertFalse(referencesStarredClues(""))
        XCTAssertFalse(referencesStarredClues(nil))
    }
}
