// The onboarding submit state machine (docs/design/name-onboarding §9, R4), the Android twin of
// iOS DisplayNameOnboardingModelTests: resilient submit, never a hard lockout. A confirmed save
// adopts and dismisses; a NAME_* rejection keeps the sheet with the inline error; transport/5xx
// auto-retries with backoff; a 429 waits out Retry-After and retries; after the bounded retries it
// hands control back with a retry-tone error, and Continue stays tappable. It never signs out
// (INV-11). Sleep is injected, so the loop runs with no delay under runBlocking.

package crossy.ui

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DisplayNameOnboardingModelTests {
    /** A submit spy: hands back a scripted sequence of outcomes, one per attempt, and records the
     *  names it was called with. The last scripted outcome repeats if the loop runs longer (it
     *  never should, given the cap). Twin of the iOS SubmitSpy. */
    private class SubmitSpy(outcomes: List<DisplayNameOutcome>) {
        private val remaining = outcomes.toMutableList()
        val calls = mutableListOf<String>()

        fun next(name: String): DisplayNameOutcome {
            calls.add(name)
            return if (remaining.size > 1) remaining.removeAt(0) else remaining.firstOrNull()
                ?: DisplayNameOutcome.Retryable(null)
        }
    }

    private fun makeModel(
        prefill: String = "Ada Lovelace",
        outcomes: List<DisplayNameOutcome>,
        maxAutoRetries: Int = 3,
        onSaved: (String) -> Unit = {},
    ): Pair<DisplayNameOnboardingModel, SubmitSpy> {
        val spy = SubmitSpy(outcomes)
        val model = DisplayNameOnboardingModel(
            prefill = prefill,
            submit = { name -> spy.next(name) },
            onSaved = onSaved,
            maxAutoRetries = maxAutoRetries,
            baseBackoffMillis = 0,
            sleep = { },
        )
        return model to spy
    }

    @Test
    fun savedOutcomeAdoptsTheCanonicalNameAndReportsSaved_R4() = runBlocking {
        var adopted: String? = null
        val (model, spy) = makeModel(
            outcomes = listOf(DisplayNameOutcome.Saved("Ada Lovelace")),
            onSaved = { adopted = it },
        )
        model.submitDraft()
        assertEquals("Ada Lovelace", adopted, "the confirmed canonical name is adopted")
        assertFalse(model.hasError)
        assertFalse(model.isSaving)
        assertEquals(1, spy.calls.size, "a clean save is one round trip")
    }

    @Test
    fun nameRejectionKeepsTheSheetWithTheInlineError_notALockout_R4() = runBlocking {
        var adopted: String? = null
        val (model, spy) = makeModel(
            outcomes = listOf(DisplayNameOutcome.NameRejected("NAME_TOO_LONG")),
            onSaved = { adopted = it },
        )
        model.submitDraft()
        assertNull(adopted, "a rejected name is not adopted")
        assertTrue(model.hasError)
        assertEquals("NAME_TOO_LONG", model.errorCode)
        // The prefill is still valid, so Continue stays enabled (one tap reverts): not a lockout.
        assertTrue(model.canSubmit, "the valid prefill keeps Continue tappable")
        assertEquals(1, spy.calls.size, "a name rejection does not retry")
    }

    @Test
    fun transientFailureAutoRetriesThenSucceeds_neverSignsOut_INV11() = runBlocking {
        var adopted: String? = null
        val (model, spy) = makeModel(
            outcomes = listOf(
                DisplayNameOutcome.Retryable(null),
                DisplayNameOutcome.Retryable(null),
                DisplayNameOutcome.Saved("Ada"),
            ),
            onSaved = { adopted = it },
        )
        model.submitDraft()
        assertEquals("Ada", adopted, "the retry eventually lands the name")
        assertFalse(model.hasError)
        assertEquals(3, spy.calls.size, "two transient failures then a save")
    }

    @Test
    fun boundedRetriesExhaustedHandsControlBack_retryAlwaysAvailable_R4() = runBlocking {
        var adopted: String? = null
        val (model, spy) = makeModel(
            // Always transient: the cap is hit.
            outcomes = listOf(DisplayNameOutcome.Retryable(null)),
            maxAutoRetries = 2,
            onSaved = { adopted = it },
        )
        model.submitDraft()
        assertNull(adopted, "nothing is adopted; the write never confirmed")
        assertTrue(model.hasError, "a retry-tone error is shown")
        assertFalse(model.isSaving, "the loop stops; Continue is tappable again")
        assertTrue(model.canSubmit, "retry is always available (never a hard wall)")
        // One initial attempt + maxAutoRetries retries.
        assertEquals(3, spy.calls.size, "1 initial + 2 bounded retries")
    }

    @Test
    fun rateLimitedHonorsRetryThenSucceeds_R4() = runBlocking {
        var adopted: String? = null
        val (model, spy) = makeModel(
            outcomes = listOf(
                DisplayNameOutcome.RateLimited(retryAfterSeconds = 0.0),
                DisplayNameOutcome.Saved("Ada"),
            ),
            onSaved = { adopted = it },
        )
        model.submitDraft()
        assertEquals("Ada", adopted, "after the rate-limit window the save lands")
        assertEquals(2, spy.calls.size, "one 429 then a save")
    }

    @Test
    fun emptyDraftCannotSubmit_theGoalIsAlwaysAName() = runBlocking {
        val (model, spy) = makeModel(prefill = "   ", outcomes = listOf(DisplayNameOutcome.Saved("x")))
        assertFalse(model.canSubmit, "a whitespace-only draft canonicalizes to empty")
        model.submitDraft()
        assertEquals(0, spy.calls.size, "an empty draft never reaches the wire")
    }

    @Test
    fun draftIsSanitizedOnSet_stripsDisallowedScalars_INV1() {
        val (model, _) = makeModel(outcomes = listOf(DisplayNameOutcome.Saved("x")))
        // A lone zero-width space (U+200B) and a bidi override (U+202E) are single-scalar clusters,
        // both stripped by the edge sanitizer; the surrounding letters survive.
        model.draft = "Ada​‮Lovelace"
        assertEquals("AdaLovelace", model.draft, "lone zero-width + bidi override stripped")
        // Casing is preserved through the sanitizer: names are not ASCII-folded (INV-1 cell-only).
        model.draft = "AdA"
        assertEquals("AdA", model.draft)
    }
}
