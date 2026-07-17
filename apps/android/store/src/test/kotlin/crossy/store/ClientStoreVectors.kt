// Client-store conformance plumbing: the consumer-side executor for the foreign family the engine
// vector runner only shape-validates (PROTOCOL.md §13; vectors/README.md "Foreign families";
// apps/android/vectors.skip.json). Kotlin twin of apps/web/src/store/client-store.vectors.test.ts
// and apps/ios/Tests/CrossyStoreTests/ClientStoreVectorSupport.swift: the three suites bind the
// same JSON cases to the same store operations, so the web, iOS, and Android stores cannot drift.
//
// Discovery is strict in the vector runner's spirit (skipping silently is forbidden): a stray
// file, an empty file, or a case missing its `name` throws instead of being skipped. Every case
// executes against the real GameStore. Server stimuli are expanded from the vector encoding
// (sparse cells map, abbreviated frames) into full wire frames and decoded through :protocol's
// codec, so the store consumes exactly what a socket would deliver and hand-rolled parsing cannot
// creep in (the web runner's discipline).

package crossy.store

import crossy.protocol.Cell
import crossy.protocol.ClearCellMessage
import crossy.protocol.ClientMessage
import crossy.protocol.PlaceLetterMessage
import crossy.protocol.ProtocolJson
import crossy.protocol.RequestSyncMessage
import crossy.protocol.ServerMessage
import crossy.protocol.ServerMessageSerializer
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.jupiter.api.Assertions.assertEquals

/**
 * Locates the shared vector tree by walking up from the test working directory (the `:store`
 * project dir under Gradle) until it finds `vectors/v1`, the same trick RepoLayout uses in the
 * engine runner. The JVM has no compiled-in `#filePath` like Swift, so the ascent is the portable
 * substitute.
 */
internal object StoreRepoLayout {
    val clientStoreDir: File = File(findRepoRoot(), "vectors/v1/client-store")

    private fun findRepoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            if (File(dir, "vectors/v1").isDirectory) return dir
            dir = dir.parentFile
        }
        error(
            "could not locate the repo root (a directory containing vectors/v1) by walking up " +
                "from ${System.getProperty("user.dir")}",
        )
    }
}

/** One discovered case: its name (for the dynamic-test label) and its raw JSON object. */
internal data class ClientStoreCase(val name: String, val raw: JsonObject)

/** One discovered cluster (file basename without `.json`) and its cases. */
internal data class ClientStoreCluster(val cluster: String, val cases: List<ClientStoreCase>)

