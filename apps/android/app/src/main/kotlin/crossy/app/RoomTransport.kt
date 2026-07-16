// The demo room's transport. Live rooms run :session's WebSocketTransport under SessionDriver,
// wired in RoomHost (CrossyApp.kt); this scripted transport serves the demo room and previews:
// it seeds a `welcome` from the puzzle geometry and echoes the local player's own mutations back
// as sequenced `cellSet` frames, so the room screen is fully demonstrable without a server and
// the optimistic overlay clears on echo exactly as INV-10 requires.

package crossy.app

import crossy.protocol.Board
import crossy.protocol.Cell
import crossy.protocol.CellSetMessage
import crossy.protocol.ClientMessage
import crossy.protocol.ClientPuzzle
import crossy.protocol.Cursor
import crossy.protocol.Direction
import crossy.protocol.GameStatus
import crossy.protocol.Participant
import crossy.protocol.ReactionMessage
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.WelcomeMessage
import crossy.store.Transport
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import java.time.Instant

/** Builds the Transport a server-less room runs over (the demo room; previews). Live rooms do
 *  not pass through this seam: RoomHost dials :session directly with the game's SessionEndpoint. */
fun interface RoomTransportFactory {
    fun create(puzzle: ClientPuzzle, selfUserId: String, seedDemo: Boolean): Transport
}

/** The scripted stand-in for :session. It emits the seeded `welcome` on connect, then turns every
 *  local mutation the store sends into a sequenced `cellSet` echo (by the local user, so no conflict
 *  flash), advancing the seq. Cursor and heartbeat frames have nothing to echo and are dropped. */
class ScriptedRoomTransport(
    private val welcome: ServerMessage.Welcome,
    private val selfUserId: String,
    startSeq: Int,
    private val demoReaction: ReactionMessage? = null,
) : Transport {
    private val channel = Channel<ServerMessage>(Channel.UNLIMITED)
    private var seq = startSeq
    private var firstFillSent = false

    override val inbound: Flow<ServerMessage> = channel.receiveAsFlow()

    override suspend fun connect() {
        channel.trySend(welcome)
        // Demo parity (PROTOCOL.md §6, §9): a single teammate reaction so the sticker layer is
        // demonstrable without a server. Ephemeral and un-sequenced, exactly as the real fan-out is;
        // the sticker decays on its own five-second clock. Cheap: one frame, no infrastructure.
        demoReaction?.let { channel.trySend(ServerMessage.Reaction(it)) }
    }

    override suspend fun send(message: ClientMessage) {
        when (message) {
            is ClientMessage.PlaceLetter -> echo(message.message.cell, message.message.value, message.message.commandId)
            is ClientMessage.ClearCell -> echo(message.message.cell, null, message.message.commandId)
            else -> Unit // moveCursor / heartbeat / requestSync: nothing to sequence in the script
        }
    }

    private fun echo(cell: Int, value: String?, commandId: String) {
        seq += 1
        val now = Instant.now().toString()
        val firstFillAt = if (value != null && !firstFillSent) {
            firstFillSent = true
            now
        } else {
            null
        }
        channel.trySend(
            ServerMessage.CellSet(CellSetMessage(seq, cell, value, by = selfUserId, commandId = commandId, at = now, firstFillAt = firstFillAt)),
        )
    }

    override suspend fun close() {
        channel.close()
    }
}

/** The scripted factory. A real game seeds only the self participant; the demo path seeds a live
 *  teammate and a couple of filled cells so presence and the roster render on the first frame. */
class ScriptedRoomTransportFactory : RoomTransportFactory {
    override fun create(puzzle: ClientPuzzle, selfUserId: String, seedDemo: Boolean): Transport {
        val welcome = RoomScripts.welcome(puzzle, selfUserId, seedDemo)
        // In demo mode the teammate cheers a middle cell once, so the sticker layer shows on arrival.
        val demoReaction = if (seedDemo) ReactionMessage(userId = RoomScripts.DEMO_MATE, emoji = "🐐", cell = 12) else null
        return ScriptedRoomTransport(welcome, selfUserId, startSeq = welcome.message.board.seq, demoReaction = demoReaction)
    }
}

object RoomScripts {
    const val DEMO_MATE = "demo-mate"

    /** A `welcome` seeded from the puzzle geometry: an empty board sized to the grid, the self
     *  participant, and (in demo mode) a teammate plus a couple of filled cells and a live cursor. */
    fun welcome(puzzle: ClientPuzzle, selfUserId: String, seedDemo: Boolean): ServerMessage.Welcome {
        val count = puzzle.rows * puzzle.cols
        val filled: Map<Int, Pair<String, String>> =
            if (seedDemo) mapOf(0 to ("C" to selfUserId), 1 to ("A" to DEMO_MATE), 2 to ("T" to DEMO_MATE)) else emptyMap()
        val cells = (0 until count).map { i ->
            val entry = filled[i]
            if (entry != null) Cell(v = entry.first, by = entry.second) else Cell(v = null, by = null)
        }
        val participants = buildList {
            add(Participant(selfUserId, "You", "#6F66D4", Role.SOLVER, connected = true))
            if (seedDemo) add(Participant(DEMO_MATE, "Ada", "#DE5722", Role.SOLVER, connected = true))
        }
        val cursors = if (seedDemo) listOf(Cursor(DEMO_MATE, cell = 1, direction = Direction.DOWN)) else emptyList()
        val board = Board(
            seq = 0,
            status = GameStatus.ONGOING,
            firstFillAt = if (seedDemo) Instant.now().toString() else null,
            completedAt = null,
            abandonedAt = null,
            cells = cells,
            participants = participants,
            cursors = cursors,
            recentCommandIds = emptyList(),
            stats = null,
        )
        return ServerMessage.Welcome(WelcomeMessage(protocolVersion = 1, self = WelcomeMessage.SelfIdentity(selfUserId, Role.SOLVER), board = board))
    }

    /** A built-in 5x5 mini for the demo room, so the room is reachable without a server. */
    val demoPuzzle: ClientPuzzle = ClientPuzzle(
        rows = 5,
        cols = 5,
        blocks = emptyList(),
        circles = listOf(12),
        shadedCircles = null,
        clues = crossy.protocol.Clues(
            across = listOf(
                crossy.protocol.Clue(1, "Small feline", listOf(0, 1, 2, 3, 4)),
                crossy.protocol.Clue(6, "Put off", listOf(5, 6, 7, 8, 9)),
                crossy.protocol.Clue(7, "Steady flame", listOf(10, 11, 12, 13, 14)),
                crossy.protocol.Clue(8, "Garden crawler", listOf(15, 16, 17, 18, 19)),
                crossy.protocol.Clue(9, "Not hard", listOf(20, 21, 22, 23, 24)),
            ),
            down = listOf(
                crossy.protocol.Clue(1, "Round shape", listOf(0, 5, 10, 15, 20)),
                crossy.protocol.Clue(2, "Curved letter", listOf(1, 6, 11, 16, 21)),
                crossy.protocol.Clue(3, "Frozen water", listOf(2, 7, 12, 17, 22)),
                crossy.protocol.Clue(4, "Make use of", listOf(3, 8, 13, 18, 23)),
                crossy.protocol.Clue(5, "Slippery fish", listOf(4, 9, 14, 19, 24)),
            ),
        ),
    )
}
