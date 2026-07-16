// The app shell and navigation (ARCHITECTURE.md §1: the CRUD shell as plain per-screen state).
// A tiny hand-rolled nav (no nav library earns its weight yet, mirroring the repo's "no
// orchestrator until it hurts"): one screen enum, one when. Each host owns its screen's data
// fetch and intents, calling the composition root's AppSession; the :ui screens stay pure
// functions of that state. A live room runs a GameStore under :session's SessionDriver; the demo
// room runs the scripted transport (RoomTransport.kt), no server.

package crossy.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import crossy.api.AuthProvider
import crossy.api.CrossyApiError
import crossy.protocol.ClientPuzzle
import crossy.protocol.CreateGameRequest
import crossy.protocol.GameSummary
import crossy.protocol.GameView
import crossy.protocol.MeResponse
import crossy.protocol.PuzzleSummary
import crossy.session.SessionDriver
import crossy.session.WebSocketTransport
import crossy.store.GameStore
import crossy.ui.CreateGameScreen
import crossy.ui.CrossyTheme
import crossy.ui.DisplayNameOnboardingModel
import crossy.ui.DisplayNameOnboardingScreen
import crossy.ui.DisplayNameOutcome
import crossy.ui.EmailOtpStep
import crossy.ui.GridGround
import crossy.ui.JoinCodeScreen
import crossy.ui.JoinScanState
import crossy.ui.ReactionSetEditorModel
import crossy.ui.ReactionSetOutcome
import crossy.ui.RoomScreen
import crossy.ui.RoomsListScreen
import crossy.ui.SettingsScreen
import crossy.ui.ShareInvite
import crossy.ui.ShareSheet
import crossy.ui.SignInProvider
import crossy.ui.SignInScreen
import crossy.ui.displayNameErrorCopy
import crossy.ui.ReactionPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

