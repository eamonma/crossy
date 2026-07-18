package crossy.engine.vectors

import crossy.engine.BoardState
import crossy.engine.CastCheckVote
import crossy.engine.Cell
import crossy.engine.CellSet
import crossy.engine.CheckProposal
import crossy.engine.CheckPuzzle
import crossy.engine.CheckVote
import crossy.engine.CheckVoteCast
import crossy.engine.CheckVoteClosed
import crossy.engine.CheckVoteOpened
import crossy.engine.ClearCell
import crossy.engine.Command
import crossy.engine.Direction
import crossy.engine.Event
import crossy.engine.ExpireCheckVote
import crossy.engine.GameCompleted
import crossy.engine.Grid
import crossy.engine.PlaceLetter
import crossy.engine.PuzzleChecked
import crossy.engine.Solution
import crossy.engine.Status
import crossy.engine.Toward
import crossy.engine.VoteCommand
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

// Adapters between the vector JSON and the engine's own Kotlin types, the twin of the
// "Engine binding" section in packages/engine/src/vectors.test.ts and VectorEngineAdapter.swift.
// The vectors are the shared source of truth; :engine owns a separate type world (INV-9,
// vectors/README.md). These adapters are the boundary that keeps them in agreement, exactly as
// an app adapter would: parse `given` into engine types, call the engine, serialize the result
// back to plain JSON, and assert it against `then` under the vectors/README.md assertion rule.

// MARK: - JSON scalar helpers

