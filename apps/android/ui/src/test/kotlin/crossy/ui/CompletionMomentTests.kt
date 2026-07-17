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
    fun `the blurred field waits out the settle delay then eases in and stands forever`() {
        // The melt (the wash-blur ratification): the blurred field is dark through the whole bloom
        // (rise and hold; the crisp field is the celebration), enters BLUR_DELAY_SECONDS into the
        // settle, eases 0 -> 1 over BLUR_FADE_SECONDS, and stands at 1 forever. The record never
        // erases itself (the flash-then-disappear fix's shape, worn by the field).
        val settleStart = MosaicEnvelope.RISE_SECONDS + MosaicEnvelope.HOLD_SECONDS
        assertEquals(0.0, MosaicEnvelope.settledWashIntensity(0.0))
        assertEquals(0.0, MosaicEnvelope.settledWashIntensity(MosaicEnvelope.RISE_SECONDS))
        assertEquals(0.0, MosaicEnvelope.settledWashIntensity(settleStart))
        assertEquals(0.0, MosaicEnvelope.settledWashIntensity(settleStart + MosaicEnvelope.BLUR_DELAY_SECONDS))
        var previous = 0.0
        for (step in 0..20) {
            val elapsed = settleStart + MosaicEnvelope.BLUR_DELAY_SECONDS +
                MosaicEnvelope.BLUR_FADE_SECONDS * step / 20
            val value = MosaicEnvelope.settledWashIntensity(elapsed)
            assertTrue(value >= previous) { "the fade must not rebound, t=$elapsed" }
            previous = value
        }
        assertEquals(1.0, MosaicEnvelope.settledWashIntensity(MosaicEnvelope.DURATION_SECONDS), 1e-9)
        assertEquals(1.0, MosaicEnvelope.settledWashIntensity(MosaicEnvelope.DURATION_SECONDS + 3600.0))
    }

    @Test
    fun `the melt trades the crisp field for the blurred one across the settle`() {
        // Mid-settle both layers are live: the crisp field (riding intensity, one clock with the
        // glyph) is on its way out while the blurred field is on its way in; by the envelope's end
        // the crisp layer is dark and the field stands.
        val mid = MosaicEnvelope.RISE_SECONDS + MosaicEnvelope.HOLD_SECONDS +
            MosaicEnvelope.BLUR_DELAY_SECONDS + MosaicEnvelope.BLUR_FADE_SECONDS / 2
        val crisp = MosaicEnvelope.intensity(mid)
        val blur = MosaicEnvelope.settledWashIntensity(mid)
        assertTrue(crisp in 0.0..1.0 && crisp < 1.0) { "the crisp field is letting go" }
        assertTrue(blur > 0.0 && blur < 1.0) { "the blurred field is breathing in" }
        assertEquals(0.0, MosaicEnvelope.intensity(MosaicEnvelope.DURATION_SECONDS)) { "the glyph settles to ink" }
        assertEquals(1.0, MosaicEnvelope.settledWashIntensity(MosaicEnvelope.DURATION_SECONDS), 1e-9)
        // The envelope ends when the blur lands: the delayed fade is inside the duration, never past it.
        assertEquals(
            MosaicEnvelope.RISE_SECONDS + MosaicEnvelope.HOLD_SECONDS +
                MosaicEnvelope.BLUR_DELAY_SECONDS + MosaicEnvelope.BLUR_FADE_SECONDS,
            MosaicEnvelope.DURATION_SECONDS,
            1e-12,
        )
    }

    @Test
    fun `Reduce Motion steps the blurred field in at the envelope's end`() {
        // The bloom is a held step (intensity's reduced-motion form: the crisp record through the
        // envelope), then the settled record appears in one step, no animated motion.
        assertEquals(0.0, MosaicEnvelope.settledWashIntensity(0.0, reduceMotion = true))
        assertEquals(0.0, MosaicEnvelope.settledWashIntensity(MosaicEnvelope.RISE_SECONDS, reduceMotion = true))
        assertEquals(
            0.0,
            MosaicEnvelope.settledWashIntensity(MosaicEnvelope.DURATION_SECONDS - 1e-6, reduceMotion = true),
        )
        assertEquals(1.0, MosaicEnvelope.settledWashIntensity(MosaicEnvelope.DURATION_SECONDS, reduceMotion = true))
        assertEquals(
            1.0,
            MosaicEnvelope.settledWashIntensity(MosaicEnvelope.DURATION_SECONDS + 1.0, reduceMotion = true),
        )
    }

    @Test
    fun `the settled record's tokens are the ratified contract values`() {
        // The wash-blur ratification (2026-07-17), shared across web, iOS, and Android: blur radius
        // 20/36 of the cell module, settled alpha 0.5, edge overscan at least 1.5 radii. The bloom's
        // crisp field keeps its own 0.30 (and a time-gated replay wash stays crisp 0.30); the settled
        // weight is a NEW token, never a bump of the old one.
        assertEquals(20f / 36f, GridMosaic.BLUR_RADIUS_CELL_FRACTION)
        assertEquals(0.50f, GridMosaic.SETTLED_WASH_ALPHA)
        assertEquals(0.30f, GridMosaic.WASH_ALPHA)
        assertTrue(GridMosaic.BLUR_OVERSCAN_RADII >= 1.5f) { "edge overscan must cover the blur's reach" }
    }

    @Test
    fun `only frame-edge cells overscan, on exactly their outer sides`() {
        // 3x4 board (rows=3, cols=4): the overscan extends a tint rect outward past the frame before
        // blurring, so the field never fades at the frame; interior cells never extend.
        assertEquals(GridMosaic.BlurOverscan(left = true, top = true, right = false, bottom = false), GridMosaic.blurOverscan(0, 3, 4))
        assertEquals(GridMosaic.BlurOverscan(left = false, top = true, right = true, bottom = false), GridMosaic.blurOverscan(3, 3, 4))
        assertEquals(GridMosaic.BlurOverscan(left = true, top = false, right = false, bottom = true), GridMosaic.blurOverscan(8, 3, 4))
        assertEquals(GridMosaic.BlurOverscan(left = false, top = false, right = true, bottom = true), GridMosaic.blurOverscan(11, 3, 4))
        assertEquals(GridMosaic.BlurOverscan(left = false, top = true, right = false, bottom = false), GridMosaic.blurOverscan(1, 3, 4))
        assertEquals(GridMosaic.BlurOverscan(left = false, top = false, right = false, bottom = false), GridMosaic.blurOverscan(5, 3, 4))
    }

    // MARK: the isolation filter (§8: isolation on the settled wash)

    @Test
    fun `a settled record with no isolation is all field, no crisp tints`() {
        // The filter is pure presentation, absent by default: a room that never taps a legend row
        // wears the full blurred field and draws no crisp cell at all.
        assertEquals(0.0, GridMosaic.settledCrispMultiplier("you", isolation = null, elapsed = 99.0))
        assertEquals(1.0, GridMosaic.blurFieldMultiplier(isolation = null, elapsed = 99.0))
    }

    @Test
    fun `an isolated solver snaps back to crisp while the field hides`() {
        // Past the fade: the blurred field is gone (a blurred single color has no shape to read), the
        // isolated solver's cells hold the full settled weight, and every other hand rests at the dim
        // floor: recessed toward paper (a lower alpha over the ground IS the step toward it), never
        // erased.
        val isolation = MosaicIsolation(solverId = "you", previousSolverId = null, changedAt = 0.0)
        assertEquals(0.0, GridMosaic.blurFieldMultiplier(isolation, elapsed = 1.0))
        assertEquals(1.0, GridMosaic.settledCrispMultiplier("you", isolation, elapsed = 1.0))
        assertEquals(GridMosaic.ISOLATION_DIM, GridMosaic.settledCrispMultiplier("bee", isolation, elapsed = 1.0))
        assertTrue(GridMosaic.ISOLATION_DIM > 0.0) { "dimmed, never erased: the record stays traceable" }
        assertTrue(GridMosaic.ISOLATION_DIM < 1.0)
    }

    @Test
    fun `the isolation crossfade trades the field for the cells monotonically`() {
        // The from-side at the toggle, the to-side by the fade's end, monotone between, both layers on
        // one clock and ease: fast and quiet, a filter, not a celebration (and already the
        // reduced-motion form, a pure opacity crossfade).
        val isolation = MosaicIsolation(solverId = "you", previousSolverId = null, changedAt = 0.0)
        val fade = GridMosaic.ISOLATION_FADE_SECONDS
        assertEquals(1.0, GridMosaic.blurFieldMultiplier(isolation, elapsed = 0.0))
        assertEquals(0.0, GridMosaic.settledCrispMultiplier("you", isolation, elapsed = 0.0))
        var previousBlur = 1.001
        var previousCrisp = -0.001
        for (step in 0..20) {
            val elapsed = fade * step / 20
            val blur = GridMosaic.blurFieldMultiplier(isolation, elapsed)
            val crisp = GridMosaic.settledCrispMultiplier("you", isolation, elapsed)
            assertTrue(blur <= previousBlur) { "the field must not rebound, t=$elapsed" }
            assertTrue(crisp >= previousCrisp) { "the spotlight must not rebound, t=$elapsed" }
            previousBlur = blur
            previousCrisp = crisp
        }
        assertEquals(0.0, GridMosaic.blurFieldMultiplier(isolation, fade))
        assertEquals(1.0, GridMosaic.settledCrispMultiplier("you", isolation, fade))
    }

    @Test
    fun `a switch crossfades both hands while a third holds the floor and the field stays hidden`() {
        // you -> bee: your hand fades down as bee's fades up, a third hand holds the dim floor with no
        // pulse, and the blurred field never returns mid-switch.
        val isolation = MosaicIsolation(solverId = "bee", previousSolverId = "you", changedAt = 0.0)
        val fade = GridMosaic.ISOLATION_FADE_SECONDS
        assertEquals(1.0, GridMosaic.settledCrispMultiplier("you", isolation, elapsed = 0.0))
        assertEquals(GridMosaic.ISOLATION_DIM, GridMosaic.settledCrispMultiplier("you", isolation, fade))
        assertEquals(GridMosaic.ISOLATION_DIM, GridMosaic.settledCrispMultiplier("bee", isolation, elapsed = 0.0))
        assertEquals(1.0, GridMosaic.settledCrispMultiplier("bee", isolation, fade))
        for (step in 0..10) {
            val elapsed = fade * step / 10
            assertEquals(
                GridMosaic.ISOLATION_DIM, GridMosaic.settledCrispMultiplier("cee", isolation, elapsed),
            ) { "a third hand never pulses, t=$elapsed" }
            assertEquals(0.0, GridMosaic.blurFieldMultiplier(isolation, elapsed)) { "the field stays hidden, t=$elapsed" }
        }
    }

    @Test
    fun `a clear melts every crisp tint back into the blurred field`() {
        // A clear (null current) fades the crisp tints out and the field back in on the same clock;
        // clearing isolation returns the blurred record.
        val isolation = MosaicIsolation(solverId = null, previousSolverId = "you", changedAt = 0.0)
        val fade = GridMosaic.ISOLATION_FADE_SECONDS
        assertEquals(GridMosaic.ISOLATION_DIM, GridMosaic.settledCrispMultiplier("bee", isolation, elapsed = 0.0))
        assertEquals(1.0, GridMosaic.settledCrispMultiplier("you", isolation, elapsed = 0.0))
        assertEquals(0.0, GridMosaic.blurFieldMultiplier(isolation, elapsed = 0.0))
        assertEquals(0.0, GridMosaic.settledCrispMultiplier("bee", isolation, fade))
        assertEquals(0.0, GridMosaic.settledCrispMultiplier("you", isolation, fade))
        assertEquals(1.0, GridMosaic.blurFieldMultiplier(isolation, fade))
    }

    // MARK: the mosaic lifecycle (MosaicMoment): the standing wash and the stand path

    @Test
    fun `the settle lands on the standing wash, never back to ink`() {
        // The flash-then-disappear fix: the bloom runs on the clock, then the settle STANDS the wash
        // (startedAt is never nilled) and pauses the frame loop (settled).
        val bloomed = MosaicMoment().bloom(now = 200.0, enabled = true)
        assertEquals(200.0, bloomed.startedAt)
        assertFalse(bloomed.settled) { "the bloom runs on the clock first" }
        val settled = bloomed.settle()
        assertEquals(200.0, settled.startedAt) { "the settled mosaic stands; the trigger is never nilled" }
        assertTrue(settled.settled)
    }

    @Test
    fun `INV-3 standMosaic wears the settled wash without ever celebrating`() {
        // A reconnect into a completed room stands the wash the moment the bundle lands: terminal-state
        // rendering, not a celebration. The gate is untouched here by construction (a stand never runs
        // through CelebrationGate); the moment is born settled with no bloom on the clock.
        val stood = MosaicMoment().stand(now = 500.0, enabled = true)
        assertEquals(500.0 - MosaicEnvelope.DURATION_SECONDS, stood.startedAt) { "born past its own envelope" }
        assertTrue(stood.settled) { "born settled: no bloom plays" }
        assertTrue(stood.armed)
        assertNull(stood.isolation)
    }

    @Test
    fun `INV-3 the stand and the bloom share one arming`() {
        // Neither can follow the other: a bloomed mosaic is never re-stood, a stood wash never re-blooms.
        val afterBloom = MosaicMoment().bloom(now = 200.0, enabled = true)
        val standAfterBloom = afterBloom.stand(now = 300.0, enabled = true)
        assertEquals(200.0, standAfterBloom.startedAt) { "the bloom stands; the stand is a no-op" }
        assertFalse(standAfterBloom.settled) { "the envelope still owns the settle" }

        val afterStand = MosaicMoment().stand(now = 500.0, enabled = true)
        val bloomAfterStand = afterStand.bloom(now = 600.0, enabled = true)
        assertEquals(500.0 - MosaicEnvelope.DURATION_SECONDS, bloomAfterStand.startedAt) { "the stand holds" }
    }

    @Test
    fun `ID-1 a muted switch stands nothing on the reconnect path`() {
        // A muted mosaic arms (so it can never later bloom) but derives no wash on the stand path either.
        val stood = MosaicMoment().stand(now = 500.0, enabled = false)
        assertNull(stood.startedAt)
        assertFalse(stood.settled)
        assertTrue(stood.armed)
    }

    @Test
    fun `INV-3 isolation is gated on the settled wash`() {
        // An unsettled room has no standing record to filter, and a bloom in flight ignores the tap
        // outright: the one arming and the celebration are untouchable.
        val fresh = MosaicMoment().toggleIsolation("you", now = 100.0)
        assertNull(fresh.isolation) { "no isolation before the wash even settles" }
        val blooming = MosaicMoment().bloom(now = 200.0, enabled = true).toggleIsolation("you", now = 201.0)
        assertNull(blooming.isolation) { "the bloom still plays; isolation waits for the settle" }
        val settled = MosaicMoment().bloom(now = 200.0, enabled = true).settle().toggleIsolation("you", now = 210.0)
        assertEquals("you", settled.isolatedSolverId)
    }

    @Test
    fun `INV-3 the same tap clears, another tap switches, and neither touches the celebration`() {
        // Same-tap clears, other-tap switches, the previous value riding along as the crossfade's
        // from-side. A pure value change over the standing wash: the trigger, the settle, and the one
        // arming never move (INV-3 by construction, the toggle is presentation only).
        val base = MosaicMoment().stand(now = 100.0, enabled = true)
        val you = base.toggleIsolation("you", now = 110.0)
        assertEquals("you", you.isolatedSolverId)
        val bee = you.toggleIsolation("bee", now = 120.0)
        assertEquals("bee", bee.isolatedSolverId)
        assertEquals("you", bee.isolation?.previousSolverId) { "the crossfade's from-side" }
        val cleared = bee.toggleIsolation("bee", now = 130.0)
        assertNull(cleared.isolatedSolverId) { "the same row again clears to the full wash" }
        assertEquals("bee", cleared.isolation?.previousSolverId)
        assertEquals(130.0, cleared.isolation?.changedAt)
        // The celebration state is exactly the stand's: the trigger, the settle, and the arming never moved.
        assertEquals(base.startedAt, cleared.startedAt)
        assertTrue(cleared.settled)
        assertTrue(cleared.armed)
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
