// Reactions through the store (PROTOCOL.md §5, §9; D24): a stateless send beside moveCursor and a
// pure fan-out beside onKicked/onConflictFlash. Twin of apps/ios ReactionRelayTests.swift. The
// store holds NOTHING for a reaction, and these tests pin that: an inbound reaction changes no
// observable store state and publishes to the ephemeral `reactions` stream, and the snapshot path
// cannot carry one because the Board payload has no reactions field (there is no `board.reactions`,
// §9). The send path emits the wire frame and nothing else, subject only to the pre-welcome gate.

package crossy.store

import crossy.protocol.Board
import crossy.protocol.Cell
import crossy.protocol.ClientMessage
import crossy.protocol.GameStatus
import crossy.protocol.PlaceLetterMessage
import crossy.protocol.ReactMessage
import crossy.protocol.ReactionMessage
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.SyncMessage
import crossy.protocol.WelcomeMessage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReactionRelayTests {
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

    private fun welcome(board: Board, userId: String = "me"): ServerMessage =
        ServerMessage.Welcome(WelcomeMessage(1, WelcomeMessage.SelfIdentity(userId, Role.SOLVER), board))

    /** Collect everything the reactions stream publishes. The stream has replay = 0 (a reaction is a
     *  live event), so the collector must be actively subscribed before any emission. These tests
     *  run on an UnconfinedTestDispatcher, so this background collector subscribes eagerly at launch
     *  and each tryEmit is delivered synchronously, no scheduler advance needed. */
    private fun TestScope.collectReactions(store: GameStore): MutableList<ReactionEvent> {
        val received = mutableListOf<ReactionEvent>()
        backgroundScope.launch { store.reactions.toList(received) }
        return received
    }

    // --- The send (PROTOCOL.md §5, §9) ---

    @Test
    fun reactEmitsTheWireFrameAndNothingElse_PROTOCOL9() {
        val store = GameStore()
        store.receive(welcome(board()))
        val overlayBefore = store.render.value.overlay

        store.react("🎉", 7)

        assertEquals(listOf<ClientMessage>(ClientMessage.React(ReactMessage("🎉", 7))), store.outbox)
        assertEquals(overlayBefore, store.render.value.overlay, "a reaction never enters the overlay (§8 is mutations only)")
    }

    @Test
    fun reactIsRefusedBeforeTheFirstWelcome_PROTOCOL7() {
        // The moveCursor gate, mirrored: no authoritative game exists while connecting.
        val store = GameStore()
        store.react("🎉", 0)
        assertTrue(store.outbox.isEmpty())
    }

    @Test
    fun reactIsLegalInATerminalStatus_PROTOCOL9() {
        // §9: react mutates nothing, so completion does not gate it the way it gates placeLetter;
        // reactions on the finished grid are intended.
        val store = GameStore()
        store.receive(welcome(board(status = GameStatus.COMPLETED)))
        store.react("🫡", 3)
        assertEquals(listOf<ClientMessage>(ClientMessage.React(ReactMessage("🫡", 3))), store.outbox)
    }

    // --- The fan-out (PROTOCOL.md §6, §9) ---

    @Test
    fun inboundReactionPublishesToTheStream_PROTOCOL9() = runTest(UnconfinedTestDispatcher()) {
        val store = GameStore()
        val received = collectReactions(store)
        store.receive(welcome(board()))

        store.receive(ServerMessage.Reaction(ReactionMessage(userId = "u2", emoji = "🔥", cell = 5)))

        // Receive-any (§9): an emoji outside the v1 send set still fans out.
        assertEquals(listOf(ReactionEvent("u2", "🔥", 5)), received)
    }

    @Test
    fun inboundReactionChangesNoStoreState_D24() = runTest(UnconfinedTestDispatcher()) {
        val store = GameStore()
        collectReactions(store)
        store.receive(welcome(board(seq = 3)))
        store.placeLetter(1, "A") // a pending overlay entry to guard

        val before = store.render.value

        store.receive(ServerMessage.Reaction(ReactionMessage(userId = "u2", emoji = "🎉", cell = 5)))

        // A notice mutates nothing sequenced and emits no frame: the render model is byte-identical.
        assertEquals(before, store.render.value)
    }

    @Test
    fun snapshotsCannotReplayReactions_D24() = runTest(UnconfinedTestDispatcher()) {
        // The server records nothing for a reaction, so no snapshot carries one (§9: there is no
        // board.reactions, unlike board.cursors). Pinned behaviorally: a resync after a reaction
        // fans nothing out again.
        val store = GameStore()
        val received = collectReactions(store)
        store.receive(welcome(board()))
        store.receive(ServerMessage.Reaction(ReactionMessage(userId = "u2", emoji = "🎉", cell = 5)))
        assertEquals(1, received.size)

        store.receive(ServerMessage.Sync(SyncMessage(board(seq = 9))))

        assertEquals(1, received.size, "a snapshot must not resurrect a reaction")
        assertEquals(9, store.render.value.seq)
    }
}