private fun intField(x: JsonElement?): Int? =
    (x as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.content?.toIntOrNull()

private fun stringField(x: JsonElement?): String? =
    (x as? JsonPrimitive)?.takeIf { it.isString }?.content

fun parseStatus(raw: String?): Status = when (raw) {
    "completed" -> Status.COMPLETED
    "abandoned" -> Status.ABANDONED
    else -> Status.ONGOING
}

fun parseDirection(raw: String?): Direction = if (raw == "down") Direction.DOWN else Direction.ACROSS

fun parseToward(raw: String?): Toward = if (raw == "backward") Toward.BACKWARD else Toward.FORWARD

// MARK: - Building engine inputs from `given`

/** Build the immutable grid geometry from a case's `given`. */
fun buildGrid(given: JsonObject): Grid {
    val blocks = (given["blocks"] as? JsonArray)?.mapNotNull { intField(it) } ?: emptyList()
    return Grid(cols = intField(given["cols"]) ?: 0, rows = intField(given["rows"]) ?: 0, blocks = blocks.toSet())
}

/** Build the reducer's starting board state; filledCount is derived from the fills. */
fun buildBoardState(given: JsonObject): BoardState {
    val cells = mutableMapOf<Int, Cell>()
    var filledCount = 0
    (given["cells"] as? JsonObject)?.forEach { (index, raw) ->
        val cellObj = raw.jsonObject
        val v = stringField(cellObj["v"]) // null for an explicit null or absent key
        val by = stringField(cellObj["by"])
        val key = index.toIntOrNull() ?: return@forEach
        cells[key] = Cell(v = v, by = by)
        if (v != null) filledCount += 1
    }
    // Standing check marks and the permanent count (check family; PROTOCOL §10, D32). Optional
    // in `given`: absent means no marks and no accepted checks yet.
    val checkedWrong = (given["checkedWrong"] as? JsonArray)?.mapNotNull { intField(it) }?.toSet() ?: emptySet()
    return BoardState(
        grid = buildGrid(given),
        status = parseStatus(stringField(given["status"])),
        seq = intField(given["seq"]) ?: 0,
        firstFillAt = stringField(given["firstFillAt"]), // null for null or absent
        cells = cells,
        filledCount = filledCount,
        checkedWrong = checkedWrong,
        checkCount = intField(given["checkCount"]) ?: 0,
        checkVote = buildCheckVote(given["checkVote"]),
    )
}

/**
 * The open check vote from a case's `given.checkVote` (vote family; PROTOCOL §10, D32). Optional and
 * nullable: an absent key or an explicit `null` means no vote is open. When present it is the object
 * `{openedSeq, by, electorate, approvals, rejections}` plus an optional `commandId` (unasserted in
 * state; the check vectors seed `null`, but the shape is parsed so a mid-vote `given` round-trips).
 */
private fun buildCheckVote(x: JsonElement?): CheckVote? {
    val obj = x as? JsonObject ?: return null
    return CheckVote(
        openedSeq = intField(obj["openedSeq"]) ?: 0,
        by = stringField(obj["by"]) ?: "",
        commandId = stringField(obj["commandId"]) ?: "",
        electorate = (obj["electorate"] as? JsonArray)?.mapNotNull { stringField(it) } ?: emptyList(),
        approvals = (obj["approvals"] as? JsonArray)?.mapNotNull { stringField(it) } ?: emptyList(),
        rejections = (obj["rejections"] as? JsonArray)?.mapNotNull { stringField(it) } ?: emptyList(),
    )
}

/** The set of filled cell indices from a navigation case's `given.fills`. */
fun buildFilled(given: JsonObject): Set<Int> =
    (given["fills"] as? JsonObject)?.keys?.mapNotNull { it.toIntOrNull() }?.toSet() ?: emptySet()

/** Build the cell-index to solution-string map from a completion case's `given`. */
fun buildSolution(given: JsonObject): Solution {
    val out = mutableMapOf<Int, String>()
    (given["solution"] as? JsonObject)?.forEach { (index, value) ->
        val key = index.toIntOrNull()
        val string = stringField(value)
        if (key != null && string != null) out[key] = string
    }
    return out
}

/**
 * A `when` entry (wire command plus server meta) as the engine command, plain data (INV-9).
 * `checkPuzzle` carries only its commandId (vectors/README.md "Check cases"; PROTOCOL §10).
 */
fun asCommand(w: JsonObject): Command {
    val commandId = stringField(w["commandId"]) ?: ""
    if (stringField(w["type"]) == "checkPuzzle") return CheckPuzzle(commandId = commandId)
    val cell = intField(w["cell"]) ?: -1
    val by = stringField(w["by"]) ?: ""
    val at = stringField(w["at"]) ?: ""
    return if (stringField(w["type"]) == "placeLetter") {
        PlaceLetter(commandId = commandId, cell = cell, value = stringField(w["value"]) ?: "", by = by, at = at)
    } else {
        ClearCell(commandId = commandId, cell = cell, by = by, at = at)
    }
}

/**
 * A check-vector `when` entry as the vote driver's command (INV-9; PROTOCOL §5, §10; D32). The wire
 * type stays `checkPuzzle` for a proposal, now carrying `by` and the frozen `electorate`; the two
 * ballot/expiry commands are their own types. A cell mutation reuses [asCommand] (a MutationCommand,
 * which is also a VoteCommand). The expiry command carries only its type.
 */
fun asVoteCommand(w: JsonObject): VoteCommand = when (stringField(w["type"])) {
    "checkPuzzle" -> CheckProposal(
        commandId = stringField(w["commandId"]) ?: "",
        by = stringField(w["by"]) ?: "",
        electorate = (w["electorate"] as? JsonArray)?.mapNotNull { stringField(it) } ?: emptyList(),
    )
    "castCheckVote" -> CastCheckVote(
        commandId = stringField(w["commandId"]) ?: "",
        by = stringField(w["by"]) ?: "",
        voteSeq = intField(w["voteSeq"]) ?: -1,
        approve = (w["approve"] as? JsonPrimitive)?.let { it !is JsonNull && it.content == "true" } ?: false,
    )
    "expireCheckVote" -> ExpireCheckVote
    else -> asCommand(w) as VoteCommand // placeLetter / clearCell: a MutationCommand
}

// MARK: - Serializing engine outputs to the `then` JSON shape

/** Serialize a board state to the `then.state` JSON shape (cells as a sparse map). */
fun serializeState(state: BoardState): JsonObject = buildJsonObject {
    put("status", state.status.wire)
    put("seq", state.seq)
    put("filledCount", state.filledCount)
    put("firstFillAt", state.firstFillAt)
    putJsonObject("cells") {
        for ((index, cell) in state.cells) {
            putJsonObject(index.toString()) {
                put("v", cell.v)
                put("by", cell.by)
            }
        }
    }
    // The wire and the vectors list the standing marks ascending (PROTOCOL §10).
    put("checkedWrong", JsonArray(state.checkedWrong.sorted().map { JsonPrimitive(it) }))
    put("checkCount", state.checkCount)
    // The open vote, null when none (PROTOCOL §10, D32). The vectors assert openedSeq, by,
    // electorate, approvals, rejections; the arrays are already ascending (INV-1).
    val vote = state.checkVote
    if (vote == null) {
        put("checkVote", JsonNull)
    } else {
        putJsonObject("checkVote") {
            put("openedSeq", vote.openedSeq)
            put("by", vote.by)
            put("electorate", JsonArray(vote.electorate.map { JsonPrimitive(it) }))
            put("approvals", JsonArray(vote.approvals.map { JsonPrimitive(it) }))
            put("rejections", JsonArray(vote.rejections.map { JsonPrimitive(it) }))
        }
    }
}

fun serializeCellSet(event: CellSet): JsonObject = buildJsonObject {
    put("type", "cellSet")
    put("seq", event.seq)
    put("cell", event.cell)
    put("value", event.value)
    put("by", event.by)
    put("commandId", event.commandId)
    put("at", event.at)
}

fun serializeEvent(event: Event): JsonObject = when (event) {
    is CellSet -> serializeCellSet(event)
    is GameCompleted -> buildJsonObject {
        put("type", "gameCompleted")
        put("seq", event.seq)
    }
    is PuzzleChecked -> buildJsonObject {
        put("type", "puzzleChecked")
        put("seq", event.seq)
        put("wrongCells", JsonArray(event.wrongCells.map { JsonPrimitive(it) }))
        put("checkCount", event.checkCount)
        // `by` is the proposer on the vote path (D32), absent on the legacy immediate path.
        event.by?.let { put("by", it) }
        put("commandId", event.commandId)
    }
    is CheckVoteOpened -> buildJsonObject {
        put("type", "checkVoteOpened")
        put("seq", event.seq)
        put("by", event.by)
        put("electorate", JsonArray(event.electorate.map { JsonPrimitive(it) }))
        put("needed", event.needed)
        put("commandId", event.commandId)
    }
    is CheckVoteCast -> buildJsonObject {
        put("type", "checkVoteCast")
        put("seq", event.seq)
        put("voteSeq", event.voteSeq)
        put("by", event.by)
        put("approve", event.approve)
        put("commandId", event.commandId)
    }
    is CheckVoteClosed -> buildJsonObject {
        put("type", "checkVoteClosed")
        put("seq", event.seq)
        put("voteSeq", event.voteSeq)
        put("outcome", event.outcome.wire)
        // `reason` is absent when passed (PROTOCOL §6, §10; assertion rule leaves it unasserted).
        event.reason?.let { put("reason", it.wire) }
    }
}

// MARK: - The assertion rule (vectors/README.md)

/**
 * An expected object constrains exactly the fields it lists; an absent field is unasserted.
 * Expected arrays match in length and order, each element under the same rule. Strings compare
 * by code unit and numbers by content, so an ASCII value never folds or collates (INV-1). The
 * `JsonNull` branch precedes `JsonPrimitive` because JsonNull is a JsonPrimitive subtype.
 */
fun expectMatch(actual: JsonElement?, expected: JsonElement, path: String) {
    when (expected) {
        is JsonNull -> if (actual !is JsonNull) fail("$path: expected null, got ${render(actual)}")
        is JsonArray -> {
            val array = actual as? JsonArray ?: return fail("$path: expected an array, got ${render(actual)}")
            if (array.size != expected.size) return fail("$path: array length ${array.size}, expected ${expected.size}")
            expected.forEachIndexed { index, element -> expectMatch(array[index], element, "$path[$index]") }
        }
        is JsonObject -> {
            val obj = actual as? JsonObject ?: return fail("$path: expected an object, got ${render(actual)}")
            for ((key, value) in expected) expectMatch(obj[key], value, "$path.$key")
        }
        is JsonPrimitive -> {
            val a = actual as? JsonPrimitive ?: return fail("$path: expected ${render(expected)}, got ${render(actual)}")
            if (a.isString != expected.isString || a.content != expected.content) {
                fail("$path: ${render(actual)} != expected ${render(expected)}")
            }
        }
    }
}

private fun fail(message: String): Unit = throw VectorMismatch(message)

private fun render(value: JsonElement?): String = when (value) {
    null -> "absent"
    is JsonNull -> "null"
    is JsonPrimitive -> if (value.isString) "\"${value.content}\"" else value.content
    else -> value.toString()
}
