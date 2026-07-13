package crossy.engine.vectors

import crossy.engine.BoardState
import crossy.engine.Cell
import crossy.engine.CellSet
import crossy.engine.ClearCell
import crossy.engine.Command
import crossy.engine.Direction
import crossy.engine.Event
import crossy.engine.GameCompleted
import crossy.engine.Grid
import crossy.engine.PlaceLetter
import crossy.engine.Solution
import crossy.engine.Status
import crossy.engine.Toward
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
    return BoardState(
        grid = buildGrid(given),
        status = parseStatus(stringField(given["status"])),
        seq = intField(given["seq"]) ?: 0,
        firstFillAt = stringField(given["firstFillAt"]), // null for null or absent
        cells = cells,
        filledCount = filledCount,
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

/** A `when` entry (wire command plus server meta) as the engine command, plain data (INV-9). */
fun asCommand(w: JsonObject): Command {
    val commandId = stringField(w["commandId"]) ?: ""
    val cell = intField(w["cell"]) ?: -1
    val by = stringField(w["by"]) ?: ""
    val at = stringField(w["at"]) ?: ""
    return if (stringField(w["type"]) == "placeLetter") {
        PlaceLetter(commandId = commandId, cell = cell, value = stringField(w["value"]) ?: "", by = by, at = at)
    } else {
        ClearCell(commandId = commandId, cell = cell, by = by, at = at)
    }
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
