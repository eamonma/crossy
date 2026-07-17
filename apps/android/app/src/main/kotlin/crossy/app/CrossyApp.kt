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
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import crossy.api.AuthProvider
import crossy.api.CrossyApiError
import crossy.protocol.AnalysisView
import crossy.protocol.ClientPuzzle
import crossy.protocol.CreateGameRequest
import crossy.protocol.GameSummary
import crossy.protocol.GameView
import crossy.protocol.MeResponse
import crossy.protocol.Participant
import crossy.protocol.PuzzleSummary
import crossy.protocol.Role
import crossy.session.SessionDriver
import crossy.session.WebSocketTransport
import crossy.store.GameStore
import crossy.ui.ArrivalCopy
import crossy.ui.ArrivalFailure
import crossy.ui.CreateGameScreen
import crossy.ui.CrossyTheme
import crossy.ui.DeleteAccountResult
import crossy.ui.DisplayNameOnboardingModel
import crossy.ui.DisplayNameOnboardingScreen
import crossy.ui.DisplayNameOutcome
import crossy.ui.EmailOtpStep
import crossy.ui.GridGround
import crossy.ui.JoinCodeScreen
import crossy.ui.JoinScanState
import crossy.ui.KickedExit
import crossy.ui.LegalPage
import crossy.ui.ReactionSetEditorModel
import crossy.ui.ReactionSetOutcome
import crossy.ui.PuzzlesScreen
import crossy.ui.RoomAnalysis
import crossy.ui.RoomBeat
import crossy.ui.RoomMomentum
import crossy.ui.RoomScreen
import crossy.ui.RoomTurningPoint
import crossy.ui.RosterAvatars
import crossy.ui.rememberSolveHapticPlayer
import crossy.ui.RoomsListScreen
import crossy.ui.SettingsScreen
import crossy.ui.orderedByActivity
import crossy.ui.ShareInvite
import crossy.ui.ShareSheet
import crossy.ui.SignInProvider
import crossy.ui.SignInScreen
import crossy.ui.SolvingPrefs
import crossy.ui.displayNameErrorCopy
import crossy.ui.ReactionPolicy
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

private sealed interface Screen {
    data object SignIn : Screen
    // The signed-in gate: load GET /me, then route to onboarding (needsName) or the shell. Onboarding
    // fires here, before any game exists (docs/design/name-onboarding §7), so the client holds no
    // naming policy: the server-computed needsName decides.
    data object Arrival : Screen
    data class Onboarding(val prefill: String) : Screen
    // The signed-in home: the three-tab shell (Rooms / Puzzles / Settings). The selected tab lives in
    // CrossyApp so it survives a room round trip; this is the marker that renders the shell.
    data object Shell : Screen
    // prefill carries an invite deep link's code (empty for a hand-tapped Join): the field opens
    // with it so the join is one tap away (iOS honorPendingInvite's deepLinkPrefill).
    data class Join(val prefill: String = "") : Screen
    data object Create : Screen
    // wsUrl null = no live socket (the demo room): the room runs on the scripted transport.
    // inviteCode null = nothing to share (the demo room carries no code). The room presents
    // full-screen OVER the tab shell (iOS pushes it into the tab's stack and hides the tab bar; the
    // shell is a distinct screen here, so the tabs are simply not composed while a room is live).
    data class Room(
        val puzzle: ClientPuzzle,
        val name: String?,
        val demo: Boolean,
        // The game's REST id, the §12 operations' key (abandon, kick, role change). Null for the demo
        // room, which supports none of them (their affordances no-op or hide there).
        val gameId: String? = null,
        val wsUrl: String? = null,
        val inviteCode: String? = null,
        // The REST game view's roster (the seeded-birth rule, DESIGN.md §4, §12): the room's members
        // recorded at open time so the store seeds the players pill true from the first frame, before
        // the socket's welcome lands. Empty for the demo room (no REST view) and for a code-join with
        // no view yet; the welcome remains the authority and overwrites it (GameStore.seedRoster).
        val roster: List<Participant> = emptyList(),
        // The tapped card's terminal facts (the seeded-birth rule, DESIGN.md §4, §12; mirrors iOS
        // RoomArrivalSeed): a solved card carries completedAt, a host-ended card carries abandonedAt,
        // both mutually exclusive. The store seeds the terminal status from them at birth so a done
        // room retires its key deck from the first frame. Null for a code-join, a freshly started
        // game, and the demo room (no card); the welcome remains the authority.
        val completedAt: String? = null,
        val abandonedAt: String? = null,
    ) : Screen
}

/** The signed-in shell's three places (iOS ShellTab), named by their tabs. Held in CrossyApp so a
 *  room round trip returns to the tab it was opened from. */
private enum class ShellTab { ROOMS, PUZZLES, SETTINGS }

/** The REST game view's membership as a seed roster (mirrors iOS RoomMapping.roster): each member is
 *  the roster, not presence, so it seeds not-yet-heard-from (`connected = false`) with no display name
 *  or wire color (the view carries neither); the players pill falls back to the identity-hash color,
 *  the same fallback RoomBar already uses. The welcome overwrites all of it when it lands. */
