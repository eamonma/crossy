package crossy.engine.vectors

import crossy.engine.CheckPuzzle
import crossy.engine.MutationCommand
import crossy.engine.RejectionCode
import crossy.engine.applyWithCompletion
import crossy.engine.backspaceTarget
import crossy.engine.getNextCell
import crossy.engine.matches
import crossy.engine.reduce
import crossy.engine.tabTarget
import crossy.engine.typingAdvance
import crossy.engine.wordBounds
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

// The runner's single seam to the engine, mirroring the `bindings` map in vectors.test.ts and
// EngineBindings.swift. Each family the port implements is in `bound` and gets a matching `run`
// arm that parses the vector, calls :engine, and asserts the vector's `then`; the family is then
// drained from apps/android/vectors.skip.json. A family with no binding falls through to
// NoEngineBindingError, which the foreign honest-failure guard relies on. `bound` is the checked
// mirror the guard tests read: a `run` arm cannot name an engine symbol that does not exist yet,
// so binding a family is a compile-time act.
object EngineBindings {
    /**
     * Families the port implements. Kept in sync with `run` and drained from the manifest.
     * CHECK was bound (D27) until Wave 15.1 rewrote its contract to the attributed-majority
     * vote flow (D32); the Kotlin port does not compute the vote state machine yet, so check
     * is unbound and skipped in vectors.skip.json until Wave 15.6 rebinds it.
     */
    val bound: Set<VectorFamily> = setOf(
        VectorFamily.REDUCER,
        VectorFamily.NAVIGATION,
        VectorFamily.COMPARATOR,
        VectorFamily.COMPLETION,
    )

    /** Runs one case against the engine, or throws NoEngineBindingError for a foreign family. */
    fun run(family: VectorFamily, case: JsonObject) {
        when (family) {
            VectorFamily.REDUCER -> runReducer(case)
            VectorFamily.NAVIGATION -> runNavigation(case)
            VectorFamily.COMPARATOR -> runComparator(case)
            VectorFamily.COMPLETION -> runCompletion(case)
            VectorFamily.CHECK -> runCheck(case)
            else -> throw NoEngineBindingError(family)
        }
    }
}

/**
 * Apply each command in `when` in mailbox order, threading state and accumulating events
 * (INV-2). A rejection carries the PROTOCOL §11 code; the sequence has at most one, since every
 * rejection case is a single command (vectors/README.md).
 */
private fun runReducer(c: JsonObject) {
    var state = buildBoardState(c.getValue("given").jsonObject)
    val events = mutableListOf<JsonElement>()
    var error: RejectionCode? = null
    for (step in c.getValue("when").jsonArray) {
        // The reducer never sees a checkPuzzle; it belongs to the check family (PROTOCOL §10). The
        // `when` is exhaustive over the sealed Command and smart-casts the mutation arm.
        val result = when (val command = asCommand(step.jsonObject)) {
            is CheckPuzzle ->
                throw VectorMismatch("checkPuzzle belongs to the check family; the reducer never sees it (PROTOCOL §10)")
            is MutationCommand -> reduce(state, command)
        }
        state = result.state
        result.events.forEach { events.add(serializeCellSet(it)) }
        if (result.error != null) error = result.error
    }
    val then = c.getValue("then").jsonObject
    then["events"]?.let { expectMatch(JsonArray(events), it, "then.events") }
    then["state"]?.let { expectMatch(serializeState(state), it, "then.state") }
    // then.error extends the reducer shape; unasserted when absent (assertion rule).
    if (then.containsKey("error")) {
        val actual: JsonElement = error?.let { JsonPrimitive(it.wire) } ?: JsonNull
        expectMatch(actual, then.getValue("error"), "then.error")
    }
}

/**
 * Dispatch on `when.op` (absent means `advance`, the seed's single-cell getNextCell). Each op
 * fixes its own `when` inputs and `then` outputs (vectors/README.md). `then.direction` is
 * asserted only for `tab`, the one op that can change axis.
 */
