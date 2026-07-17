package crossy.protocol

import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

// The stats side of sittings (PROTOCOL.md §4; DESIGN.md D29): `activeSolveSeconds` and
// `sittingCount` are additive-optional, frozen pre-D29 rows lack them forever (never backfilled),
// and the headline Time everywhere stats render is active time with the wall-clock fallback (owner
// ruling). The fixtures pin the wire shapes (WireSnapshotTests: gameCompleted carries the fields,
// sync-completed predates them); these pin the decode tolerance and the one preference rule. Twin
// of apps/ios StatsSittingsTests.swift.

class StatsSittingsTests {
    @Test
    fun statsWithoutSittingsFieldsDecodesWithNulls_D29() {
        // §4, D29: a frozen pre-D29 stats row (no activeSolveSeconds, no sittingCount) decodes fine
        // — additive fields, absence tolerated, never a decode failure. `checkCount` is required and
        // present, the D27 permanent count.
        val frozen = """
            {
              "solveTimeSeconds": 96067,
              "totalEvents": 899,
              "participantCount": 4,
              "checkCount": 2
            }
        """.trimIndent()
        val stats = ProtocolJson.decodeFromString(Stats.serializer(), frozen)
        assertNull(stats.activeSolveSeconds)
        assertNull(stats.sittingCount)
        assertEquals(96067, stats.solveTimeSeconds)
    }

    @Test
    fun statsWithSittingsFieldsDecodesBoth_D29() {
        val current = """
            {
              "solveTimeSeconds": 96067,
              "activeSolveSeconds": 1453,
              "sittingCount": 2,
              "totalEvents": 899,
              "participantCount": 4,
              "checkCount": 2
            }
        """.trimIndent()
        val stats = ProtocolJson.decodeFromString(Stats.serializer(), current)
        assertEquals(1453, stats.activeSolveSeconds)
        assertEquals(2, stats.sittingCount)
        assertEquals(96067, stats.solveTimeSeconds, "solveTimeSeconds keeps its wall-clock semantics unchanged, forever (§4)")
    }

    @Test
    fun headlinePrefersActiveOverWall_D29() {
        // Owner ruling, D29: active time is THE headline Time stat wherever stats render — a
        // two-evening Sunday reads 24:13, not the 26:41:07 nobody experienced.
        val stats = Stats(
            solveTimeSeconds = 96067, totalEvents = 899, participantCount = 4, checkCount = 2,
            activeSolveSeconds = 1453, sittingCount = 2,
        )
        assertEquals(1453, stats.headlineSolveSeconds)
    }

    @Test
    fun headlineFallsBackToWallClockWhenActiveAbsent_D29() {
        // §4, D29: stats frozen before the fields shipped fall back to the wall-clock number they
        // always showed; a client never invents an active time.
        val frozen = Stats(solveTimeSeconds = 2272, totalEvents = 899, participantCount = 4, checkCount = 0)
        assertEquals(2272, frozen.headlineSolveSeconds)
    }

    @Test
    fun absentSittingsFieldsStayAbsentOnReencode_D29() {
        // Expand/contract honesty (§4: never backfilled): a pre-D29 row re-encodes WITHOUT the keys
        // — absent stays absent, unlike checkCount whose 0 is a real count (a required field).
        val frozen = Stats(solveTimeSeconds = 2272, totalEvents = 899, participantCount = 4, checkCount = 0)
        val reencoded = ProtocolJson.parseToJsonElement(
            ProtocolJson.encodeToString(Stats.serializer(), frozen),
        ).jsonObject
        assertFalse(reencoded.containsKey("activeSolveSeconds"))
        assertFalse(reencoded.containsKey("sittingCount"))
    }
}