private fun GameView.seedRoster(): List<Participant> =
    members.map {
        Participant(
            userId = it.userId,
            displayName = "",
            color = "",
            role = it.role,
            connected = false,
            avatarUrl = it.avatarUrl,
        )
    }

/** Map the post-game analysis view to the room's render shape (owner ruling 2026-07-13; mirrors iOS
 *  RoomMapping.analysis). The wire `owners` map is string-keyed (JSON object keys); `ownersByCell`
 *  parses them to cell indices. INV-6 rides through untouched: AnalysisView carries userIds, cells, and
 *  numbers only, and RoomAnalysis holds nothing solution-shaped either. The composition root owns this
 *  wire->render translation (AAD-2), keeping :ui out of the REST ring. */
internal fun analysisFromView(view: AnalysisView): RoomAnalysis =
    RoomAnalysis(
        owners = view.ownersByCell,
        momentum = RoomMomentum(
            durationSeconds = view.momentum.durationSeconds,
            samples = view.momentum.samples,
        ),
        firstToFall = view.moments.firstToFall?.let { RoomBeat(it.cell, it.userId, it.atSeconds) },
        lastSquare = view.moments.lastSquare?.let { RoomBeat(it.cell, it.userId, it.atSeconds) },
        turningPoint = view.moments.turningPoint?.let {
            RoomTurningPoint(it.stallSeconds, it.breakSeconds, it.burst)
        },
    )

