// Compose previews over a scripted render model (ARCHITECTURE.md §7, the replay-is-the-superpower
// pattern): the store is pure over an injected transport, so a preview seeds it a scripted `welcome`
// frame and renders the real screens with no server. The same fixtures drive the grid preview
// directly and the room preview through a live GameStore. These are @Preview-only; nothing here
// ships in the app.

package crossy.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import crossy.design.IdentityRoster
import crossy.protocol.Board
import crossy.protocol.Cell
import crossy.protocol.ClientPuzzle
import crossy.protocol.Clue
import crossy.protocol.Clues
import crossy.protocol.Cursor
import crossy.protocol.Direction
import crossy.protocol.GameStatus
import crossy.protocol.Participant
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.WelcomeMessage
import crossy.store.GameStore

/** Shared scripted fixtures for previews: a 5x5 mini, its roster, and a `welcome` frame with a few
 *  filled cells and a live teammate cursor. */
internal object PreviewFixtures {
    const val SELF = "self-1"
    const val MATE = "mate-2"

    val puzzle = ClientPuzzle(
        rows = 5,
        cols = 5,
        blocks = emptyList(),
        circles = listOf(12),
        shadedCircles = null,
        clues = Clues(
            across = listOf(
                Clue(1, "Friendly greeting", listOf(0, 1, 2, 3, 4)),
                Clue(6, "Put off", listOf(5, 6, 7, 8, 9)),
                Clue(7, "Steady flame", listOf(10, 11, 12, 13, 14)),
                Clue(8, "Garden crawler", listOf(15, 16, 17, 18, 19)),
                Clue(9, "Not hard", listOf(20, 21, 22, 23, 24)),
            ),
            down = listOf(
                Clue(1, "Round shape", listOf(0, 5, 10, 15, 20)),
                Clue(2, "Curved letter", listOf(1, 6, 11, 16, 21)),
                Clue(3, "Frozen water", listOf(2, 7, 12, 17, 22)),
                Clue(4, "Make use of", listOf(3, 8, 13, 18, 23)),
                Clue(5, "Slippery fish", listOf(4, 9, 14, 19, 24)),
            ),
        ),
    )

    private val participants = listOf(
        Participant(SELF, "You", "#6F66D4", Role.SOLVER, connected = true),
        Participant(MATE, "Ada", "#DE5722", Role.SOLVER, connected = true),
    )

    private fun board(): Board {
        val filled = mapOf(0 to "H", 1 to "E", 2 to "L", 3 to "L", 4 to "O", 5 to "D")
        val writers = mapOf(0 to SELF, 1 to SELF, 2 to SELF, 3 to SELF, 4 to SELF, 5 to MATE)
        val cells = (0 until 25).map { i -> Cell(v = filled[i], by = writers[i]) }
        return Board(
            seq = 6,
            status = GameStatus.ONGOING,
            firstFillAt = "2026-07-13T12:00:00Z",
            completedAt = null,
            abandonedAt = null,
            cells = cells,
            participants = participants,
            cursors = listOf(Cursor(MATE, cell = 6, direction = Direction.DOWN)),
            recentCommandIds = emptyList(),
            stats = null,
        )
    }

    fun welcome(): ServerMessage.Welcome =
        ServerMessage.Welcome(WelcomeMessage(protocolVersion = 1, self = WelcomeMessage.SelfIdentity(SELF, Role.SOLVER), board = board()))

    /** A store already seeded with the scripted welcome, live and ready to render. */
    fun seededStore(): GameStore = GameStore().apply { receive(welcome()) }
}

@Preview(name = "Grid (Studio)", showBackground = true, widthDp = 360, heightDp = 360)
@Composable
private fun GridStudioPreview() {
    val geometry = remember { GridGeometry.from(PreviewFixtures.puzzle) }
    val ground = GridGround.STUDIO
    CrossyTheme(ground) {
        CrossyGrid(
            geometry = geometry,
            values = mapOf(0 to "H", 1 to "E", 2 to "L", 3 to "L", 4 to "O", 5 to "D"),
            selection = GridSelection(2, isAcross = true),
            activeWord = geometry.wordCells(2, true),
            presence = mapOf(6 to listOf(PresenceMark(PreviewFixtures.MATE, "A", ground.rosterColor(IdentityRoster.poppy), isAcross = false))),
            ground = ground,
            cursorTint = ground.rosterColor(IdentityRoster.violet),
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Preview(name = "Grid (Observatory)", showBackground = true, widthDp = 360, heightDp = 360)
@Composable
private fun GridObservatoryPreview() {
    val geometry = remember { GridGeometry.from(PreviewFixtures.puzzle) }
    val ground = GridGround.OBSERVATORY
    CrossyTheme(ground) {
        CrossyGrid(
            geometry = geometry,
            values = mapOf(0 to "H", 1 to "E", 2 to "L", 3 to "L", 4 to "O", 5 to "D"),
            selection = GridSelection(11, isAcross = false),
            activeWord = geometry.wordCells(11, false),
            presence = mapOf(6 to listOf(PresenceMark(PreviewFixtures.MATE, "A", ground.rosterColor(IdentityRoster.poppy), isAcross = false))),
            ground = ground,
            cursorTint = ground.rosterColor(IdentityRoster.cobalt),
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Preview(name = "Room", showBackground = true, widthDp = 380, heightDp = 780)
@Composable
private fun RoomPreview() {
    val store = remember { PreviewFixtures.seededStore() }
    CrossyTheme(GridGround.STUDIO) {
        RoomScreen(store = store, puzzle = PreviewFixtures.puzzle, roomName = "Sunday Mini")
    }
}