private sealed interface Screen {
    data object SignIn : Screen
    // The signed-in gate: load GET /me, then route to onboarding (needsName) or Rooms. Onboarding
    // fires here, before any game exists (docs/design/name-onboarding §7), so the client holds no
    // naming policy: the server-computed needsName decides.
    data object Arrival : Screen
    data class Onboarding(val prefill: String) : Screen
    data object Rooms : Screen
    data object Settings : Screen
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
fun CrossyApp(session: AppSession, factory: RoomTransportFactory, redirects: OAuthRedirects) {
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO
    var screen by remember { mutableStateOf<Screen>(Screen.SignIn) }
    val scope = rememberCoroutineScope()
    // The caller's personal reaction set (Wave 8.5; D25), held at the shell root so it survives across
    // screens: seeded from GET /me at arrival (null = the default five), updated when Settings saves,
    // and threaded to the room's send fan. Held here rather than in the room so a Settings edit is
    // reflected the NEXT time a room is entered (live mid-room propagation is not required).
    var reactionSet by remember { mutableStateOf<List<String>?>(null) }

    CrossyShell(ground) {
        when (val s = screen) {
            Screen.SignIn -> SignInHost(session, redirects, onSignedIn = { screen = Screen.Arrival })

            // The needsName gate between sign-in and Rooms: the server decides, the client routes. The
            // /me read also seeds the personal reaction set (null = the defaults) so the fan wears it.
            Screen.Arrival -> ArrivalHost(
                session = session,
                onNeedsName = { me ->
                    reactionSet = me.reactionSet
                    screen = Screen.Onboarding(prefill = me.displayName.orEmpty())
                },
                onReady = { me ->
                    reactionSet = me.reactionSet
                    screen = Screen.Rooms
                },
            )

            is Screen.Onboarding -> OnboardingHost(
                session = session,
                prefill = s.prefill,
                // Required, but never a dead end: once a name lands, enter Rooms.
                onDone = { screen = Screen.Rooms },
            )

            Screen.Rooms -> RoomsHost(
                session = session,
                ground = ground,
                onOpenGame = { view -> screen = Screen.Room(view.puzzle, view.name, demo = false, wsUrl = view.session.ws, inviteCode = view.inviteCode) },
                onJoin = { screen = Screen.Join },
                onCreate = { screen = Screen.Create },
                onOpenDemo = { screen = Screen.Room(RoomScripts.demoPuzzle, "Demo room", demo = true) },
                onOpenSettings = { screen = Screen.Settings },
            )

            Screen.Settings -> SettingsHost(
                session = session,
                onBack = { screen = Screen.Rooms },
                onSignOut = {
                    scope.launch { runCatching { session.auth.signOut() } }
                    session.clearSession()
                    screen = Screen.SignIn
                },
                // A saved reaction set (null = the defaults) updates the shell root, so the next room
                // entry's fan wears it (live mid-room propagation is not required).
                onReactionSetChanged = { reactionSet = it },
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
                // The personal five (null -> the protocol defaults): read at room entry.
                reactionEmojis = reactionSet ?: ReactionPolicy.defaultSet,
                onExit = { screen = Screen.Rooms },
            )
        }
    }
}

/** CrossyTheme plus the edge-to-edge shell (targetSdk 36 enforces edge-to-edge): the ground paints
 *  the whole window, behind the system bars, while content lays out inside the safe drawing area.
 *  The insets are consumed here once, so nested Scaffolds see nothing left to pad and no screen
 *  can bleed into the status bar. */
@Composable
private fun CrossyShell(ground: GridGround, content: @Composable () -> Unit) {
    CrossyTheme(ground) {
        Box(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            content()
        }
    }
}

/** The provider buttons' :ui vocabulary mapped to :api's wire enum, one-to-one (:ui cannot import
 *  :api, so the screen speaks SignInProvider and the host translates). */
private fun SignInProvider.asAuthProvider(): AuthProvider = when (this) {
    SignInProvider.APPLE -> AuthProvider.APPLE
    SignInProvider.DISCORD -> AuthProvider.DISCORD
    SignInProvider.HISBAAN -> AuthProvider.HISBAAN
}

@Composable
private fun SignInHost(session: AppSession, redirects: OAuthRedirects, onSignedIn: () -> Unit) {
    // Which provider's browser trip is out (the tapped button's busy state), and the shared inline
    // error. The OTP sub-flow's step and its own busy live here too (the host owns the network);
    // the screen is a pure function of them.
    var busyProvider by remember { mutableStateOf<SignInProvider?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var otpStep by remember { mutableStateOf<EmailOtpStep>(EmailOtpStep.Closed) }
    var otpBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // The deep-link return, consumed exactly once per intent: complete the exchange, then proceed
    // exactly as the email verify does. A provider refusal (typed InvalidCallback), network
    // weather, and a stray callback with no pending begin (false: the process died under the tab,
    // taking the in-memory verifier) all land the same calm retry sentence, never a crash.
    //
    // One stable effect collecting the holder, never an effect keyed on the redirect value:
    // consume() nulls the observed state, and a keyed effect would restart on that change and
    // cancel its own in-flight exchange (the bug this shape replaced).
    LaunchedEffect(redirects) {
        snapshotFlow { redirects.latest }.filterNotNull().collect { redirect ->
            redirects.consume(redirect)
            error = null
            // The failure reason is logged by type, never the URI: the callback query carries the
            // single-use auth code. Same policy as the Turnstile minter's token-length-only logs.
            val result = runCatching { session.completeOAuth(redirect.uri) }
            result.exceptionOrNull()?.let { e ->
                if (e is CancellationException) throw e
                android.util.Log.w("CrossyAuth", "OAuth completion failed: $e")
            }
            if (result.getOrNull() == false) {
                android.util.Log.w("CrossyAuth", "OAuth completion returned false (stray callback or machine refused)")
            }
            busyProvider = null
            if (result.getOrDefault(false)) onSignedIn() else error = "Sign-in didn't finish. Try again."
        }
    }

    // Coming back to the foreground with no redirect in hand means the person left the browser
    // without completing: clear the tapped button's busy state. Begin was effect-free, so the
    // abandoned attempt needs no undo and a re-tap simply supersedes it. When a redirect DID
    // arrive, onNewIntent delivered it before this resume fired, so the busy state rides through
    // the exchange instead of flickering off.
    LifecycleResumeEffect(Unit) {
        if (redirects.latest == null) busyProvider = null
        onPauseOrDispose { }
    }

    SignInScreen(
        busyProvider = busyProvider,
        error = error,
        onProvider = { provider ->
            // Begin is effect-free (fresh verifier, no phase change), so a re-tap after an
            // abandoned trip is safe and just supersedes the stale attempt.
            error = null
            busyProvider = provider
            val url = session.beginOAuth(provider.asAuthProvider())
            if (!AuthBrowser.open(context, url)) {
                busyProvider = null
                error = "Couldn't open a browser to sign in. Try again."
            }
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
    onOpenSettings: () -> Unit,
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
        onOpenSettings = onOpenSettings,
    )
}

/** The signed-in gate: load GET /me and route on the server-computed needsName (onboarding before
 *  any game exists, docs/design/name-onboarding §7). A load failure is never a dead end and never a
 *  sign-out (INV-11): it shows a retry, so a transient /me hiccup cannot brick entry. */
@Composable
private fun ArrivalHost(
    session: AppSession,
    onNeedsName: (MeResponse) -> Unit,
    onReady: (MeResponse) -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    LaunchedEffect(reloadKey) {
        error = null
        runCatching { session.api.me() }
            .onSuccess { me -> if (me.needsName) onNeedsName(me) else onReady(me) }
            .onFailure { error = it.message ?: it::class.simpleName }
    }
    Scaffold { inner ->
        Column(
            modifier = Modifier.fillMaxSize().padding(inner).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            val message = error
            if (message == null) {
                CircularProgressIndicator()
            } else {
                Text("Couldn't load your profile.", fontSize = 15.sp)
                Text(
                    message,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
                )
                Button(onClick = { reloadKey += 1 }) { Text("Try again") }
            }
        }
    }
}

/** The onboarding gate host: owns the DisplayNameOnboardingModel and the /me write behind it. The
 *  screen is a pure function of the model's state; the resilient submit loop (R4) lives in the
 *  model, so this host only wires the model to the screen and reports the saved name upward. */
@Composable
private fun OnboardingHost(session: AppSession, prefill: String, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    val model = remember {
        DisplayNameOnboardingModel(
            prefill = prefill,
            submit = { name -> submitDisplayName(session, name) },
            onSaved = { _ -> onDone() },
        )
    }
    DisplayNameOnboardingScreen(
        draft = model.draft,
        onDraftChange = { model.draft = it },
        canSubmit = model.canSubmit,
        isSaving = model.isSaving,
        errorMessage = if (model.hasError) displayNameErrorCopy(model.errorCode) else null,
        onSubmit = { scope.launch { model.submitDraft() } },
    )
}

/** The Settings host: load GET /me, then render the account row and the nickname editor over the
 *  loaded identity. The editor reuses the same DisplayNameOnboardingModel as onboarding (one write
 *  path), so a nickname edit is the same resilient submit. */
@Composable
private fun SettingsHost(
    session: AppSession,
    onBack: () -> Unit,
    onSignOut: () -> Unit,
    onReactionSetChanged: (List<String>?) -> Unit,
) {
    var me by remember { mutableStateOf<MeResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    LaunchedEffect(reloadKey) {
        error = null
        runCatching { session.api.me() }.onSuccess { me = it }.onFailure { error = it.message ?: it::class.simpleName }
    }
    val loaded = me
    if (loaded == null) {
        Scaffold { inner ->
            Column(
                modifier = Modifier.fillMaxSize().padding(inner).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                val message = error
                if (message == null) {
                    CircularProgressIndicator()
                } else {
                    Text("Couldn't load Settings.", fontSize = 15.sp)
                    Button(onClick = { reloadKey += 1 }, modifier = Modifier.padding(top = 12.dp)) { Text("Try again") }
                    Button(onClick = onBack, modifier = Modifier.padding(top = 8.dp)) { Text("Back") }
                }
            }
        }
        return
    }
    SettingsContent(session, loaded, onBack, onSignOut, onReactionSetChanged)
}

@Composable
private fun SettingsContent(
    session: AppSession,
    me: MeResponse,
    onBack: () -> Unit,
    onSignOut: () -> Unit,
    onReactionSetChanged: (List<String>?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var shownName by remember { mutableStateOf(me.displayName) }
    var saved by remember { mutableStateOf(false) }
    val model = remember {
        DisplayNameOnboardingModel(
            prefill = me.displayName.orEmpty(),
            submit = { name -> submitDisplayName(session, name) },
            onSaved = { canonical ->
                shownName = canonical
                saved = true
            },
        )
    }
    // The reaction set editor: seeded from /me's reactionSet (null = the defaults), one write path
    // behind updateReactionSet, and a saved canonical set reported up so the room's fan follows.
    val reactions = remember {
        ReactionSetEditorModel(
            initialPersonal = me.reactionSet,
            save = { set -> submitReactionSet(session, set) },
            onSaved = onReactionSetChanged,
        )
    }
    SettingsScreen(
        userId = me.userId,
        isAnonymous = me.isAnonymous,
        currentName = shownName,
        nickname = model.draft,
        onNicknameChange = {
            saved = false
            model.draft = it
        },
        canSave = model.canSubmit,
        isSaving = model.isSaving,
        error = if (model.hasError) displayNameErrorCopy(model.errorCode) else null,
        saved = saved,
        onSave = { scope.launch { model.submitDraft() } },
        onSignOut = onSignOut,
        onBack = onBack,
        reactions = reactions,
    )
}

/** Map one `PATCH /me {reactionSet}` round trip into the ReactionSetOutcome the editor model acts on
 *  (the submitDisplayName twin). A REACTION_SET_* rejection keeps the draft for a correction; a 429
 *  carries its Retry-After; every other failure (transport, 5xx, even a post-refresh 401) is retryable
 *  within the model's bound and never signs the person out (INV-11). The server's canonical set is what
 *  the client adopts (a null reactionSet in the response = the defaults). */
private suspend fun submitReactionSet(session: AppSession, set: List<String>?): ReactionSetOutcome =
    try {
        val me = session.api.updateReactionSet(set)
        ReactionSetOutcome.Saved(me.reactionSet)
    } catch (e: CrossyApiError.RateLimited) {
        ReactionSetOutcome.RateLimited(e.retryAfterSeconds)
    } catch (e: CrossyApiError) {
        val code = e.apiCodeString
        if (code != null && code.startsWith("REACTION_SET_")) ReactionSetOutcome.Rejected(code)
        else ReactionSetOutcome.Retryable(code)
    }

/** Map one `PATCH /me` round trip into the DisplayNameOutcome the onboarding model acts on. A
 *  NAME_* rejection keeps the field for a correction; a 429 carries its Retry-After; every other
 *  failure (transport, 5xx, even a post-refresh 401) is retryable within the model's bound and
 *  never signs the person out (INV-11). The server's canonical value is what the client adopts. */
private suspend fun submitDisplayName(session: AppSession, name: String): DisplayNameOutcome =
    try {
        val me = session.api.updateDisplayName(name)
        DisplayNameOutcome.Saved(me.displayName ?: name)
    } catch (e: CrossyApiError.RateLimited) {
        DisplayNameOutcome.RateLimited(e.retryAfterSeconds)
    } catch (e: CrossyApiError) {
        val code = e.apiCodeString
        if (code != null && code.startsWith("NAME_")) DisplayNameOutcome.NameRejected(code)
        else DisplayNameOutcome.Retryable(code)
    }

@Composable
private fun JoinHost(session: AppSession, onBack: () -> Unit, onJoined: (GameView) -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // Camera-first (iOS JoinCodeScreen): the app target resolves the scan verdict and fills the
    // scanner slot with the CameraX preview (JoinCameraScan, AAD-2 — camera plumbing is not :ui's).
    // The screen renders the viewport and keeps the typed field standing beneath it; a scanned QR
    // takes the very same onJoin path as a typed code.
    val scanState = rememberJoinScanState()
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
        scanState = scanState,
        scanner = { ingest -> CameraScanView(onScan = ingest, modifier = Modifier.fillMaxSize()) },
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
    reactionEmojis: List<String>,
    onExit: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val store = remember(puzzle) { GameStore() }
    // The share surface: the pure ShareInvite builds the canonical short link from the configured
    // host (AppConfig.INVITE_HOST); tapping the chip opens the share sheet (iOS ShareMenu shape:
    // copy-link, system-share, show-QR over that link). The sheet and its QR are pure :ui
    // (ShareSheet), but the composition root presents them and owns the two platform acts the rows
    // report — the system share sheet and the clipboard (AD-2, the iOS split). A null shareLink means
    // no code (the demo room), so RoomBar shows no share affordance and the sheet never opens.
    val context = LocalContext.current
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO
    val shareLink = remember(inviteCode) { ShareInvite.url(AppConfig.inviteHost(), inviteCode) }
    var shareOpen by remember(puzzle) { mutableStateOf(false) }
    val onShare: (() -> Unit)? = shareLink?.let { { shareOpen = true } }
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
    RoomScreen(
        store = store,
        puzzle = puzzle,
        roomName = roomName,
        onExit = onExit,
        onShare = onShare,
        reactionEmojis = reactionEmojis,
    )
    // The share sheet the chip opens: pure :ui over the link (ShareSheet), presented here so it can
    // close over the two platform acts its rows report — the system share sheet and the clipboard
    // (the app target owns both, AD-2). Guarded on the link and the code, so it exists only when
    // there is something to share.
    val link = shareLink
    if (shareOpen && link != null && inviteCode != null) {
        ShareSheet(
            ground = ground,
            code = inviteCode,
            url = link,
            onSystemShare = {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, link)
                }
                context.startActivity(Intent.createChooser(send, null))
            },
            onCopyLink = {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Crossy invite", link))
            },
            onDismiss = { shareOpen = false },
        )
    }
}
