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
        // The proposer sees the room's pending answer, not their own name (owner ruling); a departed
        // or unknown proposer/elector stays collective, never a raw userId (Wave 15.9a).
        assertEquals("Waiting for the room", VoteCopy.WAITING_FOR_ROOM)
        assertEquals("A teammate", VoteCopy.PROPOSER_FALLBACK)
        assertEquals("Player", VoteCopy.CHIP_FALLBACK)
    }

    // --- The proposal line: proposer, other, and departed/unknown (Wave 15.9a owner ruling) ---

    @Test
    fun theProposerSeesTheRoomNotTheirOwnNameAndUnknownStaysCollective_D32() {
        val v = vote(by = "u1") // u1 is Ana
        assertEquals(
            "Waiting for the room",
            CheckVoteBenchModel.proposalLine(v, selfUserId = "u1", proposerName = "Ana"),
            "the proposer never reads their own name in the third person",
        )
        assertEquals(
            "Ana wants to check the puzzle",
            CheckVoteBenchModel.proposalLine(v, selfUserId = "u2", proposerName = "Ana"),
            "others read the proposer's question",
        )
        assertEquals(
            "A teammate wants to check the puzzle",
            CheckVoteBenchModel.proposalLine(v, selfUserId = "u2", proposerName = null),
            "a departed/unknown proposer falls back to a teammate, never a raw id",
        )
    }

    @Test
    fun anUnknownElectorsChipFallsBackToPlayerNotARawId_D32() {
        val chips = CheckVoteBenchModel.chips(vote(), selfUserId = "u2", names = { null })
        assertTrue(chips.all { it.name == "Player" }, "an unresolved elector chip reads Player, never its userId")
    }

    // --- The merged chip summary: the room's only tally for TalkBack (U5, Wave 15.9a) ---

    @Test
    fun chipSummaryMergesTheBallotStateForTalkBack_U5() {
        val chips = CheckVoteBenchModel.chips(
            vote(approvals = listOf("u1", "u2"), rejections = emptyList(), electorate = listOf("u1", "u2", "u3")),
            selfUserId = "u3",
            names = { mapOf("u1" to "Ana", "u2" to "Ben", "u3" to "Cleo")[it] },
        )
        assertEquals("Ana and Ben voted check, Cleo hasn't voted", CheckVoteBenchModel.chipsSummary(chips))
        val split = CheckVoteBenchModel.chips(
            vote(approvals = listOf("u1"), rejections = listOf("u2"), electorate = listOf("u1", "u2", "u3", "u4")),
            selfUserId = "u4",
            names = { mapOf("u1" to "Ana", "u2" to "Ben", "u3" to "Cleo", "u4" to "Dan")[it] },
        )
        assertEquals(
            "Ana voted check, Ben voted keep solving, Cleo and Dan haven't voted",
            CheckVoteBenchModel.chipsSummary(split),
            "each ballot state gets its own clause; unvoted pluralizes",
        )
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
        // "{n} to fix" lands LAST (U6): it holds "Checking…" through the breath AND the wash, then the
        // count arrives at breath + wash, not at the wash's first frame.
        assertEquals("Checking…", CheckVoteBenchModel.resolutionLine(r, 100L), "the breath reads Checking…")
        assertEquals("Checking…", CheckVoteBenchModel.resolutionLine(r, 700L), "the wash still reads Checking…")
        val landsAt = VoteBenchTiming.REVEAL_BREATH_MS + VoteBenchTiming.WASH_MAX_MS
        assertEquals("4 to fix", CheckVoteBenchModel.resolutionLine(r, landsAt), "the count lands after breath + wash")
        // Reduced motion has no breath or wash: the marks and the line apply instantly (U6).
        assertEquals("4 to fix", CheckVoteBenchModel.resolutionLine(r, 0L, reduceMotion = true), "reduced motion lands instantly")
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

    // --- The ascending mark wash (UX.md U6) ---

    @Test
    fun theWashStaggersAscendingAndLandsUnder900ms_U6() {
        // The per-cell delay is min(60, 500/(n-1)); a single mark has no stagger.
        assertEquals(0.0, CheckWash.perCellDelayMs(1), 0.001)
        assertEquals(60.0, CheckWash.perCellDelayMs(2), 0.001) // 500/1 clamps to 60
        assertEquals(500.0 / 9, CheckWash.perCellDelayMs(10), 0.001) // ~55.6, under the 60 cap
        assertEquals(500.0 / 99, CheckWash.perCellDelayMs(100), 0.001) // tiny stagger for a dense board
        // The whole wash stays under 900 ms for every n (the last start + one 360 ms coat).
        for (n in intArrayOf(1, 2, 3, 10, 50, 100, 1000)) {
            assertTrue(CheckWash.totalMs(n) < 900.0, "n=$n wash must land under 900 ms, was ${CheckWash.totalMs(n)}")
        }
    }

    @Test
    fun eachMarkFadesInOverItsCoatAfterItsStaggeredStart_U6() {
        val n = 4
        val delay = CheckWash.perCellDelayMs(n) // 60 ms (500/3 -> clamped)
        // The first mark starts at 0 and is full at one coat; a later mark waits its stagger.
        assertEquals(0.0, CheckWash.progress(0, n, 0.0), 0.001, "rank 0 begins at the wash start")
        assertEquals(1.0, CheckWash.progress(0, n, CheckWash.COAT_MS), 0.001, "rank 0 full after one coat")
        assertEquals(0.0, CheckWash.progress(2, n, 2 * delay), 0.001, "rank 2 only begins at its stagger")
        assertEquals(1.0, CheckWash.progress(2, n, 2 * delay + CheckWash.COAT_MS), 0.001, "rank 2 full one coat later")
        assertEquals(0.5, CheckWash.progress(1, n, delay + CheckWash.COAT_MS / 2), 0.001, "mid-coat is half in")
        assertEquals(1.0, CheckWash.progress(3, n, 10_000.0), 0.001, "clamps to full")
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
