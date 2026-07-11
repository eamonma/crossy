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

    func test_theFocusedViewportIsALiveStripNotAFold() {
        // The camera stays live under the keyboard (owner ruling): the field-focused
        // viewport shrinks to a compact strip, never to zero. A legible strip is
        // well clear of a hairline, and it is shorter than the resting window so the
        // shrink is real.
        XCTAssertGreaterThan(
            JoinSheetPresentation.viewportCompactHeight, 80,
            "the focused viewport is a legible live strip, not a fold to nothing")
        XCTAssertLessThan(
            JoinSheetPresentation.viewportCompactHeight,
            JoinSheetPresentation.viewportHeight,
            "the strip is a shrink of the resting viewport, not the same height")
    }

    func test_focusRaisesTheSheetToClearTheKeyboard() {
        // Focusing the field raises the sheet so the compact strip and the field
        // both clear the keyboard: the focused detent stands taller than the
        // resting camera-first detent, and still fits under the full page.
        XCTAssertGreaterThan(
            JoinSheetPresentation.scanFocusedDetentFraction,
            JoinSheetPresentation.scanDetentFraction,
            "focus lifts the sheet above the keyboard, above the resting detent")
        XCTAssertLessThanOrEqual(
            JoinSheetPresentation.scanFocusedDetentFraction, 1.0,
            "the focused sheet is still a sheet, not past a full page")
    }
}
