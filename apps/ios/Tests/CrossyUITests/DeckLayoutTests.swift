import XCTest

@testable import CrossyUI

// Deck geometry (ID-4; the SP-i2 rig's numbers). The math is pure so the layout is
// pinned headlessly: the top row and the specials row fill the deck width exactly,
// the home row centers inside it, and the key set is the full alphabet plus
// backspace and the rebus key (EXPERIENCE.md baseline).

final class DeckLayoutTests: XCTestCase {
    /// iPhone-ish deck widths, including a non-integral one.
    private let widths: [CGFloat] = [366, 390, 402.5, 430]

    func test_topRow_tenKeysAndNineGapsFillTheDeckWidthExactly_ID4() {
        for width in widths {
            XCTAssertEqual(
                DeckLayout.rowWidth(row: 0, deckWidth: width), width, accuracy: 0.001)
        }
    }

    func test_specialsRow_rebusPlusSevenLettersPlusBackspaceFillsTheWidthExactly_ID4() {
        for width in widths {
            XCTAssertEqual(
                DeckLayout.rowWidth(row: 2, deckWidth: width), width, accuracy: 0.001)
        }
    }

    func test_homeRow_nineKeysSitInsideTheDeckWidth_centeredByTheView() {
        for width in widths {
            XCTAssertLessThan(DeckLayout.rowWidth(row: 1, deckWidth: width), width)
        }
    }

    func test_keys_coverTheFullAlphabetOnceWithRebusLeadingAndBackspaceTrailing() {
        let rows = (0..<DeckLayout.letterRows.count).map { DeckLayout.keys(row: $0) }
        XCTAssertEqual(rows[2].first, .rebus)
        XCTAssertEqual(rows[2].last, .backspace)
        let letters = rows.flatMap { row in
            row.compactMap { key -> Character? in
                if case .letter(let character) = key { return character }
                return nil
            }
        }
        XCTAssertEqual(letters.count, 26)
        XCTAssertEqual(Set(letters), Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ"))
    }

    func test_deckHeight_isThreeKeyRowsAndTwoGaps_theRigsPitch() {
        XCTAssertEqual(
            DeckLayout.deckHeight,
            DeckLayout.keyHeight * 3 + DeckLayout.rowSpacing * 2)
    }

    func test_specialKeyWidth_isOneAndAHalfUnitsPlusHalfAGap_theRigsBackspace() {
        for width in widths {
            let unit = DeckLayout.keyWidth(deckWidth: width)
            XCTAssertEqual(
                DeckLayout.specialKeyWidth(deckWidth: width),
                unit * 1.5 + DeckLayout.keySpacing * 0.5,
                accuracy: 0.001)
        }
    }
}
