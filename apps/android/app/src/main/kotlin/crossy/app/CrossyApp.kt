// The app shell and navigation (ARCHITECTURE.md §1: the CRUD shell as plain per-screen state).
// A tiny hand-rolled nav (no nav library earns its weight yet, mirroring the repo's "no
// orchestrator until it hurts"): one screen enum, one when. Each host owns its screen's data
// fetch and intents, calling the composition root's AppSession; the :ui screens stay pure
// functions of that state. A live room runs a GameStore under :session's SessionDriver; the demo
// room runs the scripted transport (RoomTransport.kt), no server.

package crossy.app

import android.content.Intent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import crossy.protocol.ClientPuzzle
import crossy.protocol.CreateGameRequest
import crossy.protocol.GameSummary
import crossy.protocol.GameView
import crossy.protocol.PuzzleSummary
import crossy.session.SessionDriver
import crossy.session.WebSocketTransport
import crossy.store.GameStore
import crossy.ui.CreateGameScreen
import crossy.ui.CrossyTheme
import crossy.ui.EmailOtpStep
import crossy.ui.GridGround
import crossy.ui.JoinCodeScreen
import crossy.ui.RoomScreen
import crossy.ui.RoomsListScreen
import crossy.ui.ShareInvite
import crossy.ui.SignInScreen
import kotlinx.coroutines.launch

private sealed interface Screen {
    data object SignIn : Screen
    data object Rooms : Screen
    data object Join : Screen
    data object Create : Screen
    // wsUrl null = no live socket (the demo room): the room runs on the scripted transport.
    // inviteCode null = nothing to share (the demo room carries no code).
    data class Room(
        val puzzle: ClientPuzzle,
        val name: String?,
        val demo: Boolean,
        val wsUrl: String? = null,
        val inviteCode: String? = null,
    ) : Screen
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
                onOpenGame = { view -> screen = Screen.Room(view.puzzle, view.name, demo = false, wsUrl = view.session.ws, inviteCode = view.inviteCode) },
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
                onJoined = { view -> screen = Screen.Room(view.puzzle, view.name, demo = false, wsUrl = view.session.ws, inviteCode = view.inviteCode) },
            )

            Screen.Create -> CreateHost(
                session = session,
                onBack = { screen = Screen.Rooms },
                onCreated = { view -> screen = Screen.Room(view.puzzle, view.name, demo = false, wsUrl = view.session.ws, inviteCode = view.inviteCode) },
            )

            is Screen.Room -> RoomHost(
                session = session,
                factory = factory,
                puzzle = s.puzzle,
                roomName = s.name,
                selfUserId = session.selfUserId ?: "you",
                demo = s.demo,
                wsUrl = s.wsUrl,
                inviteCode = s.inviteCode,
                onExit = { screen = Screen.Rooms },
            )
        }
    }
}

@Composable
private fun SignInHost(session: AppSession, onSignedIn: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // The OTP sub-flow's step and its own busy live here (the host owns the network); the screen is
    // a pure function of them. Success is observed through the phase the verify drives, exactly as
    // the password leg is: nothing here reads a verify return to decide sign-in.
    var otpStep by remember { mutableStateOf<EmailOtpStep>(EmailOtpStep.Closed) }
    var otpBusy by remember { mutableStateOf(false) }
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
        otpStep = otpStep,
        otpBusy = otpBusy,
        onEmailStep = { error = null; otpStep = EmailOtpStep.Email(null) },
        onCancelOtp = { otpStep = EmailOtpStep.Closed },
        onSendCode = { email ->
            scope.launch {
                otpBusy = true
                val sent = runCatching { session.sendEmailOtp(email) }.isSuccess
                otpBusy = false
                otpStep = if (sent) {
                    EmailOtpStep.Code(email, null)
                } else {
                    EmailOtpStep.Email("Couldn't send the code. Check the address and try again.")
                }
            }
        },
        onResendCode = {
            val step = otpStep
            if (step is EmailOtpStep.Code) scope.launch {
                otpBusy = true
                // A failed resend keeps the code entry standing (the screen's countdown already
                // restarted); the user still has the prior code and can retry the send.
                runCatching { session.sendEmailOtp(step.email) }
                otpBusy = false
            }
        },
        onVerifyCode = { code ->
            val step = otpStep
            if (step is EmailOtpStep.Code) scope.launch {
                otpBusy = true
                // AuthSession rethrows a bad code, so either the throw or a false lands the retry copy.
                val ok = runCatching { session.verifyEmailOtp(step.email, code) }.getOrDefault(false)
                otpBusy = false
                if (ok) {
                    onSignedIn()
                } else {
                    otpStep = EmailOtpStep.Code(
                        step.email,
                        "That code didn't work. Check it and try again, or resend.",
                    )
                }
            }
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

/** The room host: build one GameStore and run it for the screen's life. A live room (wsUrl
 *  present) runs the real :session stack: SessionDriver dials a fresh WebSocketTransport per
 *  attempt with the store's bearer, resumes from the store's seq on a redial, and executes the
 *  store-decided backoff (AD-6). The demo room (wsUrl null) runs the scripted transport, no
 *  server. Confinement to the main dispatcher is the composition root's job (AAD-2); the compose
 *  coroutine scope is main-confined, so the store's single consumption loop runs there. */
@Composable
private fun RoomHost(
    session: AppSession,
    factory: RoomTransportFactory,
    puzzle: ClientPuzzle,
    roomName: String?,
    selfUserId: String,
    demo: Boolean,
    wsUrl: String?,
    inviteCode: String?,
    onExit: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val store = remember(puzzle) { GameStore() }
    // The share intent: the pure ShareInvite builds the canonical short link from the configured
    // host (AppConfig.INVITE_HOST), and the app target fires the system share sheet (mirroring iOS,
    // where CrossyUI is pure over the link and the app target presents the sheet). Null when the
    // room has no code (the demo room), so RoomBar shows no share affordance.
    val context = LocalContext.current
    val shareLink = remember(inviteCode) { ShareInvite.url(AppConfig.inviteHost(), inviteCode) }
    val onShare: (() -> Unit)? = shareLink?.let { link ->
        {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, link)
            }
            context.startActivity(Intent.createChooser(send, null))
        }
    }
    DisposableEffect(puzzle) {
        val job = scope.launch {
            if (wsUrl != null) {
                SessionDriver(
                    store = store,
                    makeTransport = {
                        WebSocketTransport(
                            url = wsUrl,
                            tokenProvider = { session.bearerToken() },
                            resumeFromSeq = store.render.value.seq.takeIf { it > 0 },
                        )
                    },
                ).run()
            } else {
                val transport = factory.create(puzzle, selfUserId, demo)
                transport.connect()
                store.run(transport)
            }
        }
        onDispose { job.cancel() }
    }
    RoomScreen(store = store, puzzle = puzzle, roomName = roomName, onExit = onExit, onShare = onShare)
}
