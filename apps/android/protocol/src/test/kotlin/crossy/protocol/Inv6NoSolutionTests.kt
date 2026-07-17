package crossy.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// INV-6: solutions never leave the server, enforced structurally by the client puzzle type, never
// by runtime stripping. The Kotlin twin is as strict as the Swift one: this module defines no
// ServerPuzzle and no Solution type at all, so a client cannot even spell, decode, hold, or
// re-encode a solution. Twin of packages/protocol/src/inv6-no-solution-leak.test.ts and apps/ios
// INV6NoSolutionTests.swift. Proven three ways: the types' own declared fields (the serial
// descriptor, the compile-time schema), a decode golden showing a solution-bearing document cannot
// be represented, and a serialized-key sweep over the fixtures.

class Inv6NoSolutionTests {
    /** Every declared serialized element name reachable from a descriptor, recursively. This is the
     *  type's compile-time field schema: a field the type cannot spell cannot appear here. */
    private fun elementNames(descriptor: SerialDescriptor, seen: MutableSet<String> = mutableSetOf()): List<String> {
        if (!seen.add(descriptor.serialName)) return emptyList()
        val names = mutableListOf<String>()
        for (i in 0 until descriptor.elementsCount) {
            names.add(descriptor.getElementName(i))
            names.addAll(elementNames(descriptor.getElementDescriptor(i), seen))
        }
        return names
    }

    private fun assertNoSolutionLabel(labels: List<String>, what: String) {
        for (label in labels) {
            assertFalse(
                asciiLower(label).contains("solution"),
                "$what carries a solution-named member \"$label\" (INV-6)",
            )
        }
    }

    @Test
    fun noClientFacingTypeHasASolutionField_INV6() {
        // Structural sweep over the declared field schema of every client-facing payload family: the
        // wire board (welcome), the game view and puzzle view, both list rows, and the analysis
        // bundle. A solution-named field anywhere in the schema fails. This is the compile-time
        // absence: `ClientPuzzle` has no `solution` accessor to reference, so none can be declared.
        val surfaces: List<Pair<String, KSerializer<*>>> = listOf(
            "ClientPuzzle" to ClientPuzzle.serializer(),
            "GameView" to GameView.serializer(),
            "PuzzleView" to PuzzleView.serializer(),
            "GameSummary" to GameSummary.serializer(),
            "PuzzleSummary" to PuzzleSummary.serializer(),
            "AnalysisView" to AnalysisView.serializer(),
            "WelcomeMessage" to WelcomeMessage.serializer(),
        )
        for ((what, serializer) in surfaces) {
            assertNoSolutionLabel(elementNames(serializer.descriptor), what)
        }
    }

    @Test
    fun aSolutionBearingDocumentCannotBeRepresented_INV6() {
        // The twin of toClientPuzzle's golden, made structural: hand ClientPuzzle a server-shaped
        // document WITH a solution; the type has nowhere to put it (and ignoreUnknownKeys drops the
        // extra key), so re-encoding proves the solution is gone by construction, not by stripping.
        val serverShaped = """
            {
              "rows": 1,
              "cols": 2,
              "blocks": [1],
              "circles": [],
              "clues": {
                "across": [{ "number": 1, "text": "Feline pet", "cellIndices": [0] }],
                "down": []
              },
              "solution": ["CAT", null]
            }
        """.trimIndent()
        val decoded = ProtocolJson.decodeFromString(ClientPuzzle.serializer(), serverShaped)
        val json = ProtocolJson.encodeToString(ClientPuzzle.serializer(), decoded)
        assertFalse(json.contains("solution"))
        assertFalse(json.contains("CAT"))
        assertTrue(json.contains("Feline pet"), "the client shape keeps geometry and clues")
    }

    @Test
    fun noSerializedClientPayloadContainsASolutionKey_INV6() {
        // Serialization golden over the checked-in fixtures, re-encoded through the typed twins where
        // the INV-6 surface lives: no JSON object key anywhere may be solution-named. (Values are
        // user-visible content like AMBIGUOUS_SOLUTION and are not keys.)
        val gameView = assertLosslessRoundTrip(GameView.serializer(), FixtureGroup.REST, "game-view")
        val welcome = ProtocolJson.decodeFromString(ServerMessageSerializer, Fixtures.text(FixtureGroup.WIRE, "welcome"))
        val encoded = mapOf(
            "GameView" to ProtocolJson.encodeToString(GameView.serializer(), gameView),
            "welcome" to ProtocolJson.encodeToString(ServerMessageSerializer, welcome),
        )
        for ((what, json) in encoded) {
            assertNoSolutionLabel(allJsonKeys(ProtocolJson.parseToJsonElement(json)), what)
        }
    }
}
