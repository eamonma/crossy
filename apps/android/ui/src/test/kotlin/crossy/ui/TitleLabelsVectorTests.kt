// Pins the Titles display LABELS to the cross-client contract (design/post-game/TITLES.md;
// PROTOCOL.md §12; vectors/analysis/title-labels.json; twin of apps/ios TitleLabelsVectorTests).
// The labels were client-owned prose until the server-rendered share card had to render them
// (native apps consume the server card PNG, not a client render; design/post-game/SHARE.md), so they
// are shared normative ground now: if TitleLadder's labels ever drift from the web/iOS/server copies,
// this fails against the frozen vector. LABELS ONLY: the evidence/detail line under a label
// ("Overwrote 7 correct squares") interpolates the solve's stats and stays client-owned, so it is
// not pinned here. INV-1: labels are display strings shown verbatim, never folded or compared. The
// vector is located by walking up from the test working directory, the RepoLayout trick the engine
// runner and DisplayNameVectorTests use (the JVM has no compiled-in `#filePath` like the Swift twin).

package crossy.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class TitleLabelsVectorTests {
    private data class Label(val key: String, val label: String)

    private fun loadLabels(): List<Label> {
        val root = Json.parseToJsonElement(vectorFile().readText()).jsonObject
        val labels = (root["labels"] ?: error("title-labels.json must carry `labels`")).jsonArray
        assertTrue(labels.isNotEmpty(), "vectors/analysis/title-labels.json must carry labels")
        return labels.map { element ->
            val obj = element.jsonObject
            Label(
                key = obj.stringField("key"),
                label = obj.stringField("label"),
            )
        }
    }

    private fun kotlinx.serialization.json.JsonObject.stringField(key: String): String =
        (this[key] ?: error("a title-labels entry is missing `$key`")).jsonPrimitive.content

    // Every pinned key resolves to its exact label, byte for byte, through the same card() the panel
    // and (in twin) the share card use. A drift on either side fails one of the twin sweeps.
    @Test
    fun `labels match the shared vector, byte for byte`() {
        for ((key, label) in loadLabels()) {
            val card = TitleLadder.card(RoomTitle(userId = "u1", key = key, evidence = 7))
            assertNotNull(card, "$key is a pinned key and must resolve to a card")
            assertEquals(label, card!!.label, key)
        }
    }

    // The ladder covers exactly the pinned keys, in the vector's rank order (the vector lists the
    // TITLE_LADDER order for coverage). No key drops out and none is added without the vector moving.
    @Test
    fun `the ladder covers exactly the vector keys, in order`() {
        assertEquals(loadLabels().map { it.key }, TitleLadder.keys)
    }

    private companion object {
        /** Locate vectors/analysis/title-labels.json by walking up from the test working directory
         *  (the `:ui` project dir under Gradle) until it is found, the RepoLayout trick the engine
         *  runner and DisplayNameVectorTests use. */
        fun vectorFile(): File {
            var dir: File? = File(System.getProperty("user.dir")).absoluteFile
            while (dir != null) {
                val candidate = File(dir, "vectors/analysis/title-labels.json")
                if (candidate.isFile) return candidate
                dir = dir.parentFile
            }
            error(
                "could not locate vectors/analysis/title-labels.json by walking up from " +
                    System.getProperty("user.dir"),
            )
        }
    }
}