internal object ClientStoreVectors {
    /** Strict discovery: only .json files, each a non-empty array of case objects that each carry
     * a string `name`. Sorted for stable output order. */
    fun discover(): List<ClientStoreCluster> {
        val dir = StoreRepoLayout.clientStoreDir
        val entries = dir.listFiles()?.sortedBy { it.name }
            ?: throw IllegalStateException("vectors/v1/client-store not found at ${dir.path}")
        val clusters = mutableListOf<ClientStoreCluster>()
        for (file in entries) {
            if (!file.isFile || !file.name.endsWith(".json")) {
                throw IllegalStateException(
                    "vectors/v1/client-store must contain only .json files, found \"${file.name}\"",
                )
            }
            val array = Json.parseToJsonElement(file.readText()) as? JsonArray
            if (array == null || array.isEmpty() || array.any { it !is JsonObject }) {
                throw IllegalStateException(
                    "vectors/v1/client-store/${file.name} must be a non-empty JSON array of case objects",
                )
            }
            val cases = array.map { it.jsonObject }.map { obj ->
                val name = (obj["name"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                    ?: throw IllegalStateException(
                        "a client-store case in ${file.name} is missing a string `name`",
                    )
                ClientStoreCase(name, obj)
            }
            clusters.add(ClientStoreCluster(file.name.removeSuffix(".json"), cases))
        }
        return clusters
    }
}

// --- Expansion: vector encoding to full wire frames, through the real codec ---

/** Expand the vector's abbreviated board (sparse cells map; only seq / status / firstFillAt /
 * cells / recentCommandIds) into the full PROTOCOL.md §4 payload the codec requires. Geometry
 * comes from the case's `given`. */
private fun expandBoard(board: JsonObject, cols: Int, rows: Int): JsonObject = buildJsonObject {
    put("seq", board["seq"]!!.jsonPrimitive.int)
    put("status", board["status"]!!.jsonPrimitive.content)
    // A snapshot may pin firstFillAt (§4); absent means null, pre-first-fill.
    put("firstFillAt", board["firstFillAt"] ?: JsonNull)
    put("completedAt", JsonNull)
    put("abandonedAt", JsonNull)
    putJsonArray("cells") {
        val sparse = board["cells"]?.jsonObject
        for (index in 0 until cols * rows) {
            val cell = sparse?.get(index.toString())?.jsonObject
            addJsonObject {
                put("v", cell?.get("v") ?: JsonNull)
                put("by", cell?.get("by") ?: JsonNull)
            }
        }
    }
    // The room-check marks and count ride every snapshot (PROTOCOL.md §4, §10; D27), required on
    // decode; a client-store vector may pin them, else they default empty/zero (pre-first-check).
    putJsonArray("checkedWrongCells") {
        board["checkedWrongCells"]?.jsonArray?.forEach { add(it) }
    }
    put("checkCount", board["checkCount"]?.jsonPrimitive?.int ?: 0)
    putJsonArray("participants") {}
    putJsonArray("cursors") {}
    putJsonArray("recentCommandIds") {
        board["recentCommandIds"]?.jsonArray?.forEach { add(it) }
    }
    put("stats", JsonNull)
}

/** Expand one server stimulus into the full wire frame the codec accepts. */
private fun expandServerFrame(step: JsonObject, cols: Int, rows: Int): JsonObject =
    when (val type = step["type"]!!.jsonPrimitive.content) {
        "cellSet" -> buildJsonObject {
            put("type", "cellSet")
            put("seq", step["seq"]!!.jsonPrimitive.int)
            put("cell", step["cell"]!!.jsonPrimitive.int)
            // value is nullable-and-present on the wire; pass the vector's value through.
            put("value", step["value"] ?: JsonNull)
            put("by", step["by"]!!.jsonPrimitive.content)
            put("commandId", step["commandId"]!!.jsonPrimitive.content)
            // The vector encoding omits `at` (unasserted); the wire requires it.
            put("at", "2026-07-07T00:00:00Z")
            // firstFillAt rides only the first fill (PROTOCOL.md §6); pass it through when present.
            step["firstFillAt"]?.let { put("firstFillAt", it) }
        }
        "error" -> buildJsonObject {
            put("type", "error")
            put("code", step["code"]!!.jsonPrimitive.content)
            // The vector encoding omits the human-readable message; the wire requires it.
            put("message", step["code"]!!.jsonPrimitive.content)
            put("fatal", step["fatal"]!!.jsonPrimitive.boolean)
            step["commandId"]?.let { put("commandId", it) }
        }
        "sync" -> buildJsonObject {
            put("type", "sync")
            put("board", expandBoard(step["board"]!!.jsonObject, cols, rows))
        }
        "welcome" -> buildJsonObject {
            put("type", "welcome")
            put("protocolVersion", 1)
            putJsonObject("self") {
                put("userId", "vector-self")
                put("role", "solver")
            }
            put("board", expandBoard(step["board"]!!.jsonObject, cols, rows))
        }
        else -> throw IllegalStateException("unhandled stimulus server/$type; widen the runner")
    }

/** Round-trip through JSON text and :protocol's ServerMessage codec, so the store consumes exactly
 * what a decoded socket frame carries. */
private fun decodeServerStimulus(step: JsonObject, cols: Int, rows: Int): ServerMessage =
    ProtocolJson.decodeFromString(ServerMessageSerializer, expandServerFrame(step, cols, rows).toString())

/** An outbound frame the store must have emitted, reconstructed as the real wire type (a string
 * re-sends placeLetter, null re-sends clearCell; vectors/README.md). */
private fun expectedFrame(frame: JsonObject): ClientMessage =
    when (val type = frame["type"]!!.jsonPrimitive.content) {
        "requestSync" -> ClientMessage.RequestSync(RequestSyncMessage())
        "placeLetter" -> ClientMessage.PlaceLetter(
            PlaceLetterMessage(
                frame["commandId"]!!.jsonPrimitive.content,
                frame["cell"]!!.jsonPrimitive.int,
                frame["value"]!!.jsonPrimitive.content,
            ),
        )
        "clearCell" -> ClientMessage.ClearCell(
            ClearCellMessage(frame["commandId"]!!.jsonPrimitive.content, frame["cell"]!!.jsonPrimitive.int),
        )
        else -> throw IllegalStateException("then.send frame \"$type\" is missing fields or unhandled; widen the runner")
    }

// --- The case runner (binds vector operations to store calls) ---

/**
 * Executes one case against the real GameStore, exactly as the web and iOS runners bind it:
 * `given` seeds the store, local steps call placeLetter/clearCell with the case's commandId, server
 * steps decode through the codec into receive(_), and `then` reads the published render model plus
 * the outbox. The assertion rule (vectors/README.md) holds: an expected object constrains exactly
 * the fields it lists.
 */
internal fun runClientStoreCase(case: ClientStoreCase) {
    val label = case.name
    val given = case.raw["given"]!!.jsonObject
    val cols = given["cols"]!!.jsonPrimitive.int
    val rows = given["rows"]!!.jsonPrimitive.int
    val syncWire = given["sync"]!!.jsonPrimitive.content
    val sync = SyncState.fromWire(syncWire)
        ?: throw IllegalStateException("sync must be live | resyncing | reconnecting, found \"$syncWire\"")

    val cells = buildMap {
        given["cells"]?.jsonObject?.forEach { (key, value) ->
            val cell = value.jsonObject
            put(
                key.toInt(),
                Cell(cell["v"]?.jsonPrimitive?.contentOrNull, cell["by"]?.jsonPrimitive?.contentOrNull),
            )
        }
    }
    val overlay = given["overlay"]!!.jsonArray.map { it.jsonObject }.map { entry ->
        PendingCommand(
            commandId = entry["commandId"]!!.jsonPrimitive.content,
            cell = entry["cell"]!!.jsonPrimitive.int,
            value = entry["value"]?.jsonPrimitive?.contentOrNull,
            agedOut = entry["agedOut"]?.jsonPrimitive?.booleanOrNull ?: false,
        )
    }
    val store = GameStore(
        seed = GameStore.Seed(seq = given["seq"]!!.jsonPrimitive.int, sync = sync, cells = cells, overlay = overlay),
    )

    for (element in case.raw["when"]!!.jsonArray) {
        val step = element.jsonObject
        when (val source = step["source"]!!.jsonPrimitive.content) {
            "local" -> when (val type = step["type"]!!.jsonPrimitive.content) {
                "placeLetter" -> store.placeLetter(
                    step["cell"]!!.jsonPrimitive.int,
                    step["value"]!!.jsonPrimitive.content,
                    step["commandId"]!!.jsonPrimitive.content,
                )
                "clearCell" -> store.clearCell(
                    step["cell"]!!.jsonPrimitive.int,
                    step["commandId"]!!.jsonPrimitive.content,
                )
                else -> throw IllegalStateException("unhandled stimulus local/$type; widen the runner")
            }
            "server" -> store.receive(decodeServerStimulus(step, cols, rows))
            else -> throw IllegalStateException("stimulus source must be local | server, found \"$source\"")
        }
    }

    val then = case.raw["then"]!!.jsonObject
    val model = store.render.value

    assertEquals(then["seq"]!!.jsonPrimitive.int, model.seq, "$label - then.seq")
    assertEquals(then["sync"]!!.jsonPrimitive.content, model.sync.wire, "$label - then.sync")

    // then.overlay is send order; expected constrains commandId/cell/value (the assertion rule
    // leaves agedOut unasserted, and re-added entries drop it anyway).
    val expectedOverlay = then["overlay"]!!.jsonArray.map { it.jsonObject }
    assertEquals(expectedOverlay.size, model.overlay.size, "$label - then.overlay length")
    expectedOverlay.forEachIndexed { index, expected ->
        val actual = model.overlay[index]
        assertEquals(expected["commandId"]!!.jsonPrimitive.content, actual.commandId, "$label - then.overlay[$index].commandId")
        assertEquals(expected["cell"]!!.jsonPrimitive.int, actual.cell, "$label - then.overlay[$index].cell")
        assertEquals(expected["value"]?.jsonPrimitive?.contentOrNull, actual.value, "$label - then.overlay[$index].value")
    }

    // then.render: the composite the user sees (INV-10), per listed cell.
    then["render"]!!.jsonObject.forEach { (key, value) ->
        val expected = (value as? JsonPrimitive)?.contentOrNull
        assertEquals(expected, model.renderValue(key.toInt()), "$label - then.render.$key")
    }

    // then.send: the ordered outbound frames the store emitted. With no transport pump running,
    // emissions accumulate in the outbox in send order, the same synchronous record the web and
    // iOS suites capture.
    val expectedSends = then["send"]!!.jsonArray.map { expectedFrame(it.jsonObject) }
    assertEquals(expectedSends, store.outbox, "$label - then.send")

    // The derived timer origin, asserted only where the case pins it (PROTOCOL.md §6).
    if (then.containsKey("firstFillAt")) {
        val expected = (then["firstFillAt"] as? JsonPrimitive)?.contentOrNull
        assertEquals(expected, model.firstFillAt, "$label - then.firstFillAt")
    }
}
