import XCTest

@testable import CrossyUI

// The join sheet's presentation policy (arrival notes, DESIGN.md §4). Join with a
// code rides a glass sheet grown from the button, not a full push, and the keyboard
// rises WITH the presentation: the field focuses as the sheet appears, so the
// system lifts sheet and keyboard as one motion (a deferred focus let the sheet
// settle and then jump, owner device report 2026-07-10). The detent is the one
// remaining pinnable value: a card, not a page.

final class JoinSheetPresentationTests: XCTestCase {
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
