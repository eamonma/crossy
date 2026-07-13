// The room transport seam. On this branch :session is the placeholder (SessionPlaceholder), so the
// real OkHttp WebSocket Transport (AAD-1: adapters implement the store's port outward) has not
// landed. Tonight the room runs on a scripted transport that seeds a `welcome` from the puzzle
// geometry and echoes the local player's own mutations back as sequenced `cellSet` frames, so the
// room screen is fully demonstrable without a server and the optimistic overlay clears on echo
// exactly as INV-10 requires. When :session lands (Wave A1) its Transport replaces
// ScriptedRoomTransport here and nothing above the seam changes: RoomHost still builds a GameStore
// and runs it over a Transport. The wiring point for the real dial is marked below.

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
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.WelcomeMessage
import crossy.store.Transport
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import java.time.Instant

/** Builds the Transport a room runs over. The scripted implementation is tonight's only one; the
 *  real one (SessionEndpoint.ws + BuildConfig.SESSION_WS_BASE) arrives with :session. */
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
) : Transport {
    private val channel = Channel<ServerMessage>(Channel.UNLIMITED)
    private var seq = startSeq
    private var firstFillSent = false

    override val inbound: Flow<ServerMessage> = channel.receiveAsFlow()

    override suspend fun connect() {
        channel.trySend(welcome)
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
        // TODO(session, Wave A1): when :session lands, return its OkHttp WebSocket Transport here,
        // dialing SessionEndpoint.ws (resolved against BuildConfig.SESSION_WS_BASE) with the bearer;
        // the store, RoomHost, and every screen above this seam stay unchanged.
        val welcome = RoomScripts.welcome(puzzle, selfUserId, seedDemo)
        return ScriptedRoomTransport(welcome, selfUserId, startSeq = welcome.message.board.seq)
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