@Composable
fun CrossyApp(
    session: AppSession,
    factory: RoomTransportFactory,
    redirects: OAuthRedirects,
    pendingLinks: PendingLinks = PendingLinks(),
) {
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO
    // A cold start with a restored session (MainActivity called session.restore()) skips SignIn and
    // opens at the Arrival gate, which loads /me and routes on to Rooms; a signed-out start begins at
    // SignIn as before. Read once at composition, the initial route only: sign-out flips back to
    // SignIn by setting the screen explicitly.
    var screen by remember {
        mutableStateOf<Screen>(if (session.isSignedIn) Screen.Arrival else Screen.SignIn)
    }
    // The selected shell tab, held here (not inside the shell) so a room round trip returns to the
    // tab it was opened from: opening a room sets screen = Room (the shell leaves composition), and
    // the exit sets screen = Shell with this tab still standing (iOS's per-tab return). Reset to
    // Rooms on sign-out, so the next sign-in lands home.
    var tab by remember { mutableStateOf(ShellTab.ROOMS) }
    val scope = rememberCoroutineScope()
    // The caller's personal reaction set (Wave 8.5; D25), held at the shell root so it survives across
    // screens: seeded from GET /me at arrival (null = the default five), updated when Settings saves,
    // and threaded to the room's send fan. Held here rather than in the room so a Settings edit is
    // reflected the NEXT time a room is entered (live mid-room propagation is not required).
    var reactionSet by remember { mutableStateOf<List<String>?>(null) }

    // --- Deep-link honoring (parity-deeplinks): three self-contained blocks that consume the
    // PendingLinks slots MainActivity's router fills. Kept narrow and top-level so the tab-shell
    // restructuring landing this wave can reconcile them; nothing here reaches into a screen.

    // The magic link (roadmap I3b): complete it against the session, then route on the phase exactly
    // as a sign-in does (SignInHost.onSignedIn -> Arrival). One stable effect collecting the slot,
    // never keyed on the value: consume() nulls the observed state, and a keyed effect would restart
    // and cancel its own in-flight verify (the OAuthRedirects shape). Never logs the token (type-only
    // logging, the standing policy). A failed or expired link is swallowed: SignIn already shows its
    // plain retry for that phase, so a second surface would only double the message (iOS
    // completePendingMagicLink).
    LaunchedEffect(pendingLinks) {
        snapshotFlow { pendingLinks.magicLink }.filterNotNull().collect { link ->
            pendingLinks.consumeMagicLink(link)
            val ok = runCatching { session.completeMagicLink(link.tokenHash, link.type) }
                .getOrDefault(false)
            if (ok) screen = Screen.Arrival
        }
    }

    // The invite (iOS honorPendingInvite): held until signed-in AND arrived (the Shell is the
    // arrived home), then it opens the Join flow prefilled so the code is one tap from joining.
    // Gating on the Shell keeps it from disrupting an active room, a create flow, or the
    // sign-in/onboarding gates; it waits and honors the moment home is reached.
    LaunchedEffect(pendingLinks) {
        snapshotFlow { pendingLinks.invite to (screen == Screen.Shell) }.collect { (invite, atHome) ->
            if (invite != null && atHome) {
                pendingLinks.consumeInvite(invite)
                screen = Screen.Join(prefill = invite.code)
            }
        }
    }

    // The play hand-off (crossy://play/<puzzleId>): the seam is deliberately unwired. MainActivity
    // holds it in pendingLinks.play; the Puzzles tab consumes it (pendingLinks.play / consumePlay)
    // and scrolls to that card; the wiring rides the Puzzles-tab polish pass.

    // Build a Room screen from a REST game view plus the tapped card's terminal facts (null for a
    // code-join, a freshly started game, or the demo room): the one place the room-open payload is
    // assembled, so every path (a room card, a join, a puzzle start) births the store the same way.
    fun openRoom(view: GameView, completedAt: String?, abandonedAt: String?) {
        screen = Screen.Room(
            puzzle = view.puzzle,
            name = view.name,
            demo = false,
            gameId = view.gameId,
            wsUrl = view.session.ws,
            inviteCode = view.inviteCode,
            roster = view.seedRoster(),
            completedAt = completedAt,
            abandonedAt = abandonedAt,
        )
    }

    CrossyShell(ground) {
        // Restrained screen transitions (iOS's zoom spirit without faking it): a short fade paired
        // with a slight scale, so a room grows in over the shell and pours back on exit. Gates and
        // tab switches ride the same easing.
        AnimatedContent(
            targetState = screen,
            transitionSpec = {
                (fadeIn(tween(220)) + scaleIn(tween(220), initialScale = 0.96f)) togetherWith
                    (fadeOut(tween(160)) + scaleOut(tween(160), targetScale = 0.98f))
            },
            label = "screen",
        ) { s ->
            when (s) {
                Screen.SignIn -> SignInHost(session, redirects, onSignedIn = { screen = Screen.Arrival })

                // The needsName gate between sign-in and the shell: the server decides, the client
                // routes. The /me read also seeds the personal reaction set (null = the defaults).
                Screen.Arrival -> ArrivalHost(
                    session = session,
                    onNeedsName = { me ->
                        reactionSet = me.reactionSet
                        screen = Screen.Onboarding(prefill = me.displayName.orEmpty())
                    },
                    onReady = { me ->
                        reactionSet = me.reactionSet
                        screen = Screen.Shell
                    },
                )

                is Screen.Onboarding -> OnboardingHost(
                    session = session,
                    prefill = s.prefill,
                    // Required, but never a dead end: once a name lands, enter the shell.
                    onDone = { screen = Screen.Shell },
                )

                Screen.Shell -> SignedInShell(
                    session = session,
                    ground = ground,
                    tab = tab,
                    onTabChange = { tab = it },
                    onOpenGame = ::openRoom,
                    onJoin = { screen = Screen.Join() },
                    onCreate = { screen = Screen.Create },
                    onOpenDemo = { screen = Screen.Room(RoomScripts.demoPuzzle, "Demo room", demo = true) },
                    onSignOut = {
                        scope.launch { runCatching { session.auth.signOut() } }
                        session.clearSession()
                        tab = ShellTab.ROOMS
                        screen = Screen.SignIn
                    },
                    onDeleted = {
                        tab = ShellTab.ROOMS
                        screen = Screen.SignIn
                    },
                    // A saved reaction set (null = the defaults) updates the shell root, so the next
                    // room entry's fan wears it (live mid-room propagation is not required).
                    onReactionSetChanged = { reactionSet = it },
                )

                is Screen.Join -> JoinHost(
                    session = session,
                    prefill = s.prefill,
                    onBack = { screen = Screen.Shell },
                    // A code-join has no card, so no terminal seed (iOS passes nil).
                    onJoined = { view -> openRoom(view, completedAt = null, abandonedAt = null) },
                )

                Screen.Create -> CreateHost(
                    session = session,
                    onBack = { screen = Screen.Shell },
                    // A freshly created game is ongoing, so no terminal seed.
                    onCreated = { view -> openRoom(view, completedAt = null, abandonedAt = null) },
                )

                is Screen.Room -> RoomHost(
                    session = session,
                    factory = factory,
                    puzzle = s.puzzle,
                    roomName = s.name,
                    selfUserId = session.selfUserId ?: "you",
                    demo = s.demo,
                    gameId = s.gameId,
                    wsUrl = s.wsUrl,
                    inviteCode = s.inviteCode,
                    // The seeded-birth roster from the REST view (empty for the demo room).
                    roster = s.roster,
                    // The tapped card's terminal facts, seeded into the store at birth (null for a
                    // join / start / demo).
                    completedAt = s.completedAt,
                    abandonedAt = s.abandonedAt,
                    // The personal five (null -> the protocol defaults): read at room entry.
                    reactionEmojis = reactionSet ?: ReactionPolicy.defaultSet,
                    onExit = { screen = Screen.Shell },
                )
            }
        }
    }
}

/** The signed-in shell (iOS ArrivalRootView.signedInShell): the three stable places carried by a
 *  Material3 NavigationBar (Android's TabView idiom), each a full screen swapped under a subtle fade.
 *  A room is NOT one of these places: it presents full-screen over the shell (the caller sets
 *  screen = Room), so the tab bar is simply not composed while a room is live (the full-bleed ruling,
 *  matched in spirit). Rooms and Puzzles each open a room and return here with the tab still standing;
 *  Settings is a single page. */
