// The personal reaction set editor model (Wave 8.5; PROTOCOL.md §9, §12; D25), the Android twin of
// the iOS SettingsScreen reactions logic and the DisplayNameOnboardingModel shape: slot replace,
// dirty tracking, edge validation through :protocol ReactionSetSpec, and the resilient save loop. A
// confirmed save adopts the server's canonical set and closes; a REACTION_SET_* rejection keeps the
// draft with the inline error; transport/5xx auto-retries with backoff; a 429 waits out Retry-After;
// after the bounded retries it hands control back, and nothing signs the person out (INV-11). Sleep
// is injected, so the loop runs with no delay under runBlocking.

package crossy.ui

import crossy.protocol.ReactionSetSpec
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ReactionSetEditorModelTests {
    private val defaults = ReactionSetSpec.defaultSet

    /** A save spy: a scripted sequence of outcomes, one per attempt, recording the sets it saw. */
    private class SaveSpy(outcomes: List<ReactionSetOutcome>) {
        private val remaining = outcomes.toMutableList()
        val calls = mutableListOf<List<String>?>()

        fun next(set: List<String>?): ReactionSetOutcome {
            calls.add(set)
            return if (remaining.size > 1) remaining.removeAt(0) else remaining.firstOrNull()
                ?: ReactionSetOutcome.Retryable(null)
        }
    }

    private fun makeModel(
        initialPersonal: List<String>? = null,
        outcomes: List<ReactionSetOutcome>,
        maxAutoRetries: Int = 3,
        onSaved: (List<String>?) -> Unit = {},
    ): Pair<ReactionSetEditorModel, SaveSpy> {
        val spy = SaveSpy(outcomes)
        val model = ReactionSetEditorModel(
            initialPersonal = initialPersonal,
            save = { set -> spy.next(set) },
            onSaved = onSaved,
            maxAutoRetries = maxAutoRetries,
            baseBackoffMillis = 0,
            sleep = { },
        )
        return model to spy
    }

    @Test
    fun nullInitialPersonalStartsOnTheDefaults_PROTOCOL9() {
        val (model, _) = makeModel(outcomes = listOf(ReactionSetOutcome.Saved(null)))
        assertEquals(defaults, model.slots, "a null personal set shows the default five")
        assertFalse(model.isDirty, "the defaults are the baseline")
        assertFalse(model.canReset, "already on the defaults: nothing to reset")
        assertFalse(model.canSave, "nothing edited yet")
    }

    @Test
    fun aChosenInitialSetShowsAndEnablesReset_PROTOCOL12() {
        val chosen = listOf("🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶")
        val (model, _) = makeModel(initialPersonal = chosen, outcomes = listOf(ReactionSetOutcome.Saved(null)))
        assertEquals(chosen, model.slots)
        assertTrue(model.canReset, "a custom set can be reset to defaults")
    }

    @Test
    fun replacingASlotMakesTheDraftDirtyAndSavable_PROTOCOL12() {
        val (model, _) = makeModel(outcomes = listOf(ReactionSetOutcome.Saved(null)))
        model.toggleSlot(0)
        assertTrue(model.applyEntry("🦆"), "a valid single emoji lands")
        assertEquals("🦆", model.slots[0])
        assertTrue(model.isDirty)
        assertTrue(model.canSave, "a clean dirty draft can save")
    }

    @Test
    fun aDuplicateSlotBlocksSaveWithTheLocalRule_PROTOCOL12() {
        // The defaults are 🔥🤔🐐💀😭; setting slot 1 to 🔥 duplicates slot 0.
        val (model, spy) = makeModel(outcomes = listOf(ReactionSetOutcome.Saved(null)))
        model.toggleSlot(1)
        model.applyPick("🔥")
        assertFalse(model.canSave, "a duplicate cannot save (the server would 422)")
        assertEquals("Each slot needs its own emoji.", model.validationMessage)
        runBlocking { model.save() }
        assertEquals(0, spy.calls.size, "a locally-invalid draft never reaches the wire")
    }

    @Test
    fun anInvalidFieldEntryShowsTheGentleRuleNotAnError_PROTOCOL9() {
        val (model, _) = makeModel(outcomes = listOf(ReactionSetOutcome.Saved(null)))
        model.toggleSlot(0)
        assertFalse(model.applyEntry("ab"), "two chars is not one emoji")
        assertTrue(model.ruleNudge, "the gentle rule shows")
        assertFalse(model.hasServerError, "nothing was judged: not a server error")
        assertEquals(defaults[0], model.slots[0], "the slot is untouched")
    }

    @Test
    fun aConfirmedSaveAdoptsTheCanonicalSetAndClears_PROTOCOL12() {
        var adopted: List<String>? = defaults
        val chosen = listOf("🦆", "🤔", "🐐", "💀", "😭")
        val (model, spy) = makeModel(
            outcomes = listOf(ReactionSetOutcome.Saved(chosen)),
            onSaved = { adopted = it },
        )
        model.toggleSlot(0)
        model.applyPick("🦆")
        runBlocking { model.save() }
        assertEquals(chosen, model.saved, "the confirmed canonical set is adopted")
        assertEquals(chosen, adopted, "and reported upward for the room fan")
        assertFalse(model.isDirty, "the draft now matches the saved set")
        assertNull(model.editingSlot, "the editor closes on save")
        assertEquals(1, spy.calls.size)
        assertEquals(chosen, spy.calls[0], "the whole draft is written")
    }

    @Test
    fun resetSavesAnExplicitNullAndReturnsToDefaults_PROTOCOL12() {
        var adopted: List<String>? = listOf("x")
        val chosen = listOf("🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶")
        val (model, spy) = makeModel(
            initialPersonal = chosen,
            outcomes = listOf(ReactionSetOutcome.Saved(null)),
            onSaved = { adopted = it },
        )
        runBlocking { model.reset() }
        assertNull(spy.calls[0], "reset writes an explicit null, the reset command")
        assertNull(model.saved, "the account is back on the defaults")
        assertNull(adopted, "null reported upward = the defaults")
        assertEquals(defaults, model.slots)
        assertFalse(model.canReset, "nothing to reset once on the defaults")
    }

    @Test
    fun aNamedRejectionKeepsTheDraftWithTheInlineError_notALockout_PROTOCOL12() {
        val (model, spy) = makeModel(outcomes = listOf(ReactionSetOutcome.Rejected("REACTION_SET_INVALID")))
        model.toggleSlot(0)
        // 🐐‍🔥 is a non-RGI ZWJ chain: the local heuristic accepts it (the documented superset), so
        // it lands and saves, but the server answers 422 REACTION_SET_INVALID, the authority.
        assertTrue(model.applyEntry("🐐‍🔥"), "the heuristic accepts the non-RGI chain")
        runBlocking { model.save() }
        assertTrue(model.hasServerError)
        assertEquals("One emoji fills a slot.", model.validationMessage)
        assertEquals("🐐‍🔥", model.slots[0], "the draft is kept for a correction")
        assertEquals(1, spy.calls.size, "a named rejection does not retry")
    }

    @Test
    fun transientFailureAutoRetriesThenSucceeds_neverSignsOut_INV11() {
        val chosen = listOf("🦆", "🤔", "🐐", "💀", "😭")
        val (model, spy) = makeModel(
            outcomes = listOf(
                ReactionSetOutcome.Retryable(null),
                ReactionSetOutcome.Retryable(null),
                ReactionSetOutcome.Saved(chosen),
            ),
        )
        model.toggleSlot(0)
        model.applyPick("🦆")
        runBlocking { model.save() }
        assertEquals(chosen, model.saved, "the retry eventually lands the set")
        assertFalse(model.hasServerError)
        assertEquals(3, spy.calls.size, "two transient failures then a save")
    }

    @Test
    fun boundedRetriesExhaustedHandsControlBack_retryAvailable() {
        val (model, spy) = makeModel(
            outcomes = listOf(ReactionSetOutcome.Retryable(null)),
            maxAutoRetries = 2,
        )
        model.toggleSlot(0)
        model.applyPick("🦆")
        runBlocking { model.save() }
        assertTrue(model.hasServerError, "a retry-tone error is shown")
        assertFalse(model.isSaving)
        assertTrue(model.canSave, "the dirty draft can be saved again (never a hard wall)")
        assertEquals(3, spy.calls.size, "1 initial + 2 bounded retries")
    }

    @Test
    fun rateLimitedHonorsRetryThenSucceeds() {
        val chosen = listOf("🦆", "🤔", "🐐", "💀", "😭")
        val (model, spy) = makeModel(
            outcomes = listOf(
                ReactionSetOutcome.RateLimited(retryAfterSeconds = 0.0),
                ReactionSetOutcome.Saved(chosen),
            ),
        )
        model.toggleSlot(0)
        model.applyPick("🦆")
        runBlocking { model.save() }
        assertEquals(chosen, model.saved, "after the rate-limit window the save lands")
        assertEquals(2, spy.calls.size, "one 429 then a save")
    }

    @Test
    fun errorCopyKeysOnTheNamedCodes_PROTOCOL12() {
        // The helper is now a thin alias over ArrivalCopy.reactionSetError (the sentence-for-sentence
        // iOS port); this pins that the codes still key one sentence each and never render raw.
        assertEquals("A set is exactly five emoji.", reactionSetErrorCopy("REACTION_SET_LENGTH"))
        assertEquals("One emoji fills a slot.", reactionSetErrorCopy("REACTION_SET_INVALID"))
        assertEquals("Each slot needs its own emoji.", reactionSetErrorCopy("REACTION_SET_DUPLICATE"))
        assertEquals(
            "Too many changes just now. Wait a moment, then try again.",
            reactionSetErrorCopy("RATE_LIMITED"),
        )
        assertEquals(ArrivalCopy.reactionSetError("REACTION_SET_LENGTH"), reactionSetErrorCopy("REACTION_SET_LENGTH"))
        assertTrue(reactionSetErrorCopy(null).startsWith("Couldn't reach"))
    }
}
