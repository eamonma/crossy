// The personal reaction set editor (Wave 8.5; PROTOCOL.md §9, §12; DESIGN.md D25), the Android twin
// of the iOS SettingsScreen reactions card. Two parts, split the way the repo splits onboarding: a
// PURE, JVM-testable model that owns the slot editing, the dirty tracking, the client-side validation
// (through the vector-pinned :protocol ReactionSetSpec), and the resilient save loop (exactly the
// DisplayNameOnboardingModel shape, sleep injected so tests run with no delay); and a thin Compose
// section that renders the model's state and translates taps into its calls. The composition root
// owns the actual `PATCH /me` write behind the injected `save`, and mirrors a saved canonical set
// back into the room's fan through `onSaved`.
//
// The set is byte-exact and never normalized (§12): the model gates a slot entry with
// ReactionSetSpec.isReactionEmoji and the whole draft with ReactionSetSpec.validate, so a duplicate or
// a non-emoji names its rule locally without a round trip; the server's REACTION_SET_* 422 stays the
// authority the inline message surfaces when the heuristic and the server ever disagree (the three
// documented divergence shapes). null is first-class throughout: it is the reset-to-defaults command.

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.ReactionSetSpec
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The result of one `PATCH /me {reactionSet}` attempt, the composition root's mapping of the API's
 * outcome into the four cases the save loop acts on (the DisplayNameOutcome twin). Kept
 * transport-agnostic so the model is testable with scripted outcomes.
 */
sealed interface ReactionSetOutcome {
    /** The write confirmed; adopt the server's canonical set (null = the defaults) and close. */
    data class Saved(val canonical: List<String>?) : ReactionSetOutcome

    /** A named REACTION_SET_* rejection (422): keep the draft, show the inline error, do not retry. */
    data class Rejected(val code: String) : ReactionSetOutcome

    /** Transport weather or a 5xx: auto-retry within the bound. `code` is a stable tag or null. */
    data class Retryable(val code: String?) : ReactionSetOutcome

    /** A 429: wait out `retryAfterSeconds` (or the backoff when the header was absent), then retry. */
    data class RateLimited(val retryAfterSeconds: Double?) : ReactionSetOutcome
}

/**
 * The five-slot editor's whole state and logic, a pure function of scripted saves (no Compose type
 * crosses its logic; the state is Compose-observable through mutableStateOf, the DisplayNameOnboarding
 * shape). The working [draft] is always a full five; edits replace one slot; [isDirty] tracks the
 * draft against the last server-confirmed set (or the defaults); [validationMessage] names a local or
 * server rule. `save` writes the whole draft (or null to reset); `onSaved` reports the adopted
 * canonical set upward so an open room's fan can follow on next entry.
 */