@Composable
private fun SignedInShell(
    session: AppSession,
    ground: GridGround,
    tab: ShellTab,
    onTabChange: (ShellTab) -> Unit,
    onOpenGame: (GameView, String?, String?) -> Unit,
    onJoin: () -> Unit,
    onCreate: () -> Unit,
    onOpenDemo: () -> Unit,
    onSignOut: () -> Unit,
    // Account deletion lands back at sign-in (the server tombstoned the account; the local purge
    // already ran inside the host's delete closure).
    onDeleted: () -> Unit,
    onReactionSetChanged: (List<String>?) -> Unit,
) {
    Scaffold(
        bottomBar = {
            NavigationBar {
                ShellTabItem(tab, ShellTab.ROOMS, "Rooms", onTabChange) {
                    Icon(Icons.Filled.Home, contentDescription = null)
                }
                ShellTabItem(tab, ShellTab.PUZZLES, "Puzzles", onTabChange) {
                    PuzzlesTabGlyph()
                }
                ShellTabItem(tab, ShellTab.SETTINGS, "Settings", onTabChange) {
                    Icon(Icons.Filled.Settings, contentDescription = null)
                }
            }
        },
    ) { inner ->
        // A quiet crossfade between tabs (chrome, not choreography): the tab bar holds still while the
        // page under it swaps, so switching tabs never reads as a full-screen shove.
        AnimatedContent(
            targetState = tab,
            transitionSpec = { fadeIn(tween(160)) togetherWith fadeOut(tween(120)) },
            modifier = Modifier.padding(inner),
            label = "tab",
        ) { selected ->
            when (selected) {
                ShellTab.ROOMS -> RoomsHost(
                    session = session,
                    ground = ground,
                    onOpenGame = onOpenGame,
                    onJoin = onJoin,
                    onCreate = onCreate,
                    onOpenDemo = onOpenDemo,
                )
                ShellTab.PUZZLES -> PuzzlesHost(
                    session = session,
                    ground = ground,
                    // A puzzle start creates an ongoing game, so no terminal seed.
                    onStarted = { view -> onOpenGame(view, null, null) },
                    onCreate = onCreate,
                )
                ShellTab.SETTINGS -> SettingsHost(
                    session = session,
                    // In a tab, "back" is a return to the home tab rather than a pop (SettingsScreen
                    // keeps its back affordance; the shell relocates where it lands).
                    onBack = { onTabChange(ShellTab.ROOMS) },
                    onSignOut = onSignOut,
                    onDeleted = onDeleted,
                    onReactionSetChanged = onReactionSetChanged,
                )
            }
        }
    }
}

/** One NavigationBar destination, achromatic (people and the destructive tone are the only color,
 *  DESIGN.md §1): the selected tab wears ink, the rest the quiet variant ink, the pill a subtle
 *  surface tint rather than the system's primary wash. */
@Composable
private fun androidx.compose.foundation.layout.RowScope.ShellTabItem(
    current: ShellTab,
    value: ShellTab,
    label: String,
    onSelect: (ShellTab) -> Unit,
    icon: @Composable () -> Unit,
) {
    NavigationBarItem(
        selected = current == value,
        onClick = { onSelect(value) },
        icon = icon,
        label = { Text(label) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = MaterialTheme.colorScheme.onSurface,
            selectedTextColor = MaterialTheme.colorScheme.onSurface,
            indicatorColor = MaterialTheme.colorScheme.surfaceVariant,
            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
    )
}

/** The Puzzles tab glyph: a 3x3 crossword lattice (iOS "squareshape.split.3x3"). The icon set carries
 *  no grid, so the app draws its own motif rather than borrow an unrelated glyph; tinted by the item's
 *  content color so it darkens with selection exactly as the Material icons beside it do. */
@Composable
private fun PuzzlesTabGlyph() {
    val tint = androidx.compose.material3.LocalContentColor.current
    Canvas(Modifier.size(24.dp)) {
        val inset = size.minDimension * 0.16f
        val side = size.minDimension - inset * 2
        val step = side / 3f
        val stroke = Stroke(width = size.minDimension * 0.08f)
        // The outer square, then the two interior lines each way: a clean 3x3.
        drawRect(color = tint, topLeft = Offset(inset, inset), size = Size(side, side), style = stroke)
        for (i in 1..2) {
            drawLine(tint, Offset(inset + step * i, inset), Offset(inset + step * i, inset + side), strokeWidth = stroke.width)
            drawLine(tint, Offset(inset, inset + step * i), Offset(inset + side, inset + step * i), strokeWidth = stroke.width)
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
            if (result.getOrDefault(false)) onSignedIn() else error = ArrivalCopy.signInFailed
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
                    EmailOtpStep.Email(ArrivalCopy.emailSendFailed)
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
                    otpStep = EmailOtpStep.Code(step.email, ArrivalCopy.codeVerifyFailed)
                }
            }
        },
        // The legal footer opens its live page in a Custom Tab (the AuthBrowser leg; App Review
        // 5.1.1: the person stays in the flow).
        onOpenLegal = { page -> AuthBrowser.open(context, legalUrl(page)) },
    )
}

