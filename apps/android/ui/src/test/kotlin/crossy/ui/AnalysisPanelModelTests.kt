// Pins the analysis panel's pure derivations against apps/ios AnalysisPanel.swift: the legend order
// (owners only, self first as "You"), the stat trio, the ribbon caption's two forms, the moment names,
// and the roster-color seam (wire color else identity hash, paired for the ground). Pure value math, no
// Compose, the RoomAnalysisTests discipline; the composable only lays these out.

package crossy.ui

import crossy.design.IdentityRoster
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AnalysisPanelModelTests {
    private val ground = GridGround.STUDIO

    private fun member(userId: String, name: String, wire: String = "") = RosterMember(
        userId = userId,
        displayName = name,
        wireColor = wire,
        avatarUrl = null,
        isHost = false,
        isSpectator = false,
        connected = true,
        cursor = null,
    )

    private fun bundle(
        owners: Map<Int, String>,
        duration: Double = 65.0,
        momentum: RoomMomentum? = null,
        turningPoint: RoomTurningPoint? = null,
        first: RoomBeat? = null,
        last: RoomBeat? = null,
    ) = RoomAnalysis(
        owners = owners,
        momentum = momentum ?: RoomMomentum(duration, List(40) { 0.0 }),
        firstToFall = first,
        lastSquare = last,
        turningPoint = turningPoint,
    )

    @Test
    fun `the legend carries only owners, dropping a member who owns nothing`() {
        val members = listOf(member("ada", "Ada"), member("grace", "Grace"), member("mallory", "Mallory"))
        val rows = AnalysisPanelModel.legendRows(
            bundle(mapOf(0 to "ada", 1 to "ada", 2 to "grace")), members, selfUserId = null, ground,
        )
        assertEquals(listOf("ada", "grace"), rows.map { it.userId }, "mallory owns nothing, so no chip")
    }

    @Test
    fun `the self legend row leads and reads You`() {
        val members = listOf(member("ada", "Ada"), member("grace", "Grace"))
        val rows = AnalysisPanelModel.legendRows(
            bundle(mapOf(0 to "ada", 1 to "grace")), members, selfUserId = "grace", ground,
        )
        assertEquals(listOf("grace", "ada"), rows.map { it.userId }, "self first, whatever the roster order")
        assertTrue(rows[0].isSelf)
        assertEquals("You", rows[0].name)
        assertEquals("Ada", rows[1].name)
        assertFalse(rows[1].isSelf)
    }

    @Test
    fun `the stat trio reads Time, Solvers, Squares off the owners`() {
        val trio = AnalysisPanelModel.statTrio(bundle(mapOf(0 to "ada", 1 to "ada", 2 to "grace")))
        assertEquals(
            listOf("Time" to "1:05", "Solvers" to "2", "Squares" to "3"),
            trio,
        )
    }

    @Test
    fun `the momentum caption reads the stall only when there is one to shade`() {
        val stalled = bundle(
            mapOf(0 to "ada"),
            momentum = RoomMomentum(65.0, List(39) { 0.0 } + listOf(0.6)),
            turningPoint = RoomTurningPoint(stallSeconds = 12.0, breakSeconds = 40.0, burst = 3),
        )
        assertEquals(AnalysisCopy.momentumCaptionStalled, AnalysisPanelModel.momentumCaption(stalled))

        val flat = bundle(mapOf(0 to "ada")) // all-zero momentum, no turning point
        assertEquals(AnalysisCopy.momentumCaptionPlain, AnalysisPanelModel.momentumCaption(flat))

        // Signal but no turning point still reads the plain line (nothing to shade).
        val noTurn = bundle(mapOf(0 to "ada"), momentum = RoomMomentum(65.0, List(39) { 0.0 } + listOf(0.6)))
        assertEquals(AnalysisCopy.momentumCaptionPlain, AnalysisPanelModel.momentumCaption(noTurn))
    }

    @Test
    fun `a moment name is You, the roster name, or the left-solver fallback`() {
        val members = listOf(member("ada", "Ada"))
        assertEquals("You", AnalysisPanelModel.nameFor("ada", members, selfUserId = "ada"))
        assertEquals("Ada", AnalysisPanelModel.nameFor("ada", members, selfUserId = "grace"))
        assertEquals("A solver", AnalysisPanelModel.nameFor("ghost", members, selfUserId = "grace"))
    }

    @Test
    fun `a color takes the wire when the member has one, the id hash otherwise`() {
        val wired = member("ada", "Ada", wire = "#3D6BD6")
        val members = listOf(wired)
        val fromWire = AnalysisPanelModel.colorFor("ada", members, ground)
        assertEquals(ground.rosterColor(IdentityRoster.colorForWireColor("#3D6BD6")!!), fromWire)

        // An owner who is not in the roster (left, or a bare seed): no wire, so the id hash stands.
        val fromHash = AnalysisPanelModel.colorFor("ghost", members, ground)
        assertEquals(ground.rosterColor(IdentityRoster.color("ghost")), fromHash)
    }
}
