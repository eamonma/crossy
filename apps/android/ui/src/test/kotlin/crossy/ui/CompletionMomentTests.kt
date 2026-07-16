// The completion moment pinned against apps/ios CompletionMoment.swift so the twins cannot drift: the
// exactly-once celebration gate (INV-3), the mosaic tint/hold/settle envelope, and the writer-to-
// roster-color palette. Pure value math, no Compose, the GridFlashTests discipline.
package crossy.ui

import crossy.design.IdentityRoster
import crossy.protocol.Cell
import crossy.protocol.GameStatus
import crossy.protocol.Participant
import crossy.protocol.Role
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CompletionMomentTests {

    // Feed a sequence of (status, live) observations through a fresh gate; return the list of fire
    // verdicts, one per observation. Mirrors how the room drives the gate from render transitions.
    private fun run(vararg steps: Pair<RoomStatus, Boolean>): List<Boolean> {
        var gate = CelebrationGate()
        return steps.map { (status, live) ->
            val step = gate.observe(status, live)
            gate = step.gate
            step.fired
        }
    }

    @Test
    fun `INV-3 the celebration fires once on a live ongoing to completed transition`() {
        val fires = run(
            RoomStatus.ONGOING to true,
            RoomStatus.COMPLETED to true,
        )
        assertEquals(listOf(false, true), fires)
    }

    @Test
    fun `INV-3 the celebration never fires twice, whatever reconnects follow`() {
        // Fire once, then a resync (completed, not live), then a reconnect welcome back to completed:
        // the gate stays fired and never celebrates again.
        val fires = run(
            RoomStatus.ONGOING to true,
            RoomStatus.COMPLETED to true,
            RoomStatus.COMPLETED to false,
            RoomStatus.COMPLETED to true,
            RoomStatus.COMPLETED to true,
        )
        assertEquals(listOf(false, true, false, false, false), fires)
    }

    @Test
    fun `INV-3 a reconnect into an already-completed room never celebrates`() {
        // The first observation is already terminal (a welcome snapshot of a completed game): the
        // gate was never live-and-ongoing, so it shows the terminal state and never fires.
        val fires = run(
            RoomStatus.COMPLETED to true,
            RoomStatus.COMPLETED to true,
        )
        assertEquals(listOf(false, false), fires)
    }

    @Test
    fun `INV-3 an ongoing board that was never live does not arm the gate`() {
        // Connecting (ongoing, not live) then straight to completed without a live beat: the store
        // never exposed a live ongoing board, so nothing celebrates.
        val fires = run(
            RoomStatus.ONGOING to false,
            RoomStatus.COMPLETED to true,
        )
        assertEquals(listOf(false, false), fires)
    }

    @Test
    fun `INV-3 an abandoned room never celebrates`() {
        val fires = run(
            RoomStatus.ONGOING to true,
            RoomStatus.ABANDONED to true,
        )
        assertEquals(listOf(false, false), fires)
    }

    @Test
    fun `INV-3 the gate is idempotent on a repeated identical observation`() {
        // Two identical ongoing-live observations arm the gate without firing; the first completed
        // observation fires once.
        val fires = run(
            RoomStatus.ONGOING to true,
            RoomStatus.ONGOING to true,
            RoomStatus.COMPLETED to true,
        )
        assertEquals(listOf(false, false, true), fires)
    }

    @Test
    fun `INV-3 RoomStatus maps the wire GameStatus`() {
        assertEquals(RoomStatus.ONGOING, RoomStatus.from(GameStatus.ONGOING))
        assertEquals(RoomStatus.COMPLETED, RoomStatus.from(GameStatus.COMPLETED))
        assertEquals(RoomStatus.ABANDONED, RoomStatus.from(GameStatus.ABANDONED))
    }

    @Test
    fun `the mosaic is dark before the trigger and after the envelope`() {
        assertEquals(0.0, MosaicEnvelope.intensity(-0.01))
        assertEquals(0.0, MosaicEnvelope.intensity(0.0))
        assertEquals(0.0, MosaicEnvelope.intensity(MosaicEnvelope.DURATION_SECONDS))
        assertEquals(0.0, MosaicEnvelope.intensity(MosaicEnvelope.DURATION_SECONDS + 1.0))
    }

    @Test
    fun `the mosaic rises with an ease-out, holds full, then settles`() {
        // The rise is an ease-out (1 - (1-t)^3): a quarter into the rise sits well above the linear
        // quarter of 0.25, and the rise ends at full tint.
        val quarter = MosaicEnvelope.intensity(MosaicEnvelope.RISE_SECONDS * 0.25)
        assertTrue(quarter > 0.25) { "the rise must be eased, not linear" }
        assertEquals(1.0, MosaicEnvelope.intensity(MosaicEnvelope.RISE_SECONDS), 1e-9)
        // The hold is flat at full tint across its whole window.
        assertEquals(1.0, MosaicEnvelope.intensity(MosaicEnvelope.RISE_SECONDS + MosaicEnvelope.HOLD_SECONDS / 2))
        assertEquals(1.0, MosaicEnvelope.intensity(MosaicEnvelope.RISE_SECONDS + MosaicEnvelope.HOLD_SECONDS - 1e-6), 1e-6)
        // The settle falls monotonically from full back to ink.
        val settleStart = MosaicEnvelope.RISE_SECONDS + MosaicEnvelope.HOLD_SECONDS
        val early = MosaicEnvelope.intensity(settleStart + MosaicEnvelope.SETTLE_SECONDS * 0.25)
        val late = MosaicEnvelope.intensity(settleStart + MosaicEnvelope.SETTLE_SECONDS * 0.75)
        assertTrue(early in 0.0..1.0 && late in 0.0..1.0)
        assertTrue(early > late) { "the settle must fall toward ink" }
    }

    @Test
    fun `Reduce Motion steps the mosaic rather than animating it`() {
        // Full tint held for the whole envelope, then cleared: no eased rise or settle (the FlashEnvelope
        // reduced-motion doctrine). The attribution color still shows; it just does not move.
        assertEquals(0.0, MosaicEnvelope.intensity(0.0, reduceMotion = true))
        assertEquals(1.0, MosaicEnvelope.intensity(0.001, reduceMotion = true))
        assertEquals(1.0, MosaicEnvelope.intensity(MosaicEnvelope.RISE_SECONDS * 0.25, reduceMotion = true))
        assertEquals(1.0, MosaicEnvelope.intensity(MosaicEnvelope.DURATION_SECONDS - 1e-6, reduceMotion = true))
        assertEquals(0.0, MosaicEnvelope.intensity(MosaicEnvelope.DURATION_SECONDS, reduceMotion = true))
    }

    private fun participant(userId: String, color: String, role: Role = Role.SOLVER) =
        Participant(userId = userId, displayName = userId, color = color, role = role, connected = true)

    @Test
    fun `the mosaic palette tints each cell to its writer's roster color`() {
        // A wire color slots the writer authoritatively; the ground maps the identity to its side.
        val ground = GridGround.STUDIO
        val participants = listOf(participant("ann", "#DE5722"))
        val colors = GridMosaic.colors(mapOf(5 to "ann"), participants, ground)
        val expected = ground.rosterColor(IdentityRoster.colorForWireColor("#DE5722")!!)
        assertEquals(expected, colors[5])
    }

    @Test
    fun `the mosaic palette falls back to the user-id hash when the wire color is absent`() {
        val ground = GridGround.OBSERVATORY
        // A writer with no roster entry (a departed teammate whose letter stands) slots by id hash.
        val colors = GridMosaic.colors(mapOf(3 to "ghost"), participants = emptyList(), ground = ground)
        assertEquals(ground.rosterColor(IdentityRoster.color("ghost")), colors[3])
    }

    @Test
    fun `the two grounds tint the same writer in their own registers`() {
        val participants = listOf(participant("ann", "#DE5722"))
        val light = GridMosaic.colors(mapOf(0 to "ann"), participants, GridGround.STUDIO)[0]
        val dark = GridMosaic.colors(mapOf(0 to "ann"), participants, GridGround.OBSERVATORY)[0]
        assertNotEquals(light, dark)
    }

    @Test
    fun `ID-1 a muted completion mosaic derives an empty palette`() {
        val participants = listOf(participant("ann", "#DE5722"))
        val muted = GridMosaic.colors(
            mapOf(0 to "ann"), participants, GridGround.STUDIO, completionMosaicEnabled = false,
        )
        assertTrue(muted.isEmpty())
    }

    @Test
    fun `sequenced writers exclude empty and cleared cells`() {
        // A filled cell maps to its writer; a cleared cell (by present, v null) and a never-written
        // cell are excluded, so a cleared cell never tints (DESIGN.md §8).
        val cells = mapOf(
            1 to Cell(v = "A", by = "ann"),
            2 to Cell(v = null, by = "ann"), // cleared: keeps its clearer, holds no letter
            3 to Cell(v = "B", by = null), // a letter with no writer never tints
        )
        val writers = sequencedWriters(cells)
        assertEquals("ann", writers[1])
        assertNull(writers[2])
        assertNull(writers[3])
        assertFalse(writers.containsKey(2))
    }
}
