package crossy.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicNode
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

// The display-name spec's honesty (docs/design/name-onboarding §5, §9.4), pinned to
// vectors/identity/display-name.json exactly as the API validator, the web sanitizer, and the iOS
// sanitizer are, so the four cannot drift (R6). Each case is one dynamic test named from the case
// name, so every vector case reports individually in the run (the engine runner's per-case shape).
// INV-1 (ASCII-only casing) does NOT apply to names: a name is user content shown back verbatim,
// never folded (the cases assert "ada" stays "ada", "ADA" stays "ADA"). The vector carries two
// intents: `canonicalize` (the submit path: NFC + trim + collapse, then validate) and `sanitize`
// (the per-keystroke edge filter: strip disallowed scalars, cap at 40, no trim/collapse). An
// unrecognized intent or a missing field is a hard failure, never a silent skip.

class DisplayNameVectorTests {
    /** One vector case. `intent` selects which function runs; `then` is the expectation: for
     *  canonicalize, `ok` with a `value` or `ok:false` with a `code`; for sanitize, a `value`. */
    private data class Case(
        val name: String,
        val intent: String,
        val input: String,
        val then: JsonObject,
    )

    private fun loadCases(): List<Case> {
        val array = Json.parseToJsonElement(vectorFile().readText()) as? JsonArray
            ?: throw IllegalStateException("vectors/identity/display-name.json must be a JSON array")
        assertTrue(array.isNotEmpty(), "vectors/identity/display-name.json must carry cases")
        return array.map { element ->
            val obj = element.jsonObject
            Case(
                name = obj.stringField("name"),
                intent = obj.stringField("intent"),
                input = obj.stringField("input"),
                then = (obj["then"] ?: error("a display-name case is missing `then`")).jsonObject,
            )
        }
    }

    private fun JsonObject.stringField(key: String): String =
        (this[key] ?: error("a display-name case is missing `$key`")).jsonPrimitive.content

    @Test
    fun everyDisplayNameVectorCaseIsBoundToThisSuite_INV1() {
        // Mirrors the web and iOS count guards: a case addition updates this count deliberately, so
        // a new vector case cannot land unrun on this port (vectors/README.md: no silent skip).
        assertEquals(23, loadCases().size, "vectors/identity/display-name.json case count")
    }

    @TestFactory
    fun displayNameVectorCasesRunIndividually_INV1(): List<DynamicNode> =
        loadCases().map { case ->
            dynamicTest("${case.intent}: ${case.name}") { runCase(case) }
        }

    private fun runCase(case: Case) {
        when (case.intent) {
            "canonicalize" -> assertCanonicalize(case)
            "sanitize" -> assertSanitize(case)
            // Fail loudly on a shape this runner does not recognize (never a silent pass).
            else -> throw IllegalStateException("unknown vector intent \"${case.intent}\" in ${case.name}")
        }
    }

    /** The canonicalize + validate path. `ok:true` asserts the canonical value equals `then.value`
     *  and validate accepts it; `ok:false` asserts validate rejects with `then.code`. */
    private fun assertCanonicalize(case: Case) {
        val result = DisplayName.validate(DisplayName.canonicalize(case.input))
        val ok = case.then["ok"]?.jsonPrimitive?.booleanOrNull
            ?: error("a canonicalize case is missing `then.ok`")
        if (ok) {
            val expected = case.then["value"]?.jsonPrimitive?.contentOrNull
            assertTrue(result is DisplayName.Result.Ok, "${label(case)} must be accepted, got $result")
            assertEquals(expected, (result as DisplayName.Result.Ok).value, label(case))
        } else {
            val expectedCode = case.then["code"]?.jsonPrimitive?.contentOrNull
            assertTrue(result is DisplayName.Result.Err, "${label(case)} must be rejected, got $result")
            assertEquals(expectedCode, (result as DisplayName.Result.Err).code.name, label(case))
        }
    }

    /** The per-keystroke sanitize path: strips disallowed scalars and caps at 40 graphemes without
     *  trimming or collapsing whitespace. `then.value` is the exact expected output. */
    private fun assertSanitize(case: Case) {
        val expected = case.then["value"]?.jsonPrimitive?.contentOrNull
            ?: error("a sanitize case is missing `then.value`")
        assertEquals(expected, DisplayName.sanitize(case.input), label(case))
    }

    private fun label(case: Case): String = "[${case.intent}] ${case.name}"

    private companion object {
        /** Locate vectors/identity/display-name.json by walking up from the test working directory
         *  (the `:protocol` project dir under Gradle) until it is found, the RepoLayout trick the
         *  engine runner uses (the JVM has no compiled-in `#filePath` like the Swift twin). */
        fun vectorFile(): File {
            var dir: File? = File(System.getProperty("user.dir")).absoluteFile
            while (dir != null) {
                val candidate = File(dir, "vectors/identity/display-name.json")
                if (candidate.isFile) return candidate
                dir = dir.parentFile
            }
            error(
                "could not locate vectors/identity/display-name.json by walking up from " +
                    System.getProperty("user.dir"),
            )
        }
    }
}