private fun runNavigation(c: JsonObject) {
    val given = c.getValue("given").jsonObject
    val grid = buildGrid(given)
    val w = c.getValue("when").jsonObject
    val then = c.getValue("then").jsonObject
    val op = (w["op"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "advance"
    val direction = parseDirection((w["direction"] as? JsonPrimitive)?.content)
    val from = (w["from"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0

    when (op) {
        "advance" -> {
            val toward = parseToward((w["toward"] as? JsonPrimitive)?.content)
            val canEscape = (w["canEscapeWord"] as? JsonPrimitive)?.booleanOrNull ?: true
            val cell = getNextCell(grid, direction, from, toward, canEscape)
            expectMatch(JsonPrimitive(cell), then.getValue("cell"), "then.cell")
        }
        "wordBounds" -> {
            val bounds = wordBounds(grid, direction, from)
            expectMatch(JsonPrimitive(bounds.start), then.getValue("start"), "then.start")
            expectMatch(JsonPrimitive(bounds.end), then.getValue("end"), "then.end")
        }
        "tab" -> {
            val toward = parseToward((w["toward"] as? JsonPrimitive)?.content)
            val result = tabTarget(grid, direction, from, toward, buildFilled(given))
            expectMatch(JsonPrimitive(result.cell), then.getValue("cell"), "then.cell")
            expectMatch(JsonPrimitive(result.direction.wire), then.getValue("direction"), "then.direction")
        }
        "typing" -> {
            val cell = typingAdvance(grid, direction, from, buildFilled(given))
            expectMatch(JsonPrimitive(cell), then.getValue("cell"), "then.cell")
        }
        "backspace" -> {
            val cell = backspaceTarget(grid, direction, from, buildFilled(given))
            expectMatch(JsonPrimitive(cell), then.getValue("cell"), "then.cell")
        }
        else -> throw VectorMismatch("unknown navigation op \"$op\"")
    }
}

/**
 * Every value in `accept` must pass and every value in `reject` must fail for the case's
 * `solution`. Casing is ASCII-only (INV-1); the Turkish dotted and dotless i in the suite prove
 * a locale-aware port cannot slip through.
 */
private fun runComparator(c: JsonObject) {
    val solution = (c["solution"] as? JsonPrimitive)?.content ?: ""
    for (value in c.getValue("accept").jsonArray) {
        val v = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
        if (!matches(solution, v)) throw VectorMismatch("comparator solution \"$solution\": accept \"$v\" did not match")
    }
    for (value in c.getValue("reject").jsonArray) {
        val v = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
        if (matches(solution, v)) throw VectorMismatch("comparator solution \"$solution\": reject \"$v\" matched")
    }
}

/**
 * Apply each command in mailbox order through the two-phase driver, accumulating the full
 * sequenced stream. Concurrency collapses to this total order (PROTOCOL §10), and the
 * level-triggered check re-runs on same-count overwrites (DESIGN §3). A rejected trailing
 * command emits nothing (INV-4).
 */
private fun runCompletion(c: JsonObject) {
    val given = c.getValue("given").jsonObject
    val solution = buildSolution(given)
    var state = buildBoardState(given)
    val events = mutableListOf<JsonElement>()
    for (step in c.getValue("when").jsonArray) {
        val result = applyWithCompletion(state, asCommand(step.jsonObject), solution)
        state = result.state
        result.events.forEach { events.add(serializeEvent(it)) }
    }
    val then = c.getValue("then").jsonObject
    then["events"]?.let { expectMatch(JsonArray(events), it, "then.events") }
    then["state"]?.let { expectMatch(serializeState(state), it, "then.state") }
}

/**
 * The room check (PROTOCOL §10, D27): the completion driver's shape plus the reducer's rejection
 * convention. Apply each command in mailbox order through the two-phase driver, accumulating the
 * sequenced stream; a rejected command (the GRID_NOT_FULL / GAME_NOT_ONGOING gates) emits
 * nothing, consumes no seq (INV-2), and surfaces its code for `then.error`.
 */
private fun runCheck(c: JsonObject) {
    val given = c.getValue("given").jsonObject
    val solution = buildSolution(given)
    var state = buildBoardState(given)
    val events = mutableListOf<JsonElement>()
    var error: RejectionCode? = null
    for (step in c.getValue("when").jsonArray) {
        val result = applyWithCompletion(state, asCommand(step.jsonObject), solution)
        state = result.state
        result.events.forEach { events.add(serializeEvent(it)) }
        if (result.error != null) error = result.error
    }
    val then = c.getValue("then").jsonObject
    then["events"]?.let { expectMatch(JsonArray(events), it, "then.events") }
    then["state"]?.let { expectMatch(serializeState(state), it, "then.state") }
    // then.error follows the reducer convention; unasserted when absent (assertion rule).
    if (then.containsKey("error")) {
        val actual: JsonElement = error?.let { JsonPrimitive(it.wire) } ?: JsonNull
        expectMatch(actual, then.getValue("error"), "then.error")
    }
}

/** The label the runner shows for a case: comparator by solution, everything else by name. */
fun caseLabel(family: VectorFamily, c: JsonObject): String =
    if (family == VectorFamily.COMPARATOR) {
        "solution \"${(c["solution"] as? JsonPrimitive)?.content ?: ""}\""
    } else {
        (c["name"] as? JsonPrimitive)?.content ?: "case"
    }
