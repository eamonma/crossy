// The Bench model's proof (PROTOCOL.md §10, D32; Wave 15.6 UX). Every normative copy string, the
// five-beat phase timing, the elector chip states, the ring drain (continuous and reduced-motion
// stepped), the hold-to-propose timing, and the proposer-only post-fail tally are pinned here, so a
// drift in the UX contract fails a headless test, not just a device review. Names cite the spec beat
// or the invariant. Twin idiom of ReactionModelTests / StickerEnvelopeTests.

package crossy.ui

import crossy.store.VoteView
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CheckVoteBenchModelTests {
    private val expires = "2026-07-07T00:00:30Z"
    private fun vote(
        approvals: List<String> = listOf("u1"),
        rejections: List<String> = emptyList(),
        electorate: List<String> = listOf("u1", "u2", "u3"),
        needed: Int = 2,
        by: String = "u1",
    ) = VoteView(31, by, electorate, approvals, rejections, needed, expires)

    private val names: (String) -> String = { if (it == "u1") "Ana" else it }

    // --- Copy, exact (Wave 15.6 spec) ---

    @Test
    fun everyCopyStringIsExact_D32() {
        assertEquals("Ana wants to check the puzzle", VoteCopy.proposal("Ana"))
        assertEquals("Check it", VoteCopy.CHECK_IT)
        assertEquals("Keep solving", VoteCopy.KEEP_SOLVING)
        assertEquals("Checking…", VoteCopy.CHECKING) // the ellipsis is one glyph
        assertEquals("3 to fix", VoteCopy.toFix(3))
        assertEquals("The room keeps solving", VoteCopy.REJECTED)
        assertEquals("The vote lapsed", VoteCopy.EXPIRED)
        assertEquals("Vote ended, the grid changed", VoteCopy.GRID_BROKEN)
        assertEquals("1 of 2", VoteCopy.tally(1, 2))
    }

    // --- Chips: the floor and the division (PROTOCOL.md §10) ---

    @Test
    fun chipsCarryBallotAndRoleStateInElectorateOrder_D32() {
        val chips = CheckVoteBenchModel.chips(
            vote(approvals = listOf("u1"), rejections = listOf("u2")),
            selfUserId = "u3",
            names = names,
        )
        assertEquals(listOf("u1", "u2", "u3"), chips.map { it.userId }, "electorate order (ascending, INV-1)")
        assertEquals(ChipVote.APPROVED, chips[0].vote)
        assertTrue(chips[0].isProposer, "the proposer opened approved")
        assertEquals("Ana", chips[0].name)
        assertEquals(ChipVote.REJECTED, chips[1].vote)
        assertEquals(ChipVote.UNVOTED, chips[2].vote, "an unvoted elector is dimmed")
        assertTrue(chips[2].isSelf)
    }

    // --- Verbs: proposer sees none, non-elector reads only, unvoted elector votes ---

    @Test
    fun verbsShowOnlyForAStillUnvotedElector_D32() {
        val v = vote(approvals = listOf("u1")) // u1 proposer/approved, u2/u3 unvoted
        assertFalse(CheckVoteBenchModel.showVerbs(v, "u1"), "the proposer already voted: chips, no verbs")
        assertTrue(CheckVoteBenchModel.showVerbs(v, "u2"), "an unvoted elector votes")
        assertFalse(CheckVoteBenchModel.showVerbs(v, "u9"), "a non-elector reads only")
        assertFalse(CheckVoteBenchModel.showVerbs(null, "u2"), "no open vote: no verbs")
        val voted = vote(approvals = listOf("u1", "u2"))
        assertFalse(CheckVoteBenchModel.showVerbs(voted, "u2"), "a voted elector sees no verbs (immutable ballot)")
    }

    // --- The ring: the only clock (PROTOCOL.md §10) ---

    @Test
    fun ringDrainsFromOneToZeroWithRemainingTime_D32() {
        val v = vote()
        val expiresMs = v.expiresAtEpochMs!!
        assertEquals(1f, CheckVoteBenchModel.ringFraction(v, expiresMs - 30_000L), 0.001f)
        assertEquals(0.5f, CheckVoteBenchModel.ringFraction(v, expiresMs - 15_000L), 0.001f)
        assertEquals(0f, CheckVoteBenchModel.ringFraction(v, expiresMs), 0.001f)
        assertEquals(0f, CheckVoteBenchModel.ringFraction(v, expiresMs + 5_000L), 0.001f, "never negative")
    }

    @Test
    fun reducedMotionStepsTheRingInsteadOfSweeping_PROTOCOL7() {
        val v = vote()
        val expiresMs = v.expiresAtEpochMs!!
        // Six steps: a value just under a step boundary rounds up to the boundary level.
        val stepped = CheckVoteBenchModel.ringFractionStepped(v, expiresMs - 16_000L) // raw ~0.533
        assertEquals(4f / 6f, stepped, 0.001f, "quantized to one of six discrete levels")
        assertTrue(CheckVoteBenchModel.ringFraction(v, expiresMs - 16_000L, reduceMotion = true) == stepped)
    }

    // --- Hold-to-propose: the call (Wave 15.6) ---

    @Test
    fun holdFillsOverSixHundredMillisAndCompletesAtThreshold_D32() {
        assertEquals(0f, CheckVoteBenchModel.holdFraction(0L), 0.001f)
        assertEquals(0.5f, CheckVoteBenchModel.holdFraction(300L), 0.001f)
        assertEquals(1f, CheckVoteBenchModel.holdFraction(600L), 0.001f)
        assertEquals(1f, CheckVoteBenchModel.holdFraction(900L), 0.001f, "clamps at full")
        assertFalse(CheckVoteBenchModel.holdComplete(599L), "an early release cancels")
        assertTrue(CheckVoteBenchModel.holdComplete(600L))
    }

    // --- The reveal: passed close (PROTOCOL.md §10) ---

    @Test
    fun aPassingRevealReadsCheckingThenToFix_D32() {
        val r = VoteResolution.Passed(wrongCells = 4, startedAt = 0L)
        assertEquals("Checking…", CheckVoteBenchModel.resolutionLine(r, 100L), "the breath reads Checking…")
        assertEquals("4 to fix", CheckVoteBenchModel.resolutionLine(r, 700L), "after the breath, the count")
        assertFalse(CheckVoteBenchModel.ringDissolving(r, 100L))
        assertTrue(CheckVoteBenchModel.ringDissolving(r, 700L), "the ring flash-dissolves after the breath")
        assertEquals(0f, CheckVoteBenchModel.washProgress(r, 100L), 0.001f, "no wash during the breath")
        assertTrue(CheckVoteBenchModel.washProgress(r, 700L) > 0f, "the wash begins after the breath")
        assertNull(CheckVoteBenchModel.proposerTally(r), "a passing close shows no tally")
    }

    // --- The recess: failed/cancelled (PROTOCOL.md §10) ---

    @Test
    fun eachNonPassingReasonHasItsOneCalmLine_D32() {
        fun ended(reason: String?, isProposer: Boolean = false) =
            VoteResolution.Ended(reason, approvalsAtClose = 1, needed = 2, isProposer = isProposer, startedAt = 0L)
        assertEquals("The room keeps solving", CheckVoteBenchModel.resolutionLine(ended("REJECTED"), 0L))
        assertEquals("The vote lapsed", CheckVoteBenchModel.resolutionLine(ended("EXPIRED"), 0L))
        assertEquals("Vote ended, the grid changed", CheckVoteBenchModel.resolutionLine(ended("GRID_BROKEN"), 0L))
        assertNull(CheckVoteBenchModel.resolutionLine(ended("TERMINAL"), 0L), "TERMINAL shows no line")
    }

    @Test
    fun theTallyIsProposerOnlyAndPostFailOnly_D32() {
        fun ended(isProposer: Boolean, reason: String = "REJECTED") =
            VoteResolution.Ended(reason, approvalsAtClose = 1, needed = 2, isProposer = isProposer, startedAt = 0L)
        assertEquals("1 of 2", CheckVoteBenchModel.proposerTally(ended(isProposer = true)))
        assertNull(CheckVoteBenchModel.proposerTally(ended(isProposer = false)), "the room never sees the tally")
        assertNull(CheckVoteBenchModel.proposerTally(ended(isProposer = true, reason = "TERMINAL")), "no tally on a TERMINAL close")
    }

    // --- Recess timing: the Bench withdraws, no try-again ---

    @Test
    fun theResolvedBenchWithdrawsAfterItsRecess_D32() {
        val passed = VoteResolution.Passed(wrongCells = 1, startedAt = 0L)
        assertFalse(CheckVoteBenchModel.resolutionComplete(passed, 3000L))
        assertTrue(CheckVoteBenchModel.resolutionComplete(passed, 600L + 2500L), "reveal breath + recess, then withdraw")
        val ended = VoteResolution.Ended("EXPIRED", 1, 2, isProposer = false, startedAt = 0L)
        assertFalse(CheckVoteBenchModel.resolutionComplete(ended, 2000L))
        assertTrue(CheckVoteBenchModel.resolutionComplete(ended, 2500L))
    }

    // --- TalkBack (polite) ---

    @Test
    fun announcementsMirrorTheVisibleLine_a11y() {
        assertEquals("Ana wants to check the puzzle", VoteCopy.proposal("Ana"))
        assertEquals("2 to fix", CheckVoteBenchModel.resolutionAnnouncement(VoteResolution.Passed(2, 0L)))
        assertEquals("The vote lapsed", CheckVoteBenchModel.resolutionAnnouncement(VoteResolution.Ended("EXPIRED", 1, 2, false, 0L)))
        assertNull(CheckVoteBenchModel.resolutionAnnouncement(VoteResolution.Ended("TERMINAL", 1, 2, false, 0L)))
    }
}
