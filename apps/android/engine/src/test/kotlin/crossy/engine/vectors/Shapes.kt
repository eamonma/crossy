package crossy.engine.vectors

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Per-family shape validation, the JVM twin of the `*ShapeProblems` functions in
// packages/engine/src/vectors.test.ts. Decoding is the shape check here: each case is walked
// as a JsonObject and every constraint vectors/README.md pins is asserted, returning the list
// of problems (empty means the case matches the shape exactly). Foreign families (client-store,
// clue-runs) are shape-validated too, since the engine runner discovers and shape-checks them
// even though it never executes them.

// MARK: - JSON predicate helpers

private fun isObject(x: JsonElement?): Boolean = x is JsonObject

private fun isString(x: JsonElement?): Boolean = x is JsonPrimitive && x !is JsonNull && x.isString

private fun isInt(x: JsonElement?): Boolean =
    x is JsonPrimitive && x !is JsonNull && !x.isString && x.content.toIntOrNull() != null

private fun intOf(x: JsonElement?): Int? =
    (x as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.content?.toIntOrNull()

private fun isBool(x: JsonElement?): Boolean =
    x is JsonPrimitive && x !is JsonNull && !x.isString && (x.content == "true" || x.content == "false")

private fun isIntArray(x: JsonElement?): Boolean =
    x is JsonArray && x.all { isInt(it) }

private fun isStringArray(x: JsonElement?): Boolean =
    x is JsonArray && x.all { isString(it) }

/** Matches the TS `/^\d+$/` key check: ASCII digits only, no locale-aware digit shaping (INV-1). */
private fun isDecimalKey(key: String): Boolean =
    key.isNotEmpty() && key.all { it in '0'..'9' }

/** A cell value or attribution: present and either null or a string (mirrors the TS isCellMap). */
private fun isNullOrString(x: JsonElement?): Boolean = x is JsonNull || isString(x)

/** Sparse map of decimal cell index to {v, by} (vectors/README.md). */
private fun isCellMap(x: JsonElement?): Boolean {
    val obj = x as? JsonObject ?: return false
    return obj.all { (key, cell) ->
        val cellObj = cell as? JsonObject ?: return false
        isDecimalKey(key) && isNullOrString(cellObj["v"]) && isNullOrString(cellObj["by"])
    }
}

/** Sparse map of decimal cell index to string (navigation fills). */
private fun isFillMap(x: JsonElement?): Boolean {
    val obj = x as? JsonObject ?: return false
    return obj.all { (key, value) -> isDecimalKey(key) && isString(value) }
}

/** Sparse map of decimal cell index to a non-empty solution string. */
private fun isSolutionMap(x: JsonElement?): Boolean {
    val obj = x as? JsonObject ?: return false
    return obj.all { (key, value) -> isDecimalKey(key) && isString(value) && value.jsonContent().isNotEmpty() }
}

/** Sparse map of decimal cell index to a rendered value (string or null). */
private fun isRenderMap(x: JsonElement?): Boolean {
    val obj = x as? JsonObject ?: return false
    return obj.all { (key, value) -> isDecimalKey(key) && (value is JsonNull || isString(value)) }
}

/** An overlay entry: {commandId, cell, value}; extra fields ignored. */
private fun isOverlayEntry(x: JsonElement?): Boolean {
    val obj = x as? JsonObject ?: return false
    return isString(obj["commandId"]) && isInt(obj["cell"]) && isNullOrString(obj["value"])
}

/** given.overlay entries may carry an optional boolean `agedOut`. */
private fun isGivenOverlay(x: JsonElement?): Boolean {
    val array = x as? JsonArray ?: return false
    return array.all { entry ->
        val obj = entry as? JsonObject ?: return false
        isOverlayEntry(obj) && (obj["agedOut"] == null || isBool(obj["agedOut"]))
    }
}

/** then.send is an ordered list of outbound frames, each with a string type. */
private fun isSendList(x: JsonElement?): Boolean {
    val array = x as? JsonArray ?: return false
    return array.all { frame -> (frame as? JsonObject)?.let { isString(it["type"]) } ?: false }
}

private fun JsonElement.jsonContent(): String = (this as JsonPrimitive).content

// MARK: - Family token sets

private val NAV_OPS = listOf("advance", "wordBounds", "tab", "typing", "backspace")
private val SYNC_STATES = listOf("live", "resyncing", "reconnecting")
private val CLUE_STYLES = listOf("b", "i", "sub", "sup")

// MARK: - Per-family shape checks

fun reducerShapeProblems(c: JsonObject): List<String> {
    val problems = mutableListOf<String>()
    if (!isString(c["name"])) problems.add("name: string required")
    val given = c["given"] as? JsonObject
    if (given == null) {
        problems.add("given: object required")
    } else {
        if (!isInt(given["cols"])) problems.add("given.cols: integer required")
        if (!isInt(given["rows"])) problems.add("given.rows: integer required")
        if (!isIntArray(given["blocks"])) problems.add("given.blocks: int[] required")
        if (!isString(given["status"])) problems.add("given.status: string required")
        if (!isInt(given["seq"])) problems.add("given.seq: integer required")
        if (given["cells"] != null && !isCellMap(given["cells"])) {
            problems.add("given.cells: sparse map of cell index to {v, by}")
        }
        val firstFillAt = given["firstFillAt"]
        if (firstFillAt != null && firstFillAt !is JsonNull && !isString(firstFillAt)) {
            problems.add("given.firstFillAt: string or null")
        }
    }
    val whenArray = c["when"] as? JsonArray
    if (whenArray == null || whenArray.isEmpty() ||
        whenArray.any { (it as? JsonObject)?.let { w -> isString(w["type"]) } != true }
    ) {
        problems.add("when: non-empty array of commands, each with a string type")
    }
    val then = c["then"] as? JsonObject
    if (then == null) {
        problems.add("then: object required")
    } else {
        if (!isEventArray(then["events"])) problems.add("then.events: array of events, each with type and seq")
        if (!isObject(then["state"])) problems.add("then.state: object required")
    }
    return problems
}

fun comparatorShapeProblems(c: JsonObject): List<String> {
    val problems = mutableListOf<String>()
    val solution = c["solution"]
    if (!isString(solution) || solution!!.jsonContent().isEmpty()) {
        problems.add("solution: non-empty string required")
    }
    if (!isStringArray(c["accept"])) problems.add("accept: string[] required")
    if (!isStringArray(c["reject"])) problems.add("reject: string[] required")
    return problems
}

fun navigationShapeProblems(c: JsonObject): List<String> {
    val problems = mutableListOf<String>()
    if (!isString(c["name"])) problems.add("name: string required")
    val given = c["given"] as? JsonObject
    if (given == null) {
        problems.add("given: object required")
    } else {
        val cols = intOf(given["cols"])
        if (cols == null || cols < 0) problems.add("given.cols: non-negative integer required")
        val rows = intOf(given["rows"])
        if (rows == null || rows < 0) problems.add("given.rows: non-negative integer required")
        if (!isIntArray(given["blocks"])) problems.add("given.blocks: int[] required")
        if (given["fills"] != null && !isFillMap(given["fills"])) {
            problems.add("given.fills: sparse map of cell index to string")
        }
    }
    val w = c["when"] as? JsonObject
    if (w == null) {
        problems.add("when: object required")
        return problems
    }
    val op = (w["op"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "advance"
    if (!NAV_OPS.contains(op)) {
        problems.add("when.op: one of ${NAV_OPS.joinToString(", ")} (absent means advance)")
    }
    val direction = (w["direction"] as? JsonPrimitive)?.content
    if (direction != "across" && direction != "down") problems.add("when.direction: \"across\" or \"down\" required")
    if (!isInt(w["from"])) problems.add("when.from: integer required")
    val then = c["then"] as? JsonObject
    if (then == null) {
        problems.add("then: object required")
        return problems
    }
    when (op) {
        "advance" -> {
            val toward = (w["toward"] as? JsonPrimitive)?.content
            if (toward != "forward" && toward != "backward") problems.add("when.toward: \"forward\" or \"backward\" required")
            if (w["canEscapeWord"] != null && !isBool(w["canEscapeWord"])) problems.add("when.canEscapeWord: boolean when present")
            if (!isInt(then["cell"])) problems.add("then.cell: integer required")
        }
        "tab" -> {
            val toward = (w["toward"] as? JsonPrimitive)?.content
            if (toward != "forward" && toward != "backward") problems.add("when.toward: \"forward\" or \"backward\" required")
            if (!isInt(then["cell"])) problems.add("then.cell: integer required")
            val thenDir = (then["direction"] as? JsonPrimitive)?.content
            if (thenDir != "across" && thenDir != "down") problems.add("then.direction: \"across\" or \"down\" required")
        }
        "wordBounds" -> {
            if (!isInt(then["start"])) problems.add("then.start: integer required")
            if (!isInt(then["end"])) problems.add("then.end: integer required")
        }
        "typing", "backspace" -> {
            if (!isInt(then["cell"])) problems.add("then.cell: integer required")
        }
    }
    return problems
}

fun completionShapeProblems(c: JsonObject): List<String> {
    val problems = mutableListOf<String>()
    if (!isString(c["name"])) problems.add("name: string required")
    val given = c["given"] as? JsonObject
    if (given == null) {
        problems.add("given: object required")
    } else {
        if (!isInt(given["cols"])) problems.add("given.cols: integer required")
        if (!isInt(given["rows"])) problems.add("given.rows: integer required")
        if (!isIntArray(given["blocks"])) problems.add("given.blocks: int[] required")
        if (!isString(given["status"])) problems.add("given.status: string required")
        if (!isInt(given["seq"])) problems.add("given.seq: integer required")
        if (!isSolutionMap(given["solution"])) {
            problems.add("given.solution: sparse map of cell index to non-empty string")
        }
        if (given["cells"] != null && !isCellMap(given["cells"])) {
            problems.add("given.cells: sparse map of cell index to {v, by}")
        }
        val firstFillAt = given["firstFillAt"]
        if (firstFillAt != null && firstFillAt !is JsonNull && !isString(firstFillAt)) {
            problems.add("given.firstFillAt: string or null")
        }
    }
    val whenArray = c["when"] as? JsonArray
    if (whenArray == null || whenArray.isEmpty() ||
        whenArray.any { (it as? JsonObject)?.let { w -> isString(w["type"]) } != true }
    ) {
        problems.add("when: non-empty array of commands, each with a string type")
    }
    val then = c["then"] as? JsonObject
    if (then == null) {
        problems.add("then: object required")
    } else {
        if (!isEventArray(then["events"])) problems.add("then.events: array of events, each with type and seq")
        if (!isObject(then["state"])) problems.add("then.state: object required")
    }
    return problems
}

/**
 * The room check shares the completion shape (vectors/README.md "Check cases"; PROTOCOL.md §10,
 * D27): it needs `given.solution` for the comparator. Two additions, both optional in `given`:
 * `checkedWrong` (ascending int array of standing marks, default none) and `checkCount` (the
 * permanent count, default 0). Rejections follow the reducer convention, so `then` may carry an
 * optional `error` string (PROTOCOL §11 codes GRID_NOT_FULL, GAME_NOT_ONGOING).
 */
fun checkShapeProblems(c: JsonObject): List<String> {
    val problems = mutableListOf<String>()
    if (!isString(c["name"])) problems.add("name: string required")
    val given = c["given"] as? JsonObject
    if (given == null) {
        problems.add("given: object required")
    } else {
        if (!isInt(given["cols"])) problems.add("given.cols: integer required")
        if (!isInt(given["rows"])) problems.add("given.rows: integer required")
        if (!isIntArray(given["blocks"])) problems.add("given.blocks: int[] required")
        if (!isString(given["status"])) problems.add("given.status: string required")
        if (!isInt(given["seq"])) problems.add("given.seq: integer required")
        if (!isSolutionMap(given["solution"])) {
            problems.add("given.solution: sparse map of cell index to non-empty string")
        }
        if (given["cells"] != null && !isCellMap(given["cells"])) {
            problems.add("given.cells: sparse map of cell index to {v, by}")
        }
        if (given["checkedWrong"] != null && !isIntArray(given["checkedWrong"])) {
            problems.add("given.checkedWrong: int[] when present")
        }
        if (given["checkCount"] != null && !isInt(given["checkCount"])) {
            problems.add("given.checkCount: integer when present")
        }
        val firstFillAt = given["firstFillAt"]
        if (firstFillAt != null && firstFillAt !is JsonNull && !isString(firstFillAt)) {
            problems.add("given.firstFillAt: string or null")
        }
    }
    val whenArray = c["when"] as? JsonArray
    if (whenArray == null || whenArray.isEmpty() ||
        whenArray.any { (it as? JsonObject)?.let { w -> isString(w["type"]) } != true }
    ) {
        problems.add("when: non-empty array of commands, each with a string type")
    }
    val then = c["then"] as? JsonObject
    if (then == null) {
        problems.add("then: object required")
    } else {
        if (!isEventArray(then["events"])) problems.add("then.events: array of events, each with type and seq")
        if (!isObject(then["state"])) problems.add("then.state: object required")
        if (then["error"] != null && !isString(then["error"])) problems.add("then.error: string when present")
    }
    return problems
}

fun clientStoreShapeProblems(c: JsonObject): List<String> {
    val problems = mutableListOf<String>()
    if (!isString(c["name"])) problems.add("name: string required")
    val given = c["given"] as? JsonObject
    if (given == null) {
        problems.add("given: object required")
    } else {
        if (!isInt(given["seq"])) problems.add("given.seq: integer required")
        val sync = (given["sync"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (sync == null || !SYNC_STATES.contains(sync)) {
            problems.add("given.sync: \"live\" | \"resyncing\" | \"reconnecting\" required")
        }
        if (!isInt(given["cols"])) problems.add("given.cols: integer required")
        if (!isInt(given["rows"])) problems.add("given.rows: integer required")
        if (!isIntArray(given["blocks"])) problems.add("given.blocks: int[] required")
        if (given["cells"] != null && !isCellMap(given["cells"])) {
            problems.add("given.cells: sparse map of cell index to {v, by}")
        }
        if (!isGivenOverlay(given["overlay"])) {
            problems.add("given.overlay: array of {commandId, cell, value, agedOut?}")
        }
    }
    val whenArray = c["when"] as? JsonArray
    val whenOk = whenArray != null && whenArray.isNotEmpty() && whenArray.all { step ->
        val obj = step as? JsonObject ?: return@all false
        val source = (obj["source"] as? JsonPrimitive)?.content
        (source == "local" || source == "server") && isString(obj["type"])
    }
    if (!whenOk) {
        problems.add("when: non-empty array of steps, each { source: \"local\" | \"server\", type, ... }")
    }
    val then = c["then"] as? JsonObject
    if (then == null) {
        problems.add("then: object required")
    } else {
        if (!isInt(then["seq"])) problems.add("then.seq: integer required")
        val sync = (then["sync"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (sync == null || !SYNC_STATES.contains(sync)) {
            problems.add("then.sync: \"live\" | \"resyncing\" | \"reconnecting\" required")
        }
        val overlay = then["overlay"] as? JsonArray
        if (overlay == null || !overlay.all { isOverlayEntry(it) }) {
            problems.add("then.overlay: array of {commandId, cell, value}")
        }
        if (!isRenderMap(then["render"])) problems.add("then.render: sparse map of cell index to string or null")
        if (!isSendList(then["send"])) problems.add("then.send: array of outbound frames, each with a string type")
        val firstFillAt = then["firstFillAt"]
        if (firstFillAt != null && firstFillAt !is JsonNull && !isString(firstFillAt)) {
            problems.add("then.firstFillAt: string or null when present")
        }
    }
    return problems
}

fun clueRunsShapeProblems(c: JsonObject): List<String> {
    val problems = mutableListOf<String>()
    if (!isString(c["name"])) problems.add("name: string required")
    val given = c["given"] as? JsonObject
    if (given == null || !isString(given["raw"])) problems.add("given.raw: string required")
    val then = c["then"] as? JsonObject
    if (then == null) {
        problems.add("then: object required")
        return problems
    }
    if (!isString(then["text"])) problems.add("then.text: string required")
    val runs = then["runs"]
    if (runs != null) {
        val array = runs as? JsonArray
        if (array == null || array.isEmpty()) {
            problems.add("then.runs: non-empty array when present (law 2)")
        } else {
            array.forEachIndexed { index, run -> problems.addAll(clueRunProblems(run, "then.runs[$index]")) }
        }
    }
    return problems
}

/** One `runs` entry: `{ t, s? }` (PROTOCOL.md §12, laws 3-4). */
private fun clueRunProblems(x: JsonElement, where: String): List<String> {
    val obj = x as? JsonObject ?: return listOf("$where: object { t, s? } required")
    val problems = mutableListOf<String>()
    val t = obj["t"]
    if (!isString(t) || t!!.jsonContent().isEmpty()) problems.add("$where.t: non-empty string required (law 3)")
    val s = obj["s"]
    if (s != null) {
        val array = s as? JsonArray
        if (array == null || array.isEmpty() || !array.all { isString(it) }) {
            problems.add("$where.s: non-empty array of styles when present (law 3)")
        } else {
            var lastRank = -1
            val seen = mutableSetOf<String>()
            for (styleEl in array) {
                val style = styleEl.jsonContent()
                val rank = CLUE_STYLES.indexOf(style)
                if (rank == -1) {
                    problems.add("$where.s: unknown style \"$style\"; one of ${CLUE_STYLES.joinToString(", ")}")
                } else if (rank <= lastRank) {
                    problems.add("$where.s: styles must be unique and ordered b,i,sub,sup (law 4), got \"$style\"")
                } else {
                    lastRank = rank
                }
                if (seen.contains(style)) problems.add("$where.s: duplicate style \"$style\" (law 3)")
                seen.add(style)
            }
        }
    }
    return problems
}

/** then.events is an array of events, each an object with a string type and an integer seq. */
private fun isEventArray(x: JsonElement?): Boolean {
    val array = x as? JsonArray ?: return false
    return array.all { event ->
        val obj = event as? JsonObject ?: return false
        isString(obj["type"]) && isInt(obj["seq"])
    }
}

/** Dispatch a case to its family's shape check, mirroring the TS `shapeProblems` record. */
fun shapeProblems(family: VectorFamily, c: JsonObject): List<String> = when (family) {
    VectorFamily.REDUCER -> reducerShapeProblems(c)
    VectorFamily.COMPARATOR -> comparatorShapeProblems(c)
    VectorFamily.NAVIGATION -> navigationShapeProblems(c)
    VectorFamily.COMPLETION -> completionShapeProblems(c)
    VectorFamily.CHECK -> checkShapeProblems(c)
    VectorFamily.CLIENT_STORE -> clientStoreShapeProblems(c)
    VectorFamily.CLUE_RUNS -> clueRunsShapeProblems(c)
}
