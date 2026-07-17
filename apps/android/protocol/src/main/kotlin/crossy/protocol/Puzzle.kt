// The client puzzle (INV-6, DESIGN.md §4, §7; PROTOCOL.md §12). Twin of the client half of
// packages/protocol/src/puzzle.ts and apps/ios Puzzle.swift.
//
// INV-6 is structural here, deliberately more so than in the TS twin: this module defines
// NO ServerPuzzle and no Solution type at all. The solution-bearing shape exists only
// server-side; a client that cannot even spell the type cannot decode, hold, or re-encode a
// solution. Inv6NoSolutionTests pins this with a descriptor sweep and a decode golden that
// shows a solution-bearing document cannot be represented.
//
// PROTOCOL.md §12 pins the load-bearing fact (the solution split) and leaves the exhaustive
// puzzle schema (image clues, cross-references, per-cell numbering) to ingestion; this is the
// faithful minimal model the wire contract needs, matching `PuzzleBase` field for field.

package crossy.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * One styled span of a clue's prose (PROTOCOL.md §12, clue-formatting wave: clue markup
 * renders as structured runs, never stripped, never raw HTML). Twin of `ClueRun`: literal
 * text `t` plus the styles `s` that wrap it.
 *
 * `s` decodes tolerantly: an unknown style string SURVIVES decode verbatim (a newer server's
 * style must never break an older client, so `s` is a `List<String>` rather than an enum that
 * would reject the value and fail the whole decode). It is absent-optional on the wire (an
 * unstyled run carries no `s`), so it defaults to empty and re-encodes off the wire when empty.
 */
@Serializable
public data class ClueRun(
    val t: String,
    val s: List<String> = emptyList(),
)

/**
 * A clue, structured at ingestion (DESIGN.md §7). No answer field, on either side of the
 * split. Twin of `Clue`.
 *
 * `runs` is the additive clue-formatting field: the styled spelling of `text`. It is absent
 * for unstyled clues and for every puzzle stored before the feature, so plain `text` is the
 * permanent fallback and the only field a renderer ever needs. Decoding is deliberately
 * tolerant: a missing or null `runs` means plain text, and a MALFORMED `runs` value (wrong
 * shape, a bad element, a non-string style) also falls back to null rather than failing the
 * clue, so one broken run can never sink a whole puzzle decode. ClueSerializer exists only for
 * that swallow; the field surface is otherwise the boring twin.
 */
@Serializable(with = ClueSerializer::class)
public data class Clue(
    val number: Int,
    val text: String,
    val cellIndices: List<Int>,
    val runs: List<ClueRun>? = null,
)

/**
 * The hand-written Clue codec. Everything but `runs` decodes as required; `runs` swallows a
 * malformed value to null (the wave's rule, twin of the Swift `try?`), so a broken run leaves
 * the clue on its `text` fallback and every sibling clue decodes cleanly. On encode an absent
 * `runs` stays off the wire (the omit-when-null posture).
 */
public object ClueSerializer : KSerializer<Clue> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("crossy.protocol.Clue") {
            element<Int>("number")
            element<String>("text")
            element<List<Int>>("cellIndices")
            element<List<ClueRun>>("runs", isOptional = true)
        }

    override fun deserialize(decoder: Decoder): Clue {
        val input = decoder as? JsonDecoder
            ?: throw SerializationException("Clue decodes from JSON only")
        val obj = input.decodeJsonElement().jsonObject
        val number = obj["number"]?.jsonPrimitive?.int
            ?: throw SerializationException("clue.number is required")
        val text = obj["text"]?.jsonPrimitive?.content
            ?: throw SerializationException("clue.text is required")
        val cellIndices = (obj["cellIndices"]?.jsonArray
            ?: throw SerializationException("clue.cellIndices is required"))
            .map { it.jsonPrimitive.int }
        val runsElement = obj["runs"]
        val runs = if (runsElement == null || runsElement is JsonNull) {
            null
        } else {
            // Tolerant by design: a wrong-shaped runs, a run missing `t`, or a non-string
            // style must never sink the puzzle decode. runCatching swallows the failure to
            // null, leaving `text` as the fallback.
            runCatching {
                input.json.decodeFromJsonElement(ListSerializer(ClueRun.serializer()), runsElement)
            }.getOrNull()
        }
        return Clue(number, text, cellIndices, runs)
    }

    override fun serialize(encoder: Encoder, value: Clue) {
        val output = encoder as? JsonEncoder
            ?: throw SerializationException("Clue encodes to JSON only")
        val obj = buildJsonObject {
            put("number", value.number)
            put("text", value.text)
            put("cellIndices", buildJsonArray { value.cellIndices.forEach { add(JsonPrimitive(it)) } })
            // Absent stays off the wire (the omit-when-null posture, matching shadedCircles).
            value.runs?.let {
                put("runs", output.json.encodeToJsonElement(ListSerializer(ClueRun.serializer()), it))
            }
        }
        output.encodeJsonElement(obj)
    }
}

/** Across and down clue lists. Twin of `Clues`. */
@Serializable
public data class Clues(
    val across: List<Clue>,
    val down: List<Clue>,
)

/**
 * The only puzzle type on any client-facing payload (REST §12). No solution field,
 * transitively (INV-6). Twin of `ClientPuzzle` (= `PuzzleBase`). `shadedCircles` is genuinely
 * absent-optional (the TS field is `?`; ingestion omits it when empty), so a null default is
 * exactly right: an absent key decodes to null and a null re-encodes to an absent key.
 */
@Serializable
public data class ClientPuzzle(
    val rows: Int,
    val cols: Int,
    val blocks: List<Int>,
    val circles: List<Int>,
    val clues: Clues,
    val shadedCircles: List<Int>? = null,
)