/** The web origin the legal pages live under (iOS ArrivalConfig.defaultWebOrigin). Committed
 *  config-as-code: no BuildConfig field exists for it, and it is the same host in every backend. */
private const val WEB_ORIGIN = "https://crossy.party"

/** The live URL for a legal page (iOS ArrivalModel privacyURL/termsURL: the web origin plus the
 *  static path). */
private fun legalUrl(page: LegalPage): HttpUrl = when (page) {
    LegalPage.PRIVACY -> "$WEB_ORIGIN/privacy".toHttpUrl()
    LegalPage.TERMS -> "$WEB_ORIGIN/terms".toHttpUrl()
}

/** The provider line the identity card shows (iOS ArrivalModel.providerLabel), or null when no
 *  marker survived a restore, in which case the card shows its own neutral fallback. Internal so a
 *  test pins the mapping. */
internal fun providerLabel(provider: AuthProvider?): String? = when (provider) {
    AuthProvider.DISCORD -> "Discord"
    AuthProvider.APPLE -> "Apple"
    AuthProvider.HISBAAN -> "Hisbaan"
    AuthProvider.EMAIL_OTP -> "Email"
    null -> null
}

/** The quiet version footer ("0.1.0 (1)") from BuildConfig, iOS versionFooter's shape. */
private fun appVersionLabel(): String = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

/** The §12 code a REST failure carries, lifted into the [ArrivalFailure] the screens render as one
 *  coded sentence: the stable code string when the server spoke ([CrossyApiError.Api] /
 *  [CrossyApiError.RateLimited]), null for network weather (transport, a missing token, a broken
 *  frame) or any non-API throwable. The raw exception text never rides along; the sentence derives
 *  from the code alone, never from server prose. Internal so a host-mapping test pins
 *  CrossyApiError -> code -> sentence. */
internal fun Throwable.arrivalFailure(): ArrivalFailure =
    ArrivalFailure((this as? CrossyApiError)?.apiCodeString)

@Composable
private fun RoomsHost(
    session: AppSession,
    ground: GridGround,
    onOpenGame: (GameView, String?, String?) -> Unit,
    onJoin: () -> Unit,
    onCreate: () -> Unit,
    onOpenDemo: () -> Unit,
) {
    var games by remember { mutableStateOf<List<GameSummary>>(emptyList()) }
    // The cursor for the next page ([ApiPage.nextBefore]); null once exhausted. `exhausted` also flips
    // on an empty page (the §12 end of iteration).
    var nextBefore by remember { mutableStateOf<String?>(null) }
    var exhausted by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // The first page (or a refresh): replace the list. Order WITHIN the page by activity (the server
    // sends this order; the client sort is belt-and-suspenders, iOS reload), never across pages.
    suspend fun reload() {
        error = null
        runCatching { session.api.listGames() }
            .onSuccess { page ->
                games = orderedByActivity(page.rows)
                nextBefore = page.nextBefore
                exhausted = page.nextBefore == null
            }
            // The §12 code through ArrivalFailure, rendered as one coded sentence; the raw exception
            // stays out of the UI (INV: no server prose on screen).
            .onFailure { error = it.arrivalFailure().sentence }
    }

    LaunchedEffect(Unit) {
        loading = true
        reload()
        loading = false
    }

    RoomsListScreen(
        games = games,
        ground = ground,
        isLoading = loading,
        isRefreshing = refreshing,
        error = error,
        onOpen = { summary ->
            scope.launch {
                runCatching { session.api.game(summary.gameId) }
                    // The tapped card carries the room's terminal facts (§12): thread them into the
                    // store's birth so a done room retires its deck from the first frame (iOS seed).
                    .onSuccess { onOpenGame(it, summary.completedAt, summary.abandonedAt) }
                    .onFailure { error = it.arrivalFailure().sentence }
            }
        },
        onRefresh = { scope.launch { refreshing = true; reload(); refreshing = false } },
        onLoadMore = {
            val cursor = nextBefore
            if (!exhausted && !loadingMore && cursor != null) {
                scope.launch {
                    loadingMore = true
                    runCatching { session.api.listGames(before = cursor) }
                        .onSuccess { page ->
                            // Order the incoming page within itself, then append after the pages
                            // already shown (never a global re-sort, §12 pagination stability).
                            games = games + orderedByActivity(page.rows)
                            nextBefore = page.nextBefore
                            exhausted = page.rows.isEmpty() || page.nextBefore == null
                        }
                        // A failed load-more never blanks what is on screen; pull to refresh recovers.
                        .onFailure { exhausted = false }
                    loadingMore = false
                }
            }
        },
        onJoinByCode = onJoin,
        onCreate = onCreate,
        onOpenDemo = onOpenDemo,
    )
}

