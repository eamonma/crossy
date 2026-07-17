// Pins the analysis panel's pure derivations against apps/ios AnalysisPanel.swift: the legend order
// (owners only, self first as "You"), the stat trio, the ribbon caption's two forms, the moment names,
// and the roster-color seam (wire color else identity hash, paired for the ground). Pure value math, no
// Compose, the RoomAnalysisTests discipline; the composable only lays these out.

package crossy.ui

import crossy.design.IdentityRoster
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
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
        titles: List<RoomTitle> = emptyList(),
        sittings: RoomSittings? = null,
    ) = RoomAnalysis(
        owners = owners,
        momentum = momentum ?: RoomMomentum(duration, List(40) { 0.0 }),
        turningPoint = turningPoint,
        titles = titles,
        sittings = sittings,
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
    fun `the stat trio reads Time, Solvers, Squares off the owners, no context without sittings`() {
        val trio = AnalysisPanelModel.statTrio(bundle(mapOf(0 to "ada", 1 to "ada", 2 to "grace")))
        assertEquals(
            listOf(
                Triple("Time", "1:05", null),
                Triple("Solvers", "2", null),
                Triple("Squares", "3", null),
            ),
            trio,
        )
    }

    @Test
    fun `the Time cell carries the sitting-count context at two or more, the others never`() {
        val twoSittings = RoomSittings(
            count = 2,
            spans = listOf(RoomSittings.Span(0.0, 30.0), RoomSittings.Span(30.0, 65.0)),
            wallSeconds = 4000.0,
        )
        val trio = AnalysisPanelModel.statTrio(
            bundle(mapOf(0 to "ada", 1 to "grace"), sittings = twoSittings),
        )
        assertEquals("2 sittings", trio[0].third, "the Time cell wears the context")
        assertNull(trio[1].third)
        assertNull(trio[2].third)

        // A single sitting reads exactly as today: no context on any cell.
        val oneSitting = RoomSittings(
            count = 1,
            spans = listOf(RoomSittings.Span(0.0, 65.0)),
            wallSeconds = 65.0,
        )
        val flat = AnalysisPanelModel.statTrio(bundle(mapOf(0 to "ada"), sittings = oneSitting))
        assertNull(flat[0].third, "one sitting adds no context")
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

    private fun legendRow(userId: String, name: String, isSelf: Boolean) = AnalysisLegendRow(
        userId = userId,
        name = name,
        color = AnalysisPanelModel.colorFor(userId, emptyList(), ground),
        isSelf = isSelf,
    )

    @Test
    fun `the legend caption is the plain sentence until the chips can isolate`() {
        val rows = listOf(legendRow("grace", "You", isSelf = true), legendRow("ada", "Ada", isSelf = false))
        // Not tappable (the bloom still plays, or an ongoing wash): the plain who-solved-it sentence.
        assertEquals(
            "Each square shows who solved it first.",
            AnalysisPanelModel.legendCaption(rows, isolatedSolverId = null, tappable = false),
        )
    }

    @Test
    fun `the legend caption names the tap affordance once tappable, none isolated`() {
        val rows = listOf(legendRow("grace", "You", isSelf = true), legendRow("ada", "Ada", isSelf = false))
        assertEquals(
            "Each square shows who solved it first. Tap a solver to see just theirs.",
            AnalysisPanelModel.legendCaption(rows, isolatedSolverId = null, tappable = true),
        )
    }

    @Test
    fun `the legend caption names the isolated solver, self or other`() {
        val rows = listOf(legendRow("grace", "You", isSelf = true), legendRow("ada", "Ada", isSelf = false))
        assertEquals(
            "Showing only your squares. Tap again for everyone.",
            AnalysisPanelModel.legendCaption(rows, isolatedSolverId = "grace", tappable = true),
        )
        // The other-solver form interpolates the display name with a curly apostrophe (U+2019).
        assertEquals(
            "Showing only Ada’s squares. Tap again for everyone.",
            AnalysisPanelModel.legendCaption(rows, isolatedSolverId = "ada", tappable = true),
        )
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
