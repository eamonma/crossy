// The display-name onboarding submit state machine (docs/design/name-onboarding §9, R4), the
// Android twin of iOS DisplayNameOnboardingModel. Resilient submit, never a hard lockout: a
// confirmed save adopts the canonical name and dismisses; a NAME_* rejection keeps the sheet with
// the inline error; transport/5xx auto-retries with backoff; a 429 waits out its Retry-After and
// retries; after the bounded retries it hands control back with a retry-tone error, and Continue
// stays tappable (retry is always available). It never signs out (INV-11) and never walls the app.
// Sleep is injected so the loop runs with no delay in tests, exactly the headless shape iOS uses.
//
// The draft is sanitized on every set through the vector-pinned :protocol twin (DisplayName), so
// the field never holds a value the server would reject for shape, and casing is preserved (INV-1
// is cell-values only, not names). The model holds Compose state; the screen renders it and the
// composition root owns the actual /me write behind the injected `submit`.

package crossy.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import crossy.protocol.DisplayName
import kotlinx.coroutines.delay

/**
 * The result of one `PATCH /me` attempt, the composition root's mapping of the API's outcome into
 * the four cases the submit loop acts on. Kept transport-agnostic so the model is testable with
 * scripted outcomes (the iOS DisplayNameOutcome twin).
 */
sealed interface DisplayNameOutcome {
    /** The write confirmed; adopt the server's canonical stored value and dismiss. */
    data class Saved(val canonical: String) : DisplayNameOutcome

    /** A named NAME_* rejection (422): keep the sheet, show the inline error, do not retry. */
    data class NameRejected(val code: String) : DisplayNameOutcome

    /** Transport weather or a 5xx: auto-retry within the bound. `code` is a stable tag or null. */
    data class Retryable(val code: String?) : DisplayNameOutcome

    /** A 429: wait out `retryAfterSeconds` (or the backoff when the header was absent), then retry. */
    data class RateLimited(val retryAfterSeconds: Double?) : DisplayNameOutcome
}

class DisplayNameOnboardingModel(
    prefill: String,
    private val submit: suspend (String) -> DisplayNameOutcome,
    private val onSaved: (String) -> Unit,
    private val maxAutoRetries: Int = 3,
    private val baseBackoffMillis: Long = 400,
    // Injected so tests run the loop with no real delay; the app passes kotlinx delay.
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private var draftState by mutableStateOf(DisplayName.sanitize(prefill))

    /** The field value. Sanitized on every set through the vector-pinned edge filter, so the field
     *  can never hold a disallowed scalar or exceed the grapheme cap (no trim/collapse mid-type). */
    var draft: String
        get() = draftState
        set(value) {
            draftState = DisplayName.sanitize(value)
        }

    /** A save is in flight (the initial attempt plus any auto-retries), so the CTA shows progress. */
    var isSaving by mutableStateOf(false)
        private set

    /** The last attempt ended in a shown error (a NAME_* rejection or an exhausted retry). */
    var hasError by mutableStateOf(false)
        private set

    /** The NAME_* code the inline error is keyed on, or null for a retry-tone (non-name) failure. */
    var errorCode by mutableStateOf<String?>(null)
        private set

    /** Continue is tappable exactly when the draft is a complete name and no save is in flight.
     *  A valid prefill keeps it enabled even after a rejection, so onboarding is never a dead end. */
    val canSubmit: Boolean
        get() = !isSaving && DisplayName.isComplete(draftState)

    /**
     * Run the resilient submit loop. Guards an empty or in-flight draft (never reaches the wire),
     * then attempts the write, auto-retrying transient failures and rate limits within the bound and
     * surfacing a NAME_* rejection as an inline error. Sends the draft verbatim; the server
     * canonicalizes and returns the value adopted via `onSaved`.
     */
    suspend fun submitDraft() {
        if (isSaving || !DisplayName.isComplete(draftState)) return
        isSaving = true
        hasError = false
        errorCode = null
        val name = draftState
        var attempt = 0
        while (true) {
            when (val outcome = submit(name)) {
                is DisplayNameOutcome.Saved -> {
                    onSaved(outcome.canonical)
                    isSaving = false
                    return
                }
                is DisplayNameOutcome.NameRejected -> {
                    // A name the server refused: no retry (retrying the same name repeats it). The
                    // valid prefill keeps Continue tappable, so this is a correction, not a lockout.
                    errorCode = outcome.code
                    hasError = true
                    isSaving = false
                    return
                }
                is DisplayNameOutcome.Retryable -> {
                    if (attempt >= maxAutoRetries) {
                        // Hand control back with a retry-tone error; Continue stays tappable so the
                        // person can try again (never a hard wall, never a sign-out, INV-11).
                        errorCode = outcome.code
                        hasError = true
                        isSaving = false
                        return
                    }
                    attempt += 1
                    sleep(baseBackoffMillis * attempt)
                }
                is DisplayNameOutcome.RateLimited -> {
                    if (attempt >= maxAutoRetries) {
                        errorCode = null
                        hasError = true
                        isSaving = false
                        return
                    }
                    attempt += 1
                    // Honor Retry-After when the header carried a delay, else fall back to backoff.
                    val delayMillis = outcome.retryAfterSeconds
                        ?.let { (it * 1000).toLong() }
                        ?: (baseBackoffMillis * attempt)
                    sleep(delayMillis)
                }
            }
        }
    }
}

/** The inline error copy keyed on the server's NAME_* code. A thin alias now: the sentences live on
 *  [ArrivalCopy.displayNameError] (the sentence-for-sentence iOS port), so this name only stands for
 *  the callers that already read it. A null code is network weather after the bounded retries; the
 *  raw code never renders. */
fun displayNameErrorCopy(code: String?): String = ArrivalCopy.displayNameError(code)