class ReactionSetEditorModel(
    initialPersonal: List<String>?,
    private val save: suspend (List<String>?) -> ReactionSetOutcome,
    private val onSaved: (List<String>?) -> Unit = {},
    private val maxAutoRetries: Int = 3,
    private val baseBackoffMillis: Long = 400,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    /** The last server-confirmed personal set, or null when the account is on the defaults. Only a
     *  value the spec accepts is adopted, so a misbehaving server can never wedge the editor. */
    var saved by mutableStateOf(initialPersonal?.takeIf { ReactionSetSpec.validate(it) == null })
        private set

    /** The working five in slot order. Starts from the saved set, else the defaults; a slot edit
     *  replaces one entry, so it is always exactly five. */
    var draft by mutableStateOf(saved ?: ReactionSetSpec.defaultSet)
        private set

    /** The slot whose inline editor is open, or null when none is. One opens at a time. */
    var editingSlot by mutableStateOf<Int?>(null)
        private set

    /** A save (the initial attempt plus any auto-retries) is in flight. */
    var isSaving by mutableStateOf(false)
        private set

    /** True when the last save ended in a shown error (a REACTION_SET_* rejection or an exhausted
     *  retry). Distinct from a local validation message, which needs no save. */
    var hasServerError by mutableStateOf(false)
        private set

    /** The REACTION_SET_* / RATE_LIMITED code the server error is keyed on, or null for a retry-tone
     *  failure. */
    var serverErrorCode by mutableStateOf<String?>(null)
        private set

    /** The gentle single-emoji rule, shown when a field entry fails the local gate (distinct from a
     *  server error: nothing was judged, the field just explains). */
    var ruleNudge by mutableStateOf(false)
        private set

    /** The set the draft is measured against for dirtiness: the saved set, else the defaults. */
    private val baseline: List<String> get() = saved ?: ReactionSetSpec.defaultSet

    /** The five the slot row shows: the working draft (always a full five). */
    val slots: List<String> get() = draft

    /** The draft differs from the last confirmed set (or the defaults): there is something to save. */
    val isDirty: Boolean get() = draft != baseline

    /** The local whole-draft violation (a duplicate, a non-emoji), or null when the draft is clean.
     *  The server stays the authority for the RGI-list divergence; this catches what the edge can. */
    val localError get() = ReactionSetSpec.validate(draft)

    /** Save is offered only for a clean, dirty draft not already in flight. */
    val canSave: Boolean get() = !isSaving && isDirty && localError == null

    /** Reset-to-defaults is offered only when the account is on a custom set (a null PATCH would
     *  otherwise be a no-op write). */
    val canReset: Boolean get() = !isSaving && saved != null

    /** The inline message beneath the editor: a server rejection first, else a local rule, else none.
     *  A pending single-emoji field rule ([ruleNudge]) renders separately, beside the field. */
    val validationMessage: String?
        get() = when {
            hasServerError -> reactionSetErrorCopy(serverErrorCode)
            localError != null -> reactionSetErrorCopy(localError!!.wire)
            else -> null
        }

    /** Open (or, when already open, toggle closed) a slot's inline editor. Clears the transient
     *  field rule and any prior server error so the editor opens clean. */
    fun toggleSlot(index: Int) {
        editingSlot = if (editingSlot == index) null else index
        ruleNudge = false
        hasServerError = false
        serverErrorCode = null
    }

    fun closeSlot() {
        editingSlot = null
        ruleNudge = false
    }

    /** A house-pick chip: a known-valid single emoji lands in the open slot at once. */
    fun applyPick(emoji: String) {
        val slot = editingSlot ?: return
        replaceSlot(slot, emoji)
    }

    /** A free-entry field submission: a valid single emoji lands in the open slot; anything else is
     *  refused with the gentle rule (never an error tone). Returns whether it landed. */
    fun applyEntry(raw: String): Boolean {
        val slot = editingSlot ?: return false
        return if (ReactionSetSpec.isReactionEmoji(raw)) {
            replaceSlot(slot, raw)
            true
        } else {
            ruleNudge = true
            false
        }
    }

    private fun replaceSlot(slot: Int, emoji: String) {
        if (!draft.indices.contains(slot)) return
        draft = draft.toMutableList().also { it[slot] = emoji }
        ruleNudge = false
        hasServerError = false
        serverErrorCode = null
    }

    /** Save the whole draft through `PATCH /me` (the resilient loop). */
    suspend fun save() {
        if (isSaving || !canSave) return
        runSave(draft)
    }

    /** Reset to the default five: a `PATCH /me {reactionSet: null}` write. */
    suspend fun reset() {
        if (isSaving || !canReset) return
        runSave(null)
    }

    /**
     * The resilient save loop (the DisplayNameOnboardingModel shape, R4): a confirmed write adopts
     * the canonical set and closes; a REACTION_SET_* rejection keeps the draft with the inline error;
     * transport/5xx auto-retries with backoff; a 429 waits out its Retry-After; after the bounded
     * retries it hands control back with a retry-tone error. Never signs out, never walls the editor.
     */
    private suspend fun runSave(target: List<String>?) {
        isSaving = true
        hasServerError = false
        serverErrorCode = null
        ruleNudge = false
        var attempt = 0
        while (true) {
            when (val outcome = save(target)) {
                is ReactionSetOutcome.Saved -> {
                    saved = outcome.canonical?.takeIf { ReactionSetSpec.validate(it) == null }
                    draft = saved ?: ReactionSetSpec.defaultSet
                    editingSlot = null
                    onSaved(saved)
                    isSaving = false
                    return
                }
                is ReactionSetOutcome.Rejected -> {
                    serverErrorCode = outcome.code
                    hasServerError = true
                    isSaving = false
                    return
                }
                is ReactionSetOutcome.Retryable -> {
                    if (attempt >= maxAutoRetries) {
                        serverErrorCode = outcome.code
                        hasServerError = true
                        isSaving = false
                        return
                    }
                    attempt += 1
                    sleep(baseBackoffMillis * attempt)
                }
                is ReactionSetOutcome.RateLimited -> {
                    if (attempt >= maxAutoRetries) {
                        serverErrorCode = "RATE_LIMITED"
                        hasServerError = true
                        isSaving = false
                        return
                    }
                    attempt += 1
                    val delayMillis = outcome.retryAfterSeconds
                        ?.let { (it * 1000).toLong() }
                        ?: (baseBackoffMillis * attempt)
                    sleep(delayMillis)
                }
            }
        }
    }
}

