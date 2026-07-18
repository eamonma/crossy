package crossy.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// The §11 error-code table and the protocol version, pinned verbatim, twinning
// packages/protocol/src/errors.test.ts + version.test.ts and apps/ios WireErrorTableTests.swift.

class WireErrorTableTests {
    // The §11 table: code -> fatality. `INTERNAL` is VARIES (fatal:true means reconnect). The four
    // vote codes (VOTE_PENDING, NO_VOTE_OPEN, NOT_ELECTOR, ALREADY_VOTED) are the D32 additions
    // (Wave 15.1 rewrote §11), all non-fatal: a rejected proposal or ballot clears the pending
    // intent and shows no toast (Wave 15.6 store).
    private val table = mapOf(
        "UNAUTHORIZED" to Fatality.ALWAYS,
        "NOT_PARTICIPANT" to Fatality.ALWAYS,
        "DENIED" to Fatality.ALWAYS,
        "GAME_NOT_FOUND" to Fatality.ALWAYS,
        "PROTOCOL_VERSION_UNSUPPORTED" to Fatality.ALWAYS,
        "GAME_NOT_ONGOING" to Fatality.NEVER,
        "INVALID_CELL" to Fatality.NEVER,
        "INVALID_VALUE" to Fatality.NEVER,
        "GRID_NOT_FULL" to Fatality.NEVER,
        "VOTE_PENDING" to Fatality.NEVER,
        "NO_VOTE_OPEN" to Fatality.NEVER,
        "NOT_ELECTOR" to Fatality.NEVER,
        "ALREADY_VOTED" to Fatality.NEVER,
        "ROLE_FORBIDDEN" to Fatality.NEVER,
        "RATE_LIMITED" to Fatality.NEVER,
        "UNKNOWN_TYPE" to Fatality.NEVER,
        "INTERNAL" to Fatality.VARIES,
    )

    @Test
    fun listsExactlyTheSeventeenSection11Codes() {
        assertEquals(table.keys, ErrorCode.entries.map { it.name }.toSet())
    }

    @Test
    fun classifiesFatalityPerTheSection11Table() {
        for (code in ErrorCode.entries) {
            assertEquals(table[code.name], code.fatality, "${code.name} fatality must match PROTOCOL.md §11")
        }
    }

    @Test
    fun protocolVersionIs1PerTheChangelog() {
        // PROTOCOL.md §2, §14 changelog: v1, 2026-07-07, initial.
        assertEquals(1, ProtocolVersion.CURRENT)
    }
}
