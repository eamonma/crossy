package crossy.ui

import crossy.protocol.Board
import crossy.protocol.Cell
import crossy.protocol.GameCompletedMessage
import crossy.protocol.GameStatus
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.Stats
import crossy.protocol.WelcomeMessage
import crossy.store.GameStore
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// RoomScreen's deck-visibility decision, the rendered half of the terminal freeze (INV-4). Twin of
// iOS SolveScreen's status switch (#205 solved, #235 host-ended) and RoomTerminal.deckRetired: a
// terminal room retires its key deck for everyone. The predicate is a pure function of the render
// model, so the deck leaves on the first frame the model reports terminal — a welcome that carries
// the terminal status retires the deck with no flash, exactly as a mid-solve completion does. Real
// render models are minted by driving a GameStore, so the view cannot drift from the store's twins.
class KeyDeckRetirementTests {
    private fun board(seq: Int = 0, status: GameStatus = GameStatus.ONGOING): Board = Board(
        seq = seq,
        status = status,
        firstFillAt = null,
        completedAt = null,
        abandonedAt = null,
        cells = List(20) { Cell(null, null) },
        participants = emptyList(),
        cursors = emptyList(),
        recentCommandIds = emptyList(),
        stats = null,
    )

    private fun welcome(board: Board): ServerMessage =
        ServerMessage.Welcome(WelcomeMessage(1, WelcomeMessage.SelfIdentity("me", Role.SOLVER), board))

    // An ongoing room keeps its deck: solvers need the keyboard.
    @Test
    fun ongoingShowsTheDeck_INV4() {
        val store = GameStore()
        store.receive(welcome(board(status = GameStatus.ONGOING)))
        assertFalse(deckRetired(store.render.value), "a live room keeps the deck")
    }

    // A solved room opened onto a completed welcome retires the deck from that first frame: the
    // predicate reads the terminal status the welcome carries, so no ongoing deck flashes first.
    @Test
    fun completedRetiresTheDeckFromTheFirstFrame_INV4() {
        val store = GameStore()
        store.receive(welcome(board(status = GameStatus.COMPLETED)))
        assertTrue(deckRetired(store.render.value), "a completed welcome retires the deck on frame one")
    }

    // The host-ended twin (#235): abandoned is terminal too, and the one `!= ONGOING` predicate
    // already covers it, so it retires the deck from the first frame with no extra view logic.
    @Test
    fun abandonedRetiresTheDeckFromTheFirstFrame_INV4() {
        val store = GameStore()
        store.receive(welcome(board(status = GameStatus.ABANDONED)))
        assertTrue(deckRetired(store.render.value), "an abandoned welcome retires the deck on frame one")
    }

    // A room solved mid-session (a GameCompleted after a live ongoing welcome) retires the deck on
    // the transition: the deck was shown live, then leaves the instant the status turns terminal.
    @Test
    fun liveCompletionTransitionRetiresTheDeck_INV4() {
        val store = GameStore()
        store.receive(welcome(board(seq = 5, status = GameStatus.ONGOING)))
        assertFalse(deckRetired(store.render.value), "the live room shows the deck before completion")
        val stats = Stats(solveTimeSeconds = 2272, totalEvents = 5, participantCount = 2, checkCount = 0)
        store.receive(ServerMessage.GameCompleted(GameCompletedMessage(6, "2026-07-07T19:40:03Z", stats)))
        assertTrue(deckRetired(store.render.value), "the completion transition retires the deck")
    }
}
