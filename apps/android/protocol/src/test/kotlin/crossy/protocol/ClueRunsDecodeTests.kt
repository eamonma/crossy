package crossy.protocol

import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

// The clue-formatting `runs` field (owner ruling 2026-07-12: clue markup renders as structured
// runs, never stripped, never raw HTML), decoded on every clue the puzzle carries. The additive,
// absent-tolerant contract these tests defend (twin of apps/ios ClueRunsDecodeTests.swift and
// packages/protocol's clue-runs codec tests):
//   absent       a clue with no `runs` decodes with runs == null (plain `text` is the fallback)
//   present      a well-formed `runs` array decodes to its spans; runs' `t` concatenate to `text`
//   unknown `s`  an unrecognized style string SURVIVES decode verbatim (the mapper drops it)
//   malformed    a wrong-shaped `runs` FALLS BACK to null and never sinks the clue
//   whole-puzzle a malformed run inside one clue leaves every other clue decoding cleanly
// The load-bearing case is malformed-falls-back: one broken run must never fail a whole puzzle.

class ClueRunsDecodeTests {
    private fun clue(extra: String): String =
        """{"number":1,"text":"Cat, informally","cellIndices":[0,1,2]$extra}"""

    private fun decodeClue(extra: String): Clue =
        ProtocolJson.decodeFromString(Clue.serializer(), clue(extra))

    // --- Absent (a pre-wave or unstyled clue decodes; text is the fallback) ---

    @Test
    fun clueRunsAbsentReadsAsNull_wave20260712() {
        val value = decodeClue("")
        assertNull(value.runs, "an unstyled clue must still decode, runs null")
        assertEquals("Cat, informally", value.text, "text carries the clue alone")
    }

    @Test
    fun clueRunsNullReadsAsNull_wave20260712() {
        val value = decodeClue(""","runs":null""")
        assertNull(value.runs, "an explicit null runs reads as null, not a decode failure")
    }

    // --- Present (a well-formed runs array decodes; projection equals text) ---

    @Test
    fun clueRunsPresentDecodesSpans_wave20260712() {
        val value = decodeClue(""","runs":[{"t":"Cat, "},{"t":"informally","s":["i"]}]""")
        val runs = requireNotNull(value.runs)
        assertEquals(2, runs.size)
        assertEquals(ClueRun(t = "Cat, "), runs[0])
        assertEquals(ClueRun(t = "informally", s = listOf("i")), runs[1])
    }

    @Test
    fun clueRunsProjectionEqualsText_wave20260712() {
        val value = decodeClue(""","runs":[{"t":"Cat, "},{"t":"informally","s":["i"]}]""")
        val projection = requireNotNull(value.runs).joinToString("") { it.t }
        assertEquals(value.text, projection, "the server's guarantee: the runs' t concatenate to the plain text")
    }

    @Test
    fun clueRunAbsentStylesReadAsEmpty_wave20260712() {
        val value = decodeClue(""","runs":[{"t":"Cat, informally"}]""")
        assertEquals(emptyList<String>(), requireNotNull(value.runs).first().s, "a run with no s decodes to no styles")
    }

    // --- Unknown style (survives decode; the mapper drops it, not the codec) ---

    @Test
    fun clueRunUnknownStyleSurvivesDecode_wave20260712() {
        // Forward compatibility: a style the client does not know must not fail decode. The wire
        // model keeps the raw string; the CrossyUI mapper is what ignores it.
        val value = decodeClue(""","runs":[{"t":"x","s":["b","strike"]}]""")
        assertEquals(
            listOf("b", "strike"), requireNotNull(value.runs).first().s,
            "an unknown style is kept verbatim, never a decode failure",
        )
    }

    // --- Malformed (falls back to null; text carries the clue, decode survives) ---

    @Test
    fun clueRunsWrongShapeFallsBackToNull_wave20260712() {
        // An object where an array belongs: swallowed to null, clue still decodes.
        val value = decodeClue(""","runs":{"t":"x"}""")
        assertNull(value.runs, "a wrong-shaped runs falls back to null, never fails the clue")
        assertEquals("Cat, informally", value.text, "text stays the fallback")
    }

    @Test
    fun clueRunsBadElementFallsBackToNull_wave20260712() {
        // A run missing its required `t`: the array decode fails, and the clue swallows it to null.
        val value = decodeClue(""","runs":[{"s":["i"]}]""")
        assertNull(value.runs, "a run with no t falls back to null, never fails the clue")
    }

    @Test
    fun clueRunsNonStringStyleFallsBackToNull_wave20260712() {
        // A numeric style element makes the s array malformed, so the run and thus the runs array
        // fails to decode; the clue swallows it to null.
        val value = decodeClue(""","runs":[{"t":"x","s":[7]}]""")
        assertNull(value.runs, "a non-string style falls back to null, never fails the clue")
        assertEquals("Cat, informally", value.text)
    }

    // --- Whole-puzzle tolerance (one bad run never sinks the puzzle) ---

    @Test
    fun malformedRunNeverSinksTheWholePuzzleDecode_wave20260712() {
        // A ClientPuzzle whose first across clue carries a malformed runs and whose second carries a
        // good one: the whole puzzle decodes, the bad clue falls back to text, the good clue keeps its runs.
        val json = """
            {
              "rows": 1, "cols": 3, "blocks": [], "circles": [],
              "clues": {
                "across": [
                  {"number":1,"text":"Bad","cellIndices":[0],"runs":{"broken":true}},
                  {"number":2,"text":"Good","cellIndices":[1],"runs":[{"t":"Good","s":["b"]}]}
                ],
                "down": []
              }
            }
        """.trimIndent()
        val puzzle = ProtocolJson.decodeFromString(ClientPuzzle.serializer(), json)
        assertEquals(2, puzzle.clues.across.size, "the whole puzzle decodes")
        assertNull(puzzle.clues.across[0].runs, "the malformed clue falls back to text")
        assertEquals("Bad", puzzle.clues.across[0].text)
        assertEquals(
            listOf(ClueRun(t = "Good", s = listOf("b"))), puzzle.clues.across[1].runs,
            "a sibling clue's good runs are untouched by the bad one",
        )
    }

    // --- Re-encode posture (absent stays off the wire; present round-trips) ---

    @Test
    fun clueWithoutRunsStaysAbsentOnReencode_wave20260712() {
        val value = decodeClue("")
        val keys = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(Clue.serializer(), value)).jsonObject.keys
        assertFalse(keys.contains("runs"), "an absent runs stays off the wire, never becomes null")
    }

    @Test
    fun clueRunsSurviveRoundTrip_wave20260712() {
        val value = decodeClue(""","runs":[{"t":"Cat, "},{"t":"x","s":["b","i"]}]""")
        val round = ProtocolJson.decodeFromString(Clue.serializer(), ProtocolJson.encodeToString(Clue.serializer(), value))
        assertEquals(value.runs, round.runs, "present runs survive a decode/encode/decode trip")
    }

    @Test
    fun clueRunEmptyStylesStayOffTheWire_wave20260712() {
        // Canonical form: an unstyled run carries no s on re-encode, so the round trip is stable and
        // matches the wire's unstyled-run spelling.
        val keys = ProtocolJson.parseToJsonElement(ProtocolJson.encodeToString(ClueRun.serializer(), ClueRun(t = "plain"))).jsonObject.keys
        assertFalse(keys.contains("s"), "an unstyled run's s stays off the wire")
    }
}
