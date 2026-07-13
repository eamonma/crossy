package crossy.ui

import crossy.protocol.GameSummary
import crossy.protocol.Role
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// The rooms list's live / solved / ended shelf split (PROTOCOL.md §12). Twin of the cases that
// main 760e6e4 (#234) pins: iOS RoomCardTests.test_shelved_* and web homeData.test.ts
// partitionRooms/isAbandoned. The predicate is the mutually exclusive terminal timestamps
// (completedAt -> solved, abandonedAt -> ended, neither -> live); the fix is that an abandoned
// room (null completedAt) no longer falls into the live shelf. Fixtures are ported from those
// twins so all three clients pin the same classification.

class RoomShelvesTests {
    private fun game(
        gameId: String = "g1",
        completedAt: String? = null,
        abandonedAt: String? = null,
    ): GameSummary = GameSummary(
        gameId = gameId,
        name = null,
        role = Role.SOLVER,
        createdAt = "2026-07-01T00:00:00.000Z",
        createdBy = "u1",
        memberCount = 1,
        puzzle = GameSummary.PuzzleRef(puzzleId = "p1", rows = 15, cols = 15, title = null),
        completedAt = completedAt,
        abandonedAt = abandonedAt,
    )

    @Test
    fun isCompletedReadsTheCompletedFact_PROTOCOL12() {
        // §12: completedAt is the completion fact; a non-null time is solved, null (ongoing, or an
        // abandoned game that never completed) is not.
        assertTrue(game(completedAt = "2026-07-08T20:11:47.000Z").isCompleted)
        assertFalse(game(completedAt = null).isCompleted, "ongoing (and abandoned) read as not solved")
    }

    @Test
    fun isAbandonedReadsTheEndedFact_andIsExclusiveWithSolved_PROTOCOL12() {
        // §12: abandonedAt is the twin terminal fact, mutually exclusive with completedAt. A
        // host-ended room is abandoned and terminal but never solved; a solved room is the reverse;
        // a live room is neither.
        val ended = game(abandonedAt = "2026-07-07T18:52:00.000Z")
        assertTrue(ended.isAbandoned)
        assertFalse(ended.isCompleted)
        assertTrue(ended.isTerminal)

        val solved = game(completedAt = "2026-07-08T20:11:47.000Z")
        assertFalse(solved.isAbandoned)
        assertTrue(solved.isTerminal)

        val live = game()
        assertFalse(live.isAbandoned)
        assertFalse(live.isTerminal)
    }

    @Test
    fun partitionRoomsSplitsLiveSolvedEnded_PROTOCOL12() {
        // The web's shelf grammar (Home.tsx GamesList): live rooms lead, then solved, then
        // host-ended, each gathered trailing by its mutually exclusive terminal timestamp.
        val live1 = game(gameId = "a", completedAt = null)
        val solved1 = game(gameId = "b", completedAt = "2026-07-08T20:11:47.000Z")
        val ended1 = game(gameId = "c", abandonedAt = "2026-07-08T21:00:00.000Z")
        val live2 = game(gameId = "d", completedAt = null)
        val solved2 = game(gameId = "e", completedAt = "2026-07-09T09:00:00.000Z")
        val ended2 = game(gameId = "f", abandonedAt = "2026-07-09T10:00:00.000Z")

        val shelves = partitionRooms(listOf(live1, solved1, ended1, live2, solved2, ended2))
        assertEquals(listOf("a", "d"), shelves.live.map { it.gameId })
        assertEquals(listOf("b", "e"), shelves.solved.map { it.gameId })
        assertEquals(listOf("c", "f"), shelves.ended.map { it.gameId })
    }

    @Test
    fun partitionRoomsKeepsAnAbandonedRoomOutOfLive_theFix_PROTOCOL12() {
        // The fix: an abandoned room has a null completedAt, so the old two-way split left it in
        // the live shelf. It must gather into `ended`, out of both live and solved.
        val shelves = partitionRooms(listOf(game(gameId = "a", abandonedAt = "2026-07-07T18:52:00.000Z")))
        assertTrue(shelves.live.isEmpty())
        assertTrue(shelves.solved.isEmpty())
        assertEquals(listOf("a"), shelves.ended.map { it.gameId })
    }

    @Test
    fun partitionRoomsPreservesOrderWithinEachGroup_PROTOCOL12() {
        // §12 pagination stability: the partition never re-sorts, so the caller's activity order
        // carries through and a terminal room from a deeper page lands after the earlier ones.
        val rooms = listOf(
            game(gameId = "s1", completedAt = "2026-07-09T00:00:00.000Z"),
            game(gameId = "l1", completedAt = null),
            game(gameId = "e1", abandonedAt = "2026-07-09T06:00:00.000Z"),
            game(gameId = "s2", completedAt = "2026-07-08T00:00:00.000Z"),
            game(gameId = "l2", completedAt = null),
            game(gameId = "e2", abandonedAt = "2026-07-08T06:00:00.000Z"),
            game(gameId = "s3", completedAt = "2026-07-07T00:00:00.000Z"),
        )
        val shelves = partitionRooms(rooms)
        assertEquals(listOf("l1", "l2"), shelves.live.map { it.gameId }, "live order preserved")
        assertEquals(listOf("s1", "s2", "s3"), shelves.solved.map { it.gameId }, "solved order preserved")
        assertEquals(listOf("e1", "e2"), shelves.ended.map { it.gameId }, "ended order preserved")
    }

    @Test
    fun partitionRoomsAllLiveGivesEmptyTerminalGroups_PROTOCOL12() {
        // When nothing is terminal the trailing sections do not render (the web's all-live shelf
        // carries no empty header); the helper reports empty solved and ended groups.
        val shelves = partitionRooms(listOf(game(gameId = "a"), game(gameId = "b")))
        assertEquals(listOf("a", "b"), shelves.live.map { it.gameId })
        assertTrue(shelves.solved.isEmpty())
        assertTrue(shelves.ended.isEmpty())
    }

    @Test
    fun partitionRoomsAllTerminalGivesEmptyLive_PROTOCOL12() {
        val shelves = partitionRooms(
            listOf(
                game(gameId = "a", completedAt = "2026-07-08T00:00:00.000Z"),
                game(gameId = "b", abandonedAt = "2026-07-09T00:00:00.000Z"),
            ),
        )
        assertTrue(shelves.live.isEmpty())
        assertEquals(listOf("a"), shelves.solved.map { it.gameId })
        assertEquals(listOf("b"), shelves.ended.map { it.gameId })
    }

    @Test
    fun partitionRoomsDoesNotMutateItsInput_PROTOCOL12() {
        val input = listOf(
            game(gameId = "a", completedAt = "2026-07-08T00:00:00.000Z"),
            game(gameId = "b", abandonedAt = "2026-07-08T00:00:00.000Z"),
            game(gameId = "c"),
        )
        val before = input.map { it.gameId }
        partitionRooms(input)
        assertEquals(before, input.map { it.gameId })
    }
}
