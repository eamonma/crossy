import XCTest

@testable import CrossyUI

// The join sheet's presentation policy (arrival notes, DESIGN.md §4). Join with a
// code rides a glass sheet grown from the button, not a full push. The one bug the
// sheet fixes is the keyboard race: the field used to focus in onAppear, so the
// keyboard rose while the push was mid-flight and jolted. The fix is to defer focus
// until the sheet settles, so the delay must be nonzero, and the detent must leave
// room for the field, the failure line, the button, and the keyboard.

final class JoinSheetPresentationTests: XCTestCase {
    func test_focusIsDeferred_notRaisedDuringThePresentation() {
        // The whole fix: focus in onAppear (zero delay) raced the push. A nonzero
        // wait lets the sheet land before the keyboard rises.
        XCTAssertGreaterThan(
            JoinSheetPresentation.focusDelay, .zero,
            "focus must wait for the sheet to settle, never race it (DESIGN.md §4)")
    }

    func test_focusDelayClearsAPresentationLength() {
        // A hair past the sheet's own settle, not a half-second stall. The window
        // pins the intent: long enough that the grow finishes, short enough that
        // the field is ready by the time a thumb reaches it.
        XCTAssertGreaterThanOrEqual(JoinSheetPresentation.focusDelay, .milliseconds(300))
        XCTAssertLessThanOrEqual(JoinSheetPresentation.focusDelay, .milliseconds(600))
    }

    func test_theDetentIsACardNotAFullPage() {
        // One field plus a button reads as a card grown from the button, never a
        // page. A fraction well under half keeps it a card; nonzero keeps the
        // field and keyboard on screen.
        XCTAssertGreaterThan(JoinSheetPresentation.detentFraction, 0)
        XCTAssertLessThan(
            JoinSheetPresentation.detentFraction, 0.6,
            "a one-field sheet is a card, not a full page (arrival notes)")
    }
}