/** The Puzzles library tab host (iOS PuzzlesScreen's composition root): load GET /puzzles (refresh +
 *  paginate), and on a card's Start create a fresh game (POST /games, unnamed) and hand the created
 *  room's view up to be pushed the same way an opened room card is. One start at a time; a failure
 *  reads inline on the card, keyed by puzzleId. The named-create + id-paste screen stays reachable
 *  through [onCreate] (Android's deliberate extra). */
@Composable
private fun PuzzlesHost(
    session: AppSession,
    ground: GridGround,
    onStarted: (GameView) -> Unit,
    onCreate: () -> Unit,
) {
    var puzzles by remember { mutableStateOf<List<PuzzleSummary>>(emptyList()) }
    var nextBefore by remember { mutableStateOf<String?>(null) }
    var exhausted by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // The puzzleId whose POST /games is out (one start at a time), and the per-card inline failures.
    var startingId by remember { mutableStateOf<String?>(null) }
    var startFailures by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        error = null
        runCatching { session.api.listPuzzles() }
            .onSuccess { page ->
                puzzles = page.rows
                nextBefore = page.nextBefore
                exhausted = page.nextBefore == null
            }
            .onFailure { error = it.arrivalFailure().sentence }
    }

    LaunchedEffect(Unit) {
        loading = true
        reload()
        loading = false
    }

    PuzzlesScreen(
        puzzles = puzzles,
        ground = ground,
        isLoading = loading,
        isRefreshing = refreshing,
        error = error,
        startingId = startingId,
        startFailures = startFailures,
        onStart = { puzzle ->
            // A second tap while one start is out is a no-op (the button is disabled; this guards the
            // closure too, iOS PuzzlesScreen.start).
            if (startingId == null) {
                scope.launch {
                    startingId = puzzle.puzzleId
                    startFailures = startFailures - puzzle.puzzleId
                    runCatching {
                        val created = session.api.createGame(CreateGameRequest(puzzle.puzzleId, null))
                        session.api.game(created.gameId)
                    }
                        .onSuccess { onStarted(it) }
                        // The inline card sentence keys on the §12 code (null for network weather);
                        // the raw exception never reaches the card.
                        .onFailure {
                            val code = (it as? CrossyApiError)?.apiCodeString
                            startFailures = startFailures + (puzzle.puzzleId to ArrivalCopy.puzzleStartFailure(code))
                        }
                    startingId = null
                }
            }
        },
        onRefresh = { scope.launch { refreshing = true; reload(); refreshing = false } },
        onLoadMore = {
            val cursor = nextBefore
            if (!exhausted && !loadingMore && cursor != null) {
                scope.launch {
                    loadingMore = true
                    runCatching { session.api.listPuzzles(before = cursor) }
                        .onSuccess { page ->
                            puzzles = puzzles + page.rows
                            nextBefore = page.nextBefore
                            exhausted = page.rows.isEmpty() || page.nextBefore == null
                        }
                        .onFailure { exhausted = false }
                    loadingMore = false
                }
            }
        },
        onCreate = onCreate,
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
            .onFailure { error = it.arrivalFailure().sentence }
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
        // The live puck preview reads the person's real roster color from their id (iOS shows one in
        // the gate); the avatar is left to the Settings card, which has the /me url in hand.
        userId = session.selfUserId ?: "",
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
    onDeleted: () -> Unit,
    onReactionSetChanged: (List<String>?) -> Unit,
) {
    var me by remember { mutableStateOf<MeResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    LaunchedEffect(reloadKey) {
        error = null
        runCatching { session.api.me() }.onSuccess { me = it }.onFailure { error = it.arrivalFailure().sentence }
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
                    // The coded §12 sentence (the composition root mapped the code through
                    // ArrivalFailure); the raw exception never reaches the screen.
                    Text(
                        message,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    Button(onClick = { reloadKey += 1 }, modifier = Modifier.padding(top = 12.dp)) { Text("Try again") }
                    Button(onClick = onBack, modifier = Modifier.padding(top = 8.dp)) { Text("Back") }
                }
            }
        }
        return
    }
    SettingsContent(session, loaded, onBack, onSignOut, onDeleted, onReactionSetChanged)
}

