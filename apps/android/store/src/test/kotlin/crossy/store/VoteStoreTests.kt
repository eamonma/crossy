// The check vote store behaviors (PROTOCOL.md §6, §7, §10; D32), the client half of Wave 15.6 and
// the twin the web/iOS stores will mirror. The three vote events are sequenced, so they apply under
// the same §7 seq gate as cellSet; the open vote is view state rebuilt from those events and healed
// wholesale by every snapshot; a ballot sends `castCheckVote`; the four vote rejections are handled
// quietly. The client-store vectors carry no vote cases, so these are unit tests in the store idiom
// (GameStoreTest), each named for the PROTOCOL section or invariant it defends.

package crossy.store

import crossy.protocol.Board
import crossy.protocol.Cell
import crossy.protocol.CheckVoteCastMessage
import crossy.protocol.CheckVoteClosedMessage
import crossy.protocol.CheckVoteOpenedMessage
import crossy.protocol.CheckVoteSnapshot
import crossy.protocol.ClientMessage
import crossy.protocol.Cursor
import crossy.protocol.ErrorCode
import crossy.protocol.ErrorMessage
import crossy.protocol.GameStatus
import crossy.protocol.Participant
import crossy.protocol.PuzzleCheckedMessage
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.WelcomeMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class VoteStoreTests {
    private val expires = "2026-07-07T00:00:30Z"

    private fun voters(vararg ids: String): List<Participant> =
        ids.map { Participant(it, it, "#7F77DD", Role.SOLVER, connected = true, avatarUrl = null) }

    private fun board(
        seq: Int,
        participants: List<Participant> = voters("me", "u2", "u3"),
        checkVote: CheckVoteSnapshot? = null,
    ): Board = Board(
        seq = seq,
        status = GameStatus.ONGOING,
        firstFillAt = null,
        completedAt = null,
        abandonedAt = null,
        cells = List(6) { Cell(null, null) },
        checkedWrongCells = emptyList(),
        checkCount = 0,
        participants = participants,
        cursors = emptyList<Cursor>(),
        recentCommandIds = emptyList(),
        stats = null,
        checkVote = checkVote,
    )

    /** A store live at `seq`, self is "me", with the roster as electors. */
    private fun liveAt(seq: Int, participants: List<Participant> = voters("me", "u2", "u3")): GameStore {
        val store = GameStore()
        store.receive(ServerMessage.Welcome(WelcomeMessage(1, WelcomeMessage.SelfIdentity("me", Role.SOLVER), board(seq, participants))))
        return store
    }

    private fun opened(seq: Int, electorate: List<String>, needed: Int, by: String = "me") =
        ServerMessage.CheckVoteOpened(
            CheckVoteOpenedMessage(seq, by, electorate, needed, expires, "c-open", "2026-07-07T00:00:00Z"),
        )

    private fun cast(seq: Int, voteSeq: Int, by: String, approve: Boolean, commandId: String = "c-cast") =
        ServerMessage.CheckVoteCast(CheckVoteCastMessage(seq, voteSeq, by, approve, commandId, "2026-07-07T00:00:01Z"))

    private fun closed(seq: Int, voteSeq: Int, outcome: String, reason: String? = null) =
        ServerMessage.CheckVoteClosed(CheckVoteClosedMessage(seq, voteSeq, outcome, "2026-07-07T00:00:02Z", reason))

    // --- Sequenced application (PROTOCOL.md §6, §7; D32) ---

    @Test
    fun checkVoteOpenedAppliesUnderTheSeqGateAndCreatesTheVote_PROTOCOL7() {
        val store = liveAt(30)
        store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
        val vote = store.render.value.checkVote
        assertEquals(31, store.render.value.seq, "the opened event advances lastApplied (§7)")
        assertEquals(31, vote?.voteSeq)
        assertEquals("me", vote?.by)
        assertEquals(listOf("me"), vote?.approvals, "approvals open as [by] (D32)")
        assertEquals(emptyList<String>(), vote?.rejections)
        assertEquals(2, vote?.needed)
        assertEquals(expires, vote?.expiresAt)
    }

    @Test
    fun aGappedVoteEventIsNotAppliedAndTriggersResync_PROTOCOL7() {
        val store = liveAt(30)
        store.receive(opened(33, listOf("me", "u2", "u3"), needed = 2)) // gap: 33 > 30 + 1
        assertNull(store.render.value.checkVote, "a gapped vote event is not applied (§7)")
        assertEquals(SyncState.RESYNCING, store.render.value.sync)
        assertTrue(store.outbox.any { it is ClientMessage.RequestSync }, "a gap sends requestSync (§7)")
    }

    @Test
    fun castFilesTheBallotIntoTheOpenVote_PROTOCOL10() {
        val store = liveAt(30)
        store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
        store.receive(cast(32, voteSeq = 31, by = "u2", approve = false))
        val vote = store.render.value.checkVote
        assertEquals(listOf("me"), vote?.approvals)
        assertEquals(listOf("u2"), vote?.rejections, "the ballot files as a rejection (D32)")
        assertTrue(vote?.hasVoted("u2") == true)
    }

    @Test
    fun closedClearsTheVoteAndSurfacesTheResolutionBeatOnce_PROTOCOL10() {
        val store = liveAt(30)
        val beats = mutableListOf<VoteClosed>()
        store.onVoteClosed = { beats.add(it) }
        store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
        store.receive(cast(32, voteSeq = 31, by = "u2", approve = false))
        store.receive(closed(33, voteSeq = 31, outcome = "failed", reason = "REJECTED"))
        assertNull(store.render.value.checkVote, "a close clears the open vote (D32)")
        assertEquals(1, beats.size, "the resolution beat fires once under the seq gate")
        assertEquals("failed", beats.single().outcome)
        assertEquals("REJECTED", beats.single().reason)
    }

    @Test
    fun aSequencedBallotSurfacesTheCastBeatForTheTick_PROTOCOL10() {
        val store = liveAt(30)
        val casts = mutableListOf<CheckVoteCastMessage>()
        store.onVoteCast = { casts.add(it) }
        store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
        store.receive(cast(32, voteSeq = 31, by = "u2", approve = true))
        assertEquals(1, casts.size, "a truly applied ballot surfaces the cast beat once (U9 tick)")
        assertEquals("u2", casts.single().by)
        // A stale/gapped cast is not applied, so it fires no beat (never a tick on healing history).
        store.receive(cast(32, voteSeq = 31, by = "u3", approve = false)) // seq 32 <= lastApplied: stale
        assertEquals(1, casts.size, "a stale ballot fires no beat (§7 seq gate)")
    }

    // --- Snapshot heals a mid-vote reconnect wholesale (PROTOCOL.md §4, §7; D32) ---

    @Test
    fun aSnapshotReconstructsTheOpenVoteWholesale_PROTOCOL4() {
        val store = liveAt(30)
        val snapshotVote = CheckVoteSnapshot(
            openedSeq = 31,
            by = "u2",
            electorate = listOf("me", "u2", "u3"),
            approvals = listOf("u2", "u3"),
            rejections = emptyList(),
            needed = 2,
            expiresAt = expires,
        )
        store.receive(ServerMessage.Sync(crossy.protocol.SyncMessage(board(40, checkVote = snapshotVote))))
        val vote = store.render.value.checkVote
        assertEquals(31, vote?.voteSeq)
        assertEquals("u2", vote?.by)
        assertEquals(listOf("u2", "u3"), vote?.approvals, "the whole vote heals from board.checkVote")
    }

    @Test
    fun aSnapshotWithoutAVoteClearsAStaleOne_PROTOCOL4() {
        val store = liveAt(30)
        store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
        store.receive(ServerMessage.Sync(crossy.protocol.SyncMessage(board(40, checkVote = null))))
        assertNull(store.render.value.checkVote, "a no-vote snapshot clears a stale vote (§4)")
    }

    // --- Remaining-time clamp (PROTOCOL.md §10; D32) ---

    @Test
    fun remainingMillisClampsToZeroThirtySeconds_PROTOCOL10() {
        val vote = VoteView(31, "me", listOf("me", "u2"), listOf("me"), emptyList(), 2, expires)
        val expiresMs = vote.expiresAtEpochMs!!
        assertEquals(30_000L, vote.remainingMillis(expiresMs - 30_000L), "full timebox 30 s before expiry")
        assertEquals(12_000L, vote.remainingMillis(expiresMs - 12_000L))
        assertEquals(0L, vote.remainingMillis(expiresMs), "clamps to 0 at expiry")
        assertEquals(0L, vote.remainingMillis(expiresMs + 5_000L), "never negative past expiry")
        assertEquals(30_000L, vote.remainingMillis(expiresMs - 90_000L), "clamps to the 30 s ceiling")
    }

    // --- Solo suppression (D32: vote chrome never appears solo, not for a frame) ---

    @Test
    fun aSoloElectorateNeverShowsTheBench_D32() {
        val store = liveAt(5, participants = voters("me"))
        store.receive(opened(6, listOf("me"), needed = 1)) // solo auto-pass triple begins
        assertFalse(store.render.value.showVoteBench, "a solo electorate shows no vote chrome (D32)")
        assertTrue(store.render.value.isSoloRoom)
    }

    @Test
    fun aMultiElectorVoteShowsTheBench_D32() {
        val store = liveAt(30)
        store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
        assertTrue(store.render.value.showVoteBench, "a real multi-elector vote surfaces the Bench")
        assertFalse(store.render.value.isSoloRoom)
    }

    // --- Bare puzzleChecked tolerance (server rollout window; §7 no resync loop) ---

    @Test
    fun aBarePuzzleCheckedWithNoOpenVoteAppliesMarksWithNoCrashNoResync_PROTOCOL10() {
        val store = liveAt(30)
        store.receive(ServerMessage.PuzzleChecked(PuzzleCheckedMessage(31, listOf(0, 2), 1, "c1", "2026-07-07T00:00:00Z", by = "me")))
        assertEquals(setOf(0, 2), store.render.value.checkedWrong, "marks apply with zero vote UI")
        assertEquals(1, store.render.value.checkCount)
        assertNull(store.render.value.checkVote, "no vote UI appears")
        assertFalse(store.outbox.any { it is ClientMessage.RequestSync }, "a bare puzzleChecked is no gap: no resync loop (§7)")
    }

    // --- The four vote errors handled quietly (PROTOCOL.md §11; D32) ---

    @Test
    fun theFourVoteErrorsClearPendingIntentWithNoToast_PROTOCOL11() {
        for (code in listOf(ErrorCode.VOTE_PENDING, ErrorCode.NO_VOTE_OPEN, ErrorCode.NOT_ELECTOR, ErrorCode.ALREADY_VOTED)) {
            val store = liveAt(30)
            store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
            store.castCheckVote(approve = true, commandId = "c-mine")
            assertEquals("c-mine", store.render.value.pendingVoteCommandId)
            store.receive(ServerMessage.Error(ErrorMessage(code, "no", fatal = false, commandId = "c-mine")))
            assertNull(store.render.value.pendingVoteCommandId, "$code clears the pending intent")
            assertNull(store.render.value.lastRejection, "$code shows no toast (D32)")
        }
    }

    // --- castCheckVote intent (PROTOCOL.md §5, §10; D32) ---

    @Test
    fun castCheckVoteSendsTheBallotNamingTheOpenVote_PROTOCOL5() {
        val store = liveAt(30)
        store.receive(opened(31, listOf("me", "u2", "u3"), needed = 2))
        store.castCheckVote(approve = true, commandId = "c-ballot")
        val sent = store.outbox.filterIsInstance<ClientMessage.CastCheckVote>().single().message
        assertEquals("c-ballot", sent.commandId)
        assertEquals(31, sent.voteSeq, "the ballot names the open vote's voteSeq")
        assertTrue(sent.approve)
        assertEquals("c-ballot", store.render.value.pendingVoteCommandId, "the ballot is tracked as pending")
    }

    @Test
    fun castCheckVoteWithNoOpenVoteSendsNothing_PROTOCOL10() {
        val store = liveAt(30)
        store.castCheckVote(approve = true, commandId = "c-ballot")
        assertFalse(store.outbox.any { it is ClientMessage.CastCheckVote }, "no open vote: nothing to cast")
    }

    @Test
    fun aProposersOwnOpenedEchoClearsItsPendingHold_D32() {
        val store = liveAt(30)
        store.checkPuzzle(commandId = "c-prop")
        assertEquals("c-prop", store.render.value.pendingVoteCommandId)
        store.receive(
            ServerMessage.CheckVoteOpened(
                CheckVoteOpenedMessage(31, "me", listOf("me", "u2", "u3"), 2, expires, "c-prop", "2026-07-07T00:00:00Z"),
            ),
        )
        assertNull(store.render.value.pendingVoteCommandId, "the proposer's own echo clears the hold (D32)")
    }
}