/** The house picks the quick-grid offers (the iOS strawman 2026-07-14): the default five first, in
 *  slot order, then the crowd favorites (the retired Phase 7 three included). One shared list so the
 *  editor and any future picker read the same shelf. */
val reactionHousePicks: List<String> = listOf(
    "🔥", "🤔", "🐐", "💀", "😭",
    "🎉", "👀", "🫡", "🤯", "❤️", "👏", "🧠", "🙏", "✨", "😤", "🥳",
)

/** The inline error copy keyed on the server's REACTION_SET_* code (or a local rule of the same
 *  name). A thin alias now: the sentences live on [ArrivalCopy.reactionSetError] (the sentence-for-
 *  sentence iOS port), so this name only stands for the callers that already read it. A null code is
 *  network weather after the bounded retries; the raw code never renders. */
fun reactionSetErrorCopy(code: String?): String = ArrivalCopy.reactionSetError(code)

/**
 * The Settings reactions section (Wave 8.5): the five slots in slot order, an inline editor for the
 * open slot (a quick grid of house picks plus a one-emoji field), a Save button, and the
 * reset-to-defaults affordance. Follows the SettingsScreen section grammar (a 13sp caps-ish label
 * over the control). Reads [model]'s Compose state; the model owns every rule, so this only renders
 * and forwards taps.
 */
@Composable
fun ReactionSetSection(model: ReactionSetEditorModel) {
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        Text(
            "Reactions",
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            "The five reactions your send fan offers.",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            model.slots.forEachIndexed { index, emoji ->
                ReactionSlotButton(
                    emoji = emoji,
                    label = "Slot ${index + 1}: $emoji",
                    selected = model.editingSlot == index,
                    enabled = !model.isSaving,
                    onClick = { model.toggleSlot(index) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        model.editingSlot?.let { slot ->
            ReactionSlotEditor(
                model = model,
                slot = slot,
            )
        }

        model.validationMessage?.let { message ->
            Text(message, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Button(
                onClick = { scope.launch { model.save() } },
                enabled = model.canSave,
            ) { Text("Save reactions") }

            TextButton(
                onClick = { scope.launch { model.reset() } },
                enabled = model.canReset,
            ) { Text("Reset to defaults") }

            if (model.isSaving) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            }
        }
    }
}

/** One slot square: its emoji, an ink ring when it is the open slot. */
@Composable
private fun ReactionSlotButton(
    emoji: String,
    // The spoken name (iOS "Slot N: emoji"): the slot index and its emoji, so a reader hears which slot.
    label: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val border = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    Box(
        modifier = modifier
            .size(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .border(if (selected) 2.dp else 1.dp, border, RoundedCornerShape(12.dp))
            .semantics {
                contentDescription = label
                role = Role.Button
                if (selected) stateDescription = "editing"
            }
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(emoji, fontSize = 24.sp)
    }
}

/** The open slot's editor: a house-pick quick grid, then a one-emoji field. A valid single emoji
 *  lands the slot; anything else shows the gentle rule beside the field. */
@Composable
private fun ReactionSlotEditor(model: ReactionSetEditorModel, slot: Int) {
    var field by remember(slot) { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        // The quick grid, wrapped into rows of eight (a plain flow; the picks are a fixed shelf).
        reactionHousePicks.chunked(8).forEach { rowPicks ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                rowPicks.forEach { pick ->
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .size(40.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .semantics { contentDescription = "Use $pick"; role = Role.Button }
                            .clickable(enabled = !model.isSaving) {
                                model.applyPick(pick)
                                field = ""
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(pick, fontSize = 22.sp)
                    }
                }
                // Pad the final short row so the grid stays a clean eight columns.
                repeat(8 - rowPicks.size) { Box(modifier = Modifier.weight(1f)) }
            }
        }

        OutlinedTextField(
            value = field,
            onValueChange = { new ->
                field = new
                if (new.isEmpty()) return@OutlinedTextField
                // A valid single emoji lands and clears the field; the newest grapheme is tried too so
                // typing a second emoji swaps rather than appends. Anything else shows the gentle rule.
                if (model.applyEntry(new)) {
                    field = ""
                } else {
                    val newest = new.takeLast(2).takeIf { crossy.protocol.ReactionSetSpec.isReactionEmoji(it) }
                        ?: new.takeLast(1)
                    if (model.applyEntry(newest)) field = ""
                }
            },
            singleLine = true,
            enabled = !model.isSaving,
            label = { Text("Type an emoji") },
            modifier = Modifier.width(200.dp),
        )

        if (model.ruleNudge) {
            Text(
                "One emoji per slot.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Start,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}
