// The roster's pure rules pinned against apps/ios RosterList.swift (DESIGN.md §3, §15; PROTOCOL.md
// §4, §12): presence order (connected first, then ASCII by name then id, INV-1), the Here/Away split
// (self always here, a disconnected guest-spectator drops), the solvers-only cluster with its +N
// overflow, the quiet state word, and the action gates (kick never self, jump only on a live cursor,
// a spectator's cursor suppressed at the map).
package crossy.ui

import crossy.protocol.Cursor
import crossy.protocol.Direction
import crossy.protocol.Participant
import crossy.protocol.Role
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RosterListTests {
    private fun member(
        id: String,
        name: String = id,
        connected: Boolean = true,
        host: Boolean = false,
        spectator: Boolean = false,
        cursor: RosterCursor? = null,
    ) = RosterMember(
        userId = id,
        displayName = name,
        wireColor = "",
        avatarUrl = null,
        isHost = host,
        isSpectator = spectator,
        connected = connected,
        cursor = cursor,
    )

    @Test
    fun `INV1 presence order is connected first then ASCII by name then id, never locale collation`() {
        val ordered = RosterList.ordered(
            listOf(
                member("u3", name = "zed", connected = false),
                member("u2", name = "amy"),
                member("u1", name = "Bob"),
                member("u4", name = "amy"),
            ),
        )
        // ASCII byte order: "Bob" (B=0x42) sorts before "amy" (a=0x61); ties break on userId.
        assertEquals(listOf("u1", "u2", "u4", "u3"), ordered.map { it.userId })
    }

    @Test
    fun `PROTOCOL4 the split leads with here, gathers away below, and keeps self here mid-reconnect`() {
        val (here, away) = RosterList.sections(
            listOf(
                member("self", connected = false),
                member("solver", connected = false),
                member("live"),
            ),
            selfUserId = "self",
        )
        assertEquals(listOf("live", "self"), here.map { it.userId })
        assertEquals(listOf("solver"), away.map { it.userId })
    }

    @Test
    fun `PROTOCOL12 a disconnected spectator drops from both sides, no permanent away ghost`() {
        val (here, away) = RosterList.sections(
            listOf(member("ghost", connected = false, spectator = true), member("live")),
            selfUserId = "live",
        )
        assertEquals(listOf("live"), here.map { it.userId })
        assertTrue(away.isEmpty())
    }

    @Test
    fun `DESIGN3 the cluster is solvers-only and collapses past the cap to plus-N`() {
        val members = (1..7).map { member("u$it", name = "p$it") } + member("spec", spectator = true)
        val (pucks, overflow) = RosterList.cluster(members)
        assertEquals(RosterList.puckCap, pucks.size)
        assertEquals(2, overflow) // 7 solvers, cap 5: two collapse; the spectator never counts.
        assertFalse(pucks.any { it.isSpectator })
    }

    @Test
    fun `ID5 the state word puts presence before role and says nothing for a connected solver`() {
        assertEquals("Away", RosterList.stateWord(member("u", connected = false, host = true)))
        assertEquals("Watching", RosterList.stateWord(member("u", spectator = true)))
        assertEquals("Host", RosterList.stateWord(member("u", host = true)))
        assertNull(RosterList.stateWord(member("u")))
    }

    @Test
    fun `PROTOCOL12 the kick gate offers everyone but self, and jump needs a live cursor`() {
        assertTrue(RosterList.canKick(member("other"), selfUserId = "self"))
        assertFalse(RosterList.canKick(member("self"), selfUserId = "self"))
        assertFalse(RosterList.canKick(member("other"), selfUserId = null))
        assertTrue(RosterList.canJump(member("u", cursor = RosterCursor(3, true))))
        assertFalse(RosterList.canJump(member("u")))
    }

    @Test
    fun `DESIGN15 the participant map suppresses a spectator's cursor so Go to never lights on them`() {
        val members = RosterList.membersFrom(
            participants = listOf(
                Participant("spec", "S", "", Role.SPECTATOR, connected = true),
                Participant("solver", "P", "", Role.SOLVER, connected = true),
            ),
            cursors = mapOf(
                "spec" to Cursor("spec", 5, Direction.ACROSS),
                "solver" to Cursor("solver", 7, Direction.DOWN),
            ),
            selfUserId = "solver",
        )
        assertNull(members.first { it.userId == "spec" }.cursor)
        assertEquals(RosterCursor(7, isAcross = false), members.first { it.userId == "solver" }.cursor)
    }

    @Test
    fun `EXPERIENCE watching gates read the self row only and never guess an absent self`() {
        val members = listOf(member("spec", spectator = true), member("host", host = true))
        assertTrue(RosterList.selfIsSpectator(members, "spec"))
        assertFalse(RosterList.selfIsSpectator(members, "host"))
        assertFalse(RosterList.selfIsSpectator(members, null))
        assertTrue(RosterList.selfIsHost(members, "host"))
        assertFalse(RosterList.selfIsHost(members, "spec"))
        assertFalse(RosterList.selfIsHost(members, "missing"))
    }
}
