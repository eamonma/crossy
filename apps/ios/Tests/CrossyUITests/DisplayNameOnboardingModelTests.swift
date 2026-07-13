import XCTest

@testable import CrossyUI

// The onboarding submit state machine (docs/design/name-onboarding.md §9, R4): resilient
// submit, never a hard lockout. A confirmed save adopts and dismisses; a NAME_* rejection
// keeps the sheet with the inline error; transport/5xx auto-retries with backoff; a 429
// waits out Retry-After and retries; after the bounded retries it hands control back with a
// retry-tone error, and Continue stays tappable (retry always available). It never signs
// out (INV-11) and never walls the app. Sleep is injected, so the loop runs with no delay.

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class DisplayNameOnboardingModelTests: XCTestCase {
    /// A submit spy: hands back a scripted sequence of outcomes, one per attempt, and
    /// records the names it was called with. The last scripted outcome repeats if the loop
    /// runs longer (it never should, given the cap).
    private final class SubmitSpy {
        private var outcomes: [DisplayNameOutcome]
        private(set) var calls: [String] = []

        init(_ outcomes: [DisplayNameOutcome]) {
            self.outcomes = outcomes
        }

        func next(_ name: String) -> DisplayNameOutcome {
            calls.append(name)
            if outcomes.count > 1 {
                return outcomes.removeFirst()
            }
            return outcomes.first ?? .retryable(code: nil)
        }
    }

    private func makeModel(
        prefill: String = "Ada Lovelace",
        outcomes: [DisplayNameOutcome],
        maxAutoRetries: Int = 3,
        onSaved: @escaping (String) -> Void = { _ in }
    ) -> (DisplayNameOnboardingModel, SubmitSpy) {
        let spy = SubmitSpy(outcomes)
        let model = DisplayNameOnboardingModel(
            prefill: prefill,
            submit: { name in spy.next(name) },
            onSaved: onSaved,
            maxAutoRetries: maxAutoRetries,
            baseBackoff: 0,
            // No real delay: the injected sleep returns immediately.
            sleep: { _ in })
        return (model, spy)
    }

    func test_savedOutcomeAdoptsTheCanonicalNameAndReportsSaved_R4() async {
        var adopted: String?
        let (model, spy) = makeModel(
            outcomes: [.saved(canonical: "Ada Lovelace")],
            onSaved: { adopted = $0 })
        await model.submitDraft()
        XCTAssertEqual(adopted, "Ada Lovelace", "the confirmed canonical name is adopted")
        XCTAssertFalse(model.hasError)
        XCTAssertFalse(model.isSaving)
        XCTAssertEqual(spy.calls.count, 1, "a clean save is one round trip")
    }

    func test_nameRejectionKeepsTheSheetWithTheInlineError_notALockout_R4() async {
        var adopted: String?
        let (model, spy) = makeModel(
            outcomes: [.nameRejected(code: "NAME_TOO_LONG")],
            onSaved: { adopted = $0 })
        await model.submitDraft()
        XCTAssertNil(adopted, "a rejected name is not adopted")
        XCTAssertTrue(model.hasError)
        XCTAssertEqual(model.errorCode, "NAME_TOO_LONG")
        // The prefill is still valid, so Continue stays enabled (one tap reverts): not a
        // lockout.
        XCTAssertTrue(model.canSubmit, "the valid prefill keeps Continue tappable")
        XCTAssertEqual(spy.calls.count, 1, "a name rejection does not retry")
    }

    func test_transientFailureAutoRetriesThenSucceeds_neverSignsOut_INV11() async {
        var adopted: String?
        let (model, spy) = makeModel(
            outcomes: [.retryable(code: nil), .retryable(code: nil), .saved(canonical: "Ada")],
            onSaved: { adopted = $0 })
        await model.submitDraft()
        XCTAssertEqual(adopted, "Ada", "the retry eventually lands the name")
        XCTAssertFalse(model.hasError)
        XCTAssertEqual(spy.calls.count, 3, "two transient failures then a save")
    }

    func test_boundedRetriesExhaustedHandsControlBack_retryAlwaysAvailable_R4() async {
        var adopted: String?
        let (model, spy) = makeModel(
            // Always transient: the cap is hit.
            outcomes: [.retryable(code: nil)],
            maxAutoRetries: 2,
            onSaved: { adopted = $0 })
        await model.submitDraft()
        XCTAssertNil(adopted, "nothing is adopted; the write never confirmed")
        XCTAssertTrue(model.hasError, "a retry-tone error is shown")
        XCTAssertFalse(model.isSaving, "the loop stops; Continue is tappable again")
        XCTAssertTrue(model.canSubmit, "retry is always available (never a hard wall)")
        // One initial attempt + maxAutoRetries retries.
        XCTAssertEqual(spy.calls.count, 3, "1 initial + 2 bounded retries")
    }

    func test_rateLimitedHonorsRetryThenSucceeds_R4() async {
        var adopted: String?
        let (model, spy) = makeModel(
            outcomes: [.rateLimited(retryAfter: 0), .saved(canonical: "Ada")],
            onSaved: { adopted = $0 })
        await model.submitDraft()
        XCTAssertEqual(adopted, "Ada", "after the rate-limit window the save lands")
        XCTAssertEqual(spy.calls.count, 2, "one 429 then a save")
    }

    func test_emptyDraftCannotSubmit_theGoalIsAlwaysAName() async {
        let (model, spy) = makeModel(prefill: "   ", outcomes: [.saved(canonical: "x")])
        XCTAssertFalse(model.canSubmit, "a whitespace-only draft canonicalizes to empty")
        await model.submitDraft()
        XCTAssertEqual(spy.calls.count, 0, "an empty draft never reaches the wire")
    }

    func test_draftIsSanitizedOnSet_stripsDisallowedScalars() {
        let (model, _) = makeModel(outcomes: [.saved(canonical: "x")])
        model.draft = "Ada\u{200B}\u{202E}Lovelace"
        XCTAssertEqual(model.draft, "AdaLovelace", "lone zero-width + bidi override stripped")
    }
}