@Composable
private fun SettingsContent(
    session: AppSession,
    me: MeResponse,
    onBack: () -> Unit,
    onSignOut: () -> Unit,
    onDeleted: () -> Unit,
    onReactionSetChanged: (List<String>?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    // The per-device typing prefs (the same persisted store the room reads) and the avatar cache the
    // identity puck reads (iOS: this screen owns its own instance, outside the room).
    val navPrefs = rememberNavigationSettingsStore()
    val avatarCache = rememberAvatarImageCache()
    val avatar = rememberAvatarBitmap(avatarCache, me.avatarUrl)
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
        providerLabel = providerLabel(session.auth.provider),
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
        avatar = avatar,
        solving = SolvingPrefs(
            skipFilledInWord = navPrefs.skipFilledInWord,
            endOfWordIsNextClue = navPrefs.endOfWordIsNextClue,
        ),
        onSkipFilledChange = navPrefs::updateSkipFilledInWord,
        onEndOfWordNextClueChange = navPrefs::updateEndOfWordIsNextClue,
        // The two-beat delete: tombstone the account (DELETE /account), purge the local session the
        // same way sign-out does (but no vendor logout: the account is gone), then land at sign-in.
        // A rejection carries its §12 code back for the inline sentence (INV-11: never a lockout).
        onDeleteAccount = {
            try {
                session.api.deleteAccount()
                session.auth.purgeForAccountDeletion()
                session.clearSession()
                onDeleted()
                DeleteAccountResult.Success
            } catch (e: CancellationException) {
                throw e
            } catch (e: CrossyApiError) {
                DeleteAccountResult.Failure(e.apiCodeString)
            } catch (e: Exception) {
                DeleteAccountResult.Failure(null)
            }
        },
        onOpenLegal = { page -> AuthBrowser.open(context, legalUrl(page)) },
        versionLabel = appVersionLabel(),
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
private fun JoinHost(session: AppSession, prefill: String = "", onBack: () -> Unit, onJoined: (GameView) -> Unit) {
    var busy by remember { mutableStateOf(false) }
    // The last join failure as a coded verdict (null = nothing to show): the §12 code through
    // ArrivalFailure, so the screen renders one sentence and treats DENIED as final. The raw
    // exception never crosses into :ui.
    var failure by remember { mutableStateOf<ArrivalFailure?>(null) }
    val scope = rememberCoroutineScope()
    // Camera-first (iOS JoinCodeScreen): the app target resolves the scan verdict and fills the
    // scanner slot with the CameraX preview (JoinCameraScan, AAD-2 — camera plumbing is not :ui's).
    // The screen renders the viewport and keeps the typed field standing beneath it; a scanned QR
    // takes the very same onJoin path as a typed code.
    val scanState = rememberJoinScanState()
    JoinCodeScreen(
        isBusy = busy,
        failure = failure,
        // An invite deep link's code, prefilled so the join is one tap away (iOS deepLinkPrefill).
        initialCode = prefill,
        onJoin = { code ->
            scope.launch {
                busy = true
                failure = null
                runCatching {
                    val membership = session.api.joinGame(code)
                    session.api.game(membership.gameId)
                }.onSuccess { onJoined(it) }.onFailure { failure = it.arrivalFailure() }
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
                }.onSuccess { onCreated(it) }.onFailure { error = it.arrivalFailure().sentence }
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
    // The game's REST id, the §12 room operations' key (abandon, kick, role change); null for the
    // demo room, which has no REST game behind it, so those affordances no-op or hide.
    gameId: String?,
    wsUrl: String?,
    inviteCode: String?,
    roster: List<Participant>,
    completedAt: String?,
    abandonedAt: String?,
    reactionEmojis: List<String>,
    onExit: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    // The person's typing-advance prefs (personal-settings slice 1): the same persisted store Settings
    // writes, read on room entry so a change made in Settings is honored the next time the room opens
    // (Android's single-screen shell never composes both at once, so entry read IS the live match).
    val navPrefs = rememberNavigationSettingsStore()
    // The solve haptics (Wave 7.5 / DESIGN.md §7): the player over the live View and Vibrator, and the
    // receive-haptics preference read on room entry (a stored default, ON, no Settings UI, matching iOS).
    val haptics = rememberSolveHapticPlayer()
    val reactionSettings = rememberReactionSettingsStore()
    // The store is born, then seeded with the tapped card's facts BEFORE the socket dials, so the
    // players pill stands at its true width and a done room retires its deck from the first frame
    // (the seeded-birth rule, DESIGN.md §4, §12; mirrors RealRoom.init). Each seed gates itself to
    // `connecting`, so the welcome always wins; an empty roster and null terminal facts (the demo
    // room, a join, a fresh start) are no-ops. Solved seeds completed, host-ended seeds abandoned;
    // the two are mutually exclusive, so the branches never both fire.
    val store = remember(puzzle) {
        GameStore().apply {
            if (roster.isNotEmpty()) seedRoster(roster)
            if (completedAt != null) seedCompleted(completedAt) else if (abandonedAt != null) seedAbandoned(abandonedAt)
        }
    }
    // The kicked terminal (PROTOCOL.md §6): the store hands the notice off here and the composition
    // root raises the exit (mirrors RealRoom's chrome.kicked flag). The driver stops redialing the
    // instant a kick lands (wired in the effect below), so no silent reconnect loop runs behind the
    // KickedExit notice.
    var kicked by remember(puzzle) { mutableStateOf(false) }
    // The instant the driver's next reconnect dial is due (SessionDriver.onReconnectScheduled). The
    // room bar counts it down while reconnecting; a stale value after the socket returns live is never
    // rendered (the chip gates on sync), so no clear step is needed (DESIGN.md §8).
    var reconnectRetryAt by remember(puzzle) { mutableStateOf<Long?>(null) }
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
                    // The driver owns the clock and hands the root the instant the next dial is due
                    // (DESIGN.md §8): the room bar shows it as the quiet countdown while reconnecting.
                    onReconnectScheduled = { deadline -> reconnectRetryAt = deadline },
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
        // A kick raises the calm terminal AND stops the redial loop at once: the server denylisted us
        // (PROTOCOL.md §12), so there is nothing to reconnect to. iOS lets the KickedExit replace the
        // room and the room's task unwind; cancelling the job here is that unwind, so the store's
        // post-close `reconnecting` never redials silently behind the notice.
        store.onKicked = {
            kicked = true
            job.cancel()
        }
        onDispose {
            store.onKicked = null
            job.cancel()
        }
    }
    // A kicked player gets the calm terminal treatment (EXPERIENCE.md §5): the room is replaced by the
    // one honest sentence and the way back to Rooms, no board left to browse (mirrors iOS SolveScreen's
    // kicked branch). Every other state renders the room.
    // The roster sheet's avatar bridge: the room owns one url-keyed cache (the AAD-2 split the
    // Settings puck already holds) and hands :ui a resolved-image reader; every roster row shares it,
    // so one member's avatar fetches once however many times the sheet opens.
    val avatarCache = rememberAvatarImageCache()
    val avatars = RosterAvatars { url -> rememberAvatarBitmap(avatarCache, url) }
    if (kicked) {
        KickedExit(ground = ground, onExit = onExit)
    } else {
        RoomScreen(
            store = store,
            puzzle = puzzle,
            roomName = roomName,
            onExit = onExit,
            onShare = onShare,
            reactionEmojis = reactionEmojis,
            reconnectRetryAt = reconnectRetryAt,
            navigationPrefs = navPrefs.navigationPrefs,
            haptics = haptics,
            receiveReactionHaptics = reactionSettings.receiveHapticsEnabled,
            avatars = avatars,
            // The room check reaches a real server only over the live socket (design R8; PROTOCOL.md
            // §5, §10): the demo room runs the scripted transport, which DROPS checkPuzzle, so it must
            // not grow the row. `wsUrl != null` is the live-transport gate the driver keys on above.
            supportsRoomCheck = wsUrl != null,
            // The host's end-game (POST /games/{id}/abandon, PROTOCOL.md §12; mirrors RealRoom.endGame):
            // the server settles the terminal state and the `gameAbandoned` event reaches the store over
            // the live socket, so the room freezes through the same path a peer's abandon would.
            // Host-only is the server's to enforce; the facts sheet offers this only to the host. A
            // failure is swallowed with a log (the room has no REST error surface yet, the iOS-reported
            // gap). Null for the demo room, so its facts sheet never offers End game.
            onEndGame = gameId?.let { id ->
                {
                    scope.launch {
                        runCatching { session.api.abandonGame(id) }
                            .onFailure { android.util.Log.w("CrossyRoom", "abandon failed: ${it::class.simpleName}") }
                    }
                }
            },
            // Kick (host, DELETE /games/{id}/members/{userId}; mirrors RealRoom.kick): the server
            // removes membership, writes the denylist, and disconnects their sockets. No frame tells
            // THIS host's socket, so the confirmed removal is reflected into the store at once instead
            // of at the next snapshot (PROTOCOL.md §12).
            onKick = { userId ->
                gameId?.let { id ->
                    scope.launch {
                        runCatching {
                            session.api.kickMember(id, userId)
                            store.removeParticipant(userId)
                        }.onFailure { android.util.Log.w("CrossyRoom", "kick failed: ${it::class.simpleName}") }
                    }
                }
            },
            // Join in (spectator -> solver, POST /games/{id}/role, the only server-supported
            // transition): the promoted seat reaches everyone through the room's next snapshot; the
            // wire stays the authority, so nothing is reflected locally here.
            onJoinIn = {
                gameId?.let { id ->
                    scope.launch {
                        runCatching { session.api.changeRole(id, Role.SOLVER) }
                            .onFailure { android.util.Log.w("CrossyRoom", "role change failed: ${it::class.simpleName}") }
                    }
                }
            },
            // The post-game analysis fetch (GET /games/{id}/analysis, mapped to the render shape here in
            // the composition root; mirrors iOS RealRoom.fetchAnalysis). Null for the demo room (no
            // gameId), where absent stands and nothing is fetched. Member-gated and completed-only
            // server-side (PROTOCOL.md §12); a 404 during the completion race, transport weather, or a
            // decode fault returns null, and AnalysisModel retries a few times before it calls the game
            // absent. INV-6-safe (userIds and numbers only).
            fetchAnalysis = gameId?.let { id ->
                suspend { runCatching { analysisFromView(session.api.gameAnalysis(id)) }.getOrNull() }
            },
        )
    }
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
