// The app shell and navigation (ARCHITECTURE.md §1: the CRUD shell as plain per-screen state).
// A tiny hand-rolled nav (no nav library earns its weight yet, mirroring the repo's "no
// orchestrator until it hurts"): one screen enum, one when. Each host owns its screen's data
// fetch and intents, calling the composition root's AppSession; the :ui screens stay pure
// functions of that state. The room runs a GameStore over the transport seam (scripted tonight).

package crossy.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import crossy.protocol.ClientPuzzle
import crossy.protocol.CreateGameRequest
import crossy.protocol.GameSummary
import crossy.protocol.GameView
import crossy.protocol.PuzzleSummary
import crossy.store.GameStore
import crossy.ui.CreateGameScreen
import crossy.ui.CrossyTheme
import crossy.ui.GridGround
import crossy.ui.JoinCodeScreen
import crossy.ui.RoomScreen
import crossy.ui.RoomsListScreen
import crossy.ui.SignInScreen
import kotlinx.coroutines.launch

private sealed interface Screen {
    data object SignIn : Screen
    data object Rooms : Screen
    data object Join : Screen
    data object Create : Screen
    data class Room(val puzzle: ClientPuzzle, val name: String?, val demo: Boolean) : Screen
}

@Composable
fun CrossyApp(session: AppSession, factory: RoomTransportFactory) {
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO
    var screen by remember { mutableStateOf<Screen>(Screen.SignIn) }
    val scope = rememberCoroutineScope()

    CrossyTheme(ground) {
        when (val s = screen) {
            Screen.SignIn -> SignInHost(session, onSignedIn = { screen = Screen.Rooms })

            Screen.Rooms -> RoomsHost(
                session = session,
                ground = ground,
                onOpenGame = { view -> screen = Screen.Room(view.puzzle, view.name, demo = false) },
                onJoin = { screen = Screen.Join },
                onCreate = { screen = Screen.Create },
                onOpenDemo = { screen = Screen.Room(RoomScripts.demoPuzzle, "Demo room", demo = true) },
                onSignOut = {
                    scope.launch { runCatching { session.auth.signOut() } }
                    session.clearSession()
                    screen = Screen.SignIn
                },
            )

            Screen.Join -> JoinHost(
                session = session,
                onBack = { screen = Screen.Rooms },
                onJoined = { view -> screen = Screen.Room(view.puzzle, view.name, demo = false) },
            )

            Screen.Create -> CreateHost(
                session = session,
                onBack = { screen = Screen.Rooms },
                onCreated = { view -> screen = Screen.Room(view.puzzle, view.name, demo = false) },
            )

            is Screen.Room -> RoomHost(
                factory = factory,
                puzzle = s.puzzle,
                roomName = s.name,
                selfUserId = session.selfUserId ?: "you",
                demo = s.demo,
                onExit = { screen = Screen.Rooms },
            )
        }
    }
}

@Composable
private fun SignInHost(session: AppSession, onSignedIn: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    SignInScreen(
        isBusy = busy,
        error = error,
        onSignIn = { email, password ->
            scope.launch {
                busy = true
                error = null
                val ok = runCatching { session.signInWithPassword(email, password) }.getOrElse {
                    error = it.message ?: "Sign-in failed"
                    false
                }
                busy = false
                if (ok) onSignedIn() else if (error == null) error = "Sign-in failed. Check your email and password."
            }
        },
        onDevToken = { token ->
            session.useDevToken(token)
            onSignedIn()
        },
    )
}

@Composable
private fun RoomsHost(
    session: AppSession,
    ground: GridGround,
    onOpenGame: (GameView) -> Unit,
    onJoin: () -> Unit,
    onCreate: () -> Unit,
    onOpenDemo: () -> Unit,
    onSignOut: () -> Unit,
) {
    var games by remember { mutableStateOf<List<GameSummary>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        loading = true
        error = null
        runCatching { session.api.listGames() }
            .onSuccess { games = it.rows }
            .onFailure { error = it.message ?: it::class.simpleName }
        loading = false
    }

    RoomsListScreen(
        games = games,
        ground = ground,
        isLoading = loading,
        error = error,
        onOpen = { summary ->
            scope.launch {
                runCatching { session.api.game(summary.gameId) }
                    .onSuccess { onOpenGame(it) }
                    .onFailure { error = it.message ?: it::class.simpleName }
            }
        },
        onJoinByCode = onJoin,
        onCreate = onCreate,
        onOpenDemo = onOpenDemo,
        onSignOut = onSignOut,
    )
}

@Composable
private fun JoinHost(session: AppSession, onBack: () -> Unit, onJoined: (GameView) -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    JoinCodeScreen(
        isBusy = busy,
        error = error,
        onJoin = { code ->
            scope.launch {
                busy = true
                error = null
                runCatching {
                    val membership = session.api.joinGame(code)
                    session.api.game(membership.gameId)
                }.onSuccess { onJoined(it) }.onFailure { error = it.message ?: it::class.simpleName }
                busy = false
            }
        },
        onBack = onBack,
    )
}

@Composable
private fun CreateHost(session: AppSession, onBack: () -> Unit, onCreated: (GameView) -> Unit) {
    var puzzles by remember { mutableStateOf<List<PuzzleSummary>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { session.api.listPuzzles() }.onSuccess { puzzles = it.rows }
    }

    CreateGameScreen(
        puzzles = puzzles,
        isBusy = busy,
        error = error,
        onCreate = { puzzleId, name ->
            scope.launch {
                busy = true
                error = null
                runCatching {
                    val created = session.api.createGame(CreateGameRequest(puzzleId, name))
                    session.api.game(created.gameId)
                }.onSuccess { onCreated(it) }.onFailure { error = it.message ?: it::class.simpleName }
                busy = false
            }
        },
        onBack = onBack,
    )
}

/** The room host: build one GameStore and run it over the transport (scripted tonight) for the
 *  screen's life. Confinement to the main dispatcher is the composition root's job (AAD-2); the
 *  compose coroutine scope is main-confined, so the store's single consumption loop runs there. */
@Composable
private fun RoomHost(
    factory: RoomTransportFactory,
    puzzle: ClientPuzzle,
    roomName: String?,
    selfUserId: String,
    demo: Boolean,
    onExit: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val store = remember(puzzle) { GameStore() }
    DisposableEffect(puzzle) {
        val transport = factory.create(puzzle, selfUserId, demo)
        val job = scope.launch {
            transport.connect()
            store.run(transport)
        }
        onDispose { job.cancel() }
    }
    RoomScreen(store = store, puzzle = puzzle, roomName = roomName, onExit = onExit)
}
